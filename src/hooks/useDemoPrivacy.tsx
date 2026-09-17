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
  isSensitiveTagKey,
  shouldBlurFilename as shouldBlurFilenameHelper,
  shouldBlurTagKey,
  shouldBlurTrackField,
  type TrackDisplayField,
} from "../lib/demoPrivacy";
import { api, type DemoPrivacySettings } from "../lib/tauri";

interface DemoPrivacyContextValue {
  demoModeEnabled: boolean;
  sensitiveTagKeys: string[];
  blurFilenames: boolean;
  loaded: boolean;
  setDemoModeEnabled: (enabled: boolean) => void;
  setBlurFilenames: (enabled: boolean) => void;
  toggleSensitiveTagKey: (tagKey: string) => void;
  shouldBlurTagKey: (tagKey: string) => boolean;
  shouldBlurTrackField: (field: TrackDisplayField) => boolean;
  shouldBlurFilename: () => boolean;
}

const DemoPrivacyContext = createContext<DemoPrivacyContextValue | null>(null);

export function DemoPrivacyProvider({ children }: { children: ReactNode }) {
  const [demoModeEnabled, setDemoModeEnabled] = useState(false);
  const [sensitiveTagKeys, setSensitiveTagKeys] = useState<string[]>([]);
  const [blurFilenames, setBlurFilenamesState] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const settingsRef = useRef({ sensitiveTagKeys, blurFilenames });

  settingsRef.current = { sensitiveTagKeys, blurFilenames };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const settings = await api.getDemoPrivacySettings();
        if (!cancelled) {
          setSensitiveTagKeys(settings.sensitive_tag_keys);
          setBlurFilenamesState(settings.blur_filenames);
        }
      } catch {
        /* keep defaults */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback((settings: DemoPrivacySettings) => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void api.setDemoPrivacySettings(settings).catch(() => {
        /* keep local selection */
      });
    }, 300);
  }, []);

  const persistCurrent = useCallback(() => {
    const { sensitiveTagKeys: keys, blurFilenames: blur } = settingsRef.current;
    persist({
      sensitive_tag_keys: keys,
      blur_filenames: blur,
    });
  }, [persist]);

  const toggleSensitiveTagKey = useCallback(
    (tagKey: string) => {
      const trimmed = tagKey.trim();
      if (!trimmed) return;

      setSensitiveTagKeys((current) => {
        const next = isSensitiveTagKey(trimmed, current)
          ? current.filter((key) => key !== trimmed)
          : [...current, trimmed];
        settingsRef.current = {
          ...settingsRef.current,
          sensitiveTagKeys: next,
        };
        persistCurrent();
        return next;
      });
    },
    [persistCurrent],
  );

  const setBlurFilenames = useCallback(
    (enabled: boolean) => {
      setBlurFilenamesState(enabled);
      settingsRef.current = { ...settingsRef.current, blurFilenames: enabled };
      persistCurrent();
    },
    [persistCurrent],
  );

  const blurTagKey = useCallback(
    (tagKey: string) =>
      shouldBlurTagKey(demoModeEnabled, tagKey, sensitiveTagKeys),
    [demoModeEnabled, sensitiveTagKeys],
  );

  const blurTrackField = useCallback(
    (field: TrackDisplayField) =>
      shouldBlurTrackField(demoModeEnabled, field, sensitiveTagKeys),
    [demoModeEnabled, sensitiveTagKeys],
  );

  const blurFilename = useCallback(
    () => shouldBlurFilenameHelper(demoModeEnabled, blurFilenames),
    [demoModeEnabled, blurFilenames],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const value = useMemo(
    () => ({
      demoModeEnabled,
      sensitiveTagKeys,
      blurFilenames,
      loaded,
      setDemoModeEnabled,
      setBlurFilenames,
      toggleSensitiveTagKey,
      shouldBlurTagKey: blurTagKey,
      shouldBlurTrackField: blurTrackField,
      shouldBlurFilename: blurFilename,
    }),
    [
      demoModeEnabled,
      sensitiveTagKeys,
      blurFilenames,
      loaded,
      blurTagKey,
      blurTrackField,
      blurFilename,
      toggleSensitiveTagKey,
      setBlurFilenames,
    ],
  );

  return (
    <DemoPrivacyContext.Provider value={value}>
      {children}
    </DemoPrivacyContext.Provider>
  );
}

export function useDemoPrivacy(): DemoPrivacyContextValue {
  const context = useContext(DemoPrivacyContext);
  if (!context) {
    throw new Error("useDemoPrivacy must be used within DemoPrivacyProvider");
  }
  return context;
}
