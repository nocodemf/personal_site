"use client";

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { CHARACTER } from './character-data';

interface PixelCharacterProps {
  pixelSize?: number;
  onPhaseChange?: (phase: AnimationPhase) => void;
  startPhase?: AnimationPhase;
  startOffset?: number;
  walkSpeed?: number;
  walkFrameMs?: number;
  autoWalk?: boolean;
}

const COLORS: Record<string, string | null> = {
  'B': '#000000',
  'W': '#FFFFFF',
  '.': null,
};

export type AnimationPhase = 
  | 'loading' 
  | 'idle' 
  | 'walking_right' 
  | 'exited_right'
  | 'entering_left'
  | 'settled';

// Timing constants
const LOAD_DURATION = 800;
const IDLE_PAUSE = 300;
const WALK_FRAME_MS = 50;
const WALK_SPEED = 8;
const REAPPEAR_DELAY = 0;

// Minimum walk distance before exit can be triggered (prevents premature exit)
const MIN_WALK_DISTANCE = 200;

// Top padding to prevent clipping during body bob
const TOP_PADDING = 5;

// Body region definitions for leg animation
const LEG_START_ROW = 92;
const SHOE_START_ROW = 173;

// Walk cycle frames - defines leg offsets for each frame
const WALK_CYCLE = [
  { bodyBob: 0, leftLeg: 0, rightLeg: 0, leftFoot: 0, rightFoot: 0 },
  { bodyBob: -1, leftLeg: -2, rightLeg: 2, leftFoot: -4, rightFoot: 4 },
  { bodyBob: -2, leftLeg: -3, rightLeg: 3, leftFoot: -6, rightFoot: 6 },
  { bodyBob: -1, leftLeg: -2, rightLeg: 2, leftFoot: -4, rightFoot: 5 },
  { bodyBob: 0, leftLeg: 0, rightLeg: 0, leftFoot: 0, rightFoot: 0 },
  { bodyBob: -1, leftLeg: 2, rightLeg: -2, leftFoot: 4, rightFoot: -4 },
  { bodyBob: -2, leftLeg: 3, rightLeg: -3, leftFoot: 6, rightFoot: -6 },
  { bodyBob: -1, leftLeg: 2, rightLeg: -2, leftFoot: 5, rightFoot: -4 },
];

export const PixelCharacter: React.FC<PixelCharacterProps> = ({
  pixelSize = 3,
  onPhaseChange,
  startPhase = 'loading',
  startOffset = 0,
  walkSpeed = WALK_SPEED,
  walkFrameMs = WALK_FRAME_MS,
  autoWalk = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<AnimationPhase>(startPhase);
  const [walkOffset, setWalkOffset] = useState(startOffset);
  
  // Refs to prevent animation restarts and track state
  const walkingStartedRef = useRef(false);
  const enteringStartedRef = useRef(false);
  const exitThresholdRef = useRef<number | null>(null);
  const enteringOffsetRef = useRef(startOffset); // Track starting offset for entering_left
  
  const gridWidth = CHARACTER[0]?.length || 54;
  const gridHeight = CHARACTER.length;
  
  // Notify parent of phase changes
  useEffect(() => {
    onPhaseChange?.(phase);
  }, [phase, onPhaseChange]);
  
  /**
   * Determine which "side" a column belongs to for leg animation
   */
  const getLegSide = useCallback((col: number): 'left' | 'right' | 'center' => {
    if (col < 20) return 'left';
    if (col < 34) return 'center';
    return 'right';
  }, []);
  
  /**
   * Draw character with walk animation applied
   */
  const drawWalkFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    walkFrameIndex: number
  ) => {
    ctx.clearRect(0, 0, gridWidth * pixelSize, (gridHeight + TOP_PADDING) * pixelSize);
    
    const frame = WALK_CYCLE[walkFrameIndex % WALK_CYCLE.length];
    
    for (let row = 0; row < CHARACTER.length; row++) {
      const rowData = CHARACTER[row];
      for (let col = 0; col < rowData.length; col++) {
        const pixel = rowData[col];
        const color = COLORS[pixel];
        if (!color) continue;
        
        let drawRow = row + TOP_PADDING;
        let drawCol = col;
        
        // Apply body bob to upper body
        if (row < LEG_START_ROW) {
          drawRow = row + TOP_PADDING + frame.bodyBob;
        }
        // Apply leg movement
        else if (row >= LEG_START_ROW && row < SHOE_START_ROW) {
          const side = getLegSide(col);
          if (side === 'left') {
            drawCol = col + frame.leftLeg;
          } else if (side === 'right') {
            drawCol = col + frame.rightLeg;
          }
          drawRow = row + TOP_PADDING + frame.bodyBob;
        }
        // Apply foot movement
        else if (row >= SHOE_START_ROW) {
          const side = getLegSide(col);
          if (side === 'left') {
            drawCol = col + frame.leftFoot;
          } else if (side === 'right') {
            drawCol = col + frame.rightFoot;
          }
          drawRow = row + TOP_PADDING;
        }
        
        // Only draw if within bounds
        if (drawCol >= 0 && drawCol < gridWidth && drawRow >= 0 && drawRow < gridHeight + TOP_PADDING) {
          ctx.fillStyle = color;
          ctx.fillRect(drawCol * pixelSize, drawRow * pixelSize, pixelSize, pixelSize);
        }
      }
    }
  }, [gridWidth, gridHeight, pixelSize, getLegSide]);
  
  /**
   * Draw static character (for loading)
   */
  const drawStaticFrame = useCallback((
    ctx: CanvasRenderingContext2D,
    maxRow?: number
  ) => {
    ctx.clearRect(0, 0, gridWidth * pixelSize, (gridHeight + TOP_PADDING) * pixelSize);
    const limit = maxRow !== undefined ? Math.min(maxRow, gridHeight) : gridHeight;
    
    for (let row = 0; row < limit; row++) {
      const rowData = CHARACTER[row];
      for (let col = 0; col < rowData.length; col++) {
        const pixel = rowData[col];
        const color = COLORS[pixel];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(col * pixelSize, (row + TOP_PADDING) * pixelSize, pixelSize, pixelSize);
        }
      }
    }
  }, [gridWidth, gridHeight, pixelSize]);
  
  // Loading animation
  useEffect(() => {
    if (phase !== 'loading') return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let startTime: number | null = null;
    let animationId: number;
    
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / LOAD_DURATION, 1);
      const rowsToDraw = Math.ceil(progress * gridHeight);
      
      drawStaticFrame(ctx, rowsToDraw);
      
      if (progress < 1) {
        animationId = requestAnimationFrame(animate);
      } else {
        setPhase('idle');
        if (autoWalk) {
          setTimeout(() => setPhase('walking_right'), IDLE_PAUSE);
        }
      }
    };
    
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [phase, gridHeight, drawStaticFrame, autoWalk]);
  
  // Idle - show full character
  useEffect(() => {
    if (phase !== 'idle' && phase !== 'settled') return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    drawStaticFrame(ctx);
  }, [phase, drawStaticFrame]);
  
  // Walking right animation
  useEffect(() => {
    if (phase !== 'walking_right') return;
    
    // Prevent animation restart if already running
    if (walkingStartedRef.current) return;
    walkingStartedRef.current = true;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Calculate exit threshold once at start (not inside interval)
    // Fallback to a reasonable default if window isn't ready
    const screenWidth = typeof window !== 'undefined' && window.innerWidth > 0 
      ? window.innerWidth 
      : 1920;
    exitThresholdRef.current = (screenWidth / 2) + (gridWidth * pixelSize) + 50;
    
    let frameIndex = 0;
    let currentOffset = 0;
    
    const walkInterval = setInterval(() => {
      frameIndex = (frameIndex + 1) % WALK_CYCLE.length;
      drawWalkFrame(ctx, frameIndex);
      
      currentOffset += walkSpeed;
      setWalkOffset(currentOffset);
      
      // Only exit after minimum distance AND past threshold
      const threshold = exitThresholdRef.current || 1000;
      if (currentOffset > MIN_WALK_DISTANCE && currentOffset > threshold) {
        clearInterval(walkInterval);
        setPhase('exited_right');
      }
    }, walkFrameMs);
    
    drawWalkFrame(ctx, 0);
    
    return () => {
      clearInterval(walkInterval);
    };
  }, [phase, drawWalkFrame, walkSpeed, walkFrameMs, gridWidth, pixelSize]);
  
  // After exiting right, trigger reappearance from left
  useEffect(() => {
    if (phase !== 'exited_right') return;
    
    // Reset flags for next animation cycle
    walkingStartedRef.current = false;
    enteringStartedRef.current = false;
    enteringOffsetRef.current = -200; // Set entering offset for cycle
    
    const timer = setTimeout(() => {
      setWalkOffset(-200); // Start off-screen to the left
      setPhase('entering_left');
    }, REAPPEAR_DELAY);
    
    return () => clearTimeout(timer);
  }, [phase]);
  
  // Walking in from left animation
  useEffect(() => {
    if (phase !== 'entering_left') return;
    
    // Prevent animation restart if already running
    if (enteringStartedRef.current) return;
    enteringStartedRef.current = true;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let frameIndex = 0;
    let currentOffset = enteringOffsetRef.current; // Start from specified offset
    
    const walkInterval = setInterval(() => {
      frameIndex = (frameIndex + 1) % WALK_CYCLE.length;
      drawWalkFrame(ctx, frameIndex);
      
      currentOffset += walkSpeed;
      setWalkOffset(currentOffset);
      
      // Stop at center position (0)
      if (currentOffset >= 0) {
        clearInterval(walkInterval);
        setWalkOffset(0);
        setPhase('settled');
      }
    }, walkFrameMs);
    
    drawWalkFrame(ctx, 0);
    
    return () => clearInterval(walkInterval);
  }, [phase, drawWalkFrame, walkSpeed, walkFrameMs]);
  
  // Don't render during the transition between phases
  if (phase === 'exited_right') {
    return null;
  }
  
  return (
    <div
      style={{
        transform: `translateX(${walkOffset}px)`,
        willChange: 'transform',
      }}
    >
      <canvas
        ref={canvasRef}
        width={gridWidth * pixelSize}
        height={(gridHeight + TOP_PADDING) * pixelSize}
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
};
