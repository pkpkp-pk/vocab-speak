// Sanity tests for the pure analysis modules (run with: node scripts/test-audio-libs.mjs)
import { analyzeAudio, voicedRegions } from "../src/lib/analyzeAudio.js";
import { createResampler } from "../src/lib/resample.js";
import { analyzeSpeech, diffStrippedFillers } from "../src/lib/analyzeSpeech.js";
import { analyzeVocabulary } from "../src/lib/analyzeVocabulary.js";
import { encodeWavPcm16 } from "../src/lib/wav.js";
import { buildCoachPrompt } from "../src/lib/aiCoach.js";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import { alignTranscript } from "../src/lib/alignTranscript.js";
import { detectPitch } from "../src/lib/pitch.js";
import {
  alignStates,
  forcedAlign,
  greedyDecode,
  logitsToLogProbs,
  scoreWords,
  textToTargets,
  wordSpansFromStates,
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

// ---- alignTranscript: two segments separated by a real silence ----
// Timeline (60fps): 1-3s voiced at -22 dB, 3-5.5s silence, 5.5-8.5s voiced at -15 dB.
const atSamples = [];
for (let i = 0; i < 9 * 60; i++) {
  const t = i / 60;
  const voiced = (t >= 1 && t < 3) || (t >= 5.5 && t < 8.5);
  atSamples.push({ t, rmsDb: voiced ? (t < 4 ? -22 : -15) : -62, f0: null });
}
const atSegments = [
  { text: "hello there", endedAt: 3.6 },   // finalized just after the first utterance
  { text: "louder now friend", endedAt: 9.0 }, // ends a bit past the audio
];
const aligned = alignTranscript(atSegments, atSamples);
const tokens = aligned?.tokens;
check("alignTranscript returns tokens", Array.isArray(tokens) && tokens.length > 0);
check("no leftover sounds when every region has words", aligned?.leftoverCount === 0,
  `got ${aligned?.leftoverCount}`);
check("lag self-calibrates (fixture implied 0.6/0.5 → median 0.55)",
  aligned?.lagCalibrated === true && Math.abs(aligned.lagSeconds - 0.55) < 0.01,
  `got ${aligned?.lagSeconds} calibrated=${aligned?.lagCalibrated}`);
const heatWords = tokens?.filter((t) => t.type === "word") ?? [];
const heatPauses = tokens?.filter((t) => t.type === "pause") ?? [];
check("all 5 words placed", heatWords.length === 5, `got ${heatWords.length}`);
check("one pause marker ≈2.5s", heatPauses.length === 1 && Math.abs(heatPauses[0].dur - 2.5) < 0.4,
  heatPauses.length ? `got ${heatPauses[0].dur}s` : "none");
check("pause sits between the two segments",
  tokens && tokens.findIndex((t) => t.type === "pause") === 2,
  `index ${tokens?.findIndex((t) => t.type === "pause")}`);
const firstSegDb = heatWords.slice(0, 2).map((w) => w.db);
const secondSegDb = heatWords.slice(2).map((w) => w.db);
check("segment volumes match waveform (-22 vs -15 dB)",
  firstSegDb.every((d) => Math.abs(d - -22) < 1.5) && secondSegDb.every((d) => Math.abs(d - -15) < 1.5),
  `got ${JSON.stringify([firstSegDb, secondSegDb])}`);
check("graceful null with no segments", alignTranscript([], atSamples) === null);
check("graceful null with no samples", alignTranscript(atSegments, []) === null);

// ---- filler recovery A: interims Chrome cleans before finalizing ----
const d1 = diffStrippedFillers("Um, so basically", "so basically");
check("diff recovers a stripped um", d1.um === 1, JSON.stringify(d1));
check("diff ignores non-filler revisions",
  Object.keys(diffStrippedFillers("their going there", "they're going there")).length === 0);
check("diff counts repeats", diffStrippedFillers("um um okay", "okay").um === 2);
check("diff is a multiset diff", diffStrippedFillers("um um okay", "um okay").um === 1);
check("diff clean when nothing vanished",
  Object.keys(diffStrippedFillers("so basically", "so basically")).length === 0);
const s1 = analyzeSpeech("i said", { durationSeconds: 10, strippedFillers: { um: 1 } });
check("analyzeSpeech merges stripped fillers",
  s1.fillerTotal === 1 && s1.fillerCounts.um === 1 && s1.strippedFillerTotal === 1,
  JSON.stringify(s1.fillerCounts));
check("merged ratio uses transcript word count", s1.fillerRatio === 50, `${s1.fillerRatio}`);
const s2 = analyzeSpeech("you know i said", { durationSeconds: 10 });
check("no stripped input keeps totals unchanged",
  s2.fillerTotal === 1 && s2.strippedFillerTotal === 0, `total ${s2.fillerTotal}`);

// ---- filler recovery B: short voiced regions with no transcript words ----
// Regions: 1-3s (words), 3.8-4.2s (a spoken "um" — no segment), 5-8s (words).
const loSamples = [];
for (let i = 0; i < 8 * 60; i++) {
  const t = i / 60;
  const voiced = (t >= 1 && t < 3) || (t >= 3.8 && t < 4.2) || (t >= 5 && t < 8);
  loSamples.push({ t, rmsDb: voiced ? -20 : -62, f0: null });
}
const loAligned = alignTranscript(
  [{ text: "hello there", endedAt: 3.6 }, { text: "louder now friend", endedAt: 8.6 }],
  loSamples
);
check("leftover: untranscribed region detected", loAligned?.leftoverCount === 1,
  `got ${loAligned?.leftoverCount}`);
check("leftover: duration ≈0.4s", loAligned && Math.abs(loAligned.leftoverSeconds - 0.4) < 0.15,
  `got ${loAligned?.leftoverSeconds}`);
check("leftover: words still placed on their regions",
  loAligned && loAligned.tokens.filter((tk) => tk.type === "word").length === 5,
  `got ${loAligned?.tokens.filter((tk) => tk.type === "word").length}`);
const loPauses = loAligned?.tokens.filter((tk) => tk.type === "pause") ?? [];
check("pause gap subtracts the skipped untranscribed region (2.0 - 0.4 ≈ 1.6s)",
  loPauses.length === 1 && Math.abs(loPauses[0].dur - 1.6) < 0.15,
  `got ${loPauses[0]?.dur}s`);
// A long unassigned region (a missed phrase) must not count as a filler.
const loBig = alignTranscript([{ text: "hello there friend", endedAt: 8.6 }], loSamples);
check("long unassigned region is not a leftover", loBig?.leftoverCount === 1,
  `got ${loBig?.leftoverCount}`);

// ---- lag calibration: true lag 1.2s (slow network), regions 1-2s and 4-5s ----
const calSamples = [];
for (let i = 0; i < 6 * 60; i++) {
  const t = i / 60;
  const voiced = (t >= 1 && t < 2) || (t >= 4 && t < 5);
  calSamples.push({ t, rmsDb: voiced ? (t < 3 ? -22 : -15) : -62, f0: null });
}
const calAligned = alignTranscript(
  [{ text: "hello there", endedAt: 3.2 }, { text: "louder now friend", endedAt: 6.2 }],
  calSamples
);
check("calibrates to true lag 1.2s",
  calAligned?.lagCalibrated === true && Math.abs(calAligned.lagSeconds - 1.2) < 0.05,
  `got ${calAligned?.lagSeconds}`);
const calWords = calAligned?.tokens.filter((t) => t.type === "word") ?? [];
check("calibrated walk still lands words on correct regions",
  calWords.length === 5 && calWords.slice(0, 2).every((w) => Math.abs(w.db - -22) < 1.5) &&
  calWords.slice(2).every((w) => Math.abs(w.db - -15) < 1.5),
  `got ${JSON.stringify(calWords.map((w) => w.db))}`);
const calSingle = alignTranscript([{ text: "hello there", endedAt: 3.2 }], calSamples);
check("single segment falls back to default lag, uncalibrated",
  calSingle?.lagCalibrated === false && calSingle?.lagSeconds === 0.7,
  `got ${calSingle?.lagSeconds} calibrated=${calSingle?.lagCalibrated}`);

// ---- measured noise floor vs adaptive (fluent nonstop-talker bias) ----
// 10s at 60fps: per 2s cycle → 1.2s loud (-20), 0.7s quiet tail (-32),
// 0.1s silence (-50). Silence is only 5% of samples, so the adaptive p10
// floor lands inside the quiet speech and eats it; a measured floor doesn't.
const ntSamples = [];
for (let c = 0; c < 5; c++) {
  const base = c * 2;
  for (let i = 0; i < 72; i++) ntSamples.push({ t: base + i / 60, rmsDb: -20, f0: 120 });
  for (let i = 0; i < 42; i++) ntSamples.push({ t: base + 1.2 + i / 60, rmsDb: -32, f0: 120 });
  for (let i = 0; i < 6; i++) ntSamples.push({ t: base + 1.9 + i / 60, rmsDb: -50, f0: null });
}
const ntAdaptive = analyzeAudio(ntSamples);
const ntMeasured = analyzeAudio(ntSamples, -50);
check("adaptive floor eats quiet tails (false pauses for fluent talker)",
  ntAdaptive.pauseCount >= 3, `adaptive pauses ${ntAdaptive.pauseCount}`);
check("measured floor keeps quiet speech voiced (no false pauses)",
  ntMeasured.pauseCount === 0 && ntMeasured.voicedSeconds > ntAdaptive.voicedSeconds + 2,
  `measured pauses ${ntMeasured.pauseCount}, voiced ${ntMeasured.voicedSeconds}s vs adaptive ${ntAdaptive.voicedSeconds}s`);

// ---- voicedRegions (shared by alignTranscript) ----
// Voiced 1-3s, 5-6s, 30-35s over 36s of samples.
const chunkSamples = [];
for (let i = 0; i < 36 * 60; i++) {
  const t = i / 60;
  const voiced = (t >= 1 && t < 3) || (t >= 5 && t < 6) || (t >= 30 && t < 35);
  chunkSamples.push({ t, rmsDb: voiced ? -20 : -62, f0: null });
}
const regions = voicedRegions(chunkSamples);
check("voicedRegions finds 3 regions", regions.length === 3,
  `got ${regions.length}`);
check("voicedRegions boundaries ≈ [1,3] [5,6] [30,35]",
  Math.abs(regions[0].start - 1) < 0.1 && Math.abs(regions[0].end - 3) < 0.1 &&
  Math.abs(regions[2].start - 30) < 0.1 && Math.abs(regions[2].end - 35) < 0.1,
  JSON.stringify(regions.map((r) => [+r.start.toFixed(1), +r.end.toFixed(1)])));

// ---- word spans from CTC states (20ms frames) ----
// Existing HI fixture: H hot at frames 30-70, I at 90-120.
const hiStates = alignStates(logProbs, T, V, ids);
const hiSpans = wordSpansFromStates(hiStates, words);
check("word span matches the hot frames (0.6s-2.4s)",
  hiSpans.length === 1 && Math.abs(hiSpans[0].start - 0.6) < 0.03 && Math.abs(hiSpans[0].end - 2.4) < 0.03,
  `got [${hiSpans[0]?.start}, ${hiSpans[0]?.end}]`);

// Two words: H 20-40, I 40-60, | 60-70, H 70-90, I 90-110.
const logits2 = new Float32Array(T * V).fill(-8);
const setHot2 = (t0, t1, id, val = 6) => { for (let t = t0; t < t1; t++) logits2[t * V + id] = val; };
setHot2(0, 20, 0); setHot2(20, 40, 11); setHot2(40, 60, 10); setHot2(60, 70, 4);
setHot2(70, 90, 11); setHot2(90, 110, 10); setHot2(110, 120, 0);
const lp2 = logitsToLogProbs(logits2, T, V);
const { ids: ids2, words: words2 } = textToTargets("hi hi", vocab);
const spans2 = wordSpansFromStates(alignStates(lp2, T, V, ids2), words2);
check("two words get distinct spans",
  spans2.length === 2 && Math.abs(spans2[0].start - 0.4) < 0.03 && Math.abs(spans2[0].end - 1.2) < 0.03 &&
  Math.abs(spans2[1].start - 1.4) < 0.03 && Math.abs(spans2[1].end - 2.2) < 0.03,
  JSON.stringify(spans2));

// ---- alignTranscript wordSpans branch: measured timings, no lag ----
const spSamples = [];
for (let i = 0; i < 7 * 60; i++) {
  const t = i / 60;
  const voiced = (t >= 1 && t < 2) || (t >= 2.5 && t < 2.8) || (t >= 4 && t < 5);
  spSamples.push({ t, rmsDb: voiced ? (t < 2.2 ? -22 : t < 3 ? -20 : -15) : -62, f0: null });
}
const spAligned = alignTranscript([], spSamples, null, [
  { word: "hello", start: 1, end: 2 },
  { word: "there", start: 4, end: 5 },
]);
const spTokens = spAligned?.tokens ?? [];
check("spans branch: word-pause-word tokens",
  spTokens.length === 3 && spTokens[0].type === "word" && spTokens[1].type === "pause" &&
  Math.abs(spTokens[1].dur - 2.0) < 0.15 && spTokens[2].type === "word",
  JSON.stringify(spTokens.map((t) => t.type)));
check("spans branch: per-word volume from true windows",
  Math.abs(spTokens[0].db - -22) < 1 && Math.abs(spTokens[2].db - -15) < 1,
  `got [${spTokens[0]?.db}, ${spTokens[2]?.db}]`);
check("spans branch: uncovered short region still counts as leftover",
  spAligned?.leftoverCount === 1, `got ${spAligned?.leftoverCount}`);
check("spans branch: lag is zero (measured)",
  spAligned?.lagSeconds === 0 && spAligned?.lagCalibrated === true);
const interpAligned = alignTranscript([], spSamples, null, [
  { word: "a", start: 1, end: 2 },
  { word: "mumble", start: null, end: null },
  { word: "c", start: 4, end: 5 },
]);
const interpWords = interpAligned?.tokens.filter((t) => t.type === "word") ?? [];
check("null spans interpolate between neighbours",
  interpWords.length === 3 && interpWords[1].text === "mumble" && interpWords[1].db !== null);

// ---- analyzeVocabulary: diversity, overuse, keyword timing ----
const repText = Array.from({ length: 60 }, () => "networking is good networking is useful").join(" ");
const repVocab = analyzeVocabulary(repText, { keywords: [], durationSeconds: 60 });
check("repetitive text scores repetitive diversity",
  repVocab.diversityLabel === "repetitive", `got ${repVocab.diversityLabel} (${repVocab.matr ?? repVocab.ttr})`);
check("overuse catches repeated content word",
  repVocab.overused.some((o) => o.word === "networking"),
  JSON.stringify(repVocab.overused));
// 240 unique alphabetic tokens (digits would be stripped by tokenization).
const pair = (i) => String.fromCharCode(97 + (i % 26), 97 + Math.floor(i / 26));
const richText = Array.from({ length: 240 }, (_, i) => pair(i)).join(" ");
const richVocab = analyzeVocabulary(richText, { keywords: [], durationSeconds: 60 });
check("varied text scores wide vocabulary",
  richVocab.diversityLabel === "wide vocabulary" && richVocab.overused.length === 0,
  `got ${richVocab.diversityLabel}, overused ${richVocab.overused.length}`);
check("stopwords never count as overused",
  analyzeVocabulary(Array(50).fill("the and but so").join(" "), {}).overused.length === 0);
check("topic keywords excluded from overuse",
  analyzeVocabulary(Array(40).fill("risk assessment risk").join(" "), { keywords: ["risk"] })
    .overused.every((o) => o.word !== "risk"));
const kwVocab = analyzeVocabulary("hello world", {
  keywords: ["risk", "growth"],
  durationSeconds: 60,
  segments: [
    { text: "risk first", endedAt: 6 },
    { text: "growth later", endedAt: 54 },
  ],
});
check("keyword timing: mean 50% → spread out",
  kwVocab.kwTiming.length === 2 && kwVocab.plannerLabel === "spread out",
  JSON.stringify(kwVocab));
const earlyVocab = analyzeVocabulary("hello", {
  keywords: ["risk", "growth"],
  durationSeconds: 60,
  segments: [{ text: "risk growth together", endedAt: 5 }],
});
check("keyword timing: both early → early planner", earlyVocab.plannerLabel === "early planner",
  `got ${earlyVocab.plannerLabel}`);
check("empty transcript → null", analyzeVocabulary("", {}) === null);

// ---- resample.js: 48k → 16k for the Gemini Live PCM feed ----
{
  const rs = createResampler(48000);
  const out = rs.push(new Float32Array(480).fill(0.5));
  check("resampler 48k→16k ratio", out.length === 160, `got ${out.length}`);
  check("resampler preserves DC level", out.every((v) => Math.abs(v - 0.5) < 1e-6));
  // Chunk-boundary continuity: two halves must equal one push.
  const rsA = createResampler(48000);
  const whole = rsA.push(new Float32Array(480).fill(-0.25));
  const rsB = createResampler(48000);
  const split = [...rsB.push(new Float32Array(240).fill(-0.25)), ...rsB.push(new Float32Array(240).fill(-0.25))];
  check("resampler chunk-boundary continuous", split.length === whole.length &&
    split.every((v, i) => v === whole[i]), `split ${split.length} vs whole ${whole.length}`);
  check("resampler passthrough at equal rates",
    createResampler(16000).push(new Float32Array([1, 2, 3])).length === 3);
  // Alternating ±1 at 48k averages toward 0 at 16k (boxcar anti-alias).
  const alt = new Float32Array(480);
  for (let i = 0; i < 480; i++) alt[i] = i % 2 ? 1 : -1;
  const altOut = createResampler(48000).push(alt);
  check("resampler averages Nyquist noise toward zero",
    altOut.every((v) => Math.abs(v) < 0.4), `max |${Math.max(...altOut.map(Math.abs))}|`);
}

// ---- heatmap markup: chip spans need real whitespace between them ----
// Adjacent elements from .map() have no break opportunities, so the browser
// treats the whole row as one unbreakable word and overflows the card.
// Render the real component (through vite's SSR loader) and check the markup.
{
  const root = fileURLToPath(new URL("..", import.meta.url));
  const server = await createServer({ root, logLevel: "silent", server: { middlewareMode: true } });
  try {
    const { default: TranscriptHeatmap } = await server.ssrLoadModule(
      "/src/components/TranscriptHeatmap.jsx"
    );
    const html = renderToStaticMarkup(
      createElement(TranscriptHeatmap, {
        tokens: [
          { type: "word", text: "hello", db: -20 },
          { type: "word", text: "there", db: -18 },
          { type: "pause", dur: 1.6 },
          { type: "word", text: "friend", db: -15 },
        ],
      })
    );
    check("heatmap chips separated by whitespace (line can wrap inside the card)",
      !html.includes("</span><span"), html.replace(/\s+/g, " ").slice(0, 140));
    check("heatmap renders words and pause pill",
      html.includes("hello") && html.includes("friend") && html.includes("1.6"));
  } finally {
    await server.close();
  }
}

// ---- wav.js: 16-bit PCM WAV encoder for the Gemini coach upload ----
const wav = encodeWavPcm16(new Float32Array([0, 0.5, -0.5, 1, -1]), 16000);
const wavAscii = (off, n) => String.fromCharCode(...wav.slice(off, off + n));
const wavView = new DataView(wav.buffer);
check("wav header is RIFF/WAVE", wavAscii(0, 4) === "RIFF" && wavAscii(8, 4) === "WAVE");
check("wav total size = 44-byte header + data", wav.length === 44 + 10);
check("wav is mono 16-bit 16kHz PCM",
  wavView.getUint16(20, true) === 1 && wavView.getUint16(22, true) === 1 &&
  wavView.getUint16(34, true) === 16 && wavView.getUint32(24, true) === 16000);
check("wav chunk sizes consistent",
  wavView.getUint32(40, true) === 10 && wavView.getUint32(4, true) === 36 + 10);
check("wav sample values roundtrip",
  wavView.getInt16(46, true) === 16383 && wavView.getInt16(48, true) === -16384,
  `got [${wavView.getInt16(46, true)}, ${wavView.getInt16(48, true)}]`);
check("wav clamps out-of-range samples",
  wavView.getInt16(50, true) === 32767 && wavView.getInt16(52, true) === -32768);

// ---- aiCoach.js: coach prompt builder (pure) ----
const coachPrompt = buildCoachPrompt({
  topic: { title: "Networking", prompt: "Talk about it" },
  transcript: "um hello there",
  stats: {
    wpm: 120,
    audio: { pauseCount: 2, longestPause: 1.5, meanDb: -22, volumeLabel: "good", pitch: { label: "monotone" } },
  },
});
check("coach prompt embeds measured stats and transcript",
  coachPrompt.includes("120") && coachPrompt.includes("um hello there") && coachPrompt.includes("monotone"));
check("coach prompt warns that the transcript drops fillers",
  /DROPS filler/i.test(coachPrompt));
const coachPromptBare = buildCoachPrompt({
  topic: { title: "T", prompt: "P" },
  transcript: "",
  stats: { wpm: 0, audio: null },
});
check("coach prompt handles missing audio and transcript",
  coachPromptBare.includes("No transcript") && !coachPromptBare.includes("undefined"));

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall green");
process.exit(failures ? 1 : 0);
