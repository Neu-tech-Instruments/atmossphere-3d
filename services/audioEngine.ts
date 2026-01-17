
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

          // Set up 3D spatial audio
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
