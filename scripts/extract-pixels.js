/**
 * Script to extract pixel data from PNG and generate CHARACTER array
 * Handles high-res pixel art by detecting and downsampling to actual pixel size
 */

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

async function extractPixels() {
  const imagePath = path.join(__dirname, '../public/D1AFF7F4-59CC-427D-9FF2-BADB9BDF8A4A 1.png');
  
  console.log('Loading image:', imagePath);
  
  const image = await loadImage(imagePath);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  
  ctx.drawImage(image, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, image.width, image.height);
  const pixels = imageData.data;
  
  console.log(`Image dimensions: ${image.width} x ${image.height}`);
  
  // Detect pixel size by finding repeating patterns
  // Sample the image to find the smallest repeating unit
  function getPixelValue(x, y) {
    if (x < 0 || x >= image.width || y < 0 || y >= image.height) return null;
    const idx = (y * image.width + x) * 4;
    const r = pixels[idx];
    const g = pixels[idx + 1];
    const b = pixels[idx + 2];
    const a = pixels[idx + 3];
    
    if (a < 128) return 'T'; // Transparent
    if (r < 128 && g < 128 && b < 128) return 'B'; // Black
    return 'W'; // White
  }
  
  // Try to detect pixel size by looking for color changes
  let pixelSize = 1;
  
  // Find a black pixel to start from
  let startX = 0, startY = 0;
  outer: for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (getPixelValue(x, y) === 'B') {
        startX = x;
        startY = y;
        break outer;
      }
    }
  }
  
  // Count consecutive same-color pixels horizontally
  let count = 0;
  const startColor = getPixelValue(startX, startY);
  for (let x = startX; x < image.width && getPixelValue(x, startY) === startColor; x++) {
    count++;
  }
  
  // The pixel size is likely a common divisor
  // Try common sizes: 6, 8, 10, 12
  const possibleSizes = [6, 8, 10, 12, 14, 16];
  for (const size of possibleSizes) {
    if (count >= size && count % size < 3) {
      pixelSize = size;
      break;
    }
  }
  
  // If count is small, use it directly
  if (count < 20) {
    pixelSize = count;
  }
  
  console.log(`Detected pixel size: ~${pixelSize} (first block was ${count} pixels)`);
  
  // Let's try pixel size of 6 based on the image analysis
  pixelSize = 6;
  console.log(`Using pixel size: ${pixelSize}`);
  
  // Find bounding box
  let minX = image.width, maxX = 0, minY = image.height, maxY = 0;
  
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const val = getPixelValue(x, y);
      if (val === 'B') {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  
  console.log(`Bounding box: (${minX}, ${minY}) to (${maxX}, ${maxY})`);
  
  // Align to pixel grid
  minX = Math.floor(minX / pixelSize) * pixelSize;
  minY = Math.floor(minY / pixelSize) * pixelSize;
  maxX = Math.ceil((maxX + 1) / pixelSize) * pixelSize;
  maxY = Math.ceil((maxY + 1) / pixelSize) * pixelSize;
  
  const gridWidth = Math.ceil((maxX - minX) / pixelSize);
  const gridHeight = Math.ceil((maxY - minY) / pixelSize);
  
  console.log(`Grid dimensions: ${gridWidth} x ${gridHeight}`);
  
  // Sample the center of each pixel cell
  const rows = [];
  
  for (let gy = 0; gy < gridHeight; gy++) {
    let row = '';
    for (let gx = 0; gx < gridWidth; gx++) {
      const centerX = minX + gx * pixelSize + Math.floor(pixelSize / 2);
      const centerY = minY + gy * pixelSize + Math.floor(pixelSize / 2);
      
      // Sample multiple points and use majority
      let blackCount = 0, whiteCount = 0, transCount = 0;
      
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const val = getPixelValue(centerX + dx, centerY + dy);
          if (val === 'B') blackCount++;
          else if (val === 'W') whiteCount++;
          else transCount++;
        }
      }
      
      if (blackCount >= whiteCount && blackCount >= transCount) {
        row += 'B';
      } else if (whiteCount > transCount) {
        row += 'W';
      } else {
        row += '.';
      }
    }
    rows.push(row);
  }
  
  // Trim empty rows from top and bottom
  while (rows.length > 0 && rows[0].replace(/\./g, '') === '') {
    rows.shift();
  }
  while (rows.length > 0 && rows[rows.length - 1].replace(/\./g, '') === '') {
    rows.pop();
  }
  
  // Trim empty columns from left and right
  let leftTrim = Infinity, rightTrim = Infinity;
  for (const row of rows) {
    const firstNonDot = row.search(/[^.]/);
    const lastNonDot = row.length - 1 - row.split('').reverse().join('').search(/[^.]/);
    if (firstNonDot !== -1) {
      leftTrim = Math.min(leftTrim, firstNonDot);
      rightTrim = Math.min(rightTrim, row.length - 1 - lastNonDot);
    }
  }
  
  const trimmedRows = rows.map(row => row.slice(leftTrim, row.length - rightTrim));
  
  console.log(`Final dimensions: ${trimmedRows[0]?.length || 0} x ${trimmedRows.length}`);
  
  // Output the array
  console.log('\n// CHARACTER array:\n');
  console.log('const CHARACTER = [');
  trimmedRows.forEach((row, i) => {
    console.log(`  "${row}",`);
  });
  console.log('];');
  
  // Save to file
  const output = `// Auto-generated from ${path.basename(imagePath)}
// Pixel size: ${pixelSize}, Grid: ${trimmedRows[0]?.length || 0} x ${trimmedRows.length}

export const CHARACTER = [
${trimmedRows.map(row => `  "${row}",`).join('\n')}
];
`;
  
  const outputPath = path.join(__dirname, '../src/components/character-data.ts');
  fs.writeFileSync(outputPath, output);
  console.log(`\nSaved to: ${outputPath}`);
}

extractPixels().catch(console.error);
