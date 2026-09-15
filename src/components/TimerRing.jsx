import { formatDuration } from "../lib/analyzeSpeech.js";
import "./TimerRing.css";

export default function TimerRing({ elapsedSeconds, targetSeconds, listening }) {
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(elapsedSeconds / targetSeconds, 1);
  const pastTarget = elapsedSeconds >= targetSeconds;
  const offset = circumference * (1 - progress);

  return (
    <div className="timer-ring">
      <svg width="200" height="200" viewBox="0 0 200 200" className="timer-svg">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="rgba(245,241,232,0.08)" strokeWidth="10" />
        <circle
          className="timer-ring-progress"
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke={pastTarget ? "#F2C14E" : "#FF5D73"}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: offset }}
        />
      </svg>
      <div className="timer-center">
        <div className={`timer-dot ${listening ? "is-listening" : ""}`} />
        <span className="timer-time">{formatDuration(elapsedSeconds)}</span>
        <span className="timer-goal">
          {pastTarget ? "goal reached" : `of ${formatDuration(targetSeconds)} goal`}
        </span>
      </div>
    </div>
  );
}
