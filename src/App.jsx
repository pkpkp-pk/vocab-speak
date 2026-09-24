import { useEffect, useMemo, useRef, useState } from "react";
import Header from "./components/Header.jsx";
import CategoryPicker from "./components/CategoryPicker.jsx";
import TopicCard from "./components/TopicCard.jsx";
import SessionScreen from "./components/SessionScreen.jsx";
import StatsPanel from "./components/StatsPanel.jsx";
import AISettingsModal from "./components/AISettingsModal.jsx";
import CustomTopicModal from "./components/CustomTopicModal.jsx";
import { useLocalStorage } from "./hooks/useLocalStorage.js";
import { getRandomTopic, TOPICS, DIFFICULTIES } from "./data/topics.js";
import { generateAITopic } from "./lib/aiTopics.js";
import { analyzeSpeech } from "./lib/analyzeSpeech.js";
import { analyzeVocabulary } from "./lib/analyzeVocabulary.js";
import { analyzeAudio } from "./lib/analyzeAudio.js";
import { alignTranscript } from "./lib/alignTranscript.js";
import "./App.css";

// Local-calendar date as YYYY-MM-DD. (The old version used toISOString(),
// which is UTC — the "day" flipped at UTC midnight instead of local midnight,
// and yesterday was computed as now-minus-86400000ms, which lands on the
// wrong date across DST changes.)
function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1); // calendar-day subtraction, DST-safe
  return dateKey(d);
}

// Slot-machine timing: fast constant spin while we have no result yet,
// then a short decelerating run that lands exactly on the final topic.
const FAST_TICK_MS = 70;
const LAND_TICKS = 8;

// Must match the .stage-fade transition duration in App.css.
const STAGE_FADE_MS = 250;

export default function App() {
  const [stage, setStage] = useState("select"); // select | session | results
  const [category, setCategory] = useState("all");
  const [difficulty, setDifficulty] = useState("all");
  const [topic, setTopic] = useState(() => getRandomTopic(TOPICS, {}));
  const [sessionResult, setSessionResult] = useState(null);

  const [aiMode, setAiMode] = useLocalStorage("speakstage.aiMode", false, (v) => typeof v === "boolean");
  const [apiKey, setApiKey] = useLocalStorage("speakstage.apiKey", "", (v) => typeof v === "string");
  const [customTopics, setCustomTopics] = useLocalStorage("speakstage.customTopics", [], Array.isArray);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [lastPracticeDate, setLastPracticeDate] = useLocalStorage(
    "speakstage.lastDate",
    null,
    (v) => v === null || typeof v === "string"
  );
  const [streak, setStreak] = useLocalStorage("speakstage.streak", 0, (v) => typeof v === "number" && v >= 0);

  const [loadingAI, setLoadingAI] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [spinDisplay, setSpinDisplay] = useState(topic);
  const [justLanded, setJustLanded] = useState(false);

  const spinTimeoutRef = useRef(null);
  const spinRunIdRef = useRef(0);

  useEffect(() => () => clearTimeout(spinTimeoutRef.current), []);

  // Delayed stage swap (replaces framer-motion's <AnimatePresence mode="wait">):
  // fade the old stage out, swap content after the fade, new stage fades in.
  const [renderedStage, setRenderedStage] = useState(stage);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (stage === renderedStage) return;
    setLeaving(true);
    const t = setTimeout(() => {
      setRenderedStage(stage);
      setLeaving(false);
    }, STAGE_FADE_MS);
    return () => clearTimeout(t);
  }, [stage, renderedStage]);

  const combinedPool = useMemo(() => [...TOPICS, ...customTopics], [customTopics]);
  const targetSeconds = (DIFFICULTIES.find((d) => d.id === topic?.difficulty)?.minutes ?? 3) * 60;

  const pickTopic = async (opts = {}) => {
    const nextCategory = opts.category ?? category;
    const nextDifficulty = opts.difficulty ?? difficulty;
    const pool = combinedPool;
    const runId = ++spinRunIdRef.current;

    setAiError(null);
    setSpinning(true);
    setJustLanded(false);

    // Phase 1: fast continuous spin while we resolve the final topic.
    let stillFast = true;
    const fastTick = () => {
      if (!stillFast || spinRunIdRef.current !== runId) return;
      setSpinDisplay(pool[Math.floor(Math.random() * pool.length)]);
      spinTimeoutRef.current = setTimeout(fastTick, FAST_TICK_MS);
    };
    fastTick();

    let finalTopic;
    if (aiMode && apiKey) {
      setLoadingAI(true);
      try {
        finalTopic = await generateAITopic({ apiKey, category: nextCategory, difficulty: nextDifficulty });
      } catch (err) {
        setAiError(err.message);
        finalTopic = getRandomTopic(pool, { category: nextCategory, difficulty: nextDifficulty, excludeId: topic?.id });
      } finally {
        setLoadingAI(false);
      }
    } else {
      finalTopic = getRandomTopic(pool, { category: nextCategory, difficulty: nextDifficulty, excludeId: topic?.id });
    }

    if (spinRunIdRef.current !== runId) return; // a newer spin superseded this one

    stillFast = false;
    clearTimeout(spinTimeoutRef.current);

    // Phase 2: decelerating landing sequence ending exactly on finalTopic.
    await new Promise((resolve) => {
      let tick = 0;
      const step = () => {
        if (spinRunIdRef.current !== runId) return resolve();
        if (tick < LAND_TICKS - 1) {
          setSpinDisplay(pool[Math.floor(Math.random() * pool.length)]);
          tick += 1;
          const progress = tick / LAND_TICKS;
          const delay = 60 + progress * progress * 240;
          spinTimeoutRef.current = setTimeout(step, delay);
        } else {
          setSpinDisplay(finalTopic);
          spinTimeoutRef.current = setTimeout(resolve, 340);
        }
      };
      step();
    });

    if (spinRunIdRef.current !== runId) return;

    setTopic(finalTopic);
    setSpinning(false);
    setJustLanded(true);
    setTimeout(() => setJustLanded(false), 700);
  };

  const handleCategory = (id) => {
    setCategory(id);
    pickTopic({ category: id });
  };

  const handleDifficulty = (id) => {
    setDifficulty(id);
    pickTopic({ difficulty: id });
  };

  const addCustomTopic = (t) => setCustomTopics((prev) => [...prev, t]);
  const deleteCustomTopic = (id) => setCustomTopics((prev) => prev.filter((t) => t.id !== id));

  const finishSession = (result) => {
    const stats = analyzeSpeech(result.transcript, {
      durationSeconds: result.durationSeconds,
      keywords: topic.keywords,
      // "um"/"uh" recovered from interim diffs — Chrome drops them from finals.
      strippedFillers: result.strippedFillers,
    });
    // Waveform metrics (pauses/volume/pitch) — null when the mic was denied
    // or too little speech was captured. result.micFloorDb is the measured
    // noise floor when the mic check ran, null otherwise (adaptive fallback).
    stats.audio = analyzeAudio(result.audioSamples, result.micFloorDb);
    // Word-choice stats: diversity, overuse, keyword timing — null on empty
    // transcript.
    stats.vocab = analyzeVocabulary(result.transcript, {
      segments: result.speechSegments,
      keywords: topic.keywords,
      durationSeconds: result.durationSeconds,
    });
    // Transcript words aligned onto the waveform (per-word volume, pause
    // markers, untranscribed-sound count) — null when either side is missing.
    stats.annotated = alignTranscript(result.speechSegments, result.audioSamples, result.micFloorDb);
    setSessionResult({ result, stats });

    const today = dateKey();
    if (lastPracticeDate !== today) {
      setStreak(lastPracticeDate === yesterdayKey() ? streak + 1 : 1);
      setLastPracticeDate(today);
    }

    setStage("results");
  };

  return (
    <div className="app-shell">
      <Header
        aiMode={aiMode}
        onToggleAI={() => {
          if (!aiMode && !apiKey) setSettingsOpen(true);
          setAiMode(!aiMode);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCustomTopics={() => setCustomModalOpen(true)}
        streak={streak}
      />

      <div className={`stage-fade ${leaving ? "is-leaving" : "is-entering"}`}>
        {renderedStage === "select" && (
          <main className="select-stage">
            <div className="select-head">
              <h1 className="select-title">Pick a topic. Speak your mind.</h1>
              <p className="select-sub">
                No scripts, no prep — just talk, and reach for a hint word if you stall.
              </p>
            </div>

            <CategoryPicker
              category={category}
              difficulty={difficulty}
              onCategory={handleCategory}
              onDifficulty={handleDifficulty}
            />

            {aiError && (
              <p className="ai-error">{aiError} — landed on a local topic instead.</p>
            )}

            <TopicCard
              topic={topic}
              spinning={spinning}
              spinDisplay={spinDisplay}
              justLanded={justLanded}
              onShuffle={() => pickTopic()}
              onStart={() => setStage("session")}
            />

            <p className="custom-hint">
              Don't see enough variety?{" "}
              <button onClick={() => setCustomModalOpen(true)} className="custom-hint-btn">
                add your own topics
              </button>{" "}
              — they work offline too.
            </p>
          </main>
        )}

        {renderedStage === "session" && (
          <SessionScreen
            topic={topic}
            targetSeconds={targetSeconds}
            onFinish={finishSession}
            onExit={() => setStage("select")}
          />
        )}

        {renderedStage === "results" && sessionResult && (
          <StatsPanel
            topic={topic}
            result={sessionResult.result}
            stats={sessionResult.stats}
            onRetry={() => setStage("session")}
            onNewTopic={() => {
              pickTopic();
              setStage("select");
            }}
          />
        )}
      </div>

      <AISettingsModal
        open={settingsOpen}
        apiKey={apiKey}
        onClose={() => setSettingsOpen(false)}
        onSave={({ apiKey: newKey }) => {
          setApiKey(newKey);
          if (!newKey) setAiMode(false);
          setSettingsOpen(false);
        }}
      />

      <CustomTopicModal
        open={customModalOpen}
        onClose={() => setCustomModalOpen(false)}
        customTopics={customTopics}
        onAdd={addCustomTopic}
        onDelete={deleteCustomTopic}
      />

      <footer className="app-footer">
        Built for daily fluency practice — waveform analysis stays in your browser;
        live transcription and AI features send audio/text to their respective APIs.
      </footer>
    </div>
  );
}
