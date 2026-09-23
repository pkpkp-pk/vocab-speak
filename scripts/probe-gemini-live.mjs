// Probe Gemini Live transcription setup variants against the real server and
// print everything it says. The API key never leaves your machine — this
// connects directly to generativelanguage.googleapis.com. (Note: the key will
// sit in your shell history; `history -d` the line after if you care.)
//
// usage: node scripts/probe-gemini-live.mjs <GEMINI_API_KEY>

const key = process.argv[2];
if (!key) {
  console.error("usage: node scripts/probe-gemini-live.mjs <GEMINI_API_KEY>");
  process.exit(1);
}

const WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const VARIANTS = [
  {
    name: "A: current code (generationConfig.responseModalities + inputAudioTranscription)",
    setup: {
      model: "models/gemini-3.5-transcribe-live",
      generationConfig: { responseModalities: ["TEXT"] },
      inputAudioTranscription: {},
    },
  },
  {
    name: "B: top-level responseModalities (ws quickstart shape)",
    setup: {
      model: "models/gemini-3.5-transcribe-live",
      responseModalities: ["TEXT"],
      inputAudioTranscription: {},
    },
  },
  {
    name: "C: bare minimum (model only)",
    setup: { model: "models/gemini-3.5-transcribe-live" },
  },
  {
    name: "D: alternate model id (flash infix), shape A",
    setup: {
      model: "models/gemini-3.5-flash-transcribe-live",
      generationConfig: { responseModalities: ["TEXT"] },
      inputAudioTranscription: {},
    },
  },
];

for (const v of VARIANTS) {
  console.log(`\n=== ${v.name} ===`);
  await new Promise((resolve) => {
    const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(key)}`);
    const done = (line) => {
      console.log(line);
      try { ws.close(); } catch {}
      resolve();
    };
    const timer = setTimeout(() => done("TIMEOUT: no setupComplete in 12s"), 12000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ setup: v.setup }));
      console.log("setup sent");
    };
    ws.onmessage = async (e) => {
      // server frames are binary Blobs — decode before parsing
      let rawData = e.data;
      if (rawData instanceof Blob) rawData = await rawData.text();
      else if (rawData instanceof ArrayBuffer) rawData = new TextDecoder().decode(rawData);
      const text = String(rawData).slice(0, 400);
      console.log("rx:", text);
      if (text.includes("setupComplete")) {
        clearTimeout(timer);
        done(">>> SETUP ACCEPTED <<<");
      }
    };
    ws.onerror = (err) => console.log("ws error:", err?.message ?? err);
    ws.onclose = (e) => {
      if (!e.wasClean) {
        clearTimeout(timer);
        done(`CLOSED: code=${e.code} reason="${e.reason}"`);
      }
    };
  });
}
console.log("\ndone.");
