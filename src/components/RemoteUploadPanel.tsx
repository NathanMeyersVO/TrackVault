import { QRCodeSVG } from "qrcode.react";

interface RemoteUploadPanelProps {
  uploadUrl: string | null;
  alternateUrls: string[];
  localhostTestUrl: string | null;
  waiting: boolean;
  busy: boolean;
  multipleFiles?: boolean;
  onCopyUrl: () => void;
}

export function RemoteUploadPanel({
  uploadUrl,
  alternateUrls,
  localhostTestUrl,
  waiting,
  busy,
  multipleFiles = false,
  onCopyUrl,
}: RemoteUploadPanelProps) {
  if (!uploadUrl) return null;

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/40 p-3">
      <p className="font-medium text-foreground">Upload from your phone</p>
      <p className="text-muted">
        Connect the phone to the same Wi‑Fi as this computer. Scan the code or open the link,
        accept the certificate warning, then upload{" "}
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
        <QRCodeSVG value={uploadUrl} size={160} aria-label="Upload URL QR code" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="break-all text-xs text-foreground">{uploadUrl}</p>
          <button
            type="button"
            onClick={onCopyUrl}
            disabled={busy}
            className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-surface-hover disabled:opacity-40"
          >
            Copy link
          </button>
          {alternateUrls.length > 0 && (
            <div className="space-y-1 pt-1">
              <p className="text-xs text-muted">If the QR does not connect, try:</p>
              <ul className="list-inside list-disc text-xs text-foreground">
                {alternateUrls.map((url) => (
                  <li key={url} className="break-all">
                    {url}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {waiting && (
        <p className="text-muted">Server is ready. Waiting for upload…</p>
      )}
    </div>
  );
}
