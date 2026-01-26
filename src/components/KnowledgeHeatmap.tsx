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

// Zoom constraints
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;
const ZOOM_SENSITIVITY = 0.002;

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
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [hasMoved, setHasMoved] = useState(false);
  
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

  // Convert screen coordinates to canvas coordinates (accounting for zoom/pan)
  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const { width: w, height: h } = dimensions;
    const centerX = w / 2;
    const centerY = h / 2;
    
    // Reverse the transform: first subtract pan, then divide by zoom relative to center
    const canvasX = (screenX - centerX - panOffset.x) / zoom + centerX;
    const canvasY = (screenY - centerY - panOffset.y) / zoom + centerY;
    
    return { x: canvasX, y: canvasY };
  }, [zoom, panOffset, dimensions]);

  // Handle zoom with mouse wheel
  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate zoom change
    const delta = -e.deltaY * ZOOM_SENSITIVITY;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + delta)));
    
    // Zoom toward mouse position
    const { width: w, height: h } = dimensions;
    const centerX = w / 2;
    const centerY = h / 2;
    
    // Calculate the point we're zooming toward in canvas space
    const zoomPointX = mouseX - centerX;
    const zoomPointY = mouseY - centerY;
    
    // Adjust pan to zoom toward mouse position
    const zoomFactor = newZoom / zoom;
    const newPanX = zoomPointX - (zoomPointX - panOffset.x) * zoomFactor;
    const newPanY = zoomPointY - (zoomPointY - panOffset.y) * zoomFactor;
    
    setZoom(newZoom);
    setPanOffset({ x: newPanX, y: newPanY });
  }, [zoom, panOffset, dimensions]);

  // Handle pan start - left click anywhere starts panning
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0) { // Left click
      e.preventDefault();
      setIsPanning(true);
      setHasMoved(false);
      setPanStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  }, [panOffset]);

  // Handle pan move
  const handlePanMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const newX = e.clientX - panStart.x;
      const newY = e.clientY - panStart.y;
      
      // Check if we've moved significantly
      if (Math.abs(newX - panOffset.x) > 3 || Math.abs(newY - panOffset.y) > 3) {
        setHasMoved(true);
      }
      
      setPanOffset({ x: newX, y: newY });
    }
  }, [isPanning, panStart, panOffset]);

  // Handle pan end
  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Reset zoom and pan
  const resetView = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Zoom in/out buttons
  const zoomIn = useCallback(() => {
    setZoom(z => Math.min(MAX_ZOOM, z * 1.3));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom(z => Math.max(MIN_ZOOM, z / 1.3));
  }, []);

  // Render heatmap
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || notes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width: w, height: h } = dimensions;
    canvas.width = w;
    canvas.height = h;

    // Clear canvas with background color
    ctx.fillStyle = '#fffffc';
    ctx.fillRect(0, 0, w, h);

    // Save context and apply zoom/pan transform
    ctx.save();
    
    // Translate to center, apply zoom, translate back, then apply pan
    ctx.translate(w / 2 + panOffset.x, h / 2 + panOffset.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);

    // Pre-compute note positions in pixel space with padding
    const padding = 0.1; // 10% padding on each side for tighter clustering
    const notePixelPositions = notes.map(note => ({
      x: (padding + note.positionX * (1 - 2 * padding)) * w,
      y: (padding + note.positionY * (1 - 2 * padding)) * h,
      weight: 1 + note.connectionCount * 0.5,
    }));

    // Calculate bandwidth - smaller values create tighter clusters around each note
    const avgSpacing = Math.sqrt((w * h) / notes.length);
    const bandwidth = Math.max(40, Math.min(70, avgSpacing * 0.7));

    // Create offscreen canvas for heatmap at base resolution
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    // Create image data for pixel manipulation
    const imageData = offCtx.createImageData(w, h);
    const data = imageData.data;

    // Calculate density for each pixel
    const densityMap = new Float32Array(w * h);
    let maxDensity = 0;

    // Sample every few pixels for performance, then interpolate
    const sampleRate = 2;
    
    for (let y = 0; y < h; y += sampleRate) {
      for (let x = 0; x < w; x += sampleRate) {
        let density = 0;
        
        for (const notePos of notePixelPositions) {
          const dx = x - notePos.x;
          const dy = y - notePos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance < bandwidth * 4) { // Wider range for softer edges
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

    // Background color RGB values
    const bgR = 255, bgG = 255, bgB = 252;

    // Edge fade margin - fade to background near edges
    const edgeFadeMargin = 40;

    // Normalize and apply colors with smooth alpha blending to background
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const normalizedDensity = maxDensity > 0 ? densityMap[i] / maxDensity : 0;
        
        // Calculate edge fade factor (0 at edges, 1 in center)
        const edgeDistX = Math.min(x, w - 1 - x);
        const edgeDistY = Math.min(y, h - 1 - y);
        const edgeDist = Math.min(edgeDistX, edgeDistY);
        const edgeFade = Math.min(1, edgeDist / edgeFadeMargin);
        
        // Smooth easing function for more organic fade
        const eased = Math.pow(normalizedDensity, 0.6);
        const baseAlpha = Math.min(1, eased * 2.5);
        const alpha = baseAlpha * edgeFade; // Apply edge fade
        
        const pixelIndex = i * 4;
        if (alpha > 0.005) {
          const color = interpolateColor(normalizedDensity);
          
          // Alpha blend with background
          data[pixelIndex] = Math.round(color[0] * alpha + bgR * (1 - alpha));
          data[pixelIndex + 1] = Math.round(color[1] * alpha + bgG * (1 - alpha));
          data[pixelIndex + 2] = Math.round(color[2] * alpha + bgB * (1 - alpha));
          data[pixelIndex + 3] = 255;
        } else {
          // Pure background
          data[pixelIndex] = bgR;
          data[pixelIndex + 1] = bgG;
          data[pixelIndex + 2] = bgB;
          data[pixelIndex + 3] = 255;
        }
      }
    }

    // Draw the heatmap to offscreen canvas
    offCtx.putImageData(imageData, 0, 0);
    
    // Draw offscreen canvas to main canvas (with transform applied)
    ctx.drawImage(offscreen, 0, 0);

    // Draw connections between related notes (draw first, so dots appear on top)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5 / zoom;
    
    for (const note of notes) {
      const notePos = notePixelPositions.find((_, i) => notes[i]._id === note._id);
      if (!notePos) continue;
      const x1 = notePos.x;
      const y1 = notePos.y;
      
      for (const relatedId of note.relatedNotes) {
        const relatedIdx = notes.findIndex(n => n._id === relatedId);
        if (relatedIdx === -1) continue;
        const relatedPos = notePixelPositions[relatedIdx];
        
        const x2 = relatedPos.x;
        const y2 = relatedPos.y;
        
        // Draw curved connection
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const offset = len * 0.15;
        const ctrlX = midX - dy * offset / (len + 0.001);
        const ctrlY = midY + dx * offset / (len + 0.001);
        
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(ctrlX, ctrlY, x2, y2);
        ctx.stroke();
      }
    }

    // Draw note positions as small dots
    const dotRadius = 4 / zoom;
    for (let i = 0; i < notes.length; i++) {
      const pos = notePixelPositions[i];
      const x = pos.x;
      const y = pos.y;
      
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    }

    // Restore context
    ctx.restore();

  }, [notes, dimensions, zoom, panOffset]);

  // Find note at position (accounting for zoom/pan and padding)
  const findNoteAtPosition = useCallback((screenX: number, screenY: number): HeatmapNote | null => {
    const { width: w, height: h } = dimensions;
    const hitRadius = 15 / zoom; // Adjust hit radius for zoom
    const padding = 0.1;
    
    // Convert screen coordinates to canvas coordinates
    const { x, y } = screenToCanvas(screenX, screenY);
    
    let closestNote: HeatmapNote | null = null;
    let closestDistance = hitRadius;
    
    for (const note of notes) {
      const noteX = (padding + note.positionX * (1 - 2 * padding)) * w;
      const noteY = (padding + note.positionY * (1 - 2 * padding)) * h;
      const distance = Math.sqrt(Math.pow(x - noteX, 2) + Math.pow(y - noteY, 2));
      
      if (distance < closestDistance) {
        closestDistance = distance;
        closestNote = note;
      }
    }
    
    return closestNote;
  }, [notes, dimensions, zoom, screenToCanvas]);

  // Mouse handlers
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setMousePos({ x: e.clientX, y: e.clientY });
    
    // Handle panning if active
    if (isPanning) {
      handlePanMove(e);
      return;
    }
    
    const note = findNoteAtPosition(x, y);
    setHoveredNote(note);
  }, [findNoteAtPosition, isPanning, handlePanMove]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Don't trigger click if we moved during the pan
    if (hasMoved) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const note = findNoteAtPosition(x, y);
    if (note) {
      onNoteClick(note._id);
    }
  }, [findNoteAtPosition, onNoteClick, hasMoved]);

  const handleMouseLeave = useCallback(() => {
    setHoveredNote(null);
    setIsPanning(false);
  }, []);

  if (notes.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-black/40 text-[14px]" style={{ backgroundColor: '#fffffc' }}>
        No notes with positions. Computing...
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full" style={{ backgroundColor: '#fffffc' }}>
      <canvas
        ref={canvasRef}
        className={`w-full h-full ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />
      
      {/* Zoom controls */}
      <div className="absolute top-3 left-3 flex flex-col gap-1">
        <button
          onClick={zoomIn}
          className="w-7 h-7 bg-black/40 hover:bg-black/60 text-white rounded flex items-center justify-center text-sm font-bold transition-colors"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={zoomOut}
          className="w-7 h-7 bg-black/40 hover:bg-black/60 text-white rounded flex items-center justify-center text-sm font-bold transition-colors"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetView}
          className="w-7 h-7 bg-black/40 hover:bg-black/60 text-white rounded flex items-center justify-center text-[9px] font-medium transition-colors mt-1"
          title="Reset view"
        >
          FIT
        </button>
      </div>
      
      {/* Tooltip */}
      {hoveredNote && !isPanning && (
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
      <div className="absolute top-3 right-3 text-[11px] text-black/40 bg-black/5 px-2 py-1 rounded">
        {notes.length} notes
      </div>
      
      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <div className="flex items-center gap-1 text-[10px] text-black/40 bg-black/5 px-2 py-1 rounded">
          <div className="w-3 h-3 rounded-full" style={{ background: 'rgb(74, 124, 174)' }} />
          <span>sparse</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-black/40 bg-black/5 px-2 py-1 rounded">
          <div className="w-3 h-3 rounded-full" style={{ background: 'rgb(232, 232, 84)' }} />
          <span>dense</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-black/40 bg-black/5 px-2 py-1 rounded">
          <div className="w-3 h-3 rounded-full" style={{ background: 'rgb(232, 84, 84)' }} />
          <span>hot spot</span>
        </div>
      </div>
    </div>
  );
}

