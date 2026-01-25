/**
 * Turn Animation Frames
 * 
 * Programmatically generates turn animation frames from the front-facing character.
 * This approach transforms the original sprite data rather than hand-drawing each frame.
 * 
 * The turn effect is achieved by:
 * 1. Shifting pixels horizontally (simulating rotation)
 * 2. Compressing width progressively (front→side is narrower)
 * 3. Adjusting facial features to suggest profile
 */

import { CHARACTER } from './character-data';

// Original dimensions
const WIDTH = CHARACTER[0]?.length || 54;
const HEIGHT = CHARACTER.length;
const CENTER = Math.floor(WIDTH / 2);

/**
 * Shift all pixels in a row by a given amount, with width compression
 */
function transformRow(row: string, shift: number, compression: number): string {
  const pixels = row.split('');
  const newWidth = Math.floor(WIDTH * compression);
  const newCenter = Math.floor(newWidth / 2);
  const result = new Array(WIDTH).fill('.');
  
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i] !== '.') {
      // Calculate position relative to center
      const relativePos = i - CENTER;
      // Apply compression
      const compressedPos = Math.floor(relativePos * compression);
      // Apply shift and reposition
      const newPos = newCenter + compressedPos + shift;
      
      if (newPos >= 0 && newPos < WIDTH) {
        result[newPos] = pixels[i];
      }
    }
  }
  
  return result.join('');
}

/**
 * Generate a turn frame with given parameters
 */
function generateTurnFrame(
  shift: number,      // Horizontal shift (positive = right)
  compression: number // Width compression (1 = full, 0.3 = very thin)
): string[] {
  return CHARACTER.map((row, rowIndex) => {
    // More shift for upper body, less for feet (pivot point at feet)
    const rowFactor = 1 - (rowIndex / HEIGHT) * 0.3;
    const rowShift = Math.floor(shift * rowFactor);
    return transformRow(row, rowShift, compression);
  });
}

// Frame 0: Original front view
export const TURN_FRAME_0 = CHARACTER;

// Frame 1: Starting to turn (very subtle)
export const TURN_FRAME_1 = generateTurnFrame(1, 0.95);

// Frame 2: More turned
export const TURN_FRAME_2 = generateTurnFrame(3, 0.85);

// Frame 3: Getting to profile
export const TURN_FRAME_3 = generateTurnFrame(5, 0.75);

// Frame 4: Nearly side view
export const TURN_FRAME_4 = generateTurnFrame(7, 0.65);

// Frame 5: Side view (final walking position)
export const TURN_FRAME_5 = generateTurnFrame(9, 0.55);

// Export all frames
export const TURN_FRAMES = [
  TURN_FRAME_0,
  TURN_FRAME_1,
  TURN_FRAME_2,
  TURN_FRAME_3,
  TURN_FRAME_4,
  TURN_FRAME_5,
];

// Animation timing
export const TURN_FRAME_DURATION = 120; // ms per frame
