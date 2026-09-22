import "./Header.css";

export default function Header({ aiMode, onToggleAI, onOpenSettings, onOpenCustomTopics, streak }) {
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

        <button onClick={onToggleAI} className={`ai-toggle ${aiMode ? "on" : "off"}`}>
          {aiMode ? "AI mode: on" : "AI mode: off"}
        </button>

        <button onClick={onOpenCustomTopics} aria-label="Add your own topics" className="icon-btn">
          +
        </button>

        <button onClick={onOpenSettings} aria-label="AI settings" className="icon-btn">
          ⚙
        </button>
      </div>
    </header>
  );
}
