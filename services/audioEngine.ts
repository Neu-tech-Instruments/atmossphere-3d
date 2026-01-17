
import { Howl, Howler } from 'howler';
import { SpatialBand } from "../types";

export class AudioEngine {
  private howl: Howl | null = null;
  private context: AudioContext;
  private analyzer: AnalyserNode;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private bandPositions: Map<string, { x: number; y: number; z: number }> = new Map();
  private currentVolume: number = 1.0;
  private lastPanUpdate: number = 0;
  private soundId: number | undefined;

  private makeupGain: GainNode | null = null;
  private masterLimiter: DynamicsCompressorNode | null = null;

  constructor() {
    this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyzer = this.context.createAnalyser();
    this.analyzer.fftSize = 2048;
    this.analyzer.connect(this.context.destination);
  }

  public setupBands(config: SpatialBand[]) {
    config.forEach(band => {
      this.bandPositions.set(band.id, { x: band.x, y: band.y, z: band.z });
    });
  }

  private setupMastering() {
    const ctx = Howler.ctx;
    if (!ctx || !Howler.masterGain) return;

    // Create mastering nodes if they don't exist
    if (!this.makeupGain) {
      this.makeupGain = ctx.createGain();
      // COMMERCIAL LOUDNESS BOOST
      // 3.5x boost allows us to compete with mastered tracks.
      // Combined with the Limiter, this crushes the dynamic range upwards (density).
      this.makeupGain.gain.value = 3.5;
    }

    if (!this.masterLimiter) {
      this.masterLimiter = ctx.createDynamicsCompressor();
      // BRICKWALL LIMITER SETTINGS
      // Threshold close to 0 to maximize headroom usage
      this.masterLimiter.threshold.value = -1.0;
      this.masterLimiter.knee.value = 0; // Hard knee for immediate limiting
      this.masterLimiter.ratio.value = 40.0; // Infinite-like ratio (brickwall)
      this.masterLimiter.attack.value = 0.001; // Instant attack
      this.masterLimiter.release.value = 0.05; // Fast release to recover punch
    }

    // Connect the chain: HowlerMaster -> MakeupGain -> Limiter -> Destination
    try {
      // First, disconnect Howler's default path to destination to avoid doubling
      Howler.masterGain.disconnect(ctx.destination);
    } catch (e) {
      // Ignore if already disconnected
    }

    // Ensure we don't have duplicate connections if called multiple times
    this.makeupGain.disconnect();
    this.masterLimiter.disconnect();

    // Re-establish the chain
    Howler.masterGain.connect(this.makeupGain);
    this.makeupGain.connect(this.masterLimiter);
    this.masterLimiter.connect(ctx.destination);
  }

  public setVolume(value: number) {
    this.currentVolume = value;
    if (this.howl) {
      this.howl.volume(value);
    }
  }

  public updateBandPosition(id: string, x: number, y: number, z: number) {
    this.bandPositions.set(id, { x, y, z });

    if (id === 'sub' && this.howl && this.soundId !== undefined) {
      const now = Date.now();
      if (now - this.lastPanUpdate < 33) return;
      this.lastPanUpdate = now;

      const scale = 0.5;
      this.howl.pos(x * scale, y * scale, z * scale, this.soundId);
    }
  }

  public async playBuffer(buffer: AudioBuffer, offset: number = 0): Promise<number> {
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    return this.context.currentTime;
  }

  public async loadAndPlay(file: File, onLoad?: (duration: number) => void): Promise<void> {
    // Stop any existing playback
    if (this.howl) {
      this.howl.unload();
      this.sourceNode = null;
    }

    // Unlock audio context first (required by browsers)
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    // Also unlock Howler's context
    if (Howler.ctx && Howler.ctx.state === 'suspended') {
      await Howler.ctx.resume();
    }

    const url = URL.createObjectURL(file);

    return new Promise((resolve, reject) => {
      this.howl = new Howl({
        src: [url],
        format: ['mp3', 'wav', 'ogg', 'm4a', 'webm'],
        html5: false,
        volume: this.currentVolume,
        autoplay: true, // Auto-play when loaded
        onload: () => {
          console.log('Audio loaded successfully');
          if (onLoad && this.howl) {
            onLoad(this.howl.duration());
          }

          // Apply mastering chain: Massive boost + Brickwall Limiter
          this.setupMastering();

          // Optimize 3D Spatial Audio for maximum loudness
          // The visual bands are at radius ~18. Default refDistance is 1.
          // This caused massive volume drop (inverse square law).
          // Setting refDistance > radius ensures virtually no distance attenuation, just panning.
          (Howler as any).pannerAttr({
            panningModel: 'HRTF',
            refDistance: 25, // Distance where volume is 100%. Our bands are at 18.
            rolloffFactor: 0.5, // Gentle falloff if things go further
            distanceModel: 'inverse'
          });

          // Connect to analyzer
          try {
            const ctx = Howler.ctx;
            if (ctx && Howler.masterGain) {
              const splitter = ctx.createGain();
              Howler.masterGain.connect(splitter);
              splitter.connect(this.analyzer);
            }
          } catch (e) {
            console.log('Could not connect analyzer:', e);
          }

          // Set up listener
          Howler.pos(0, 0, 0);
          Howler.orientation(0, 0, -1, 0, 1, 0);
        },
        onplay: (id) => {
          console.log('Audio playing, id:', id);
          this.soundId = id;
          resolve();
        },
        onloaderror: (id, error) => {
          console.error('Load error:', error);
          reject(error);
        },
        onplayerror: (id, error) => {
          console.error('Play error:', error);
          // Try to unlock and play again
          if (Howler.ctx && Howler.ctx.state === 'suspended') {
            Howler.ctx.resume().then(() => {
              this.howl?.play();
            });
          }
        }
      });
    });
  }

  public play() {
    if (this.howl) {
      this.soundId = this.howl.play();
    }
  }

  public pause() {
    if (this.howl) {
      this.howl.pause();
    }
  }

  public stop() {
    if (this.howl) {
      this.howl.stop();
    }
  }

  public seek(time: number) {
    if (this.howl && this.soundId !== undefined) {
      this.howl.seek(time, this.soundId);
    }
  }

  public getCurrentTime(): number {
    if (this.howl && this.soundId !== undefined) {
      const time = this.howl.seek(this.soundId);
      return typeof time === 'number' ? time : 0;
    }
    return 0;
  }

  public isPlaying(): boolean {
    return this.howl?.playing() || false;
  }

  public getAnalyser() {
    return this.analyzer;
  }

  public getContext() {
    return this.context;
  }
}
