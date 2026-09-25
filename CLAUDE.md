# CLAUDE.md — Vocab Speak (vocab-speak)

Spontaneous-English-speaking practice app. User picks a topic, talks against a
timer with optional keyword hints, then gets transcript stats plus waveform-based
voice metrics. No backend; deployed as a static site on Vercel.

## Stack & conventions

- React 18 + Vite 8 (rolldown-vite). Plain per-component CSS files (`X.jsx` +
  `X.css`). Tailwind and framer-motion were **deliberately removed** — do not
  reintroduce them or animation/utility CSS frameworks.
- No router. Stage state machine in `src/App.jsx`: `select | session | results`.
- ESM throughout (`"type": "module"`). Test scripts are plain Node `.mjs`.
- This directory path contains a space (`frontend practice`): in Node scripts
  always use `fileURLToPath(new URL(...))`, never `new URL(...).pathname`
  (percent-encoding bug bitten before).
- Do not access any `.claude` folder; it is gitignored.

## Commands

- `npm run dev` / `npm run build` — plain Vite, no pre-steps.
- `node scripts/test-audio-libs.mjs` — unit suite for the pure analysis libs
  (plus an SSR render check of TranscriptHeatmap via vite's middleware mode).
  Run it after touching anything in `src/lib/` or the heatmap. Currently 54 checks.

## Architecture

```
src/
  App.jsx                     stage machine; finishSession() computes all stats
  data/topics.js              built-in topic pool
  hooks/
    useSpeechRecognition.js   Chrome SpeechRecognition wrapper
    useAudioAnalysis.js       Web Audio sampler: {t, rmsDb, f0} at ~60 Hz
    useLocalStorage.js
  lib/
    analyzeSpeech.js          WPM, filler words, keyword usage from transcript
    analyzeVocabulary.js      diversity (MATR), content-word overuse, keyword timing
    analyzeAudio.js           pauses/volume/pitch; voicedMask(), voicedRegions()
    pitch.js                  YIN-lite F0 detection
    alignTranscript.js        transcript↔waveform alignment (see gotchas)
  components/
    SessionScreen.jsx         timer + live transcript + MediaRecorder
    StatsPanel.jsx            results: stat blocks, sparkline, fillers, heatmap
    TranscriptHeatmap.jsx     per-word loudness highlight + pause pills
    CustomTopicModal.jsx      user-added topics (localStorage)
```

`finishSession` result pipeline: `analyzeSpeech(transcript)` →
`stats.audio = analyzeAudio(samples)` → `stats.annotated = alignTranscript(segments, samples)`.

## Invariants & hard-won gotchas

**Speech recognition**
- Acquire the mic (`getUserMedia`) BEFORE `recognition.start()` — starting both
  at once races the permission prompt and recognition fails with
  `not-allowed`/`audio-capture`.
- `onerror`: fatal codes (`not-allowed`, `audio-capture`, `service-not-allowed`,
  `language-not-supported`) must clear `shouldRestartRef`, otherwise
  `onend → start()` loops forever. `no-speech` is benign.
- Chrome's recognizer is server-side Google ASR: it needs network, **sends
  audio to Google** (footer wording reflects this), and **strips disfluencies**
  ("um"/"uh") from final transcripts.
- **Android Chrome delegates recognition to the Google app's speech service** —
  when that is missing/disabled it hangs SILENTLY (no onerror, no onresult,
  "listening…" forever). useSpeechRecognition has a 10 s no-result watchdog
  (`gotResultRef`) that surfaces this as error code `no-results`; onresult
  clears it. Diagnosed on-device 2026-09-24 with an isolated config matrix:
  `lang="en-US"` and `interimResults: true` each made the recognizer hear
  speech yet return zero results; bare config worked ONCE then the API went
  erratic device-wide (google.com voice search unaffected — it bypasses this
  API). Conclusion: Chrome Android SpeechRecognition is unreliable on some
  devices; watchdog + honest error is the app-side ceiling.
- Filler recovery exists because of that stripping, two paths:
  (A) `diffStrippedFillers(interim, final)` in analyzeSpeech.js — multiset diff
  of the last interim snapshot vs. the finalized text, filtered to known
  disfluency tokens; accumulated in useSpeechRecognition per result index.
  (B) leftover regions in alignTranscript.js — voiced regions ≤ 0.8 s that no
  transcript words landed on = likely dropped "um"/"uh". Longer unassigned
  regions are missed phrases, not fillers.

**Audio**
- `autoGainControl: false` at capture on purpose — volume stats must reflect
  the speaker, not OS gain riding. Do not enable AGC.
- `useSpeechRecognition` and `useAudioAnalysis` share ONE clock: caller passes
  the same `performance.now()` t0 to both `.start(t0)`. alignTranscript depends
  on identical timebases.
- `alignTranscript` SELF-CALIBRATES the recognition lag: two-pass walk, median
  implied lag clamped [0.25, 1.75]s, spread > 1.5s → default 0.7. The optional
  4th `wordSpans` param (skips the lag heuristic, measured timings) is kept
  and tested but has NO producer since the pronunciation stack was removed.
- `voicedMask(samples, floorDb)` takes an optional MEASURED noise floor from
  the SessionScreen mic check (`checkMic` in useAudioAnalysis). The adaptive
  p10 fallback inflates into quiet speech for fluent nonstop talkers — the
  floor-bias regression test ("nonstop talker") pins this.
- `alignTranscript` returns `{ tokens, leftoverCount, leftoverSeconds,
  lagSeconds, lagCalibrated } | null`, NOT a bare array. Pause markers
  subtract skipped-over regions from the gap.

**On-device ASR (Moonshine)** — REMOVED (user call, 2026-09-23): the
onnxruntime-web wasm decoder crashed ("Missing required scale") and value
overlapped with Gemini live. asr.worker.js/asr.js/asrChunks.js/AsrPanel gone;
`voicedRegions()` stays (alignTranscript uses it).

**Gemini features** — REMOVED (user call, 2026-09-24): live transcription
engine (useGeminiLive.js, geminiLive.js, pcm16.worklet.js, resample.js), AI
coach (aiCoach.js, CoachPanel.jsx, wav.js), and the `speakstage.geminiKey`/
`speakstage.geminiLive` settings. Chrome SpeechRecognition is now the ONLY
transcript engine — non-Chrome browsers get no transcript (accepted
trade-off, same as after the Moonshine removal). Old gemini* localStorage
keys are orphaned in place; harmless.

**TranscriptHeatmap**
- Tokens from `.map()` MUST have real whitespace between them
  (`{i > 0 && " "}` in a Fragment). Adjacent elements have no break
  opportunities → the whole row is one unbreakable word → overflows the card.
  Regression-tested in the suite via SSR markup check.

**Deep pronunciation stack** — REMOVED (user call, 2026-09-24):
PronunciationPanel, pronunciation.js/.worker.js, forcedAlign.js,
decodeAudio.js, fetch-model.mjs, test-pronunciation.mjs, vercel.json,
public/models, the `@huggingface/transformers` dep, and the
`speakstage.deepAnalysis` toggle all gone. Builds no longer download the
~91 MB wav2vec2 model. alignTranscript's `wordSpans` param survives (tested,
no producer).

## Deployment

Vercel static build, default Vite preset (`npm run build` → `dist/`). No
model downloads, no headers config, no env vars needed.

## AI features — ALL REMOVED

AI topics (Anthropic BYO key) removed 2026-09-25 (user call): Header AI-mode
toggle + settings gear, AISettingsModal, aiTopics.js, `speakstage.aiMode`/
`speakstage.apiKey` state. App is now fully offline except Chrome's speech
recognition (which sends audio to Google — see footer). Earlier removals:
Gemini live + coach (2026-09-24), pronunciation stack (2026-09-24). Orphaned
localStorage keys (`geminiKey`, `geminiLive`, `deepAnalysis`, `aiMode`,
`apiKey`) stay harmlessly in existing users' browsers.

## Naming

App renamed to **Vocab Speak** (header, title, README, package.json).
`speakstage.*` localStorage keys intentionally kept — renaming them would wipe
existing users' streaks and settings.

## Pending / discussed, not approved

- User to verify live transcript + filler recovery in Chrome, then redeploy.
- ~~`en-IN` language option~~ — moot: recognition now uses the device default
  locale (hardcoded `en-US` was provably harmful on Android, 2026-09-24).
