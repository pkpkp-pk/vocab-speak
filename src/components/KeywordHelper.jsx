import "./KeywordHelper.css";

const REVEAL_BATCH = 3;

export default function KeywordHelper({ keywords, revealedCount, onReveal }) {
  const visible = keywords.slice(0, revealedCount);
  const hasMore = revealedCount < keywords.length;

  return (
    <div className="keyword-helper">
      {visible.length === 0 ? (
        <button onClick={onReveal} className="keyword-reveal">
          <span className="keyword-reveal-icon">💡</span> Stuck? Get a few words
        </button>
      ) : (
        <div className="keyword-area">
          <div className="keyword-chips">
            {/* New chips mount and pop in; existing keys don't remount, so
                already-shown chips stay still (no AnimatePresence needed). */}
            {visible.map((word, i) => (
              <span
                key={word}
                className="keyword-chip"
                style={{ animationDelay: `${(i % REVEAL_BATCH) * 0.06}s` }}
              >
                {word}
              </span>
            ))}
          </div>
          {hasMore && (
            <button onClick={onReveal} className="keyword-more">
              show a few more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { REVEAL_BATCH };
