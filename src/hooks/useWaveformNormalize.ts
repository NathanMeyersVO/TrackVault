import { useCallback, useState } from "react";

const STORAGE_KEY = "trackvault.waveformNormalize";

function readStored(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return false;
    return raw === "true";
  } catch {
    return false;
  }
}

function store(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Ignore storage failures.
  }
}

export function useWaveformNormalize() {
  const [normalize, setNormalizeState] = useState(readStored);

  const setNormalize = useCallback((value: boolean) => {
    setNormalizeState(value);
    store(value);
  }, []);

  return { normalize, setNormalize };
}
