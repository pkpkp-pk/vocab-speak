import { useState } from "react";
import Modal from "./Modal.jsx";
import "./AISettingsModal.css";

export default function AISettingsModal({ open, onClose, apiKey, onSave }) {
  const [draft, setDraft] = useState(apiKey || "");

  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="modal-title">AI-generated topics</h3>
      <p className="modal-text">
        Optional bonus mode. Paste your own Anthropic API key to generate fresh topics and
        keywords on demand. It's stored only in this browser's local storage and sent only to
        api.anthropic.com — never anywhere else.
      </p>

      <input
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="sk-ant-..."
        className="input ai-key-input"
      />

      <div className="modal-actions">
        <button
          onClick={() => {
            onSave("");
            setDraft("");
          }}
          className="modal-clear"
        >
          Clear key
        </button>
        <button onClick={() => onSave(draft)} className="btn-amber">
          Save
        </button>
      </div>
    </Modal>
  );
}
