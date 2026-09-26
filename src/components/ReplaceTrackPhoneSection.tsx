import { useCallback, useEffect, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";

import { RemoteUploadPanel } from "./RemoteUploadPanel";
import { api } from "../lib/tauri";

interface ReplaceTrackPhoneSectionProps {
  trackId: number;
  trackTitle: string;
  enabled: boolean;
  onError: (message: string | null) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function ReplaceTrackPhoneSection({
  trackId,
  trackTitle,
  enabled,
  onError,
  onBusyChange,
}: ReplaceTrackPhoneSectionProps) {
  const [remoteUploadUrl, setRemoteUploadUrl] = useState<string | null>(null);
  const [remoteWaiting, setRemoteWaiting] = useState(false);
  const [remoteStarting, setRemoteStarting] = useState(false);
  const [remoteLogPath, setRemoteLogPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const effectGeneration = useRef(0);
  const startedRef = useRef(false);

  const reportError = useCallback(
    (message: string | null) => {
      setError(message);
      onError(message);
    },
    [onError],
  );

  const runRemoteStart = useCallback(
    async (generation: number) => {
      reportError(null);
      setRemoteStarting(true);
      try {
        const info = await api.startReplaceRemoteUpload(trackId);
        if (effectGeneration.current !== generation) return;
        setRemoteUploadUrl(info.uploadUrl);
        setRemoteLogPath(info.logFilePath);
        setRemoteWaiting(true);
      } catch (err) {
        if (effectGeneration.current !== generation) return;
        setRemoteUploadUrl(null);
        setRemoteLogPath(null);
        setRemoteWaiting(false);
        reportError(String(err));
      } finally {
        if (effectGeneration.current === generation) {
          setRemoteStarting(false);
        }
      }
    },
    [reportError, trackId],
  );

  const retryRemoteStart = useCallback(() => {
    const generation = ++effectGeneration.current;
    void runRemoteStart(generation);
  }, [runRemoteStart]);

  useEffect(() => {
    if (!enabled) {
      effectGeneration.current += 1;
      startedRef.current = false;
      setRemoteUploadUrl(null);
      setRemoteWaiting(false);
      setRemoteStarting(false);
      setError(null);
      onError(null);
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    const generation = ++effectGeneration.current;
    void runRemoteStart(generation);
  }, [enabled, onError, runRemoteStart]);

  useEffect(() => {
    if (!enabled) return;
    void api.getReplaceRemoteUploadLogPath().then(setRemoteLogPath).catch(() => {});
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !remoteWaiting) return;

    const interval = window.setInterval(() => {
      void api.getReplaceRemoteUploadStatus().then((status) => {
        if (status.status === "failed" && status.error) {
          reportError(status.error);
          setRemoteWaiting(false);
          setRemoteUploadUrl(null);
        }
        if (status.status === "expired") {
          reportError(status.error ?? "Upload session expired.");
          setRemoteWaiting(false);
          setRemoteUploadUrl(null);
        }
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [enabled, remoteWaiting, reportError]);

  useEffect(() => {
    onBusyChange?.(remoteStarting);
  }, [onBusyChange, remoteStarting]);

  const openLogsFolder = useCallback(async () => {
    try {
      const dir = await api.getReplaceRemoteUploadLogsDir();
      await openPath(dir);
    } catch {
      reportError("Could not open the diagnostics log folder.");
    }
  }, [reportError]);

  if (!enabled) return null;

  return (
    <div className="space-y-3 text-sm text-foreground">
      <p className="text-xs text-muted">
        Send a replacement audio file from your phone (any network). When the upload finishes,
        IceTrackVault will verify the file and show the confirmation step.
      </p>
      {remoteLogPath && (
        <p className="text-xs text-muted">
          Diagnostics log:{" "}
          <span className="break-all text-foreground">{remoteLogPath}</span>{" "}
          <button
            type="button"
            onClick={() => void openLogsFolder()}
            className="text-accent hover:underline"
          >
            Open log folder
          </button>
        </p>
      )}
      {remoteStarting && !remoteUploadUrl && (
        <p className="text-muted">Starting upload server…</p>
      )}
      <RemoteUploadPanel
        uploadUrl={remoteUploadUrl}
        waiting={remoteWaiting}
        busy={remoteStarting}
        destinationHint={`Replacing “${trackTitle}”`}
        onCopyError={reportError}
      />
      {error && (
        <div className="space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          {!remoteStarting && !remoteUploadUrl ? (
            <button
              type="button"
              onClick={() => retryRemoteStart()}
              className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-surface-hover"
            >
              Try again
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
