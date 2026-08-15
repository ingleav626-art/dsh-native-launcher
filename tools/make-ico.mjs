// 将 PNG 打包为 ICO（ICO 规范支持内嵌 PNG 图像，Vista+ 均支持）
// 要求：PNG ≤ 256x256，8bit RGBA
// 用法: node tools/make-ico.mjs <input.png> <output.ico>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('usage: node tools/make-ico.mjs <input.png> <output.ico>');
  process.exit(1);
}

const png = readFileSync(input);
// 校验 PNG 签名与尺寸
if (png.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
  console.error('not a PNG');
  process.exit(1);
}
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width > 256 || height > 256) {
  console.error(`PNG too large for ICO: ${width}x${height} (max 256)`);
  process.exit(1);
}

// ICONDIR (6) + ICONDIRENTRY (16) + PNG 数据
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);        // reserved
header.writeUInt16LE(1, 2);        // type: icon
header.writeUInt16LE(1, 4);        // count
header[6] = width === 256 ? 0 : width;   // entry: width (0 = 256)
header[7] = height === 256 ? 0 : height; // entry: height
header[8] = 0;                     // colors
header[9] = 0;                     // reserved
header.writeUInt16LE(1, 10);       // planes
header.writeUInt16LE(32, 12);      // bitcount
header.writeUInt32LE(png.length, 14); // size
header.writeUInt32LE(22, 18);      // offset

writeFileSync(output, Buffer.concat([header, png]));
console.log(`OK: ${width}x${height} PNG -> ${output} (${22 + png.length} bytes)`);
