# Vocab Speak — Complete Project Details

## What it is

**Vocab Speak** is a spontaneous-English-speaking practice app. It is a pure
front-end web application — no backend, no accounts, no database server. It
builds to a static site (deployed on Vercel) and runs entirely in the user's
browser.

The core idea: fluency grows by speaking continuously about an unprepared
topic. The app gives the user a topic, a target speaking time, and optional
keyword hints when they stall, then measures how they actually spoke — pace,
filler words, pauses, volume, pitch variety — and optionally pronunciation
quality and AI coaching feedback.

## What it does

### Core loop (works fully offline, no keys needed)

1. **Topic selection** — The user filters 30 built-in topics
   (`src/data/topics.js`) by category (History, Society, Technology, Personal,
   World & Nature, Business) and difficulty (Beginner 2 min / Intermediate
   3 min / Advanced 4 min). A shuffle button cycles topics until one appeals.
   Users can also add their own custom topics via a modal.

2. **Speaking session** — A stage-clock ring (`TimerRing`) counts up toward
   the target time for the chosen difficulty. While speaking:
   - The browser's `SpeechRecognition` API transcribes speech live
     (Chrome/Edge; server-side Google ASR, so audio goes to Google for this
     part).
   - A `MediaRecorder` captures the audio for later analysis.
   - If the user stalls, **"Stuck? Get a few words"** reveals the topic's
     rescue keywords a few at a time — deliberately not the whole list, so it
     stays a nudge rather than a script.

3. **Results** — When the session ends, `App.jsx`'s `finishSession()` computes
   all statistics and shows them in `StatsPanel`:
   - **Transcript stats** (`src/lib/analyzeSpeech.js`): word count,
     words-per-minute, filler-word count and breakdown (um, uh, like, you
     know, …), and how many hint keywords were actually used.
   - **Voice stats** (`src/lib/analyzeAudio.js` + `src/lib/pitch.js`):
     pause detection, loudness over time, and pitch variety — measured from
     the raw waveform with the Web Audio API, so they work in any modern
     browser even without speech recognition.
   - **Transcript heatmap** (`TranscriptHeatmap.jsx`): each transcript word
     colored by how loudly it was spoken, with pause pills inserted where true
     silence occurred.
   - A streak counter (days in a row practiced) persists across visits.

### Opt-in features

- **Deep pronunciation analysis** — toggle on the results screen. The
  transcript is force-aligned against a quantized wav2vec2 CTC model
  (`Xenova/wav2vec2-base-960h`, ~91 MB) running in a Web Worker via
  transformers.js (`pronunciation.worker.js` + `forcedAlign.js`), scoring
  each word's pronunciation. Runs fully on-device; no API key. Model files
  are served same-origin from `/models/` (fetched at build time by
  `scripts/fetch-model.mjs`) with Hugging Face as fallback. Quality is known
  to be mediocre, so it stays behind the toggle.

- **AI coach** — bring-your-own Gemini API key. Sends the session recording
  (WAV, first 90 s) to `gemini-2.5-flash` for what local metrics cannot give:
  fillers heard by ear, pronunciation tips, grammar fixes, vocabulary
  upgrades, and a fluency score (`aiCoach.js`, `CoachPanel.jsx`). Nothing is
  sent until the user clicks the button.

- **AI topic mode** — bring-your-own Anthropic API key. Generates fresh
  topics and keyword sets on demand instead of using the built-in bank
  (`aiTopics.js`). Off by default; the app works fully without it.

Both keys live only in the browser's `localStorage` and are sent only to
their respective APIs.

## How it does it

### Stack

- **React 18 + Vite 8** (rolldown-vite), ESM throughout (`"type": "module"`).
- **Plain per-component CSS** (`X.jsx` + `X.css`); design tokens as CSS
  custom properties in `src/index.css`. All animation is CSS
  transitions/keyframes. Tailwind and framer-motion were **deliberately
  removed** and must not be reintroduced.
- **No router.** `src/App.jsx` is a stage state machine:
  `select | session | results`, with a CSS fade between stages replacing the
  old `<AnimatePresence>`.
- **transformers.js v4** (`@huggingface/transformers`) for on-device wav2vec2
  in a Web Worker.

### Data flow through a session

```
CategoryPicker / TopicCard          (pick topic, difficulty)
        │
SessionScreen.jsx                   timer + live transcript + MediaRecorder
  ├─ useSpeechRecognition.js        Chrome SpeechRecognition wrapper
  └─ useAudioAnalysis.js            Web Audio sampler: {t, rmsDb, f0} @ ~60 Hz
        │
App.jsx finishSession()
  ├─ analyzeSpeech(transcript)      WPM, fillers, keyword usage
  ├─ analyzeAudio(samples)          pauses, volume, pitch variety
  └─ alignTranscript(segments,      per-word loudness tokens + pause pills
        samples)                    → StatsPanel / TranscriptHeatmap
        │
  (opt-in) pronunciation.worker.js  wav2vec2 CTC forced alignment
  (opt-in) aiCoach.js               Gemini feedback on the WAV recording
```

### Key mechanisms and why they exist

- **Mic ordering**: `getUserMedia` is acquired **before**
  `recognition.start()` — starting both at once races the permission prompt
  and recognition fails with `not-allowed`/`audio-capture`.
- **Fatal vs. benign recognition errors**: fatal codes (`not-allowed`,
  `audio-capture`, `service-not-allowed`, `language-not-supported`) clear the
  restart flag, otherwise `onend → start()` loops forever. `no-speech` is
  benign and restarts.
- **Filler-word recovery**: Chrome's recognizer silently strips "um"/"uh"
  from final transcripts. Two recovery paths:
  - (A) `diffStrippedFillers(interim, final)` in `analyzeSpeech.js` —
    multiset diff of the last interim snapshot vs. finalized text, filtered
    to known disfluency tokens.
  - (B) Leftover regions in `alignTranscript.js` — voiced regions ≤ 0.8 s
    with no transcript words on them are likely dropped fillers. Longer
    unassigned regions are treated as missed phrases, not fillers.
- **Auto-gain disabled**: `autoGainControl: false` at capture time, so volume
  stats reflect the speaker, not OS gain riding. Do not enable AGC.
- **One shared clock**: `useSpeechRecognition` and `useAudioAnalysis` both
  receive the same `performance.now()` t0 at start; `alignTranscript` depends
  on identical timebases. `RECOGNITION_LAG_S = 0.7` compensates ASR latency.
- **Pitch**: YIN-lite F0 detector (`src/lib/pitch.js`).
- **Heatmap wrapping invariant**: tokens from `.map()` must have real
  whitespace between them (`{i > 0 && " "}`), otherwise adjacent elements
  have no break opportunities and the row overflows the card. Regression
  tested.
- **transformers.js v4 gotchas**: `AutoProcessor` has no tokenizer attached —
  `AutoTokenizer` loads separately; `get_vocab()` returns a `Map`; the worker
  sets `env.localModelPath = "/models/"` and `env.allowLocalModels = true`
  (false by default in browsers).

### Persistence (localStorage keys, `speakstage.*`)

Kept under the old `speakstage.*` prefix on purpose after the rename to
Vocab Speak — renaming would wipe existing users' data.

| Key | Contents |
|---|---|
| `speakstage.streak` | consecutive-day practice streak |
| `speakstage.lastDate` | last practice date (for streak) |
| `speakstage.aiMode` | AI topic mode on/off |
| `speakstage.apiKey` | Anthropic key (AI topics) |
| `speakstage.geminiKey` | Gemini key (AI coach) |
| `speakstage.customTopics` | user-added topics |
| `speakstage.deepAnalysis` | pronunciation toggle |

### Model self-hosting

`npm run dev` and `npm run build` first run `scripts/fetch-model.mjs`, which
downloads the wav2vec2 files into `public/models/` (gitignored, ~91 MB,
skipped if present). The build bundles them into `dist/models/`, and
`vercel.json` sets immutable cache headers for `/models/*`. If local files
are missing at runtime, the app falls back to the Hugging Face hub.

### Project structure

```
src/
  App.jsx                     stage machine; finishSession() computes all stats
  data/topics.js              30 built-in topics, CATEGORIES, DIFFICULTIES
  hooks/
    useSpeechRecognition.js   mic transcription wrapper
    useAudioAnalysis.js       mic capture: loudness + pitch sampling
    useLocalStorage.js        tiny persistence helper
  lib/
    analyzeSpeech.js          WPM / filler / keyword-usage stats (pure)
    analyzeAudio.js           pause / volume / pitch stats; voicedMask() (pure)
    pitch.js                  YIN-lite F0 detection (pure)
    alignTranscript.js        maps transcript onto voiced regions
    forcedAlign.js            CTC forced alignment / greedy decode (pure)
    pronunciation.worker.js   wav2vec2 in a Web Worker
    pronunciation.js          worker wrapper
    decodeAudio.js            Blob → 16 kHz mono
    wav.js                    Float32 PCM → 16-bit WAV encoder (pure)
    aiCoach.js                optional BYO-key Gemini coach
    aiTopics.js               optional BYO-key Anthropic topic generation
  components/
    Header, CategoryPicker, TopicCard, CustomTopicModal
    SessionScreen, TimerRing, KeywordHelper
    StatsPanel, TranscriptHeatmap, PronunciationPanel, CoachPanel
    Modal, AISettingsModal
scripts/
  fetch-model.mjs             downloads wav2vec2 into public/models/
  test-audio-libs.mjs         unit suite for pure libs + heatmap SSR check
  test-pronunciation.mjs      pronunciation pipeline check
```

### Commands

```bash
npm install
npm run dev        # fetch-model + vite dev server (usually :5173)
npm run build      # fetch-model + production build to dist/
npm run preview    # preview the production build
node scripts/test-audio-libs.mjs   # 48-check unit suite; run after
                                   # touching src/lib/ or the heatmap
```

### Deployment

Vercel static build, default Vite preset (build `npm run build`, output
`dist`). First build needs network access to huggingface.co for the model
fetch.

## Constraints and gotchas

- The directory path contains a space (`frontend practice`): in Node scripts
  always use `fileURLToPath(new URL(...))`, never `new URL(...).pathname`
  (percent-encoding bug).
- Full transcription needs Chrome or Edge (the Web Speech `SpeechRecognition`
  API); Safari/Firefox have limited or no support. Timer, keyword hints, and
  waveform-based voice stats work everywhere.
- Do not access the `.claude` folder; it is gitignored.
