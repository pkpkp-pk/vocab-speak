import { useEffect, useRef, useState } from "react";
import { CATEGORIES, DIFFICULTIES } from "../data/topics.js";
import "./TopicCard.css";

function metaFor(t) {
  const categoryLabel = CATEGORIES.find((c) => c.id === t?.category)?.label ?? "Mixed";
  const difficultyMeta = DIFFICULTIES.find((d) => d.id === t?.difficulty);
  return { categoryLabel, difficultyMeta };
}

export default function TopicCard({ topic, spinning, spinDisplay, justLanded, onShuffle, onStart }) {
  const displayTopic = spinning ? spinDisplay : topic;
  const { categoryLabel, difficultyMeta } = metaFor(displayTopic);

  // Slot-machine handoff (replaces framer-motion's <AnimatePresence mode="popLayout">):
  // keep the previous title mounted for one 140ms tick so it can slide down
  // and out while the new title slides in from above.
  const [leavingTopic, setLeavingTopic] = useState(null);
  const prevRef = useRef(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = spinDisplay;
    if (prev && spinDisplay && prev.id !== spinDisplay.id) {
      setLeavingTopic(prev);
      const t = setTimeout(() => setLeavingTopic(null), 140); // match .reel-leave duration
      return () => clearTimeout(t);
    }
  }, [spinDisplay]);

  const leavingMeta = leavingTopic ? metaFor(leavingTopic) : null;

  return (
    <div className="topic-card-wrap">
      <div aria-hidden className="topic-glow" />

      {/* reel pointer notch, slot-machine style */}
      <div className="reel-notch">
        <div className={`reel-notch-diamond ${spinning ? "spinning" : ""}`} />
      </div>

      <div className={`topic-card ${justLanded ? "landed" : ""}`}>
        {spinning ? (
          <div className="spin-reel">
            <div className="reel-window">
              <div className="reel-fade reel-fade-top" />
              <div className="reel-fade reel-fade-bottom" />
              {leavingTopic && (
                <div className="reel-item reel-leave">
                  <span className="reel-cat">{leavingMeta.categoryLabel}</span>
                  <span className="reel-title">{leavingTopic.title}</span>
                </div>
              )}
              <div className="reel-item reel-enter" key={spinDisplay?.id ?? "spin"}>
                <span className="reel-cat">{categoryLabel}</span>
                <span className="reel-title">{displayTopic?.title}</span>
              </div>
            </div>
            <div className="spin-dots">
              <span className="spin-dot" />
              <span className="spin-dot" />
              <span className="spin-dot" />
            </div>
          </div>
        ) : (
          <div className="topic-detail" key={topic?.id}>
            <div>
              <div className="topic-tags">
                <span className="chip">{categoryLabel}</span>
                <span className="chip">
                  {difficultyMeta?.label ?? "Intermediate"} · speak {difficultyMeta?.minutes ?? 3} min
                </span>
                {topic?.isAI && <span className="chip chip-ai">AI generated</span>}
                {topic?.isCustom && <span className="chip chip-custom">your topic</span>}
              </div>
              <h2 className="topic-title">{topic?.title}</h2>
              <p className="topic-prompt">{topic?.prompt}</p>
            </div>

            <div className="topic-actions">
              <button onClick={onShuffle} className="btn-ghost">
                🎰 Spin again
              </button>
              <button onClick={onStart} className="btn-primary topic-start">
                Start speaking →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
