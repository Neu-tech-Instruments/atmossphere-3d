
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SpatialBand, AIAnalysisResult } from './types';
import { AudioEngine } from './services/audioEngine';
import { analyzeAudioSnippet } from './services/geminiService';
import Stage3D from './components/Stage3D';
import { storageService, StoredAudio } from './services/storageService';

const INITIAL_BANDS: SpatialBand[] = [
  { id: 'sub', name: 'Low/Kick', frequency: 100, x: 0, y: 0, z: -16, color: '#06b6d4', gain: 1.0 },
  { id: 'midlow', name: 'Vocal/Mid', frequency: 500, x: -16, y: 0, z: -8, color: '#3b82f6', gain: 1.0 },
  { id: 'midhigh', name: 'Lead/Synth', frequency: 2500, x: 16, y: 0, z: -8, color: '#8b5cf6', gain: 1.0 },
  { id: 'high', name: 'Cymbal/Air', frequency: 8000, x: 0, y: 0, z: 16, color: '#ec4899', gain: 1.0 },
];

const App: React.FC = () => {
  const [bands, setBands] = useState<SpatialBand[]>(INITIAL_BANDS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isOmniMode, setIsOmniMode] = useState(false);
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [storedFiles, setStoredFiles] = useState<StoredAudio[]>([]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1.0);
  const [rotationSpeed, setRotationSpeed] = useState(5.0);
  const [isDragging, setIsDragging] = useState(false);

  const audioEngineRef = useRef<AudioEngine | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<number>(0);
  const progressRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const audioContextStartTimeRef = useRef<number>(0);
  const playbackOffsetRef = useRef<number>(0);

  const bandsRef = useRef<SpatialBand[]>(INITIAL_BANDS);
  const workerRef = useRef<Worker | null>(null);

  const refreshLibrary = async () => {
    try {
      const files = await storageService.getAllAudioFiles();
      setStoredFiles(files);
    } catch (e) {
      console.error("Failed to refresh library", e);
    }
  };

  useEffect(() => {
    // Initialize Audio Engine
    audioEngineRef.current = new AudioEngine();
    audioEngineRef.current.setupBands(INITIAL_BANDS);
    setAnalyser(audioEngineRef.current.getAnalyser());

    // Create a Web Worker for background timing
    const workerScript = `
      let intervalId;
      self.onmessage = function(e) {
        if (e.data === 'start') {
          if (intervalId) clearInterval(intervalId);
          intervalId = setInterval(() => postMessage('tick'), 20); // 50fps
        } else if (e.data === 'stop') {
          clearInterval(intervalId);
          intervalId = null;
        }
      };
    `;
    const blob = new Blob([workerScript], { type: 'application/javascript' });
    workerRef.current = new Worker(URL.createObjectURL(blob));

    // Load stored files
    const loadLibrary = async () => {
      try {
        const files = await storageService.getAllAudioFiles();
        setStoredFiles(files);
        if (files.length > 0) {
          console.log("Loading most recent track:", files[0].name);
          await loadTrack(files[0].file, false);
        }
      } catch (err) {
        console.error("Failed to load library", err);
      }
    };

    loadLibrary();

    return () => {
      workerRef.current?.terminate();
      if (progressRef.current) cancelAnimationFrame(progressRef.current);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // Physics Update logic...
  const updatePhysics = useCallback(() => {
    if (!isOmniMode || !isPlaying) return;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    const updated = bandsRef.current.map((band, idx) => {
      const radius = 18;
      const basePhase = elapsed * rotationSpeed;
      const bandOffset = (idx * (Math.PI / 8));
      const newX = Math.cos(basePhase + bandOffset) * radius;
      const newZ = Math.sin(basePhase + bandOffset) * radius;
      const newY = Math.sin(basePhase * 0.4) * 1.5;
      audioEngineRef.current?.updateBandPosition(band.id, newX, newY, newZ);
      return { ...band, x: newX, y: newY, z: newZ };
    });
    bandsRef.current = updated;
  }, [isOmniMode, isPlaying, rotationSpeed]);

  const animateUI = useCallback(() => {
    if (isOmniMode && isPlaying) {
      setBands(bandsRef.current);
      requestRef.current = requestAnimationFrame(animateUI);
    }
  }, [isOmniMode, isPlaying]);

  useEffect(() => {
    if (!workerRef.current) return;
    workerRef.current.onmessage = (e) => {
      if (e.data === 'tick') updatePhysics();
    };
  }, [updatePhysics]);

  useEffect(() => {
    if (isOmniMode && isPlaying) {
      startTimeRef.current = Date.now();
      workerRef.current?.postMessage('start');
      requestRef.current = requestAnimationFrame(animateUI);
    } else {
      workerRef.current?.postMessage('stop');
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    }
  }, [isOmniMode, isPlaying, animateUI]);

  const startPlayback = async (offset: number) => {
    if (audioBufferRef.current && audioEngineRef.current) {
      playbackOffsetRef.current = offset;
      const startTime = await audioEngineRef.current.playBuffer(audioBufferRef.current, offset);
      audioContextStartTimeRef.current = startTime;
      setIsPlaying(true);
    }
  };

  const loadTrack = async (file: File, shouldSave: boolean = true) => {
    if (!audioEngineRef.current) return;

    if (shouldSave) {
      storageService.saveAudioFile(file)
        .then(() => refreshLibrary())
        .catch(err => console.error("Failed to save file", err));
    }

    setFileName(file.name);

    // Read file for AI analysis
    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target?.result as ArrayBuffer;

      setIsAnalyzing(true);
      try {
        const snippetBlob = new Blob([arrayBuffer.slice(0, 1024 * 1024)], { type: 'audio/mp3' });
        const snippetBase64 = await blobToBase64(snippetBlob);
        const result = await analyzeAudioSnippet(snippetBase64);
        setAnalysis(result);
      } catch (err) {
        console.error("AI Analysis failed", err);
      } finally {
        setIsAnalyzing(false);
      }
    };
    reader.readAsArrayBuffer(file);

    // Load and play with Howler
    try {
      await audioEngineRef.current.loadAndPlay(file, (dur) => {
        setDuration(dur);
        setCurrentTime(0);
      });

      setIsPlaying(true);
      setIsOmniMode(true);
      audioContextStartTimeRef.current = audioEngineRef.current.getContext().currentTime;
      playbackOffsetRef.current = 0;
    } catch (error) {
      console.error("Error loading audio:", error);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await loadTrack(file, true);
  };

  const deleteTrack = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    if (window.confirm(`Delete ${name}?`)) {
      await storageService.deleteAudioFile(name);
      await refreshLibrary();
    }
  };

  // ... (Seek, volume, rotation handlers remain the same - omitting for brevity in replace block, but need to ensure context is right)
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
  };

  const handleSeekEnd = async () => {
    setIsDragging(false);
    if (audioEngineRef.current) {
      audioEngineRef.current.seek(currentTime);
      playbackOffsetRef.current = currentTime;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    audioEngineRef.current?.setVolume(newVol);
  };

  const handleRotationSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newSpeed = parseFloat(e.target.value);
    setRotationSpeed(newSpeed);
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    });
  };

  const updatePosition = useCallback((id: string, x: number, y: number) => {
    if (isOmniMode) return;
    setBands(prev => {
      const updated = prev.map(b => b.id === id ? { ...b, x, y } : b);
      audioEngineRef.current?.updateBandPosition(id, x, y, 0);
      return updated;
    });
  }, [isOmniMode]);

  const togglePlay = () => {
    if (!audioEngineRef.current) return;
    if (isPlaying) {
      audioEngineRef.current.pause();
      setIsPlaying(false);
      playbackOffsetRef.current = currentTime;
    } else {
      audioEngineRef.current.play();
      setIsPlaying(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white p-6 md:p-12 selection:bg-cyan-500/30 overflow-x-hidden">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center mb-12 gap-6">
          <div>
            <h1 className="text-6xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-br from-white via-white to-white/40 mb-2">
              AtmosSphere
            </h1>
            <p className="text-white/40 max-w-md font-medium text-lg leading-tight uppercase tracking-widest text-xs">
              Transparent 3D Audio • Multi-Speed Rotation
            </p>
          </div>
          <div className="flex flex-wrap gap-4 items-center">
            {/* ... Header Controls ... */}
            <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-full px-5 py-2 backdrop-blur-xl">
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Vol</span>
              <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVolumeChange} className="w-20 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white" />
            </div>
            <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-full pl-5 pr-2 py-1.5 backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Speed</span>
                <input type="range" min="0" max="100" step="0.5" value={rotationSpeed} onChange={handleRotationSpeedChange} className="w-20 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400" />
              </div>
              <div className="flex gap-1">
                {[5, 10, 25, 50, 75].map((speed) => (
                  <button key={speed} onClick={() => setRotationSpeed(speed)} className={`w-7 h-7 flex items-center justify-center rounded-full text-[9px] font-bold transition-all border ${rotationSpeed === speed ? 'bg-cyan-500 border-cyan-400 text-black shadow-lg shadow-cyan-500/20' : 'bg-white/5 border-white/10 text-white/40 hover:text-white'}`}>{speed}</button>
                ))}
              </div>
            </div>
            <button onClick={() => setIsOmniMode(!isOmniMode)} className={`px-8 py-3.5 rounded-full font-black uppercase tracking-tighter text-xs transition-all border-2 ${isOmniMode ? 'bg-cyan-500 border-cyan-400 text-black shadow-lg shadow-cyan-500/20' : 'bg-white/5 border-white/10 text-white/60'}`}>{isOmniMode ? "Rotation Active" : "Enable 360 Rotation"}</button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="audio/*" className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="px-8 py-3.5 bg-white text-black font-black uppercase tracking-tighter text-xs rounded-full hover:scale-105 transition-all shadow-xl shadow-white/5">Upload MP3</button>
            {fileName && (
              <button onClick={togglePlay} className={`w-12 h-12 flex items-center justify-center rounded-full border border-white/10 shadow-xl transition-all ${isPlaying ? 'bg-red-500 border-red-400' : 'bg-white text-black'}`}>
                {isPlaying ? <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg> : <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>}
              </button>
            )}
          </div>
        </header>

        {fileName && (
          <div className="bg-white/5 border border-white/10 rounded-3xl p-6 mb-12 backdrop-blur-md">
            <div className="flex justify-between text-[10px] font-black text-white/20 mb-3 uppercase tracking-widest">
              <span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span>
            </div>
            <input type="range" min="0" max={duration || 100} step="0.1" value={currentTime} onChange={handleSeek} onMouseDown={() => setIsDragging(true)} onMouseUp={handleSeekEnd} onTouchStart={() => setIsDragging(true)} onTouchEnd={handleSeekEnd} className="w-full h-1.5 bg-white/5 rounded-full appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 transition-all" />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-12 mb-20">
          <div className="lg:col-span-1 space-y-8">
            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
              <h3 className="text-[10px] font-black text-white/40 uppercase mb-4 tracking-widest">Track Info</h3>
              <div className="mb-4">
                <p className="text-xl font-black truncate text-white">{fileName || "No file selected"}</p>
                {analysis && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    <div className="px-2 py-1 bg-white/10 text-white/60 rounded text-[9px] border border-white/5 uppercase font-black tracking-widest">{analysis.genre}</div>
                    <div className="px-2 py-1 bg-cyan-500/10 text-cyan-400 rounded text-[9px] border border-cyan-500/20 uppercase font-black tracking-widest">{analysis.mood}</div>
                  </div>
                )}
              </div>
            </div>

            {/* NEW: LIBRARY SECTION */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
              <h3 className="text-[10px] font-black text-white/40 uppercase mb-4 tracking-widest">Library</h3>
              <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                {storedFiles.map(f => (
                  <div key={f.name} className={`group flex justify-between items-center p-3 rounded-lg border cursor-pointer transition-all ${fileName === f.name ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-white/5 border-white/5 hover:bg-white/10'}`} onClick={() => loadTrack(f.file, false)}>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold truncate ${fileName === f.name ? 'text-cyan-400' : 'text-white/70 group-hover:text-white'}`}>{f.name}</p>
                      <p className="text-[9px] text-white/20 mt-0.5">{new Date(f.timestamp).toLocaleDateString()}</p>
                    </div>
                    <button onClick={(e) => deleteTrack(e, f.name)} className="w-6 h-6 flex items-center justify-center text-white/20 hover:text-red-400 transition-colors ml-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                ))}
                {storedFiles.length === 0 && (
                  <div className="text-center py-4 text-white/20 text-xs italic">No tracks uploaded yet</div>
                )}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-[10px] font-black text-white/20 uppercase tracking-widest">Atmosphere</h3>
                <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)] animate-pulse"></div>
              </div>
              {bands.map((band) => (
                <div key={band.id} className="space-y-2">
                  <div className="flex justify-between items-center text-[9px] uppercase font-black tracking-widest">
                    <span className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: band.color }}></div>
                      {band.name}
                    </span>
                    <span className="text-white/20">
                      {isOmniMode ? 'Active' : 'Static'}
                    </span>
                  </div>
                  <div className="h-0.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full transition-all duration-75" style={{ width: '100%', transform: `translateX(${(band.x * 2.5)}%)`, backgroundColor: band.color, opacity: 0.8 }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3">
            <Stage3D bands={bands} onPositionChange={updatePosition} isAnalyzing={isAnalyzing} analyser={analyser} />
          </div>
        </div>

        <footer className="pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center text-[10px] font-black text-white/10 gap-4 uppercase tracking-widest mb-12">
          <div className="flex items-center gap-8">
            <span>Standard High-Fidelity HRTF</span>
            <span>Bit-Perfect Passthrough</span>
          </div>
          <div className="flex items-center gap-4">
            <p>© 2024 AtmosSphere</p>
          </div>
        </footer>

      </div>

      <div className="fixed top-0 left-0 w-full h-full pointer-events-none -z-10 opacity-30">
        <div className={`absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] rounded-full bg-cyan-900/10 blur-[150px] transition-all duration-[2000ms] ${isOmniMode ? 'scale-110 opacity-40' : 'scale-100 opacity-20'}`}></div>
      </div>
    </div>
  );
};

export default App;
