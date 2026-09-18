// Words that are essentially always fillers.
const FILLER_WORDS = [
  // Disfluencies — Chrome's recognizer usually strips these from final
  // transcripts (they're recovered from interims, see diffStrippedFillers),
  // but whenever one does survive in the text it's counted directly.
  "um", "uh", "umm", "uhh", "er", "err", "erm", "ah", "eh", "hmm", "mmm", "huh",
  // Discourse padding that survives transcription.
  "you know", "sort of", "kind of", "actually", "basically", "literally", "i mean", "so yeah",
];

// Common legitimate words too ("I like coding", "the right answer") — these
// are reported separately instead of inflating the filler count.
const AMBIGUOUS_FILLERS = ["like", "right"];

// The single-word disfluencies above — the tokens diffStrippedFillers looks
// for when an interim's wording vanishes at finalization.
const STRIPPED_FILLERS = FILLER_WORDS.filter((w) => !w.includes(" "));

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word count of `term` in already-lowercased text.
function countWord(clean, term) {
  const matches = clean.match(new RegExp(`\\b${escapeRegExp(term)}\\b`, "g"));
  return matches?.length ?? 0;
}

function countAll(clean, words) {
  const counts = {};
  let total = 0;
  words.forEach((word) => {
    const n = countWord(clean, word);
    if (n) {
      counts[word] = n;
      total += n;
    }
  });
  return { counts, total };
}

// Words of `text` normalized for comparison: lowercased, punctuation stripped.
function tokensOf(text) {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// Disfluency counts for words that were present in an interim snapshot but
// vanished from the finalized result — exactly the "um"/"uh" Chrome's
// server-side cleanup removed. Only the latest snapshot per result is diffed
// (earlier interim revisions can wobble a word in and out, which would
// overcount), and only known disfluencies count, so ordinary recognition
// revisions ("their" → "there") never inflate the number.
export function diffStrippedFillers(interimText, finalText) {
  const interimCounts = new Map();
  for (const w of tokensOf(interimText)) {
    if (STRIPPED_FILLERS.includes(w)) interimCounts.set(w, (interimCounts.get(w) ?? 0) + 1);
  }
  if (!interimCounts.size) return {};
  const finalCounts = new Map();
  for (const w of tokensOf(finalText)) {
    if (interimCounts.has(w)) finalCounts.set(w, (finalCounts.get(w) ?? 0) + 1);
  }
  const stripped = {};
  for (const [word, n] of interimCounts) {
    const gone = n - (finalCounts.get(word) ?? 0);
    if (gone > 0) stripped[word] = gone;
  }
  return stripped;
}

export function analyzeSpeech(transcript, { durationSeconds, keywords = [], strippedFillers = {} }) {
  const clean = transcript.trim().toLowerCase();
  const words = clean.length ? clean.split(/\s+/) : [];
  const wordCount = words.length;
  const minutes = Math.max(durationSeconds / 60, 1 / 60);
  const wpm = Math.round(wordCount / minutes);

  let { counts: fillerCounts, total: fillerTotal } = countAll(clean, FILLER_WORDS);
  // Merge disfluencies recovered from interims (useSpeechRecognition) —
  // Chrome's final transcripts never contain them, so countAll can't see them.
  let strippedFillerTotal = 0;
  for (const [word, n] of Object.entries(strippedFillers)) {
    if (!n) continue;
    fillerCounts[word] = (fillerCounts[word] ?? 0) + n;
    fillerTotal += n;
    strippedFillerTotal += n;
  }
  const { counts: possibleFillerCounts, total: possibleFillerTotal } = countAll(clean, AMBIGUOUS_FILLERS);

  // Whole-word matching — a keyword like "risk" must not match "brisk",
  // and "apps" must not match "perhaps".
  const keywordsUsed = keywords.filter((kw) =>
    new RegExp(`\\b${escapeRegExp(kw.toLowerCase())}\\b`).test(clean)
  );

  let pace = "steady";
  if (wpm > 0) {
    if (wpm < 90) pace = "slow & deliberate";
    else if (wpm > 160) pace = "quite fast";
    else pace = "natural conversational pace";
  }

  return {
    wordCount,
    wpm,
    durationSeconds,
    fillerTotal,
    fillerCounts,
    strippedFillerTotal,
    possibleFillerTotal,
    possibleFillerCounts,
    fillerRatio: wordCount ? +((fillerTotal / wordCount) * 100).toFixed(1) : 0,
    keywordsUsed,
    keywordsTotal: keywords.length,
    pace,
  };
}

export function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
