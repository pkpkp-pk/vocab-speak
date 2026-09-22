// Plans inference chunks for the on-device ASR worker: groups of voiced
// regions bounded by silence, so no chunk ever cuts mid-word. Pure — the
// worker just receives the plan alongside the PCM.

import { voicedRegions } from "./analyzeAudio.js";

const MAX_CHUNK_S = 25; // keep each inference window comfortably small
const PAD_S = 0.2; // a little silence around each chunk helps the model

// samples: the session's 60 Hz {t, rmsDb} series (floorDb = measured mic
// floor when available). Returns [{ start, end }] in seconds.
export function planChunks(samples, { floorDb = null } = {}) {
  if (!samples?.length) return [];
  const regions = voicedRegions(samples, floorDb);
  if (!regions.length) return [];
  const audioEnd = samples[samples.length - 1].t;

  const chunks = [];
  let cur = null;
  const push = () => {
    if (cur) chunks.push(cur);
    cur = null;
  };

  for (const region of regions) {
    // A single nonstop region longer than MAX_CHUNK_S gets hard-split.
    const pieces = [];
    if (region.end - region.start > MAX_CHUNK_S) {
      for (let s = region.start; s < region.end; s += MAX_CHUNK_S) {
        pieces.push({ start: s, end: Math.min(s + MAX_CHUNK_S, region.end) });
      }
    } else {
      pieces.push(region);
    }

    for (const piece of pieces) {
      if (cur && piece.end - cur.start > MAX_CHUNK_S) push();
      if (!cur) cur = { start: piece.start, end: piece.end };
      else cur.end = piece.end;
    }
  }
  push();

  return chunks.map((c) => ({
    start: Math.max(0, +(c.start - PAD_S).toFixed(2)),
    end: Math.min(audioEnd, +(c.end + PAD_S).toFixed(2)),
  }));
}
