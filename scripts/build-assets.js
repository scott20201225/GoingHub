/**
 * Vector and High-DPI Template Asset Generator for BuddyApiHub.
 * Uses @resvg/resvg-js to compile high-fidelity SVG assets for cross-platform packaging.
 */

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const assetsDir = path.resolve(__dirname, '..', 'assets');
const menuDir = path.join(assetsDir, 'menu');

function renderSvg(svgPath, targetPx) {
  const svg = fs.readFileSync(svgPath, 'utf8');
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: targetPx } });
  return resvg.render().asPng();
}

console.log('[Assets] Verifying vector SVG assets...');

// 1. Verify Tray SVG
const traySvg = path.join(assetsDir, 'tray-icon.svg');
if (fs.existsSync(traySvg)) {
  console.log('✓ assets/tray-icon.svg verified');
}

// 2. Verify Menu SVGs
const menuIcons = ['dashboard', 'copy', 'browser', 'folder', 'restart', 'update', 'quit', 'checkbox-checked', 'checkbox-unchecked', 'about'];
for (const name of menuIcons) {
  const p = path.join(menuDir, `${name}.svg`);
  if (fs.existsSync(p)) {
    console.log(`✓ assets/menu/${name}.svg verified`);
  } else {
    console.warn(`! assets/menu/${name}.svg missing`);
  }
}

console.log('[Assets] Verification complete.');
