import { useEffect, useState } from "react";

// `validate` (optional) guards against hand-edited or corrupt stored values —
// a value with the wrong shape falls back to initialValue instead of
// propagating into the app and crashing it (e.g. a non-array customTopics
// would break `[...TOPICS, ...customTopics]`).
export function useLocalStorage(key, initialValue, validate) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return initialValue;
      const parsed = JSON.parse(stored);
      if (validate && !validate(parsed)) return initialValue;
      return parsed;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable — fail silently */
    }
  }, [key, value]);

  return [value, setValue];
}
