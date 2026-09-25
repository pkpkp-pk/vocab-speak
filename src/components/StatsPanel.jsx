import { formatDuration } from "../lib/analyzeSpeech.js";
import PronunciationPanel from "./PronunciationPanel.jsx";
import TranscriptHeatmap from "./TranscriptHeatmap.jsx";
import "./StatsPanel.css";

function StatBlock({ label, value, sub, delay }) {
  return (
    <div className="card stat-block" style={{ animationDelay: `${delay}s` }}>
      <p className="stat-value">{value}</p>
      <p className="label-xs stat-label">{label}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  );
}

// Tiny inline-SVG loudness curve with pause ticks — no chart lib needed.
function VolumeSpark({ spark, sparkPauses }) {
  const W = 300;
  const H = 56;
  const PAD = 4;
  const n = spark.length;
  const MIN_DB = -60;
  const x = (i) => PAD + (i / Math.max(n - 1, 1)) * (W - 2 * PAD);
  const y = (db) => H - PAD - (Math.max(db, MIN_DB) - MIN_DB) / -MIN_DB * (H - 2 * PAD);
  const points = spark.map((db, i) => `${x(i).toFixed(1)},${y(db).toFixed(1)}`).join(" ");

  return (
    <svg className="spark-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Volume over time">
      <polyline points={points} fill="none" className="spark-line" />
      {sparkPauses.map((p, i) => (
        <line
          key={i}
          x1={PAD + p * (W - 2 * PAD)}
          x2={PAD + p * (W - 2 * PAD)}
          y1={H - 8}
          y2={H - 2}
          className="spark-pause"
        />
      ))}
    </svg>
  );
}

export default function StatsPanel({ topic, result, stats, onRetry, onNewTopic, onWordSpans }) {
  const hasTranscript = result.transcript?.trim().length > 0;
  const a = stats.audio;
  // Short voiced regions in the waveform that no transcript words landed on.
  const leftoverCount = stats.annotated?.leftoverCount ?? 0;

  const blocks = [];
  if (hasTranscript) {
    blocks.push(
      { label: "Words spoken", value: stats.wordCount },
      { label: "Pace", value: `${stats.wpm} wpm`, sub: stats.pace },
      {
        label: "Filler words",
        value: stats.fillerTotal,
        sub: stats.fillerTotal ? `${stats.fillerRatio}% of speech` : "very clean!",
      },
      { label: "Keywords used", value: `${stats.keywordsUsed.length}/${stats.keywordsTotal}` }
    );
  }
  if (a) {
    blocks.push(
      {
        label: "Pauses",
        value: a.pauseCount,
        sub: a.pauseCount ? `longest ${a.longestPause}s · ${a.silencePct}% silence` : "smooth flow!",
      },
      { label: "Volume", value: a.volumeLabel, sub: `${a.meanDb} dB average` },
      a.pitch
        ? {
            label: "Pitch variety",
            value: a.pitch.label,
            sub: `${a.pitch.rangeSt} semitone range`,
          }
        : { label: "Pitch variety", value: "—", sub: "not enough voiced audio" }
    );
  }

  return (
    <div className="stats-panel">
      <div className="stats-head">
        <span className="stats-emoji">🎉</span>
        <h2 className="stats-title">Nice work!</h2>
        <p className="stats-sub">
          You spoke about <span className="stats-topic">{topic.title}</span> for{" "}
          {formatDuration(result.durationSeconds)}.
        </p>
      </div>

      {blocks.length > 0 ? (
        <div className="stats-grid">
          {blocks.map((b, i) => (
            <StatBlock key={b.label} {...b} delay={0.05 * (i + 1)} />
          ))}
        </div>
      ) : (
        <div className="card stats-empty">
          No transcript captured this time — that's fine, the timer still counted{" "}
          {formatDuration(result.durationSeconds)} of practice. Try enabling microphone access or use
          Chrome/Edge for live stats next time.
        </div>
      )}

      {a && (
        <div className="card card-dim audio-panel">
          <p className="label-xs filler-label">volume over time</p>
          <VolumeSpark spark={a.spark} sparkPauses={a.sparkPauses} />
          <p className="spark-legend">
            line = loudness · <span className="spark-legend-tick">ticks</span> = pauses
          </p>
          {a.tips.length > 0 && (
            <ul className="audio-tips">
              {a.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result.audioBlob && (
        <PronunciationPanel
          audioBlob={result.audioBlob}
          transcript={result.transcript}
          onWordSpans={onWordSpans}
        />
      )}

      {hasTranscript &&
        (stats.fillerTotal > 0 || stats.possibleFillerTotal > 0 || leftoverCount > 0) && (
        <div className="card card-dim filler-panel">
          <p className="label-xs filler-label">filler word breakdown</p>
          {stats.fillerTotal > 0 && (
            <div className="filler-chips">
              {Object.entries(stats.fillerCounts).map(([word, count]) => (
                <span key={word} className="chip">
                  "{word}" ×{count}
                </span>
              ))}
            </div>
          )}
          {stats.strippedFillerTotal > 0 && (
            <p className="filler-maybe">
              {stats.strippedFillerTotal} of these were caught live — Chrome's transcript
              silently drops "um"/"uh"
            </p>
          )}
          {leftoverCount > 0 && (
            <p className="filler-maybe">
              plus {leftoverCount} short untranscribed sound{leftoverCount === 1 ? "" : "s"} in
              the waveform — likely "um"/"uh" said next to a pause
            </p>
          )}
          {stats.possibleFillerTotal > 0 && (
            <p className="filler-maybe">
              also heard{" "}
              {Object.entries(stats.possibleFillerCounts)
                .map(([word, count]) => `"${word}" ×${count}`)
                .join(", ")}{" "}
              — these can be normal words, so they're not counted as fillers
            </p>
          )}
        </div>
      )}

      {hasTranscript && stats.vocab && (
        <div className="card card-dim vocab-panel">
          <p className="label-xs filler-label">vocabulary</p>
          <p className="vocab-line">
            {stats.vocab.uniqueCount} unique of {stats.vocab.wordCount} words ·{" "}
            {stats.vocab.diversityLabel} ({stats.vocab.matr ?? stats.vocab.ttr}
            {stats.vocab.matr == null ? ", estimate" : ""})
          </p>
          {stats.vocab.overused.length > 0 && (
            <>
              <div className="filler-chips">
                {stats.vocab.overused.map((o) => (
                  <span key={o.word} className="chip">
                    "{o.word}" ×{o.count}
                  </span>
                ))}
              </div>
              <p className="filler-maybe">
                you said "{stats.vocab.overused[0].word}" {stats.vocab.overused[0].count} times —
                try a synonym next round
              </p>
            </>
          )}
          {stats.vocab.plannerLabel && (
            <p className="filler-maybe">
              keyword timing: {stats.vocab.plannerLabel} (
              {stats.vocab.kwTiming.map((k) => `${k.keyword} ${Math.round(k.at * 100)}%`).join(", ")}
              through the session)
            </p>
          )}
        </div>
      )}

      {hasTranscript && stats.annotated ? (
        <div className="card card-dim stats-transcript">
          <p className="label-xs filler-label">transcript · volume per word</p>
          <TranscriptHeatmap tokens={stats.annotated.tokens} />
          <p className="th-legend">
            <span className="th-legend-swatch" /> stronger highlight = louder ·{" "}
            <span className="th-legend-pause">⏸</span> = pause · hover a word for its dB level
          </p>
        </div>
      ) : hasTranscript ? (
        <details className="card card-dim stats-transcript">
          <summary>view full transcript</summary>
          <p>{result.transcript}</p>
        </details>
      ) : null}

      <div className="stats-actions">
        <button onClick={onRetry} className="btn-ghost stats-retry">
          ⟲ Try this topic again
        </button>
        <button onClick={onNewTopic} className="btn-amber stats-next">
          Next topic →
        </button>
      </div>
    </div>
  );
}
