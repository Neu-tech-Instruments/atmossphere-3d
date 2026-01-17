
import { SpatialBand } from "../types";

export class AudioEngine {
  private context: AudioContext;
  private source: AudioBufferSourceNode | null = null;
  private analyzer: AnalyserNode;
  private masterVolume: GainNode;
  private panner: PannerNode;
  private bandPositions: Map<string, { x: number; y: number; z: number }> = new Map();

  constructor() {
    this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyzer = this.context.createAnalyser();
    this.analyzer.fftSize = 2048;

    this.masterVolume = this.context.createGain();
    this.masterVolume.gain.value = 1.0;

    // Single panner for 3D spatial effect
    this.panner = this.context.createPanner();
    this.panner.panningModel = 'equalpower'; // Less aggressive than HRTF, cleaner sound
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 1;
    this.panner.maxDistance = 100;
    this.panner.rolloffFactor = 0.1; // Very gentle rolloff to avoid volume changes
    this.panner.coneInnerAngle = 360;
    this.panner.coneOuterAngle = 360;
    this.panner.coneOuterGain = 1;

    // Audio path: source -> panner -> volume -> analyzer -> output
    this.panner.connect(this.masterVolume);
    this.masterVolume.connect(this.analyzer);
    this.analyzer.connect(this.context.destination);
  }

  public setupBands(config: SpatialBand[]) {
    // Store band positions for visualization
    config.forEach(band => {
      this.bandPositions.set(band.id, { x: band.x, y: band.y, z: band.z });
    });
  }

  public setVolume(value: number) {
    const now = this.context.currentTime;
    this.masterVolume.gain.setTargetAtTime(value, now, 0.05);
  }

  public updateBandPosition(id: string, x: number, y: number, z: number) {
    // Store position for visualization
    this.bandPositions.set(id, { x, y, z });

    // Move the single panner based on the first band (sub/kick) position
    // This creates the spinning effect
    if (id === 'sub') {
      // Use short ramp (16ms) to prevent audio cracks while staying smooth
      // Intensity at 0.2 for subtle effect that won't distort
      const rampTime = this.context.currentTime + 0.016;
      const intensity = 0.2;
      if (this.panner.positionX) {
        this.panner.positionX.linearRampToValueAtTime(x * intensity, rampTime);
        this.panner.positionY.linearRampToValueAtTime(y * intensity, rampTime);
        this.panner.positionZ.linearRampToValueAtTime(z * intensity, rampTime);
      } else {
        this.panner.setPosition(x * intensity, y * intensity, z * intensity);
      }
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

    // Connect through the panner for spatial effect
    this.source.connect(this.panner);

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
