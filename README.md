# Vocab Speak — Vocabulary & Spontaneous Speaking Trainer

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

## Self-hosted model files

`npm run dev` and `npm run build` first run `scripts/fetch-model.mjs`, which
downloads the wav2vec2 files into `public/models/` (gitignored, ~91 MB,
skipped if already present). The app then loads the model from its own
origin — on Vercel that means your deployment's CDN, with immutable cache
headers from `vercel.json`. If the local files are ever missing, the app
falls back to downloading from the Hugging Face hub automatically.

## Deploying to Vercel

Import the repo, keep the default Vite preset (build command `npm run build`,
output `dist`). The build fetches the model files and bundles them into
`dist/models/`, so no extra configuration is needed.

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
  API, no key needed for this part (audio goes to Google's speech service).
- **On-device re-transcription** (optional) — a Moonshine ASR model running
  in a Web Worker re-transcribes the recording after the session: it hears
  the "um"/"uh" Chrome drops, works offline, and gives Firefox/Safari a
  transcript at all. Chunked at silence boundaries; ~63 MB model served from
  the app's own origin. Applying it recomputes every transcript stat.
- **Mic check** — optional 4-second pre-session check measures your noise
  floor (feeding the pause/voicing detectors — fluent nonstop talkers
  otherwise get undercounted), catches dead or clipping mics, and settles
  the mic permission before recognition starts.
- **Vocabulary analysis** — unique-word ratio with MATR diversity estimate,
  content-word overuse ("you said 'networking' ×9"), and keyword timing
  (early planner / spread out / late scrambler).
- **Stats** — word count, words-per-minute, filler-word count/breakdown
  (um, uh, like, you know, etc.), and how many hint keywords you actually
  used, computed in `src/lib/analyzeSpeech.js`. Chrome's recognizer silently
  drops "um"/"uh" from final transcripts, so fillers are recovered two ways:
  by diffing interim snapshots against the finalized text
  (`diffStrippedFillers`), and by flagging short voiced regions in the
  waveform that no transcript words landed on (`alignTranscript`).
- **Voice analysis** — pauses, loudness, and pitch variety measured from the
  raw waveform with the Web Audio API (`src/lib/analyzeAudio.js`,
  `src/lib/pitch.js`), so they work in any modern browser — no transcript
  needed. Auto-gain is disabled at capture time on purpose, so the volume
  stats reflect you, not your OS's gain riding.
- **Deep pronunciation analysis** (experimental, opt-in on the results
  screen) — scores each word by forced-aligning the transcript against a
  wav2vec2 CTC model running in a Web Worker via transformers.js
  (`src/lib/pronunciation.worker.js`, `src/lib/forcedAlign.js`). Runs fully
  on-device; no API key. The ~91 MB quantized model is served from the app's
  own origin (see below) and cached by the browser after the first run.
- **AI coach** (optional, bring-your-own Gemini key) — sends the session
  recording (WAV, first 90 s) to Google's Gemini API for the feedback local
  metrics can't give: fillers heard by ear, pronunciation tips, grammar fixes,
  vocabulary upgrades, and a fluency score (`src/lib/aiCoach.js`,
  `src/components/CoachPanel.jsx`). Nothing is sent until you click the
  button; the key lives only in your browser's local storage.
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
  hooks/useAudioAnalysis.js       mic capture: loudness + pitch sampling
  hooks/useLocalStorage.js        tiny persistence helper
  lib/analyzeSpeech.js     WPM / filler-word / keyword-usage stats
  lib/analyzeAudio.js      pause / volume / pitch-variety stats
  lib/pitch.js             YIN-lite pitch detector
  lib/aiTopics.js          optional AI topic generation
  lib/pronunciation.worker.js   on-device wav2vec2 scoring (opt-in)
  lib/forcedAlign.js       CTC forced alignment / greedy decode
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
