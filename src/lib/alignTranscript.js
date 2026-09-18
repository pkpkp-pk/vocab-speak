// Aligns SpeechRecognition segments to the recorded waveform so the
// transcript can show *where* you were loud/quiet and *where* you paused.
//
// The Web Speech API gives no word timestamps, so this is an estimation:
// Chrome tends to finalize a segment when you pause, so each segment is
// anchored to the voiced region whose END is closest to (arrival − lag).
// The anchor pointer only moves forward, so word order can never scramble.
// Within a region, words are spread proportional to their length.
//
// segments: [{ text, endedAt }] — seconds since session start
// samples:  [{ t, rmsDb }]     — from useAudioAnalysis
// returns:  { tokens, leftoverCount, leftoverSeconds } | null
//   tokens: [{ type: "word", text, db } | { type: "pause", dur }]
//   leftover*: short voiced regions no transcript words landed on — usually
//   spoken "um"/"uh" that Chrome dropped from the transcript.

import { voicedMask } from "./analyzeAudio.js";

const RECOGNITION_LAG_S = 0.7; // how far behind speech the API typically is
const MIN_REGION_S = 0.15; // ignore voiced blips shorter than this
const MIN_PAUSE_S = 0.3; // gaps shorter than this aren't worth a marker
const LEFTOVER_MAX_S = 0.8; // longer unassigned regions are missed phrases, not disfluencies

export function alignTranscript(segments, samples) {
  const usableSegments = (segments ?? []).filter((s) => s.text?.trim());
  if (!usableSegments.length || !samples?.length) return null;

  const mask = voicedMask(samples);

  // Contiguous voiced regions.
  const regions = [];
  let start = null;
  for (let i = 0; i < samples.length; i++) {
    if (mask[i] && start === null) start = samples[i].t;
    if (!mask[i] && start !== null) {
      regions.push({ start, end: samples[i].t });
      start = null;
    }
  }
  if (start !== null) regions.push({ start, end: samples[samples.length - 1].t });
  const usable = regions.filter((r) => r.end - r.start >= MIN_REGION_S);
  if (!usable.length) return null;

  const tokens = [];
  const assigned = new Set(); // region indices that received transcript words
  let ri = 0;
  let prevRi = -1;
  let regionCursor = usable[0].start;

  for (const seg of usableSegments) {
    const target = seg.endedAt - RECOGNITION_LAG_S;
    // Move the anchor forward while the next region's end is at least as
    // close to the target — monotonic, so segments keep their spoken order.
    while (
      ri < usable.length - 1 &&
      Math.abs(usable[ri + 1].end - target) <= Math.abs(usable[ri].end - target)
    ) {
      ri++;
    }
    assigned.add(ri);

    // A jump to a later region with real silence in between = a pause marker.
    if (prevRi !== -1 && ri > prevRi) {
      const gap = usable[ri].start - usable[prevRi].end;
      if (gap >= MIN_PAUSE_S) tokens.push({ type: "pause", dur: +gap.toFixed(1) });
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

  // Short voiced regions that no transcript words landed on. Chrome strips
  // disfluencies from finalized text, so a 0.15–0.8s region sitting between
  // word-carrying ones was very likely a spoken "um"/"uh" that never made it
  // into the transcript. (Ones glued to neighbouring words inside the same
  // region are invisible here — the interim diff covers those.) Longer
  // unassigned regions are treated as missed phrases, not fillers.
  let leftoverCount = 0;
  let leftoverSeconds = 0;
  usable.forEach((region, i) => {
    if (assigned.has(i)) return;
    const dur = region.end - region.start;
    if (dur <= LEFTOVER_MAX_S) {
      leftoverCount++;
      leftoverSeconds += dur;
    }
  });

  return { tokens, leftoverCount, leftoverSeconds: +leftoverSeconds.toFixed(1) };
}
