// Web Worker: on-device pronunciation scoring with wav2vec2-base-960h (CTC).
//
// The quantized model (~95 MB) downloads once from the Hugging Face hub and
// is then served from the browser cache. No API key, no server of ours —
// audio never leaves the device.
//
// Protocol:
//   in : { type: "analyze", audio: Float32Array (16 kHz mono, transferred),
//          transcript: string | null }
//   out: { type: "progress", stage, progress (0..1), detail }
//        { type: "done", words: [{ word, score }], decodedTranscript?, truncated }
//        { type: "error", message }

import { AutoProcessor, AutoModelForCTC, AutoTokenizer, env } from "@huggingface/transformers";
import {
  forcedAlign,
  greedyDecode,
  logitsToLogProbs,
  scoreWords,
  textToTargets,
} from "./forcedAlign.js";

const MODEL_ID = "Xenova/wav2vec2-base-960h";
const CHUNK_SECONDS = 15; // per-inference window; logits are concatenated
const SAMPLE_RATE = 16000;

// Serve model files from our own origin (public/models/, populated by
// scripts/fetch-model.mjs at build time) instead of huggingface.co.
// allowLocalModels defaults to false in browsers, so enable it explicitly;
// allowRemoteModels stays true, so a missing local file still falls back
// to the Hugging Face hub. Either way the browser cache stores the result,
// so the ~91 MB download happens once per browser, not per session.
env.localModelPath = "/models/";
env.allowLocalModels = true;

let bundlePromise = null;

function postProgress(stage, progress, detail = "") {
  self.postMessage({ type: "progress", stage, progress, detail });
}

// Track the model file download specifically (it's ~95% of the bytes).
function makeProgressCallback(stage) {
  const files = new Map();
  return (p) => {
    if (p.status === "progress" && p.total) {
      files.set(p.file, p.loaded / p.total);
      const avg = [...files.values()].reduce((a, b) => a + b, 0) / files.size;
      postProgress(stage, Math.min(avg, 0.999), p.file);
    }
  };
}

function loadBundle() {
  bundlePromise ??= (async () => {
    // AutoProcessor for wav2vec2 carries only the feature extractor — the CTC
    // tokenizer (char vocab for alignment) loads separately.
    const [processor, tokenizer, model] = await Promise.all([
      AutoProcessor.from_pretrained(MODEL_ID, {
        progress_callback: makeProgressCallback("download"),
      }),
      AutoTokenizer.from_pretrained(MODEL_ID),
      AutoModelForCTC.from_pretrained(MODEL_ID, {
        dtype: "q8",
        progress_callback: makeProgressCallback("download"),
      }),
    ]);
    return { processor, tokenizer, model };
  })();
  return bundlePromise;
}

async function runInference(audio, transcript) {
  const { processor, tokenizer, model } = await loadBundle();
  postProgress("download", 1);

  // Tokenizer vocab → char→id map for alignment, id→char for decoding.
  // v4's Wav2Vec2CTCTokenizer.get_vocab() returns a Map; older versions an object.
  const rawVocab = tokenizer.get_vocab();
  const vocabEntries = rawVocab instanceof Map ? [...rawVocab.entries()] : Object.entries(rawVocab);
  const vocab = Object.fromEntries(vocabEntries);
  const idToChar = [];
  for (const [token, id] of vocabEntries) idToChar[id] = token;

  // Chunked inference; concatenate log-probs along time.
  const chunkLen = CHUNK_SECONDS * SAMPLE_RATE;
  const chunks = [];
  for (let start = 0; start < audio.length; start += chunkLen) {
    chunks.push(audio.subarray(start, Math.min(start + chunkLen, audio.length)));
  }

  const parts = [];
  let totalFrames = 0;
  const V = Object.keys(vocab).length;
  for (let i = 0; i < chunks.length; i++) {
    const inputs = await processor(chunks[i]);
    const { logits } = await model(inputs);
    const T = logits.dims[1];
    const logProbs = logitsToLogProbs(new Float32Array(logits.data), T, V);
    parts.push(logProbs);
    totalFrames += T;
    postProgress("inference", (i + 1) / chunks.length, `chunk ${i + 1}/${chunks.length}`);
  }

  const all = new Float32Array(totalFrames * V);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }

  // Without a recognizer transcript (Firefox/Safari), decode one locally and
  // score against it — self-consistency instead of an independent reference.
  let reference = transcript;
  let decodedTranscript = null;
  if (!reference || !reference.trim()) {
    decodedTranscript = greedyDecode(all, totalFrames, V, idToChar);
    reference = decodedTranscript;
  }

  const { ids, words } = textToTargets(reference, vocab);
  if (!ids.length || !words.length) {
    return { words: [], decodedTranscript, note: "no scoreable words" };
  }

  // If the text can't fit the audio (long transcript, short audio), keep the
  // leading words that do fit — better than failing outright.
  let fittedWords = words;
  let fittedIds = ids;
  const maxChars = Math.floor((totalFrames - 1) / 2); // extended seq must fit T
  if (ids.length > maxChars) {
    fittedWords = words.filter((w) => w.to <= maxChars);
    const cut = fittedWords.length ? fittedWords[fittedWords.length - 1].to : 0;
    fittedIds = ids.slice(0, cut);
  }
  if (!fittedWords.length) return { words: [], decodedTranscript, note: "audio too short" };

  const charScores = forcedAlign(all, totalFrames, V, fittedIds);
  if (!charScores) return { words: [], decodedTranscript, note: "alignment failed" };

  return {
    words: scoreWords(charScores, fittedWords),
    decodedTranscript,
    truncated: fittedWords.length < words.length,
  };
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== "analyze") return;
  try {
    const result = await runInference(msg.audio, msg.transcript);
    self.postMessage({ type: "done", ...result });
  } catch (err) {
    self.postMessage({ type: "error", message: err?.message ?? String(err) });
  }
};
