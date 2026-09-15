// Sanity tests for the pure analysis modules (run with: node scripts/test-audio-libs.mjs)
import { analyzeAudio } from "../src/lib/analyzeAudio.js";
import { detectPitch } from "../src/lib/pitch.js";
import {
  forcedAlign,
  greedyDecode,
  logitsToLogProbs,
  scoreWords,
  textToTargets,
} from "../src/lib/forcedAlign.js";

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

// ---- pitch.js: synthesize a 120 Hz tone, expect ~120 Hz back ----
const rate = 48000;
const N = 2048;
const tone = new Float32Array(N);
for (let i = 0; i < N; i++) {
  tone[i] = 0.5 * Math.sin((2 * Math.PI * 120 * i) / rate) + 0.1 * Math.sin((2 * Math.PI * 240 * i) / rate);
}
const f0 = detectPitch(tone, rate);
check("pitch detects 120 Hz tone", f0 !== null && Math.abs(f0 - 120) < 5, `got ${f0?.toFixed(1)}`);
check("pitch rejects silence", detectPitch(new Float32Array(N), rate) === null);

// ---- analyzeAudio: 60s @ 60fps, voiced/silence/voiced/silence/voiced ----
function makeSession(f0Wobble) {
  const samples = [];
  let t = 0;
  const dt = 1 / 60;
  let phase = 0;
  const push = (rmsDb, voiced, f0base) => {
    // 60 frames of the given level
    for (let i = 0; i < 60; i++) {
      phase += dt;
      const f0 = voiced && f0base ? f0base * (1 + f0Wobble * Math.sin(phase * 2)) : null;
      samples.push({ t: phase, rmsDb: voiced ? rmsDb + (Math.random() - 0.5) * 2 : -60, f0 });
    }
  };
  // 0-1s: room silence (lead-in), then speech blocks with 2 gaps
  for (let i = 0; i < 60; i++) { phase += dt; samples.push({ t: phase, rmsDb: -60 + Math.random(), f0: null }); }
  push(-22, true, 120); // 1s
  for (let i = 0; i < 120; i++) { phase += dt; samples.push({ t: phase, rmsDb: -60, f0: null }); } // 2s pause
  push(-22, true, 120); // 1s
  for (let i = 0; i < 300; i++) { phase += dt; samples.push({ t: phase, rmsDb: -60, f0: null }); } // 5s pause
  push(-22, true, 120); // 1s
  return samples;
}

const a1 = analyzeAudio(makeSession(0.005));
check("analyzeAudio finds 2 pauses", a1.pauseCount === 2, `got ${a1.pauseCount}`);
check("longest pause ≈ 5s", Math.abs(a1.longestPause - 5) < 0.3, `got ${a1.longestPause}`);
check("volume label good at -22 dB", a1.volumeLabel === "good", `got ${a1.volumeLabel} (${a1.meanDb} dB)`);
check("flat pitch → monotone", a1.pitch && a1.pitch.label === "monotone", `got ${a1.pitch?.label} (${a1.pitch?.stdev} st)`);

const a2 = analyzeAudio(makeSession(0.5));
check("wandering pitch → expressive", a2.pitch && a2.pitch.label === "expressive", `got ${a2.pitch?.label} (${a2.pitch?.stdev} st)`);
check("spark has ≤120 buckets", a1.spark.length <= 120, `got ${a1.spark.length}`);
check("2 spark pause markers", a1.sparkPauses.length === 2, `got ${a1.sparkPauses.length}`);
check("returns null on all-silence", analyzeAudio(makeSession(0).map(s => ({ ...s, rmsDb: -70, f0: null }))) === null);

// ---- forcedAlign: synthetic logits for "HI" ----
// vocab ids: 0 blank, 4 "|", 11 H, 10 I
const V = 32;
const T = 120;
const logits = new Float32Array(T * V).fill(-8);
const setHot = (t0, t1, id, val = 6) => { for (let t = t0; t < t1; t++) logits[t * V + id] = val; };
setHot(0, 30, 0); // blank
setHot(30, 70, 11); // H
setHot(70, 90, 0); // blank
setHot(90, 120, 10); // I
const logProbs = logitsToLogProbs(logits, T, V);

const vocab = { "|": 4, H: 11, I: 10 };
const { ids, words } = textToTargets("hi", vocab);
check("textToTargets maps 'hi' → [11,10]", ids.length === 2 && ids[0] === 11 && ids[1] === 10);

const charScores = forcedAlign(logProbs, T, V, ids);
check("forcedAlign returns per-char scores", charScores && charScores.length === 2);
check("clean synthetic audio scores >0.8", charScores && charScores[0] > 0.8 && charScores[1] > 0.8,
  charScores ? `got [${charScores[0].toFixed(2)}, ${charScores[1].toFixed(2)}]` : "null");

const wordScores = scoreWords(charScores, words);
check("word 'hi' scores high", wordScores[0].score > 0.8, `got ${wordScores[0].score}`);

// Mismatch: align "HI" against audio that's all blank → low scores
const blankLogits = logitsToLogProbs(new Float32Array(T * V).fill(-8).map((v, i) => (i % V === 0 ? 6 : v)), T, V);
const badScores = forcedAlign(blankLogits, T, V, ids);
check("mismatched audio scores <0.2", badScores && badScores[0] < 0.2 && badScores[1] < 0.2,
  badScores ? `got [${badScores[0].toFixed(3)}, ${badScores[1].toFixed(3)}]` : "null");

// greedy decode round-trip
const idToChar = [];
idToChar[4] = "|"; idToChar[11] = "H"; idToChar[10] = "I";
check("greedyDecode recovers 'hi'", greedyDecode(logProbs, T, V, idToChar) === "hi",
  `got "${greedyDecode(logProbs, T, V, idToChar)}"`);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall green");
process.exit(failures ? 1 : 0);
