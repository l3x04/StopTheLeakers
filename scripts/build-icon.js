const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const svgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');
const png256Path = path.join(__dirname, '..', 'assets', 'icon-256.png');

const sizes = [16, 24, 32, 48, 64, 128, 256];

(async () => {
  const svg = fs.readFileSync(svgPath);
  const pngs = await Promise.all(
    sizes.map((s) => sharp(svg).resize(s, s).png().toBuffer())
  );
  const ico = await pngToIco(pngs);
  fs.writeFileSync(icoPath, ico);
  fs.writeFileSync(png256Path, pngs[pngs.length - 1]);
  console.log(`Wrote ${icoPath} (${(ico.length / 1024).toFixed(1)} KB) and ${png256Path}`);
})();
