
export interface SpatialBand {
  id: string;
  name: string;
  frequency: number;
  x: number;
  y: number;
  z: number;
  color: string;
  gain: number;
}

export interface AIAnalysisResult {
  genre: string;
  mood: string;
  recommendedLayout: Array<{
    band: string;
    position: { x: number; y: number; z: number };
    movementType: 'static' | 'orbit' | 'pulse';
  }>;
}
