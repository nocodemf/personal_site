"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Id } from "../../convex/_generated/dataModel";

interface HeatmapNote {
  _id: Id<"notes">;
  title: string;
  color: string;
  tags: string[];
  positionX: number;
  positionY: number;
  relatedNotes: Id<"notes">[];
  connectionCount: number;
}

interface KnowledgeHeatmapProps {
  notes: HeatmapNote[];
  onNoteClick: (noteId: Id<"notes">) => void;
  width?: number;
  height?: number;
}

// Color palette matching the reference image
const HEATMAP_COLORS = [
  { threshold: 0.0, color: [138, 138, 138] },    // Gray background
  { threshold: 0.05, color: [107, 140, 174] },   // Light blue dots
  { threshold: 0.15, color: [74, 124, 174] },    // Blue
  { threshold: 0.35, color: [122, 179, 212] },   // Light blue blend
  { threshold: 0.55, color: [232, 232, 84] },    // Yellow
  { threshold: 0.75, color: [232, 156, 84] },    // Orange
  { threshold: 0.90, color: [232, 84, 84] },     // Red hot spots
];

function interpolateColor(value: number): [number, number, number] {
  // Clamp value
  value = Math.max(0, Math.min(1, value));
  
  // Find the two colors to interpolate between
  let lower = HEATMAP_COLORS[0];
  let upper = HEATMAP_COLORS[HEATMAP_COLORS.length - 1];
  
  for (let i = 0; i < HEATMAP_COLORS.length - 1; i++) {
    if (value >= HEATMAP_COLORS[i].threshold && value <= HEATMAP_COLORS[i + 1].threshold) {
      lower = HEATMAP_COLORS[i];
      upper = HEATMAP_COLORS[i + 1];
      break;
    }
  }
  
  // Interpolate
  const range = upper.threshold - lower.threshold;
  const t = range > 0 ? (value - lower.threshold) / range : 0;
  
  return [
    Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * t),
    Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * t),
    Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * t),
  ];
}

// Gaussian kernel for KDE
function gaussianKernel(distance: number, bandwidth: number): number {
  return Math.exp(-0.5 * Math.pow(distance / bandwidth, 2));
}

export function KnowledgeHeatmap({ 
  notes, 
  onNoteClick,
  width = 800,
  height = 600,
}: KnowledgeHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredNote, setHoveredNote] = useState<HeatmapNote | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width, height });
  
  // Spatial index for fast hit detection
  const spatialIndexRef = useRef<Map<string, HeatmapNote[]>>(new Map());
  const GRID_SIZE = 50; // pixels per grid cell

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({ 
          width: Math.floor(rect.width), 
          height: Math.floor(rect.height) 
        });
      }
    };
    
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Build spatial index
  useEffect(() => {
    const index = new Map<string, HeatmapNote[]>();
    
    for (const note of notes) {
      const gridX = Math.floor(note.positionX * dimensions.width / GRID_SIZE);
      const gridY = Math.floor(note.positionY * dimensions.height / GRID_SIZE);
      const key = `${gridX},${gridY}`;
      
      if (!index.has(key)) {
        index.set(key, []);
      }
      index.get(key)!.push(note);
    }
    
    spatialIndexRef.current = index;
  }, [notes, dimensions]);

  // Render heatmap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || notes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width: w, height: h } = dimensions;
    canvas.width = w;
    canvas.height = h;

    // Create image data for pixel manipulation
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    // Calculate bandwidth based on note count and canvas size
    const avgSpacing = Math.sqrt((w * h) / notes.length);
    const bandwidth = Math.max(30, Math.min(80, avgSpacing * 0.8));

    // Calculate density for each pixel
    const densityMap = new Float32Array(w * h);
    let maxDensity = 0;

    // Pre-compute note positions in pixel space
    const notePixelPositions = notes.map(note => ({
      x: note.positionX * w,
      y: note.positionY * h,
      weight: 1 + note.connectionCount * 0.5, // More connected = higher weight
    }));

    // Sample every few pixels for performance, then interpolate
    const sampleRate = 2;
    
    for (let y = 0; y < h; y += sampleRate) {
      for (let x = 0; x < w; x += sampleRate) {
        let density = 0;
        
        for (const notePos of notePixelPositions) {
          const dx = x - notePos.x;
          const dy = y - notePos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < bandwidth * 3) { // Only compute if within range
            density += gaussianKernel(distance, bandwidth) * notePos.weight;
          }
        }
        
        // Fill sampled area
        for (let sy = 0; sy < sampleRate && y + sy < h; sy++) {
          for (let sx = 0; sx < sampleRate && x + sx < w; sx++) {
            densityMap[(y + sy) * w + (x + sx)] = density;
          }
        }
        
        maxDensity = Math.max(maxDensity, density);
      }
    }

    // Normalize and apply colors
    for (let i = 0; i < w * h; i++) {
      const normalizedDensity = maxDensity > 0 ? densityMap[i] / maxDensity : 0;
      const color = interpolateColor(normalizedDensity);
      
      const pixelIndex = i * 4;
      data[pixelIndex] = color[0];     // R
      data[pixelIndex + 1] = color[1]; // G
      data[pixelIndex + 2] = color[2]; // B
      data[pixelIndex + 3] = 255;      // A
    }

    // Draw the heatmap
    ctx.putImageData(imageData, 0, 0);

    // Draw grid lines (subtle)
    ctx.strokeStyle = 'rgba(0, 100, 0, 0.2)';
    ctx.lineWidth = 0.5;
    
    // Vertical center line
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    
    // Horizontal center line
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Draw note positions as small dots
    for (const note of notes) {
      const x = note.positionX * w;
      const y = note.positionY * h;
      
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw connections between related notes
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    
    for (const note of notes) {
      const x1 = note.positionX * w;
      const y1 = note.positionY * h;
      
      for (const relatedId of note.relatedNotes) {
        const relatedNote = notes.find(n => n._id === relatedId);
        if (!relatedNote) continue;
        
        const x2 = relatedNote.positionX * w;
        const y2 = relatedNote.positionY * h;
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

  }, [notes, dimensions]);

  // Find note at position
  const findNoteAtPosition = useCallback((x: number, y: number): HeatmapNote | null => {
    const { width: w, height: h } = dimensions;
    const hitRadius = 15; // pixels
    
    let closestNote: HeatmapNote | null = null;
    let closestDistance = hitRadius;
    
    for (const note of notes) {
      const noteX = note.positionX * w;
      const noteY = note.positionY * h;
      const distance = Math.sqrt(Math.pow(x - noteX, 2) + Math.pow(y - noteY, 2));
      
      if (distance < closestDistance) {
        closestDistance = distance;
        closestNote = note;
      }
    }
    
    return closestNote;
  }, [notes, dimensions]);

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePos({ x: e.clientX, y: e.clientY });
    
    const note = findNoteAtPosition(x, y);
    setHoveredNote(note);
  }, [findNoteAtPosition]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const note = findNoteAtPosition(x, y);
    if (note) {
      onNoteClick(note._id);
    }
  }, [findNoteAtPosition, onNoteClick]);

  const handleMouseLeave = useCallback(() => {
    setHoveredNote(null);
  }, []);

  if (notes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-black/40 text-[14px]">
        No notes with positions. Computing...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onMouseLeave={handleMouseLeave}
      />
      
      {/* Tooltip */}
      {hoveredNote && (
        <div
          className="fixed z-50 bg-black/90 text-white px-3 py-2 rounded-lg shadow-lg pointer-events-none max-w-[200px]"
          style={{
            left: mousePos.x + 15,
            top: mousePos.y + 15,
          }}
        >
          <p className="text-[13px] font-medium truncate">{hoveredNote.title}</p>
          {hoveredNote.tags.length > 0 && (
            <p className="text-[10px] text-white/60 mt-1 truncate">
              {hoveredNote.tags.slice(0, 3).join(', ')}
            </p>
          )}
          {hoveredNote.connectionCount > 0 && (
            <p className="text-[10px] text-white/40 mt-1">
              {hoveredNote.connectionCount} connections
            </p>
          )}
        </div>
      )}
      
      {/* Stats overlay */}
      <div className="absolute top-3 right-3 text-[11px] text-white/60 bg-black/30 px-2 py-1 rounded">
        {notes.length} notes
      </div>
      
      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <div className="flex items-center gap-1 text-[10px] text-white/60 bg-black/30 px-2 py-1 rounded">
          <div className="w-3 h-3 rounded-full" style={{ background: 'rgb(74, 124, 174)' }} />
          <span>sparse</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-white/60 bg-black/30 px-2 py-1 rounded">
          <div className="w-3 h-3 rounded-full" style={{ background: 'rgb(232, 232, 84)' }} />
          <span>dense</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-white/60 bg-black/30 px-2 py-1 rounded">
          <div className="w-3 h-3 rounded-full" style={{ background: 'rgb(232, 84, 84)' }} />
          <span>hot spot</span>
        </div>
      </div>
    </div>
  );
}

