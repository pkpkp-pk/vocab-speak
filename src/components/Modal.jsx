import { useEffect, useState } from "react";
import "./Modal.css";

// Must match the .is-closing animation durations in Modal.css.
const EXIT_MS = 200;

// Shared modal shell (replaces the per-modal AnimatePresence wrappers).
// Keeps the panel mounted for EXIT_MS after `open` flips false so the
// closing animation can play, then unmounts it.
export default function Modal({ open, onClose, panelClassName = "", children }) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setRender(true);
      setClosing(false);
      return;
    }
    if (!render) return;
    setClosing(true);
    const t = setTimeout(() => {
      setRender(false);
      setClosing(false);
    }, EXIT_MS);
    return () => clearTimeout(t);
  }, [open, render]);

  if (!render) return null;

  return (
    <div className={`modal-backdrop ${closing ? "is-closing" : ""}`} onClick={onClose}>
      <div
        className={`modal-panel ${panelClassName} ${closing ? "is-closing" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
