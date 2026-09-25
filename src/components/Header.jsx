import "./Header.css";

export default function Header({ onOpenCustomTopics, streak }) {
  return (
    <header className="site-header">
      <div className="logo">
        <div className="logo-mark">V</div>
        <div className="logo-text">
          <p className="logo-name">Vocab Speak</p>
          <p className="logo-sub">spontaneous speaking practice</p>
        </div>
      </div>

      <div className="header-actions">
        {streak > 0 && (
          <div className="streak-badge">🔥 {streak} day streak</div>
        )}

        <button onClick={onOpenCustomTopics} aria-label="Add your own topics" className="icon-btn">
          +
        </button>
      </div>
    </header>
  );
}
