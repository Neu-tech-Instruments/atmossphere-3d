
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { SpatialBand } from '../types';

interface Stage3DProps {
  bands: SpatialBand[];
  onPositionChange: (id: string, x: number, y: number) => void;
  isAnalyzing: boolean;
  analyser: AnalyserNode | null;
}

const Stage3D: React.FC<Stage3DProps> = ({ bands, onPositionChange, isAnalyzing, analyser }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const centerX = width / 2;
    const centerY = height / 2;

    // Persistent layers
    if (svg.select(".bg-layer").empty()) {
      svg.append("g").attr("class", "bg-layer");
      svg.append("g").attr("class", "content-layer");
    }

    const bgLayer = svg.select(".bg-layer");
    const contentLayer = svg.select(".content-layer");

    bgLayer.selectAll("*").remove();

    // Range rings
    [50, 100, 150, 200, 250].forEach((r, i) => {
      bgLayer.append("circle")
        .attr("cx", centerX)
        .attr("cy", centerY)
        .attr("r", r)
        .attr("fill", "none")
        .attr("stroke", i === 0 ? "#444" : "#222")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", i % 2 === 0 ? "none" : "5,5");
    });

    // Axis
    bgLayer.append("line").attr("x1", centerX).attr("y1", 0).attr("x2", centerX).attr("y2", height).attr("stroke", "#111");
    bgLayer.append("line").attr("x1", 0).attr("y1", centerY).attr("x2", width).attr("y2", centerY).attr("stroke", "#111");

    // Listener
    const listener = contentLayer.selectAll(".listener").data([0]);
    const listenerEnter = listener.enter().append("g").attr("class", "listener")
      .attr("transform", `translate(${centerX}, ${centerY})`);
    
    listenerEnter.append("circle").attr("r", 15).attr("fill", "#7c3aed").attr("class", "animate-pulse");
    listenerEnter.append("path").attr("d", "M -8 -4 L 0 -12 L 8 -4").attr("stroke", "white").attr("fill", "none");

    // Drag behavior
    const drag = d3.drag<SVGGElement, SpatialBand>()
      .on("drag", (event, d) => {
        const newX = (event.x - centerX) / 15;
        const newY = (event.y - centerY) / 15;
        onPositionChange(d.id, newX, -newY);
      });

    // Draw Bands
    const nodes = contentLayer.selectAll(".band-node").data(bands, (d: any) => d.id);
    nodes.exit().remove();

    const nodesEnter = nodes.enter()
      .append("g")
      .attr("class", "band-node cursor-pointer")
      .call(drag as any);

    nodesEnter.append("circle")
      .attr("class", "orb-glow")
      .attr("r", 20)
      .attr("opacity", 0.2)
      .attr("filter", "blur(8px)");

    nodesEnter.append("circle")
      .attr("class", "orb")
      .attr("r", 12)
      .attr("filter", "blur(2px)");

    nodesEnter.append("text")
      .attr("class", "label")
      .attr("dy", -22)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("font-weight", "bold");

    const merged = nodesEnter.merge(nodes as any);
    merged.attr("transform", d => `translate(${centerX + d.x * 15}, ${centerY - d.y * 15})`);

    merged.select(".orb")
      .attr("fill", d => d.color)
      .attr("r", d => 12 + d.z * 0.5)
      .attr("opacity", d => Math.max(0.6, 1 + d.z * 0.05));

    merged.select(".orb-glow")
      .attr("fill", d => d.color);

    merged.select(".label")
      .attr("fill", d => d.color)
      .text(d => d.name);

    // AI Analysis Overlay
    if (isAnalyzing) {
      const overlay = contentLayer.selectAll(".analyzing-group").data([0]);
      const overlayEnter = overlay.enter().append("g").attr("class", "analyzing-group");
      
      overlayEnter.append("rect")
        .attr("width", width)
        .attr("height", height)
        .attr("fill", "rgba(0,0,0,0.6)")
        .attr("class", "pointer-events-none");
        
      overlayEnter.append("text")
        .attr("x", centerX)
        .attr("y", centerY + 40)
        .attr("text-anchor", "middle")
        .attr("fill", "#7c3aed")
        .attr("class", "animate-pulse font-bold tracking-widest text-xs")
        .text("GEMINI SCANNING SONIC TEXTURES...");
    } else {
      contentLayer.selectAll(".analyzing-group").remove();
    }

    // Animation loop for frequency pulsing
    if (analyser) {
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updatePulsing = () => {
        analyser.getByteFrequencyData(dataArray);
        
        // Split frequencies into 4 buckets for our 4 bands
        // 0: Sub, 1: Mid-Low, 2: Mid-High, 3: High
        const bucketSize = Math.floor(bufferLength / 8); // Focus on first half of spectrum mostly
        
        merged.each(function(d, i) {
          const bucketStart = i * bucketSize;
          let sum = 0;
          for (let j = 0; j < bucketSize; j++) {
            sum += dataArray[bucketStart + j];
          }
          const avg = sum / bucketSize;
          const scale = 1 + (avg / 255) * 1.5; // Scale factor 1.0 to 2.5
          
          const g = d3.select(this);
          g.select(".orb")
            .attr("r", (12 + d.z * 0.5) * scale);
          
          g.select(".orb-glow")
            .attr("r", (20 + d.z * 0.5) * scale)
            .attr("opacity", (avg / 255) * 0.6 + 0.1);
        });

        rafRef.current = requestAnimationFrame(updatePulsing);
      };

      rafRef.current = requestAnimationFrame(updatePulsing);
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };

  }, [bands, onPositionChange, isAnalyzing, analyser]);

  return (
    <div className="relative w-full h-[500px] bg-black rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
      <svg ref={svgRef} className="w-full h-full" />
      <div className="absolute top-4 left-4 flex flex-col gap-1">
        <div className="text-[10px] text-white/40 uppercase tracking-widest font-semibold">
          Omni-Directional Stage
        </div>
        <div className="text-[8px] text-white/20 uppercase tracking-[0.2em]">
          (Top-Down View + Frequency Pulse)
        </div>
      </div>
      <div className="absolute bottom-4 right-4 flex gap-2">
        <div className="flex items-center gap-2 px-3 py-1 bg-purple-500/10 rounded-full border border-purple-500/20">
          <div className="w-2 h-2 rounded-full bg-purple-500 animate-ping"></div>
          <span className="text-[10px] text-purple-400 font-bold tracking-tighter uppercase">Sonic Feed Active</span>
        </div>
      </div>
    </div>
  );
};

export default Stage3D;
