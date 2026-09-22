// Web Worker: on-device re-transcription with Moonshine-base (seq2seq ASR,
// English). Fixes what Chrome's server-side recognizer can't: it hears
// "um"/"uh" (no disfluency stripping), works offline, and runs in browsers
// with no SpeechRecognition at all (Firefox/Safari).
//
// The quantized model (~63 MB) is served same-origin from /models/ (see
// scripts/fetch-model.mjs) with Hugging Face as fallback; the browser cache
// holds it after the first run. No API key — audio never leaves the device.
//
// Protocol:
//   in : { type: "transcribe", audio: Float32Array (16 kHz mono, transferred),
//          chunks: [{ start, end }] (seconds; planned by asrChunks.js) }
//   out: { type: "progress", stage, progress (0..1), detail }
//        { type: "done", text, segments: [{ text, endedAt }] }
//        { type: "error", message }

import { pipeline, env } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/moonshine-base-ONNX";
const SAMPLE_RATE = 16000;

// int8 ("quantized") decoder is broken in onnxruntime-WEB (wasm):
// TransposeDQWeightsForMatMulNBits "Missing required scale" on
// embed_tokens — even though onnxruntime-node accepts the same file. The q4
// decoder uses MatMulNBits with embedded scales, which wasm supports.
const DTYPE = { encoder_model: "q8", decoder_model_merged: "q4" };

env.localModelPath = "/models/";
env.allowLocalModels = true;

let transcriberPromise = null;

function postProgress(stage, progress, detail = "") {
  self.postMessage({ type: "progress", stage, progress, detail });
}

function makeProgressCallback() {
  const files = new Map();
  return (p) => {
    if (p.status === "progress" && p.total) {
      files.set(p.file, p.loaded / p.total);
      const avg = [...files.values()].reduce((a, b) => a + b, 0) / files.size;
      postProgress("download", Math.min(avg, 0.999), p.file);
    }
  };
}

function loadTranscriber() {
  transcriberPromise ??= pipeline("automatic-speech-recognition", MODEL_ID, {
    dtype: DTYPE,
    progress_callback: makeProgressCallback(),
  });
  return transcriberPromise;
}

async function run(audio, chunks) {
  const transcriber = await loadTranscriber();
  postProgress("download", 1);

  const segments = [];
  for (let i = 0; i < chunks.length; i++) {
    const { start, end } = chunks[i];
    const pcm = audio.subarray(
      Math.floor(start * SAMPLE_RATE),
      Math.min(Math.ceil(end * SAMPLE_RATE), audio.length)
    );
    if (pcm.length < SAMPLE_RATE * 0.2) continue; // too short to decode
    const out = await transcriber(pcm);
    const text = (out?.text ?? "").trim();
    if (text) segments.push({ text, endedAt: end });
    postProgress("inference", (i + 1) / chunks.length, `chunk ${i + 1}/${chunks.length}`);
  }

  return {
    text: segments.map((s) => s.text).join(" "),
    segments,
  };
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== "transcribe") return;
  try {
    const result = await run(msg.audio, msg.chunks);
    self.postMessage({ type: "done", ...result });
  } catch (err) {
    self.postMessage({ type: "error", message: err?.message ?? String(err) });
  }
};
