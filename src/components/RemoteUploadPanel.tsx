import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface RemoteUploadPanelProps {
  uploadUrl: string | null;
  alternateUrls: string[];
  localhostTestUrl: string | null;
  waiting: boolean;
  busy: boolean;
  multipleFiles?: boolean;
  onCopyError?: (message: string) => void;
}

function buildUploadUrlList(
  uploadUrl: string | null,
  alternateUrls: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of [uploadUrl, ...alternateUrls]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function RemoteUploadPanel({
  uploadUrl,
  alternateUrls,
  localhostTestUrl,
  waiting,
  busy,
  multipleFiles = false,
  onCopyError,
}: RemoteUploadPanelProps) {
  const urls = useMemo(
    () => buildUploadUrlList(uploadUrl, alternateUrls),
    [uploadUrl, alternateUrls],
  );
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  useEffect(() => {
    setSelectedUrl(urls[0] ?? null);
  }, [urls]);

  const copySelectedUrl = useCallback(async () => {
    if (!selectedUrl) return;
    try {
      await navigator.clipboard.writeText(selectedUrl);
    } catch {
      onCopyError?.("Could not copy URL to clipboard.");
    }
  }, [onCopyError, selectedUrl]);

  if (!selectedUrl) return null;

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/40 p-3">
      <p className="font-medium text-foreground">Upload from your phone</p>
      <p className="text-muted">
        Connect the phone to the same Wi‑Fi as this computer. Choose an address below, scan the
        code or open the link, accept the certificate warning, then upload{" "}
        {multipleFiles ? "one or more audio files" : "one audio file"}. Windows may ask to allow
        TrackVault on private networks the first time.
        {import.meta.env.DEV && (
          <>
            {" "}
            When running <span className="text-foreground">npm run tauri dev</span>, allow{" "}
            <span className="break-all text-foreground">src-tauri/target/debug/trackvault.exe</span>{" "}
            — not a different install path.
          </>
        )}
      </p>
      {localhostTestUrl && (
        <p className="text-xs text-muted">
          Test on this PC:{" "}
          <a
            href={localhostTestUrl}
            className="break-all text-accent hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            {localhostTestUrl}
          </a>
        </p>
      )}
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <QRCodeSVG
          value={selectedUrl}
          size={160}
          aria-label={`Upload URL QR code for ${selectedUrl}`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium text-foreground">Upload address</p>
          <ul className="space-y-1" role="radiogroup" aria-label="Upload addresses">
            {urls.map((url, index) => {
              const selected = url === selectedUrl;
              return (
                <li key={url}>
                  <label
                    className={`flex cursor-pointer gap-2 rounded-md border px-2 py-1.5 text-xs ${
                      selected
                        ? "border-accent bg-surface-hover/60"
                        : "border-border hover:bg-surface-hover/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="remote-upload-url"
                      checked={selected}
                      onChange={() => setSelectedUrl(url)}
                      disabled={busy}
                      className="mt-0.5 shrink-0"
                    />
                    <span className="min-w-0 break-all text-foreground">
                      {url}
                      {index === 0 && urls.length > 1 ? (
                        <span className="ml-1 text-muted">(suggested)</span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => void copySelectedUrl()}
            disabled={busy}
            className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-surface-hover disabled:opacity-40"
          >
            Copy link
          </button>
        </div>
      </div>
      {waiting && (
        <p className="text-muted">Server is ready. Waiting for upload…</p>
      )}
    </div>
  );
}
