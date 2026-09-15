// CTC forced alignment + greedy decoding over wav2vec2 character logits.
// Pure functions (no DOM, no transformers.js) so they can be unit-tested in
// node with synthetic log-probs.
//
// wav2vec2-base-960h vocab: id 0 = "<pad>" (the CTC blank), id 4 = "|"
// (word separator), ids 5-31 = uppercase E T A O N I H S R D L U M W C F G Y
// P B V K ' X J Q Z.

export const BLANK_ID = 0;
export const WORD_DELIM_ID = 4;

// The model only knows A-Z + apostrophe. Everything else (digits, punctuation)
// collapses to a word boundary, which also keeps the alignment honest.
export function normalizeForCtc(text) {
  return String(text)
    .toUpperCase()
    .replace(/[^A-Z'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Map normalized text to token ids, tracking which id ranges belong to which
// word. Returns { ids, words: [{ word, from, to }] } — [from, to) index ids.
export function textToTargets(text, vocab) {
  const clean = normalizeForCtc(text);
  const ids = [];
  const words = [];
  if (!clean) return { ids, words };

  const wordsRaw = clean.split(" ");
  wordsRaw.forEach((word, wi) => {
    if (wi > 0) ids.push(vocab["|"]);
    const from = ids.length;
    for (const ch of word) {
      const id = vocab[ch];
      if (id !== undefined) ids.push(id);
    }
    if (ids.length > from) words.push({ word: word.toLowerCase(), from, to: ids.length });
  });
  return { ids, words };
}

// Per-frame log-softmax in place over a [T x V] logits buffer.
export function logitsToLogProbs(logits, T, V) {
  const out = logits instanceof Float32Array ? logits : new Float32Array(logits);
  for (let t = 0; t < T; t++) {
    const off = t * V;
    let max = -Infinity;
    for (let v = 0; v < V; v++) if (out[off + v] > max) max = out[off + v];
    let sumExp = 0;
    for (let v = 0; v < V; v++) sumExp += Math.exp(out[off + v] - max);
    const lse = max + Math.log(sumExp);
    for (let v = 0; v < V; v++) out[off + v] -= lse;
  }
  return out;
}

// Viterbi forced alignment of targetIds against log-probs (T frames x V vocab).
// Standard CTC trellis over the blank-extended target sequence. Returns a
// per-target-character posterior score array (aligned 1:1 with targetIds),
// or null when the target cannot fit the audio (T < extended length).
export function forcedAlign(logProbs, T, V, targetIds) {
  const S = targetIds.length;
  if (S === 0) return null;

  // Extended sequence: blank, t0, blank, t1, ..., blank
  const E = 2 * S + 1;
  if (T < E) return null;
  const ext = new Int32Array(E);
  for (let i = 0; i < S; i++) ext[2 * i + 1] = targetIds[i];

  const NEG = -1e30;
  const back = new Uint8Array(T * E); // 0 = stay, 1 = from s-1, 2 = from s-2
  let prev = new Float64Array(E).fill(NEG);
  prev[0] = logProbs[BLANK_ID];
  prev[1] = logProbs[ext[1]];

  for (let t = 1; t < T; t++) {
    const cur = new Float64Array(E).fill(NEG);
    const rowOff = t * V;
    const backOff = t * E;
    for (let s = 0; s < E; s++) {
      const lp = logProbs[rowOff + ext[s]];
      let best = prev[s];
      let move = 0;
      if (s >= 1 && prev[s - 1] > best) {
        best = prev[s - 1];
        move = 1;
      }
      // Skip a blank only when the token differs (CTC repeat rule).
      if (s >= 2 && ext[s] !== BLANK_ID && ext[s] !== ext[s - 2] && prev[s - 2] > best) {
        best = prev[s - 2];
        move = 2;
      }
      cur[s] = best + lp;
      back[backOff + s] = move;
    }
    prev = cur;
  }

  let sEnd = E - 1;
  if (prev[E - 2] > prev[E - 1]) sEnd = E - 2;

  // Backtrace to a per-frame state assignment.
  const states = new Int32Array(T);
  let s = sEnd;
  for (let t = T - 1; t >= 0; t--) {
    states[t] = s;
    s -= back[t * E + s];
  }

  // Per-character score: geometric mean of the token's posterior over the
  // frames it was aligned to (equivalently exp of mean log-prob).
  const charScores = new Float64Array(S);
  for (let i = 0; i < S; i++) {
    const stateIdx = 2 * i + 1;
    const tok = targetIds[i];
    let sumLp = 0;
    let count = 0;
    for (let t = 0; t < T; t++) {
      if (states[t] === stateIdx) {
        sumLp += logProbs[t * V + tok];
        count++;
      }
    }
    charScores[i] = count ? Math.exp(sumLp / count) : 0;
  }
  return charScores;
}

// Fold per-character scores into per-word scores (geometric mean of chars).
export function scoreWords(charScores, words) {
  return words.map(({ word, from, to }) => {
    let sumLog = 0;
    for (let i = from; i < to; i++) sumLog += Math.log(Math.max(charScores[i], 1e-6));
    return { word, score: +Math.exp(sumLog / (to - from)).toFixed(3) };
  });
}

// Greedy CTC decode (argmax + collapse repeats + drop blanks). Used as the
// reference text when the browser produced no SpeechRecognition transcript.
export function greedyDecode(logProbs, T, V, idToChar) {
  let out = "";
  let prevId = -1;
  for (let t = 0; t < T; t++) {
    const off = t * V;
    let best = BLANK_ID;
    let bestVal = -Infinity;
    for (let v = 0; v < V; v++) {
      if (logProbs[off + v] > bestVal) {
        bestVal = logProbs[off + v];
        best = v;
      }
    }
    if (best !== BLANK_ID && best !== prevId) out += idToChar[best] ?? "";
    prevId = best;
  }
  return out.replace(/\|/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
