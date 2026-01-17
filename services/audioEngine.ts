
import { SpatialBand } from "../types";

export class AudioEngine {
  private context: AudioContext;
  private source: AudioBufferSourceNode | null = null;
  private analyzer: AnalyserNode;
  private masterVolume: GainNode;
  private panners: Map<string, PannerNode> = new Map();

  constructor() {
    this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyzer = this.context.createAnalyser();
    this.analyzer.fftSize = 2048;

    this.masterVolume = this.context.createGain();
    // Start at 0.25 (1/4) because audio goes through 4 panners
    // This ensures max volume = normal browser volume (no amplification/distortion)
    this.masterVolume.gain.value = 0.25;

    this.masterVolume.connect(this.analyzer);
    this.analyzer.connect(this.context.destination);
  }

  public setupBands(config: SpatialBand[]) {
    // Revert to a simpler setup: Create panners for each band
    this.panners.forEach(p => p.disconnect());
    this.panners.clear();

    config.forEach(band => {
      const panner = this.context.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'linear';
      panner.refDistance = 1;
      panner.maxDistance = 10000;
      panner.rolloffFactor = 1;
      panner.connect(this.masterVolume);
      this.panners.set(band.id, panner);
    });
  }

  public setVolume(value: number) {
    const now = this.context.currentTime;
    // Multiply by 0.25 to normalize for 4 panners
    // Volume slider 0-1 maps to 0% to 100% of normal volume (no boost)
    this.masterVolume.gain.setTargetAtTime(value * 0.25, now, 0.05);
  }

  public updateBandPosition(id: string, x: number, y: number, z: number) {
    const panner = this.panners.get(id);
    if (!panner) return;

    const now = this.context.currentTime;
    if (panner.positionX) {
      panner.positionX.setTargetAtTime(x, now, 0.05);
      panner.positionY.setTargetAtTime(y, now, 0.05);
      panner.positionZ.setTargetAtTime(z, now, 0.05);
    } else {
      panner.setPosition(x, y, z);
    }
  }

  public async playBuffer(buffer: AudioBuffer, offset: number = 0) {
    if (this.source) {
      try { this.source.stop(); } catch(e) {}
    }
    
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    this.source = this.context.createBufferSource();
    this.source.buffer = buffer;
    
    // In this simpler version, the whole signal goes to all panners 
    // to simulate the atmos effect without aggressive filtering
    this.panners.forEach(p => {
      this.source?.connect(p);
    });

    this.source.start(0, offset);
    return this.context.currentTime;
  }

  public stop() {
    try { 
      this.source?.stop(); 
      this.source = null;
    } catch(e) {}
  }

  public getAnalyser() {
    return this.analyzer;
  }

  public getContext() {
    return this.context;
  }
}
