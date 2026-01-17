
import { Howl } from 'howler';
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

    // Throttle stereo updates
    if (id === 'sub' && this.howl && this.soundId !== undefined) {
      const now = Date.now();
      if (now - this.lastPanUpdate < 50) return;
      this.lastPanUpdate = now;

      // Normalize x to -1 to 1 range for stereo
      const stereoValue = Math.max(-1, Math.min(1, x / 18));
      this.howl.stereo(stereoValue, this.soundId);
    }
  }

  public async playBuffer(buffer: AudioBuffer, offset: number = 0): Promise<number> {
    // Howler needs a URL, so we'll convert the buffer to a blob URL
    // This method is called with an AudioBuffer, but we need to adapt for Howler

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    return this.context.currentTime;
  }

  public async loadAndPlay(file: File, onLoad?: (duration: number) => void): Promise<void> {
    // Stop any existing playback
    if (this.howl) {
      this.howl.unload();
    }

    const url = URL.createObjectURL(file);

    return new Promise((resolve) => {
      this.howl = new Howl({
        src: [url],
        html5: true, // Use HTML5 Audio for large files
        volume: this.currentVolume,
        onload: () => {
          if (onLoad && this.howl) {
            onLoad(this.howl.duration());
          }

          // Connect to analyzer for visualization
          if (this.howl) {
            const audioElement = (this.howl as any)._sounds[0]._node as HTMLAudioElement;
            if (audioElement && !this.sourceNode) {
              try {
                this.sourceNode = this.context.createMediaElementSource(audioElement);
                this.sourceNode.connect(this.analyzer);
              } catch (e) {
                // Already connected
              }
            }
          }

          resolve();
        },
        onplay: () => {
          if (this.context.state === 'suspended') {
            this.context.resume();
          }
        }
      });

      this.soundId = this.howl.play();
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
      return this.howl.seek(undefined, this.soundId) as number || 0;
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
