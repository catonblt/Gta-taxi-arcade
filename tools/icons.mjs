// Renders the app icon at every size Android asks for, from one SVG source, using the Chromium
// that is already here. Keeps the icon a single editable file rather than a folder of binaries
// nobody can change.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../public/icons/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// 180 is Apple's canonical apple-touch-icon size (60pt @3x); 192/512 cover Android/PWA.
const SIZES = [180, 192, 512];

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0b0d10"/>
  <!-- A car seen from above, mid-slide, with the light behind it. -->
  <circle cx="50" cy="50" r="34" fill="#f0a63c" opacity="0.10"/>
  <g transform="rotate(-24 50 50)">
    <rect x="35" y="22" width="30" height="56" rx="7" fill="#f0a63c"/>
    <rect x="40" y="34" width="20" height="16" rx="3" fill="#0b0d10"/>
    <rect x="40" y="56" width="20" height="10" rx="3" fill="#0b0d10" opacity="0.45"/>
  </g>
  <rect x="18" y="82" width="64" height="4" rx="2" fill="#d83a44"/>
</svg>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});

for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg(size)}</body>`);
  await page.screenshot({ path: `${OUT}icon-${size}.png`, omitBackground: false });
  await page.close();
  console.log(`wrote icon-${size}.png`);
}

await browser.close();
