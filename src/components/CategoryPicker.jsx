import { useCallback, useEffect, useRef, useState } from "react";
import { CATEGORIES, DIFFICULTIES } from "../data/topics.js";
import "./CategoryPicker.css";

function PillGroup({ label, active, onChange, options, getId, getLabel }) {
  const rowRef = useRef(null);
  const [ind, setInd] = useState(null); // {x, y, w, h} of the active pill

  // Measure the active button so the amber indicator can slide over to it
  // (replaces framer-motion's layoutId shared-element animation).
  const measure = useCallback(() => {
    const btn = rowRef.current?.querySelector(`[data-id="${active}"]`);
    if (btn) {
      setInd({ x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight });
    }
  }, [active]);

  useEffect(() => {
    measure();
  }, [measure, options]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    // Re-measure once webfonts finish loading — text widths shift slightly.
    document.fonts?.ready.then(measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return (
    <div className="pill-group">
      <p className="label-xs pill-label">{label}</p>
      <div className="pill-row" ref={rowRef}>
        {ind && (
          <span
            className="pill-indicator"
            style={{ transform: `translate(${ind.x}px, ${ind.y}px)`, width: ind.w, height: ind.h }}
          />
        )}
        {options.map((opt) => {
          const id = getId(opt);
          const isActive = active === id;
          return (
            <button
              key={id}
              data-id={id}
              onClick={() => onChange(id)}
              className={`pill ${isActive ? "active" : ""}`}
            >
              {getLabel(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function CategoryPicker({ category, difficulty, onCategory, onDifficulty }) {
  return (
    <div className="category-picker">
      <PillGroup
        label="Category"
        active={category}
        onChange={onCategory}
        options={[{ id: "all", label: "All" }, ...CATEGORIES]}
        getId={(o) => o.id}
        getLabel={(o) => o.label}
      />
      <PillGroup
        label="Difficulty"
        active={difficulty}
        onChange={onDifficulty}
        options={[{ id: "all", label: "Any" }, ...DIFFICULTIES]}
        getId={(o) => o.id}
        getLabel={(o) => o.label}
      />
    </div>
  );
}
