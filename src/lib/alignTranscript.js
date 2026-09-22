// Aligns SpeechRecognition segments to the recorded waveform so the
// transcript can show *where* you were loud/quiet and *where* you paused.
//
// The Web Speech API gives no word timestamps, so this is an estimation:
// Chrome tends to finalize a segment when you pause, so each segment is
// anchored to the voiced region whose END is closest to (arrival − lag).
// The anchor pointer only moves forward, so word order can never scramble.
// Within a region, words are spread proportional to their length.
//
// The lag is not a fixed constant: it is Chrome's end-of-speech detection
// delay plus the server round-trip, which varies per session and network.
// alignTranscript therefore self-calibrates — it runs the anchor walk once
// with the default lag, measures the implied lag of every segment
// (endedAt − assigned region end), then re-runs the walk with the median.
//
// segments: [{ text, endedAt }] — seconds since session start
// samples:  [{ t, rmsDb }]     — from useAudioAnalysis
// returns:  { tokens, leftoverCount, leftoverSeconds, lagSeconds,
//             lagCalibrated } | null
//   tokens: [{ type: "word", text, db } | { type: "pause", dur }]
//   leftover*: short voiced regions no transcript words landed on — usually
//   spoken "um"/"uh" that Chrome dropped from the transcript.

import { voicedRegions } from "./analyzeAudio.js";

const DEFAULT_LAG_S = 0.7; // fallback + first-pass guess
const LAG_MIN_S = 0.25; // beyond these bounds the estimate is noise, not signal
const LAG_MAX_S = 1.75;
const LAG_SPREAD_MAX_S = 1.5; // implied lags varying more than this = untrustworthy
const MIN_REGION_S = 0.15; // ignore voiced blips shorter than this
const MIN_PAUSE_S = 0.3; // gaps shorter than this aren't worth a marker
const LEFTOVER_MAX_S = 0.8; // longer unassigned regions are missed phrases, not disfluencies

// floorDb: optional measured noise floor (mic check) — see voicedMask.
// wordSpans: optional measured per-word timings from the deep-analysis CTC
// pass — when present, the whole lag/anchor heuristic is skipped.
export function alignTranscript(segments, samples, floorDb = null, wordSpans = null) {
  const usableSegments = (segments ?? []).filter((s) => s.text?.trim());
  if (!samples?.length) return null;
  if (!wordSpans?.length && !usableSegments.length) return null;

  const regions = voicedRegions(samples, floorDb);
  const usable = regions.filter((r) => r.end - r.start >= MIN_REGION_S);
  if (!usable.length) return null;

  if (wordSpans?.length) return alignFromSpans(wordSpans, samples, usable);

  if (!usableSegments.length) return null;

  // One pass of the monotonic anchor walk at a given recognition lag.
  const walk = (lagS) => {
    const tokens = [];
    const assigned = new Set(); // region indices that received transcript words
    const segRegions = []; // region index per segment (for lag estimation)
    let ri = 0;
    let prevRi = -1;
    let regionCursor = usable[0].start;

    for (const seg of usableSegments) {
      const target = seg.endedAt - lagS;
      // Move the anchor forward while the next region's end is at least as
      // close to the target — monotonic, so segments keep their spoken order.
      while (
        ri < usable.length - 1 &&
        Math.abs(usable[ri + 1].end - target) <= Math.abs(usable[ri].end - target)
      ) {
        ri++;
      }
      assigned.add(ri);
      segRegions.push(ri);

      // A jump to a later region with real silence in between = a pause marker.
      // Subtract any regions skipped over in between — they contain sound
      // (untranscribed words, leftover "um"s), so the silent gap is shorter
      // than the distance between the two anchored regions.
      if (prevRi !== -1 && ri > prevRi) {
        let silence = usable[ri].start - usable[prevRi].end;
        for (let k = prevRi + 1; k < ri; k++) silence -= usable[k].end - usable[k].start;
        if (silence >= MIN_PAUSE_S) tokens.push({ type: "pause", dur: +silence.toFixed(1) });
      }

      const region = usable[ri];
      const words = seg.text.trim().split(/\s+/);
      const spanStart = Math.max(regionCursor, region.start);
      const span = region.end - spanStart;
      const totalChars = words.reduce((a, w) => a + w.length, 0) || 1;

      let cursor = spanStart;
      words.forEach((word, wi) => {
        const end =
          wi === words.length - 1 ? region.end : cursor + (word.length / totalChars) * span;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < samples.length; i++) {
          if (samples[i].t >= cursor && samples[i].t < end) {
            sum += samples[i].rmsDb;
            n++;
          }
        }
        tokens.push({ type: "word", text: word, db: n ? +(sum / n).toFixed(1) : null });
        cursor = end;
      });

      regionCursor = region.end;
      prevRi = ri;
    }

    return { tokens, assigned, segRegions };
  };

  // Pass 1 with the default lag, then calibrate from where segments landed.
  const first = walk(DEFAULT_LAG_S);
  const implied = first.segRegions.map((ri, i) => usableSegments[i].endedAt - usable[ri].end);

  let lagS = DEFAULT_LAG_S;
  let lagCalibrated = false;
  if (implied.length >= 2) {
    const sorted = [...implied].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median =
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const spread = sorted[sorted.length - 1] - sorted[0];
    if (spread <= LAG_SPREAD_MAX_S) {
      lagS = Math.min(LAG_MAX_S, Math.max(LAG_MIN_S, median));
      lagCalibrated = true;
    }
  }

  const finalWalk = lagCalibrated ? walk(lagS) : first;

  // Short voiced regions that no transcript words landed on. Chrome strips
  // disfluencies from finalized text, so a 0.15–0.8s region sitting between
  // word-carrying ones was very likely a spoken "um"/"uh" that never made it
  // into the transcript. (Ones glued to neighbouring words inside the same
  // region are invisible here — the interim diff covers those.) Longer
  // unassigned regions are treated as missed phrases, not fillers.
  let leftoverCount = 0;
  let leftoverSeconds = 0;
  usable.forEach((region, i) => {
    if (finalWalk.assigned.has(i)) return;
    const dur = region.end - region.start;
    if (dur <= LEFTOVER_MAX_S) {
      leftoverCount++;
      leftoverSeconds += dur;
    }
  });

  return {
    tokens: finalWalk.tokens,
    leftoverCount,
    leftoverSeconds: +leftoverSeconds.toFixed(1),
    lagSeconds: +lagS.toFixed(2),
    lagCalibrated,
  };
}

// Token construction from measured CTC word spans: no recognition lag, no
// proportional spreading — each word's volume is sampled from its true
// window, and pauses are true inter-word gaps. Words with null spans
// (zero-frame mumbles) are interpolated evenly between their neighbours.
function alignFromSpans(wordSpans, samples, usable) {
  const fixed = wordSpans.map((w) => (w.start != null ? w : null));
  let i = 0;
  while (i < fixed.length) {
    if (fixed[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < fixed.length && !fixed[j]) j++;
    const startBase = i > 0 ? fixed[i - 1].end : 0;
    const endCap = j < fixed.length ? fixed[j].start : startBase + 0.2 * (j - i);
    const step = Math.max((endCap - startBase) / (j - i), 0.04);
    for (let k = i; k < j; k++) {
      fixed[k] = {
        word: wordSpans[k].word,
        start: startBase + step * (k - i),
        end: startBase + step * (k - i + 1),
      };
    }
    i = j;
  }

  const tokens = [];
  let prevEnd = null;
  for (const w of fixed) {
    if (prevEnd !== null && w.start - prevEnd >= MIN_PAUSE_S) {
      tokens.push({ type: "pause", dur: +(w.start - prevEnd).toFixed(1) });
    }
    let sum = 0;
    let n = 0;
    for (let s = 0; s < samples.length; s++) {
      if (samples[s].t >= w.start && samples[s].t < w.end) {
        sum += samples[s].rmsDb;
        n++;
      }
    }
    tokens.push({ type: "word", text: w.word, db: n ? +(sum / n).toFixed(1) : null });
    prevEnd = w.end;
  }

  // Leftover regions: voiced audio no word span covers (likely dropped
  // disfluencies even the reference text lacked).
  let leftoverCount = 0;
  let leftoverSeconds = 0;
  usable.forEach((r) => {
    const covered = fixed.some((w) => w.start < r.end && w.end > r.start);
    if (covered) return;
    const dur = r.end - r.start;
    if (dur <= LEFTOVER_MAX_S) {
      leftoverCount++;
      leftoverSeconds += dur;
    }
  });

  return {
    tokens,
    leftoverCount,
    leftoverSeconds: +leftoverSeconds.toFixed(1),
    lagSeconds: 0, // measured timings — no recognition lag involved
    lagCalibrated: true,
  };
}
