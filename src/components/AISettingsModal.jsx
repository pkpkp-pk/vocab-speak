import { useState } from "react";
import Modal from "./Modal.jsx";
import "./AISettingsModal.css";

export default function AISettingsModal({ open, onClose, apiKey, geminiKey, onSave }) {
  const [draft, setDraft] = useState(apiKey || "");
  const [geminiDraft, setGeminiDraft] = useState(geminiKey || "");

  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="modal-title">AI features</h3>
      <p className="modal-text">
        Optional bonus modes using your own keys. Keys are stored only in this browser's
        local storage and sent only to the matching API — never anywhere else.
      </p>

      <p className="modal-text ai-key-label">
        <strong>Anthropic key</strong> — generates fresh topics and keywords on demand
        (sent to api.anthropic.com).
      </p>
      <input
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="sk-ant-..."
        className="input ai-key-input"
      />

      <p className="modal-text ai-key-label">
        <strong>Gemini key</strong> — powers live transcription during sessions
        (Gemini 3.5 Transcribe Live; hears "um"/"uh" and works in any browser) and the
        AI coach on the results screen (sent to generativelanguage.googleapis.com).
        Get a free key at aistudio.google.com.
      </p>
      <input
        type="password"
        value={geminiDraft}
        onChange={(e) => setGeminiDraft(e.target.value)}
        placeholder="AIza..."
        className="input ai-key-input"
      />

      <div className="modal-actions">
        <button
          onClick={() => {
            setDraft("");
            setGeminiDraft("");
            onSave({ apiKey: "", geminiKey: "" });
          }}
          className="modal-clear"
        >
          Clear both
        </button>
        <button
          onClick={() => onSave({ apiKey: draft, geminiKey: geminiDraft })}
          className="btn-amber"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
