#!/usr/bin/env node
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sizes = [16, 32, 48, 128];

await mkdir(resolve(root, "icons"), { recursive: true });

for (const size of sizes) {
  const source = resolve(root, "icons", `icon-${size}.svg`);
  const destination = resolve(root, "icons", `icon-${size}.png`);
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(destination);
  console.log(`Generated ${destination}`);
}
