# Speak Stage — Vocabulary & Spontaneous Speaking Trainer

A React + Vite app for practicing spontaneous
English speaking. Styled with plain per-component CSS (design tokens live as
CSS custom properties in `src/index.css`); all animations are CSS
transitions/keyframes — no UI libraries. Pick a topic, talk for 2–4 minutes,
tap a hint button if you stall, and get pace/filler-word stats when you're done.

## Run it locally

```bash
npm install
npm run dev
```

Open the printed local URL (usually `http://localhost:5173`). For the mic
transcription feature, use Chrome or Edge and allow microphone access when
prompted — Safari/Firefox have limited or no support for the underlying
`SpeechRecognition` API, but the timer and keyword-hint features still work
everywhere.

Build for production with `npm run build`; preview that build with
`npm run preview`.

## How it works

- **Topic selection** — filter by category and difficulty, then shuffle
  until a topic feels right. Topics live in `src/data/topics.js` — add as
  many as you like, each with a title, a one-line prompt, and a list of
  rescue keywords.
- **Speaking session** — a stage-clock ring counts up toward the target
  time for the chosen difficulty (2/3/4 min). If you stall, tap
  "Stuck? Get a few words" to reveal keywords a few at a time — not the
  whole list at once, so it stays a nudge rather than a script.
- **Live transcription** — uses the browser's built-in `SpeechRecognition`
  API, entirely client-side, no server or API key needed for this part.
- **Stats** — word count, words-per-minute, filler-word count/breakdown
  (um, uh, like, you know, etc.), and how many hint keywords you actually
  used, computed in `src/lib/analyzeSpeech.js`.
- **AI bonus mode** (optional) — toggle "AI mode" in the header and paste
  your own Anthropic API key (gear icon) to generate fresh topics and
  keyword sets on demand instead of pulling from the local list. The key
  is stored only in `localStorage` and sent only to `api.anthropic.com`.
  Leave this off and the app works fully offline.

## Project structure

```
src/
  data/topics.js          curated offline topic bank
  hooks/useSpeechRecognition.js   mic transcription wrapper
  hooks/useLocalStorage.js        tiny persistence helper
  lib/analyzeSpeech.js     WPM / filler-word / keyword-usage stats
  lib/aiTopics.js          optional AI topic generation
  components/              Header, CategoryPicker, TopicCard, TimerRing,
                            KeywordHelper, SessionScreen, StatsPanel,
                            AISettingsModal
  App.jsx                  select -> session -> results state machine
```

## Ideas for extending it

- A fuller progress dashboard (streaks are already tracked in
  `localStorage` — `speakstage.streak` — just needs a view).
- Save past transcripts to review growth over time.
- Difficulty auto-adjustment based on recent WPM/filler stats.
- A "duel" mode: two topics, pick one on the spot, no shuffling allowed.
- Export session stats as a shareable image/card.
