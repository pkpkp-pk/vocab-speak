// Gemini Live API transcription session ("Gemini 3.5 Transcribe Live"):
// WebSocket to BidiGenerateContent, 16 kHz PCM16 streamed in, transcript text
// streamed out. The API key rides the WS query param — browser WebSocket can't
// set headers, and this is a BYO-key app (disclosed in settings).
//
// Server messages of interest:
//   { setupComplete: {} }                                  → ready to stream
//   { serverContent: { inputTranscription: { text } } }    → transcript chunk
//   { serverContent: { turnComplete: true } }              → utterance boundary

const WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MODEL = "gemini-3.5-transcribe-live";

// Chunked btoa — same call-stack concern as aiCoach.js's WAV upload.
function toBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function createLiveSession({ apiKey, onText, onTurnComplete, onError }) {
  const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(apiKey)}`);
  let ready = false;
  let closed = false;
  const queue = [];

  const sendPcm = (int16) => {
    const bytes = new Uint8Array(int16.length * 2);
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < int16.length; i++) dv.setInt16(i * 2, int16[i], true); // LE
    ws.send(
      JSON.stringify({
        realtimeInput: { audio: { data: toBase64(bytes), mimeType: "audio/pcm;rate=16000" } },
      })
    );
  };

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        setup: {
          model: `models/${MODEL}`,
          generationConfig: { responseModalities: ["TEXT"] },
          inputAudioTranscription: {},
        },
      })
    );
  };

  ws.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.setupComplete) {
      ready = true;
      queue.splice(0).forEach(sendPcm);
      return;
    }
    const sc = msg.serverContent;
    if (!sc) return;
    const text = sc.inputTranscription?.text;
    if (text) onText?.(text);
    if (sc.turnComplete || sc.interrupted) onTurnComplete?.();
  };

  ws.onerror = () => onError?.("connection-error");
  ws.onclose = (e) => {
    if (!closed && !e.wasClean) onError?.("connection-lost");
  };

  return {
    send(int16) {
      if (closed) return;
      if (ready && ws.readyState === WebSocket.OPEN) sendPcm(int16);
      else queue.push(int16);
    },
    close() {
      closed = true;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}
