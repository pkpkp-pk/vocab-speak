import { Fragment } from "react";
import "./TranscriptHeatmap.css";

// Renders the transcript with per-word loudness highlighting and inline pause
// markers. tokens come from alignTranscript():
//   { type: "word", text, db } | { type: "pause", dur }
//
// Highlight intensity is normalized between the 5th and 95th percentile of
// word volumes, so one spike can't flatten everything else.

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export default function TranscriptHeatmap({ tokens }) {
  const dbs = tokens.filter((t) => t.type === "word" && t.db != null).map((t) => t.db);
  if (!dbs.length) return null;

  const sorted = [...dbs].sort((a, b) => a - b);
  const lo = percentile(sorted, 0.05);
  const hi = percentile(sorted, 0.95);
  const span = Math.max(hi - lo, 1e-6);

  const alphaFor = (db) =>
    db == null ? 0.05 : 0.06 + 0.34 * Math.min(Math.max((db - lo) / span, 0), 1);

  // The {i > 0 && " "} separator matters: adjacent elements from .map() get
  // NO whitespace between them, and without break opportunities the browser
  // treats the whole chip run as one unbreakable word — the line overflows
  // the card instead of wrapping. (Only the inline-block pause pills were
  // breakable, which is why wrapping appeared to half-work.) Real spaces also
  // make copy-pasting the transcript come out spaced correctly.
  return (
    <p className="th-words">
      {tokens.map((tok, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          {tok.type === "pause" ? (
            <span className="th-pause" title={`${tok.dur}s pause`}>
              ⏸ {tok.dur}s
            </span>
          ) : (
            <span
              className="th-word"
              style={{ backgroundColor: `rgba(242, 193, 78, ${alphaFor(tok.db).toFixed(2)})` }}
              title={tok.db != null ? `${Math.round(tok.db)} dB` : "no audio data"}
            >
              {tok.text}
            </span>
          )}
        </Fragment>
      ))}
    </p>
  );
}
