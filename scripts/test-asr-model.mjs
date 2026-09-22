// End-to-end proof that the Moonshine ONNX files actually load and run — the
// browser worker can't be unit-tested, but the model graph can (transformers.js
// runs in node). Usage: node scripts/test-asr-model.mjs
// Reproduces runtime errors like the int8-decoder "Missing required scale"
// failure without opening a browser.

import { fileURLToPath } from "node:url";
import { pipeline, env } from "@huggingface/transformers";

env.localModelPath = fileURLToPath(new URL("../public/models/", import.meta.url));
env.allowLocalModels = true;
env.allowRemoteModels = false; // prove the SELF-HOSTED files work, not the hub

const MODEL_ID = "onnx-community/moonshine-base-ONNX";
// Must match DTYPE in src/lib/asr.worker.js. NOTE: node (onnxruntime-node)
// accepts even the int8 decoder that crashes onnxruntime-WEB — this script
// proves the local file set loads and runs, but cannot catch wasm-only graph
// errors.
const DTYPE = { encoder_model: "q8", decoder_model_merged: "q4" };

console.log(`loading ${MODEL_ID} (${JSON.stringify(DTYPE)}) from local files…`);
const transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, { dtype: DTYPE });

// 3s of near-silence — the point is that the graph loads and runs, not the text.
const pcm = new Float32Array(16000 * 3).map((_, i) => Math.sin(i / 100) * 0.001);
const out = await transcriber(pcm);
console.log("OK — pipeline ran. Output:", JSON.stringify(out));
