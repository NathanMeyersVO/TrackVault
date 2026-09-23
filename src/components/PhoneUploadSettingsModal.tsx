import { useCallback, useEffect, useMemo, useState } from "react";

import { api, type PhoneUploadSettings } from "../lib/tauri";

interface PhoneUploadSettingsModalProps {
  onClose: () => void;
  onSaved?: () => void;
}

const DEFAULT_LOCAL_PORT = 38444;

export function PhoneUploadSettingsModal({ onClose, onSaved }: PhoneUploadSettingsModalProps) {
  const [enabled, setEnabled] = useState(false);
  const [publicOrigin, setPublicOrigin] = useState("");
  const [localPort, setLocalPort] = useState(DEFAULT_LOCAL_PORT);
  const [tunnelToken, setTunnelToken] = useState("");
  const [hasStoredToken, setHasStoredToken] = useState(false);
  const [replaceToken, setReplaceToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [portProbeMessage, setPortProbeMessage] = useState<string | null>(null);
  const [pathProbeMessage, setPathProbeMessage] = useState<string | null>(null);
  const [pathProbeBusy, setPathProbeBusy] = useState(false);

  const serviceUrl = useMemo(
    () => `http://localhost:${localPort || DEFAULT_LOCAL_PORT}`,
    [localPort],
  );

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await api.getPhoneUploadSettings();
        setEnabled(loaded.enabled);
        setPublicOrigin(loaded.publicOrigin);
        setLocalPort(loaded.localPort || DEFAULT_LOCAL_PORT);
        setHasStoredToken(loaded.hasTunnelToken);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, []);

  const probeCloudflared = useCallback(async () => {
    setProbeMessage(null);
    setError(null);
    try {
      setProbeMessage(await api.probeCloudflared());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const probeLocalPort = useCallback(async () => {
    setPortProbeMessage(null);
    setError(null);
    const port = localPort || DEFAULT_LOCAL_PORT;
    try {
      await api.probePhoneUploadLocalPort(port);
      setPortProbeMessage(`Port ${port} is available on 127.0.0.1.`);
    } catch (e) {
      setError(String(e));
    }
  }, [localPort]);

  const hasTokenForProbe =
    (hasStoredToken && !replaceToken) || tunnelToken.trim().length > 0;

  const probeTunnelPath = useCallback(async () => {
    setPathProbeMessage(null);
    setError(null);
    setPathProbeBusy(true);
    try {
      const payload: PhoneUploadSettings = {
        enabled,
        publicOrigin: publicOrigin.trim(),
        localPort: localPort || DEFAULT_LOCAL_PORT,
      };
      const tokenForProbe =
        replaceToken || !hasStoredToken
          ? tunnelToken.trim() || null
          : null;
      const message = await api.probePhoneUploadPath(payload, tokenForProbe);
      setPathProbeMessage(message);
    } catch (e) {
      setError(String(e));
    } finally {
      setPathProbeBusy(false);
    }
  }, [
    enabled,
    hasStoredToken,
    localPort,
    publicOrigin,
    replaceToken,
    tunnelToken,
  ]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: PhoneUploadSettings = {
        enabled,
        publicOrigin: publicOrigin.trim(),
        localPort: localPort || DEFAULT_LOCAL_PORT,
      };
      const tokenToSave =
        replaceToken || !hasStoredToken
          ? tunnelToken.trim() || null
          : undefined;
      await api.setPhoneUploadSettings(payload, tokenToSave);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [
    enabled,
    hasStoredToken,
    localPort,
    onClose,
    onSaved,
    publicOrigin,
    replaceToken,
    tunnelToken,
  ]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-xl">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Phone upload (Cloudflare Tunnel)</h2>
          <p className="mt-1 text-xs text-muted">
            One-time setup on this computer: install{" "}
            <code className="text-foreground">cloudflared</code>, create a named Cloudflare tunnel
            routed to{" "}
            <code className="text-foreground">{serviceUrl}</code> (local port below), then save your
            origin and token. Each upload session uses a new link under your public hostname.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
          <ol className="list-decimal space-y-2 pl-5 text-xs text-muted">
            <li>
              Install <code className="text-foreground">cloudflared</code> on this PC and ensure it is on
              your PATH. See{" "}
              <a
                href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
                className="text-accent hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                Cloudflare tunnel downloads
              </a>
              . Windows:{" "}
              <code className="text-foreground">winget install Cloudflare.cloudflared</code> (or download
              the .exe). macOS: <code className="text-foreground">brew install cloudflared</code>. Use{" "}
              <span className="text-foreground">Check cloudflared install</span> below to verify.
            </li>
            <li>
              Cloudflare dashboard → Networking → Tunnels → create tunnel → published route Service URL{" "}
              <code className="text-foreground">{serviceUrl}</code> (must match local port below).
            </li>
            <li>Copy the tunnel run token from the install command.</li>
            <li>Enter your public HTTPS origin, local port, and token below.</li>
          </ol>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={busy}
            />
            Enable upload from phone
          </label>

          <label className="block text-xs text-muted">
            Local port (TrackVault listens on 127.0.0.1; default {DEFAULT_LOCAL_PORT})
            <input
              type="number"
              min={1024}
              max={65535}
              value={localPort}
              onChange={(e) => setLocalPort(Number(e.target.value))}
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              disabled={busy}
            />
          </label>
          <p className="text-xs text-muted">
            If this port is in use, pick another number and set the same Service URL in Cloudflare (
            <code className="text-foreground">{serviceUrl}</code>).
          </p>

          <label className="block text-xs text-muted">
            Public origin (hostname only)
            <input
              type="url"
              value={publicOrigin}
              onChange={(e) => setPublicOrigin(e.target.value)}
              placeholder="https://upload.example.com"
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              disabled={busy}
            />
          </label>

          <div className="text-xs text-muted">
            {hasStoredToken && !replaceToken ? (
              <p>
                Tunnel token is saved.{" "}
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => setReplaceToken(true)}
                >
                  Replace token…
                </button>
              </p>
            ) : (
              <label className="block">
                Tunnel run token
                <input
                  type="password"
                  value={tunnelToken}
                  onChange={(e) => setTunnelToken(e.target.value)}
                  autoComplete="off"
                  className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                  disabled={busy}
                />
              </label>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void probeCloudflared()}
              disabled={busy || pathProbeBusy}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-hover disabled:opacity-40"
            >
              Check cloudflared install
            </button>
            <button
              type="button"
              onClick={() => void probeLocalPort()}
              disabled={busy || pathProbeBusy}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-hover disabled:opacity-40"
            >
              Test local port
            </button>
            <button
              type="button"
              onClick={() => void probeTunnelPath()}
              disabled={
                busy ||
                pathProbeBusy ||
                !publicOrigin.trim() ||
                !hasTokenForProbe
              }
              className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent/20 disabled:opacity-40"
            >
              {pathProbeBusy ? "Testing tunnel path…" : "Test tunnel path"}
            </button>
          </div>
          <p className="text-xs text-muted">
            Test tunnel path briefly starts cloudflared and checks your public HTTPS hostname
            (localhost listener → tunnel → Cloudflare). It does not upload a file. Allow up to
            about a minute.
          </p>
          {probeMessage ? <p className="text-xs text-green-400">{probeMessage}</p> : null}
          {portProbeMessage ? <p className="text-xs text-green-400">{portProbeMessage}</p> : null}
          {pathProbeMessage ? (
            <p className="text-xs text-green-400">{pathProbeMessage}</p>
          ) : null}

          <p className="text-xs text-muted">
            Anyone with the session link can upload while that session is open. Use a dedicated
            subdomain and keep the tunnel token secret.
          </p>

          {error ? (
            <p className="whitespace-pre-wrap break-words text-xs text-red-400">{error}</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy || pathProbeBusy}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy || pathProbeBusy}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
