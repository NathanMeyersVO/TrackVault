import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  applyAppearance,
  type AppearanceSettings,
} from "../lib/appearance";
import {
  DEFAULT_SCHEME_ID,
  getScheme,
  getSchemeColors,
  isValidSchemeId,
} from "../lib/colorSchemes";
import { api, type ThemeSettings } from "../lib/tauri";

interface AppearanceContextValue {
  themeId: string;
  settings: AppearanceSettings;
  loaded: boolean;
  selectTheme: (themeId: string) => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function resolveThemeId(raw: ThemeSettings): string {
  const themeId = raw.theme_id?.trim();
  return themeId && isValidSchemeId(themeId) ? themeId : DEFAULT_SCHEME_ID;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState(DEFAULT_SCHEME_ID);
  const [loaded, setLoaded] = useState(false);
  const themeIdRef = useRef(themeId);
  const saveTimerRef = useRef<number | null>(null);

  themeIdRef.current = themeId;
  const settings = useMemo(() => getSchemeColors(themeId), [themeId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const raw = await api.getAppSettings();
        if (cancelled) return;
        const resolved = resolveThemeId(raw);
        setThemeId(resolved);
        applyAppearance(getSchemeColors(resolved));
      } catch {
        applyAppearance(getSchemeColors(DEFAULT_SCHEME_ID));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((nextThemeId: string) => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void api.setAppSettings({ theme_id: nextThemeId }).catch(() => {
        /* keep local theme even if save fails */
      });
    }, 300);
  }, []);

  const selectTheme = useCallback(
    (nextThemeId: string) => {
      if (!isValidSchemeId(nextThemeId)) return;
      setThemeId(nextThemeId);
      themeIdRef.current = nextThemeId;
      applyAppearance(getSchemeColors(nextThemeId));
      persist(nextThemeId);
    },
    [persist],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const value = useMemo(
    () => ({ themeId, settings, loaded, selectTheme }),
    [themeId, settings, loaded, selectTheme],
  );

  return (
    <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext);
  if (!context) {
    throw new Error("useAppearance must be used within AppearanceProvider");
  }
  return context;
}

export { getScheme };
