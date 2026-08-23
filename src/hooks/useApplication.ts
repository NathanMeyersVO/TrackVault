import { useCallback, useEffect, useState } from "react";

import { api, type ApplicationId, type ApplicationSettings } from "../lib/tauri";

function isApplicationId(value: string): value is ApplicationId {
  return value === "none" || value === "usfs_ems";
}

export function useApplication() {
  const [applicationId, setApplicationId] = useState<ApplicationId>("none");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const settings = await api.getApplicationSettings();
        if (cancelled) return;
        const resolved = isApplicationId(settings.application_id)
          ? settings.application_id
          : "none";
        setApplicationId(resolved);
      } catch {
        if (!cancelled) setApplicationId("none");
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectApplication = useCallback(async (nextApplicationId: ApplicationId) => {
    setApplicationId(nextApplicationId);
    try {
      const settings: ApplicationSettings = {
        application_id: nextApplicationId,
      };
      const saved = await api.setApplicationSettings(settings);
      const resolved = isApplicationId(saved.application_id)
        ? saved.application_id
        : "none";
      setApplicationId(resolved);
    } catch (error) {
      console.error(error);
    }
  }, []);

  return { applicationId, loaded, selectApplication };
}
