import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

interface RemoteUploadPanelProps {
  uploadUrl: string | null;
  waiting: boolean;
  busy: boolean;
  multipleFiles?: boolean;
  destinationHint?: string | null;
  onCopyError?: (message: string) => void;
}

export function RemoteUploadPanel({
  uploadUrl,
  waiting,
  busy,
  multipleFiles = false,
  destinationHint = null,
  onCopyError,
}: RemoteUploadPanelProps) {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);

  useEffect(() => {
    setSelectedUrl(uploadUrl);
  }, [uploadUrl]);

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
      {destinationHint ? (
        <p className="text-sm text-foreground">{destinationHint}</p>
      ) : null}
      <p className="text-muted">
        Scan the QR code or open the link on your phone (Wi‑Fi or cellular). Upload{" "}
        {multipleFiles ? "one or more audio files" : "one audio file"}. This link works only for
        this session — do not share it publicly.
      </p>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <QRCodeSVG
          value={selectedUrl}
          size={160}
          level="M"
          aria-label={`Upload URL QR code for ${selectedUrl}`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium text-foreground">Session link</p>
          <p className="break-all text-xs text-foreground">{selectedUrl}</p>
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
      {waiting && <p className="text-muted">Waiting for upload…</p>}
    </div>
  );
}
