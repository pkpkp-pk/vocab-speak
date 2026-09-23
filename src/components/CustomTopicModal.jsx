import { useState } from "react";
import Modal from "./Modal.jsx";
import { CATEGORIES, DIFFICULTIES } from "../data/topics.js";
import "./CustomTopicModal.css";

const emptyForm = { title: "", prompt: "", category: "society", difficulty: "intermediate", keywords: "" };

export default function CustomTopicModal({ open, onClose, customTopics, onAdd, onDelete }) {
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    const title = form.title.trim();
    const prompt = form.prompt.trim();
    const keywords = form.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    if (!title || !prompt) {
      setFormError("A title and a prompt are both required.");
      return;
    }

    onAdd({
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category: form.category,
      difficulty: form.difficulty,
      title,
      prompt,
      keywords: keywords.length ? keywords : ["speak freely", "own words"],
      isCustom: true,
    });
    setForm(emptyForm);
    setFormError(null);
  };

  return (
    <Modal open={open} onClose={onClose} panelClassName="modal-panel--wide scrollbar-thin">
      <h3 className="modal-title">Your own topics</h3>
      <p className="modal-text">
        Add topics and hint words yourself — these are saved on this device and mix right in
        with the built-in ones, no internet required.
      </p>

      <form onSubmit={submit} className="topic-form">
        <input
          value={form.title}
          onChange={update("title")}
          placeholder="Topic title, e.g. My First Job"
          className="input"
        />
        <textarea
          value={form.prompt}
          onChange={update("prompt")}
          placeholder="One-line prompt telling the speaker what to talk about"
          rows={2}
          className="input"
        />
        <div className="form-row">
          <select value={form.category} onChange={update("category")} className="input form-select">
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select value={form.difficulty} onChange={update("difficulty")} className="input form-select">
            {DIFFICULTIES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <input
          value={form.keywords}
          onChange={update("keywords")}
          placeholder="Hint keywords, comma separated"
          className="input"
        />
        {formError && <p className="form-error">{formError}</p>}
        <button type="submit" className="btn-amber form-submit">
          + Add topic
        </button>
      </form>

      {customTopics.length > 0 && (
        <div className="custom-list">
          <p className="label-xs custom-list-label">your topics ({customTopics.length})</p>
          <ul className="custom-items">
            {customTopics.map((t) => (
              <li key={t.id} className="custom-item">
                <span className="custom-item-title">{t.title}</span>
                <button
                  onClick={() => onDelete(t.id)}
                  aria-label={`Delete ${t.title}`}
                  className="custom-item-remove"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button onClick={onClose} className="custom-close">
        Close
      </button>
    </Modal>
  );
}
