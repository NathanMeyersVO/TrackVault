import { useCallback, useEffect, useState } from "react";

import { api, type PhoneUploadSettingsResponse } from "../lib/tauri";

const DEFAULT_RESPONSE: PhoneUploadSettingsResponse = {
  enabled: false,
  publicOrigin: "",
  localPort: 38444,
  hasTunnelToken: false,
  ready: false,
};

export function usePhoneUploadSettings() {
  const [settings, setSettings] = useState<PhoneUploadSettingsResponse>(DEFAULT_RESPONSE);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setSettings(await api.getPhoneUploadSettings());
    } catch {
      setSettings(DEFAULT_RESPONSE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { settings, loading, reload, phoneUploadReady: settings.ready };
}
