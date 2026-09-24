import { useState } from "react";
import Modal from "./Modal.jsx";
import "./AISettingsModal.css";

export default function AISettingsModal({ open, onClose, apiKey, onSave }) {
  const [draft, setDraft] = useState(apiKey || "");

  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="modal-title">AI features</h3>
      <p className="modal-text">
        Optional bonus mode using your own key. The key is stored only in this browser's
        local storage and sent only to api.anthropic.com — never anywhere else.
      </p>

      <p className="modal-text ai-key-label">
        <strong>Anthropic key</strong> — generates fresh topics and keywords on demand.
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
            setDraft("");
            onSave({ apiKey: "" });
          }}
          className="modal-clear"
        >
          Clear
        </button>
        <button
          onClick={() => onSave({ apiKey: draft })}
          className="btn-amber"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
