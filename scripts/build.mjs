import { build } from "esbuild";
import { cp, mkdir, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await build({
  entryPoints: ["src/popup.tsx", "src/background.ts"],
  bundle: true,
  outdir: "dist",
  format: "esm",
  target: "chrome121",
  minify: true,
});
await build({
  entryPoints: ["src/content.ts"],
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome121",
  minify: true,
});
// Generate deterministic locally packaged PNG icons without a graphics dependency.
import { deflateSync } from "node:zlib";
const crc = (b) => {
  let c = 0xffffffff;
  for (const n of b) {
    c ^= n;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const t = Buffer.from(type),
    len = Buffer.alloc(4),
    sum = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  sum.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, sum]);
}
await mkdir("dist/icons", { recursive: true });
for (const n of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const px = x / n,
        py = y / n;
      const left =
        Math.abs(px - (0.14 + py * 0.39)) < 0.05 && py > 0.15 && py < 0.86;
      const right =
        Math.abs(px - (0.86 - py * 0.39)) < 0.05 && py > 0.15 && py < 0.86;
      const top = py > 0.15 && py < 0.23 && px > 0.2 && px < 0.52;
      const at = y * (n * 4 + 1) + x * 4 + 1;
      pixels[at] = left || top ? 244 : 155;
      pixels[at + 1] = left || top ? 241 : 118;
      pixels[at + 2] = left || top ? 255 : 230;
      pixels[at + 3] = left || right || top ? 255 : 0;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(n);
  header.writeUInt32BE(n, 4);
  header[8] = 8;
  header[9] = 6;
  await writeFile(
    `dist/icons/${n}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}
await cp('dist','extension',{recursive:true});
