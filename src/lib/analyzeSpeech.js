// Words that are essentially always fillers.
const FILLER_WORDS = [
  "um", "uh", "umm", "uhh", "you know", "sort of", "kind of",
  "actually", "basically", "literally", "i mean", "so yeah",
];

// Common legitimate words too ("I like coding", "the right answer") — these
// are reported separately instead of inflating the filler count.
const AMBIGUOUS_FILLERS = ["like", "right"];

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

export function analyzeSpeech(transcript, { durationSeconds, keywords = [] }) {
  const clean = transcript.trim().toLowerCase();
  const words = clean.length ? clean.split(/\s+/) : [];
  const wordCount = words.length;
  const minutes = Math.max(durationSeconds / 60, 1 / 60);
  const wpm = Math.round(wordCount / minutes);

  const { counts: fillerCounts, total: fillerTotal } = countAll(clean, FILLER_WORDS);
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
