
import { GoogleGenAI, Type } from "@google/genai";
import { AIAnalysisResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const analyzeAudioSnippet = async (base64Audio: string): Promise<AIAnalysisResult> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'audio/mp3',
            data: base64Audio,
          },
        },
        {
          text: "Analyze this 10-second audio snippet. Identify the genre and mood. Then, provide a recommended 3D spatial layout for 4 frequency bands: Sub-Bass (Deep lows), Mid-Low (Vocals/Snare), Mid-High (Guitars/Synths), and High (Cymbals/Air). Return JSON only.",
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          genre: { type: Type.STRING },
          mood: { type: Type.STRING },
          recommendedLayout: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                band: { type: Type.STRING },
                position: {
                  type: Type.OBJECT,
                  properties: {
                    x: { type: Type.NUMBER },
                    y: { type: Type.NUMBER },
                    z: { type: Type.NUMBER },
                  },
                  required: ["x", "y", "z"]
                },
                movementType: { type: Type.STRING },
              },
              required: ["band", "position", "movementType"]
            }
          }
        },
        required: ["genre", "mood", "recommendedLayout"]
      },
    },
  });

  try {
    const data = JSON.parse(response.text || '{}');
    return data as AIAnalysisResult;
  } catch (e) {
    console.error("Failed to parse AI response", e);
    throw e;
  }
};
