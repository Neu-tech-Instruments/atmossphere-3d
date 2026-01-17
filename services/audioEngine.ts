
import { SpatialBand } from "../types";

export class AudioEngine {
  private context: AudioContext;
  private source: AudioBufferSourceNode | null = null;
  private analyzer: AnalyserNode;
  private masterVolume: GainNode;
  private bandPositions: Map<string, { x: number; y: number; z: number }> = new Map();

  constructor() {
    this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyzer = this.context.createAnalyser();
    this.analyzer.fftSize = 2048;

    this.masterVolume = this.context.createGain();
    this.masterVolume.gain.value = 1.0;

    // Clean audio path: source -> volume -> analyzer -> output
    this.masterVolume.connect(this.analyzer);
    this.analyzer.connect(this.context.destination);
  }

  public setupBands(config: SpatialBand[]) {
    // Store band positions for visualization (no audio processing)
    config.forEach(band => {
      this.bandPositions.set(band.id, { x: band.x, y: band.y, z: band.z });
    });
  }

  public setVolume(value: number) {
    const now = this.context.currentTime;
    // Simple volume control: 0-1 maps to 0%-100% volume
    this.masterVolume.gain.setTargetAtTime(value, now, 0.05);
  }

  public updateBandPosition(id: string, x: number, y: number, z: number) {
    // Store position for visualization only
    this.bandPositions.set(id, { x, y, z });
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

    // Direct connection: clean audio without spatial filtering
    this.source.connect(this.masterVolume);

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
