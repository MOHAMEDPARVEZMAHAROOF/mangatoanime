const fs = require('fs');
const path = require('path');

// Simple SVG logo for MangaToAnime
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#7B5CF0"/>
      <stop offset="100%" style="stop-color:#a78bfa"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="48" fill="#0a0a0a"/>
  <rect x="24" y="24" width="208" height="208" rx="36" fill="none" stroke="url(#g)" stroke-width="4"/>
  <text x="128" y="110" text-anchor="middle" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="url(#g)">M</text>
  <text x="128" y="175" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="#f0f0f0">A</text>
  <polygon points="180,60 200,100 160,100" fill="#7B5CF0" opacity="0.8"/>
</svg>`;

fs.writeFileSync(path.join(__dirname, 'logo.svg'), svg);

async function main() {
  try {
    const sharp = require('sharp');
    await sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, 'logo.png'));
    await sharp(Buffer.from(svg)).resize(256, 256).png().toFile(path.join(__dirname, 'icon.png'));
    console.log('Logo generated');
  } catch (err) {
    // Fallback: copy svg as reference
    fs.copyFileSync(path.join(__dirname, 'logo.svg'), path.join(__dirname, 'logo.png'));
    console.log('Sharp unavailable, using svg fallback');
  }
}

main();
