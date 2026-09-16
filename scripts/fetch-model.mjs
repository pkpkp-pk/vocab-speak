// Downloads the wav2vec2 model files into public/models/ so the app can serve
// them from the same origin (e.g. Vercel's CDN) instead of huggingface.co.
// Runs automatically before `npm run dev` and `npm run build`; existing files
// are kept, so it's a no-op after the first run. `node scripts/fetch-model.mjs --force`
// re-downloads everything.

import { mkdir, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REPO = "Xenova/wav2vec2-base-960h";
const BASE = `https://huggingface.co/${REPO}/resolve/main`;
// fileURLToPath (not .pathname) so paths with spaces survive.
const OUT_DIR = fileURLToPath(new URL(`../public/models/${REPO}/`, import.meta.url));

const FILES = [
  "config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx", // q8, ~91 MB
];

const force = process.argv.includes("--force");

for (const file of FILES) {
  const dest = join(OUT_DIR, file);
  if (!force) {
    const existing = await stat(dest).catch(() => null);
    if (existing && existing.size > 0) {
      console.log(`skip  ${file} (already present)`);
      continue;
    }
  }
  await mkdir(dirname(dest), { recursive: true });
  process.stdout.write(`fetch ${file} …`);
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok || !res.body) {
    console.log(` FAILED (${res.status})`);
    process.exitCode = 1;
    continue;
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const { size } = await stat(dest);
  console.log(` ${(size / 1048576).toFixed(1)} MB`);
}

console.log("model files ready in public/models/");
