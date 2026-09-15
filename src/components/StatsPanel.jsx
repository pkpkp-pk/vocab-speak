import { formatDuration } from "../lib/analyzeSpeech.js";
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

export default function StatsPanel({ topic, result, stats, onRetry, onNewTopic }) {
  const hasTranscript = result.transcript?.trim().length > 0;

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

      {hasTranscript ? (
        <div className="stats-grid">
          <StatBlock label="Words spoken" value={stats.wordCount} delay={0.05} />
          <StatBlock label="Pace" value={`${stats.wpm} wpm`} sub={stats.pace} delay={0.1} />
          <StatBlock
            label="Filler words"
            value={stats.fillerTotal}
            sub={stats.fillerTotal ? `${stats.fillerRatio}% of speech` : "very clean!"}
            delay={0.15}
          />
          <StatBlock
            label="Keywords used"
            value={`${stats.keywordsUsed.length}/${stats.keywordsTotal}`}
            delay={0.2}
          />
        </div>
      ) : (
        <div className="card stats-empty">
          No transcript captured this time — that's fine, the timer still counted{" "}
          {formatDuration(result.durationSeconds)} of practice. Try enabling microphone access or use
          Chrome/Edge for live stats next time.
        </div>
      )}

      {hasTranscript && (stats.fillerTotal > 0 || stats.possibleFillerTotal > 0) && (
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

      {hasTranscript && (
        <details className="card card-dim stats-transcript">
          <summary>view full transcript</summary>
          <p>{result.transcript}</p>
        </details>
      )}

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
