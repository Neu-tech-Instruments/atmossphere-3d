
import { SpatialBand } from "../types";

export class AudioEngine {
  private context: AudioContext;
  private source: AudioBufferSourceNode | null = null;
  private analyzer: AnalyserNode;
  private masterVolume: GainNode;
  private stereoPanner: StereoPannerNode;
  private bandPositions: Map<string, { x: number; y: number; z: number }> = new Map();

  constructor() {
    this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyzer = this.context.createAnalyser();
    this.analyzer.fftSize = 2048;

    this.masterVolume = this.context.createGain();
    this.masterVolume.gain.value = 1.0;

    // Simple stereo panner for clean left-right movement
    this.stereoPanner = this.context.createStereoPanner();
    this.stereoPanner.pan.value = 0;

    // Audio path: source -> stereoPanner -> volume -> analyzer -> output
    this.stereoPanner.connect(this.masterVolume);
    this.masterVolume.connect(this.analyzer);
    this.analyzer.connect(this.context.destination);
  }

  public setupBands(config: SpatialBand[]) {
    config.forEach(band => {
      this.bandPositions.set(band.id, { x: band.x, y: band.y, z: band.z });
    });
  }

  public setVolume(value: number) {
    const now = this.context.currentTime;
    this.masterVolume.gain.setTargetAtTime(value, now, 0.05);
  }

  public updateBandPosition(id: string, x: number, y: number, z: number) {
    this.bandPositions.set(id, { x, y, z });

    // Use the x position to control stereo panning (left-right)
    if (id === 'sub') {
      // Normalize x to -1 to 1 range for stereo pan
      // x ranges roughly from -18 to 18, so divide by 18
      const panValue = Math.max(-1, Math.min(1, x / 18));

      // Smooth transition
      const rampTime = this.context.currentTime + 0.05;
      this.stereoPanner.pan.linearRampToValueAtTime(panValue, rampTime);
    }
  }

  public async playBuffer(buffer: AudioBuffer, offset: number = 0) {
    if (this.source) {
      try { this.source.stop(); } catch (e) { }
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    this.source = this.context.createBufferSource();
    this.source.buffer = buffer;

    this.source.connect(this.stereoPanner);

    this.source.start(0, offset);
    return this.context.currentTime;
  }

  public stop() {
    try {
      this.source?.stop();
      this.source = null;
    } catch (e) { }
  }

  public getAnalyser() {
    return this.analyzer;
  }

  public getContext() {
    return this.context;
  }
}
