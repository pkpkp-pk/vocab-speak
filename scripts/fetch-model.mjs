// Downloads the on-device model files into public/models/ so the app can
// serve them from the same origin (e.g. Vercel's CDN) instead of
// huggingface.co. Runs automatically before `npm run dev` and
// `npm run build`; existing files are kept, so it's a no-op after the first
// run. `node scripts/fetch-model.mjs --force` re-downloads everything.

import { mkdir, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MODELS = [
  {
    // Pronunciation scoring (CTC forced alignment), default-on, opt-out toggle.
    repo: "Xenova/wav2vec2-base-960h",
    files: [
      "config.json",
      "preprocessor_config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "vocab.json",
      "special_tokens_map.json",
      "onnx/model_quantized.onnx", // q8, ~91 MB
    ],
  },
];

const force = process.argv.includes("--force");

for (const { repo, files } of MODELS) {
  const base = `https://huggingface.co/${repo}/resolve/main`;
  // fileURLToPath (not .pathname) so paths with spaces survive.
  const outDir = fileURLToPath(new URL(`../public/models/${repo}/`, import.meta.url));

  for (const file of files) {
    const dest = join(outDir, file);
    if (!force) {
      const existing = await stat(dest).catch(() => null);
      if (existing && existing.size > 0) {
        console.log(`skip  ${repo}/${file} (already present)`);
        continue;
      }
    }
    await mkdir(dirname(dest), { recursive: true });
    process.stdout.write(`fetch ${repo}/${file} …`);
    const res = await fetch(`${base}/${file}`);
    if (!res.ok || !res.body) {
      console.log(` FAILED (${res.status})`);
      process.exitCode = 1;
      continue;
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    const { size } = await stat(dest);
    console.log(` ${(size / 1048576).toFixed(1)} MB`);
  }
}

console.log("model files ready in public/models/");
