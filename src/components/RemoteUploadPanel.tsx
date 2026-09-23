import { useCallback, useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../lib/tauri";

interface RemoteUploadPanelProps {
  uploadUrl: string | null;
  alternateUrls: string[];
  localhostTestUrl: string | null;
  lanIp?: string | null;
  httpsPort?: number | null;
  httpPort?: number | null;
  serverExePath?: string | null;
  firewallRuleOk?: boolean;
  usingStablePorts?: boolean;
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

function defaultPhoneUrl(urls: string[], lanIp: string | null | undefined): string | null {
  if (urls.length === 0) return null;
  if (lanIp) {
    const hostPrefix = `${lanIp}:`;
    const httpOnPrimary = urls.find(
      (url) => url.startsWith("http://") && url.includes(hostPrefix),
    );
    if (httpOnPrimary) return httpOnPrimary;
  }
  return urls.find((url) => url.startsWith("http://")) ?? urls[0] ?? null;
}

function isPhoneSuggestedUrl(url: string, lanIp: string | null | undefined): boolean {
  if (!url.startsWith("http://")) return false;
  if (!lanIp) return true;
  return url.includes(`${lanIp}:`);
}

const isWindows =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

const WINDOWS_FIREWALL_RULE_NAME = "TrackVault remote upload (session)";
const WINDOWS_FIREWALL_PORTS_RULE_NAME = "TrackVault remote upload ports";

function buildElevatedFirewallPowerShell(
  exePath: string,
  httpsPort: number,
  httpPort: number,
): string {
  const exe = exePath.replace(/'/g, "''");
  const ports = `${httpsPort},${httpPort}`;
  const rule = WINDOWS_FIREWALL_RULE_NAME;
  const portsRule = WINDOWS_FIREWALL_PORTS_RULE_NAME;
  const innerScript = [
    `$rule = '${rule}'`,
    `$portsRule = '${portsRule}'`,
    `$exe = '${exe}'`,
    `$ports = '${ports}'`,
    `$profiles = 'private,public,domain'`,
    `& netsh.exe advfirewall firewall delete rule name="$rule"`,
    `& netsh.exe advfirewall firewall delete rule name="$portsRule"`,
    `& netsh.exe advfirewall firewall add rule name="$rule" dir=in action=allow protocol=TCP localport=$ports program="$exe" enable=yes profile=$profiles`,
    "if ($LASTEXITCODE -ne 0) { exit 1 }",
    `& netsh.exe advfirewall firewall add rule name="$portsRule" dir=in action=allow protocol=TCP localport=$ports enable=yes profile=$profiles`,
    "if ($LASTEXITCODE -ne 0) { exit 1 }",
  ].join("\n");
  return [
    "# One UAC prompt — paste into PowerShell and press Enter",
    "$inner = @'",
    innerScript,
    "'@",
    "Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-Command',$inner)",
  ].join("\n");
}

export function RemoteUploadPanel({
  uploadUrl,
  alternateUrls,
  localhostTestUrl,
  lanIp,
  httpsPort,
  httpPort,
  serverExePath,
  firewallRuleOk = true,
  usingStablePorts = false,
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
  const [firewallSetupMessage, setFirewallSetupMessage] = useState<string | null>(null);
  const [firewallSetupBusy, setFirewallSetupBusy] = useState(false);
  const [firewallManualOk, setFirewallManualOk] = useState(false);
  const [firewallPathWarning, setFirewallPathWarning] = useState<string | null>(null);

  useEffect(() => {
    setSelectedUrl(defaultPhoneUrl(urls, lanIp));
  }, [urls, lanIp]);

  useEffect(() => {
    setFirewallManualOk(false);
    setFirewallSetupMessage(null);
    setFirewallPathWarning(null);
  }, [httpsPort, httpPort, serverExePath]);

  const firewallEffectiveOk = firewallRuleOk || firewallManualOk;

  const canConfigureFirewall =
    isWindows &&
    httpsPort != null &&
    httpPort != null &&
    !!serverExePath &&
    serverExePath.length > 0;

  const copySelectedUrl = useCallback(async () => {
    if (!selectedUrl) return;
    try {
      await navigator.clipboard.writeText(selectedUrl);
    } catch {
      onCopyError?.("Could not copy URL to clipboard.");
    }
  }, [onCopyError, selectedUrl]);

  const openWindowsFirewall = useCallback(async () => {
    try {
      await openUrl("ms-settings:windowsdefender-firewall");
    } catch {
      onCopyError?.("Could not open Windows Firewall settings.");
    }
  }, [onCopyError]);

  const copyFirewallCommand = useCallback(async () => {
    if (!canConfigureFirewall) {
      onCopyError?.("Firewall command is not available yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(
        buildElevatedFirewallPowerShell(serverExePath!, httpsPort!, httpPort!),
      );
    } catch {
      onCopyError?.("Could not copy firewall command to clipboard.");
    }
  }, [canConfigureFirewall, httpPort, httpsPort, onCopyError, serverExePath]);

  const runElevatedFirewallSetup = useCallback(async () => {
    if (!canConfigureFirewall) {
      onCopyError?.("Firewall setup is not available yet.");
      return;
    }
    setFirewallSetupBusy(true);
    setFirewallSetupMessage(null);
    try {
      const result = await api.setupRemoteUploadFirewall(
        serverExePath!,
        httpsPort!,
        httpPort!,
      );
      setFirewallSetupMessage(result.message);
      const pathWarnings: string[] = [];
      if (!result.sessionExePathMatchesListener && result.listeningExePath) {
        pathWarnings.push(
          `This upload session was started under a different .exe than the running process (${result.listeningExePath}). Stop upload and start again, then re-run Administrator setup.`,
        );
      }
      if (
        result.firewallProgramPath &&
        !result.programPathMatchesListener &&
        result.listeningExePath
      ) {
        pathWarnings.push(
          `Firewall program rule uses ${result.firewallProgramPath} but TrackVault is running ${result.listeningExePath}. Phone access uses the port rule "${WINDOWS_FIREWALL_PORTS_RULE_NAME}" and should still work if that rule verified.`,
        );
      }
      if (result.success && result.portsRuleVerified) {
        pathWarnings.push(
          `Port rule verified for HTTPS ${httpsPort} / HTTP ${httpPort} — phone access does not require the program rule path to match.`,
        );
      }
      setFirewallPathWarning(pathWarnings.length > 0 ? pathWarnings.join(" ") : null);
      if (result.success) {
        setFirewallManualOk(true);
      } else {
        onCopyError?.(result.message);
      }
    } catch (err) {
      onCopyError?.(String(err));
    } finally {
      setFirewallSetupBusy(false);
    }
  }, [canConfigureFirewall, httpPort, httpsPort, onCopyError, serverExePath]);

  if (!selectedUrl) return null;

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/40 p-3">
      <p className="font-medium text-foreground">Upload from your phone</p>
      <p className="text-muted">
        Connect the phone to the same Wi‑Fi as this computer. The QR code uses the selected
        address (HTTP is suggested for phones). Scan the code or paste the link in the phone
        browser, then upload{" "}
        {multipleFiles ? "one or more audio files" : "one audio file"}.
        {import.meta.env.DEV && (
          <>
            {" "}
            When running <span className="text-foreground">npm run tauri dev</span>, firewall
            rules must apply to{" "}
            <span className="break-all text-foreground">src-tauri/target/debug/trackvault.exe</span>
            .
          </>
        )}
      </p>
      {(httpsPort != null || httpPort != null || serverExePath) && (
        <div className="rounded-md border border-border/80 bg-background/30 px-2 py-1.5 text-xs text-muted">
          {httpsPort != null && httpPort != null && (
            <p>
              Inbound ports (phone access): HTTPS{" "}
              <span className="text-foreground">{httpsPort}</span>, HTTP{" "}
              <span className="text-foreground">{httpPort}</span>
              {usingStablePorts ? (
                <span className="text-foreground"> (fixed — one Admin setup works across sessions)</span>
              ) : (
                <span> (this session only unless you allow these ports)</span>
              )}
              . The <span className="text-foreground">{WINDOWS_FIREWALL_PORTS_RULE_NAME}</span>{" "}
              rule allows these ports regardless of .exe path.
            </p>
          )}
          {serverExePath && (
            <p className="mt-1 break-all">
              Process when upload started:{" "}
              <span className="text-foreground">{serverExePath}</span>
            </p>
          )}
          {firewallPathWarning && (
            <p className="mt-1 text-amber-200/90">{firewallPathWarning}</p>
          )}
          {isWindows && firewallEffectiveOk && (
            <p className="mt-1 text-foreground/90">
              {firewallManualOk
                ? "Administrator firewall setup completed for Private and Public profiles."
                : "Firewall rule added automatically for this session."}
            </p>
          )}
          {isWindows && firewallSetupMessage && (
            <p
              className={`mt-1 ${firewallManualOk ? "text-foreground/90" : "text-amber-200/90"}`}
            >
              {firewallSetupMessage}
            </p>
          )}
          {isWindows && !firewallEffectiveOk && (
            <div className="mt-2 space-y-2">
              <p className="text-amber-200/90">
                Windows needs an Administrator firewall rule (one UAC prompt — not a second
                “private networks” popup). Rules apply to Private and Public Wi‑Fi profiles.
              </p>
              {canConfigureFirewall && (
                <button
                  type="button"
                  onClick={() => void runElevatedFirewallSetup()}
                  disabled={busy || firewallSetupBusy}
                  className="rounded-md border border-accent bg-accent/10 px-2 py-1 text-xs font-medium text-foreground hover:bg-accent/20 disabled:opacity-40"
                >
                  {firewallSetupBusy
                    ? "Running Administrator setup…"
                    : "Allow phone connections (Administrator)"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer text-foreground">Phone can&apos;t connect?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          <li>Paste the same URL into the phone browser (not only the QR code).</li>
          <li>Use the same Wi‑Fi; turn off cellular data if the page hangs.</li>
          <li>
            Ensure this PC&apos;s network is <span className="text-foreground">Private</span>, not
            Public, in Windows network settings.
          </li>
          {isWindows && canConfigureFirewall && (
            <li className="space-y-1">
              <span>
                <button
                  type="button"
                  onClick={() => void openWindowsFirewall()}
                  className="text-accent hover:underline"
                >
                  Open Windows Firewall settings
                </button>
                {" · "}
                <button
                  type="button"
                  onClick={() => void copyFirewallCommand()}
                  className="text-accent hover:underline"
                >
                  Copy firewall script
                </button>
              </span>
            </li>
          )}
          <li>
            After a phone attempt, check the diagnostics log for{" "}
            <span className="text-foreground">client_connect</span> — if none appears, traffic
            never reached TrackVault.
          </li>
        </ul>
      </details>
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
          level="M"
          aria-label={`Upload URL QR code for ${selectedUrl}`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium text-foreground">Upload address</p>
          <ul className="space-y-1" role="radiogroup" aria-label="Upload addresses">
            {urls.map((url) => {
              const selected = url === selectedUrl;
              const phoneSuggested = isPhoneSuggestedUrl(url, lanIp);
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
                      {phoneSuggested ? (
                        <span className="ml-1 text-muted">(suggested for phone)</span>
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
