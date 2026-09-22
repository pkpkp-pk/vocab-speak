// Word-choice analysis over the session transcript: vocabulary diversity,
// content-word overuse, and keyword timing. Pure — no audio, no models.
//
// The app is called Vocab Speak; this is the vocabulary feedback.

import { tokensOf, FILLER_WORDS } from "./analyzeSpeech.js";

// Common English stopwords — excluded from overuse detection.
const STOPWORDS = new Set(
  (
    "a,an,the,and,or,but,if,then,else,when,while,of,at,by,for,with,about,against,between," +
    "into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under," +
    "again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor," +
    "not,only,own,same,so,than,too,very,can,will,just,should,now,i,me,my,we,our,you,your," +
    "he,him,his,she,her,it,its,they,them,their,this,that,these,those,am,is,are,was,were," +
    "be,been,being,have,has,had,having,do,does,did,doing,would,could,shall,may,might,must," +
    "what,which,who,whom,how,as,us,get,got,go,going,went,know,think,say,said,make,made,thing,things"
  ).split(",")
);

const MATR_WINDOW = 30; // moving average type/token ratio window

export function analyzeVocabulary(transcript, { segments = [], keywords = [], durationSeconds = 0 } = {}) {
  const tokens = tokensOf(transcript);
  const wordCount = tokens.length;
  if (!wordCount) return null;

  // Diversity: plain type/token ratio, plus MATR (mean TTR of sliding
  // 30-word windows) — plain TTR shrinks as text grows, MATR doesn't.
  const uniqueCount = new Set(tokens).size;
  const ttr = uniqueCount / wordCount;
  let matr = null;
  if (wordCount >= MATR_WINDOW) {
    let sum = 0;
    let windows = 0;
    for (let i = 0; i + MATR_WINDOW <= wordCount; i++) {
      sum += new Set(tokens.slice(i, i + MATR_WINDOW)).size / MATR_WINDOW;
      windows++;
    }
    matr = sum / windows;
  }
  // Bands hedged on purpose — MATR is an estimate on short sessions.
  const diversity = matr ?? ttr;
  const diversityLabel =
    diversity < 0.65 ? "repetitive" : diversity <= 0.78 ? "steady range" : "wide vocabulary";

  // Content-word overuse: stopwords, fillers, and the topic's own keywords
  // excluded (using a prompted keyword is the exercise, not overuse).
  const excluded = new Set([...STOPWORDS, ...FILLER_WORDS, ...keywords.map((k) => k.toLowerCase())]);
  const freq = new Map();
  for (const tok of tokens) {
    if (excluded.has(tok) || tok.length < 3) continue;
    freq.set(tok, (freq.get(tok) ?? 0) + 1);
  }
  const threshold = Math.max(3, wordCount / 80);
  const overused = [...freq.entries()]
    .filter(([, n]) => n >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word, count]) => ({ word, count }));

  // Keyword timing: when each keyword was first used, as a fraction of the
  // session → early planner / spread out / late scrambler.
  const kwTiming = [];
  if (durationSeconds > 0) {
    for (const kw of keywords) {
      const re = new RegExp(`\\b${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const hit = segments.find((s) => re.test(s.text ?? ""));
      if (hit && hit.endedAt != null) {
        kwTiming.push({ keyword: kw, at: +Math.min(hit.endedAt / durationSeconds, 1).toFixed(2) });
      }
    }
  }
  let plannerLabel = null;
  if (kwTiming.length >= 2) {
    const mean = kwTiming.reduce((a, k) => a + k.at, 0) / kwTiming.length;
    plannerLabel = mean < 0.33 ? "early planner" : mean > 0.66 ? "late scrambler" : "spread out";
  }

  return {
    wordCount,
    uniqueCount,
    ttr: +ttr.toFixed(2),
    matr: matr != null ? +matr.toFixed(2) : null,
    diversityLabel,
    overused,
    kwTiming,
    plannerLabel,
  };
}
