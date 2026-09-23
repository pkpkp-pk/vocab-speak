// End-to-end smoke test of the pronunciation pipeline (node side: validates
// the transformers.js v4 API calls the worker makes — AutoProcessor,
// AutoModelForCTC with dtype q8, processor(audio), logits shape, vocab).
// Uses 3s of synthetic speech-like audio; scores themselves are meaningless
// here, the pipeline completing is the test.
import { AutoProcessor, AutoModelForCTC, AutoTokenizer } from "@huggingface/transformers";
import {
  forcedAlign,
  greedyDecode,
  logitsToLogProbs,
  scoreWords,
  textToTargets,
} from "../src/lib/forcedAlign.js";

const MODEL_ID = "Xenova/wav2vec2-base-960h";
const SR = 16000;
const SECONDS = 3;

console.log("loading processor…");
const t0 = Date.now();
const processor = await AutoProcessor.from_pretrained(MODEL_ID);
console.log("loading q8 model (~95 MB on first run)…");
const model = await AutoModelForCTC.from_pretrained(MODEL_ID, { dtype: "q8" });
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const rawVocab = tokenizer.get_vocab();
// v4's Wav2Vec2CTCTokenizer returns a Map; older versions a plain object.
const vocabEntries = rawVocab instanceof Map ? [...rawVocab.entries()] : Object.entries(rawVocab);
const vocab = Object.fromEntries(vocabEntries);
const idToChar = [];
for (const [token, id] of vocabEntries) idToChar[id] = token;
console.log("vocab size:", vocabEntries.length, "| blank:", JSON.stringify(idToChar[0]), "| delim:", JSON.stringify(idToChar[4]));

// Synthetic "speech": amplitude-modulated harmonics sweeping 100–200 Hz.
const audio = new Float32Array(SR * SECONDS);
for (let i = 0; i < audio.length; i++) {
  const t = i / SR;
  const f0 = 100 + 50 * Math.sin(t * 3);
  const env = 0.3 + 0.2 * Math.sin(t * 8);
  audio[i] =
    env *
    (Math.sin(2 * Math.PI * f0 * t) +
      0.5 * Math.sin(2 * Math.PI * 2 * f0 * t) +
      0.25 * Math.sin(2 * Math.PI * 3 * f0 * t));
}

console.log("running inference…");
const t1 = Date.now();
const inputs = await processor(audio);
const { logits } = await model(inputs);
const T = logits.dims[1];
const V = logits.dims[2];
console.log(`logits [${logits.dims.join("x")}] in ${((Date.now() - t1) / 1000).toFixed(1)}s (${SECONDS}s audio)`);

if (V !== 32) throw new Error(`unexpected vocab dim ${V}`);
const logProbs = logitsToLogProbs(new Float32Array(logits.data), T, V);

const decoded = greedyDecode(logProbs, T, V, idToChar);
console.log("greedy decode of synthetic signal:", JSON.stringify(decoded), "(gibberish is fine)");

const reference = decoded || "hello world";
const { ids, words } = textToTargets(reference, vocab);
const charScores = forcedAlign(logProbs, T, V, ids);
if (!charScores) throw new Error("forcedAlign returned null");
const wordScores = scoreWords(charScores, words);
console.log("word scores:", wordScores.map((w) => `${w.word}:${w.score}`).join(" "));
console.log("\n✅ pronunciation pipeline OK end-to-end");
