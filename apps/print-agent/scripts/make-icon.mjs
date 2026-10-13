// Generates assets/icon.ico (16, 32, 48 and 256 px) from the web app icon (apps/web/public/icons/icon.svg:
// orange-700 rounded square with the white utensils). Run once when the brand changes and commit the .ico;
// build:exe only reads it. Usage: node scripts/make-icon.mjs
//
// The SVG is rasterized with sharp, borrowed from the api workspace (a native module the print agent does not
// depend on). The ICO holds PNG images (supported by Windows Vista and later), so it needs no BMP encoder.
// Small sizes get thicker strokes so the utensils stay readable at 16 px.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "../..");
const sharp = createRequire(join(repo, "apps/api/package.json"))("sharp");

const svg = readFileSync(join(repo, "apps/web/public/icons/icon.svg"), "utf8");
/** Size in px → stroke width in the SVG's 24-unit icon grid (the web uses 2). */
const SIZES = [
  [16, 3],
  [32, 2.5],
  [48, 2.25],
  [256, 2],
];

/**
 * Builds an .ico file from PNG images.
 * @param {{ size: number, png: Buffer }[]} images one PNG per size (≤ 256 px), any order
 * @returns {Buffer} ICONDIR + ICONDIRENTRY[] + the PNGs
 */
function icoFromPngs(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette colors
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

const images = [];
for (const [size, stroke] of SIZES) {
  const source = svg.replace('stroke-width="2"', `stroke-width="${stroke}"`);
  const png = await sharp(Buffer.from(source), { density: Math.max(72, (72 * size) / 512) * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  images.push({ size, png });
}

mkdirSync(join(root, "assets"), { recursive: true });
const ico = icoFromPngs(images);
writeFileSync(join(root, "assets/icon.ico"), ico);
process.stdout.write(`assets/icon.ico (${SIZES.map(([size]) => size).join(", ")} px, ${(ico.length / 1024).toFixed(1)} KB)\n`);
