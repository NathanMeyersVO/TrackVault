import { useCallback, useEffect, useRef, useState } from "react";

import { listen } from "@tauri-apps/api/event";

import { openPath } from "@tauri-apps/plugin-opener";



import { ConfirmDialog } from "./ConfirmDialog";

import { RemoteUploadPanel } from "./RemoteUploadPanel";

import { api } from "../lib/tauri";

import {

  fileNameFromPath,

  formatCollectionConflictMessage,

  formatLibraryConflictMessage,

  formatUploadResult,

} from "../lib/uploadFeedback";

import { useLibrary } from "../hooks/usePlayer";

import { usePlayerStore } from "../store/playerStore";



export type UploadTracksPhoneMode = "library" | "collection";



interface UploadTracksPhoneSectionProps {

  mode: UploadTracksPhoneMode;

  collectionId?: number;

  collectionName?: string | null;

  enabled: boolean;

  onUploaded: (message: string) => void;

  onBusyChange?: (busy: boolean) => void;

}



function pathsKey(paths: string[]): string {

  return paths.join("\0");

}



export function UploadTracksPhoneSection({

  mode,

  collectionId,

  collectionName,

  enabled,

  onUploaded,

  onBusyChange,

}: UploadTracksPhoneSectionProps) {

  const { refresh } = useLibrary();

  const setScanning = usePlayerStore((state) => state.setScanning);

  const [sourcePaths, setSourcePaths] = useState<string[]>([]);

  const [remoteUploadUrl, setRemoteUploadUrl] = useState<string | null>(null);

  const [remoteWaiting, setRemoteWaiting] = useState(false);

  const [remoteStarting, setRemoteStarting] = useState(false);

  const [remoteLogPath, setRemoteLogPath] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);

  const [pendingImport, setPendingImport] = useState<{

    sourcePaths: string[];

    conflicts: string[];

  } | null>(null);

  const effectGeneration = useRef(0);

  const startedRef = useRef(false);

  const lastAutoImportKeyRef = useRef("");



  const runRemoteStart = useCallback(

    async (generation: number) => {

      setError(null);

      setRemoteStarting(true);

      try {

        const info =

          mode === "library"

            ? await api.startLibraryRemoteUpload()

            : await api.startCollectionRemoteUpload(collectionId!);

        if (effectGeneration.current !== generation) return;

        setRemoteUploadUrl(info.uploadUrl);

        setRemoteLogPath(info.logFilePath);

        setRemoteWaiting(true);

      } catch (err) {

        if (effectGeneration.current !== generation) return;

        setRemoteUploadUrl(null);

        setRemoteLogPath(null);

        setRemoteWaiting(false);

        setError(String(err));

      } finally {

        if (effectGeneration.current === generation) {

          setRemoteStarting(false);

        }

      }

    },

    [collectionId, mode],

  );



  const retryRemoteStart = useCallback(() => {

    const generation = ++effectGeneration.current;

    void runRemoteStart(generation);

  }, [runRemoteStart]);



  useEffect(() => {

    if (!enabled) {

      effectGeneration.current += 1;

      startedRef.current = false;

      setSourcePaths([]);

      setRemoteUploadUrl(null);

      setRemoteWaiting(false);

      setRemoteStarting(false);

      setError(null);

      lastAutoImportKeyRef.current = "";

      return;

    }

    if (startedRef.current) return;

    startedRef.current = true;

    const generation = ++effectGeneration.current;

    void runRemoteStart(generation);

  }, [enabled, runRemoteStart]);



  useEffect(() => {

    if (!enabled) return;

    void api.getReplaceRemoteUploadLogPath().then(setRemoteLogPath).catch(() => {});

  }, [enabled]);



  useEffect(() => {

    if (!enabled) return;

    let cancelled = false;

    const unlistenPromise = listen<{

      mode: string;

      collectionId: number | null;

      sourcePaths: string[];

    }>("remote-import-upload-updated", (event) => {

      if (cancelled) return;

      if (event.payload.mode !== mode) return;

      if (

        mode === "collection" &&

        collectionId != null &&

        event.payload.collectionId !== collectionId

      ) {

        return;

      }

      setSourcePaths(event.payload.sourcePaths);

      setError(null);

    });

    return () => {

      cancelled = true;

      void unlistenPromise.then((unlisten) => unlisten());

    };

  }, [collectionId, enabled, mode]);



  useEffect(() => {

    if (!enabled || !remoteWaiting) return;



    const interval = window.setInterval(() => {

      void api.getReplaceRemoteUploadStatus().then((status) => {

        if (status.sourcePaths.length > 0) {

          setSourcePaths(status.sourcePaths);

        }

        if (status.status === "failed" && status.error) {

          setError(status.error);

          setRemoteWaiting(false);

        }

        if (status.status === "expired") {

          setError(status.error ?? "Upload session expired.");

          setRemoteWaiting(false);

        }

      });

    }, 2000);



    return () => window.clearInterval(interval);

  }, [enabled, remoteWaiting]);



  const openLogsFolder = useCallback(async () => {

    try {

      const dir = await api.getReplaceRemoteUploadLogsDir();

      await openPath(dir);

    } catch {

      setError("Could not open the diagnostics log folder.");

    }

  }, []);



  const runImport = useCallback(

    async (paths: string[], overwrite: boolean) => {

      setImporting(true);

      setScanning(true);

      setError(null);

      try {

        const result =

          mode === "library"

            ? await api.uploadTracks(paths, overwrite)

            : await api.uploadCollectionTracks(collectionId!, paths, overwrite);

        await refresh();

        const message = formatUploadResult(result);

        if (result.errors.length > 0 && result.uploaded === 0) {

          setError(message);

          lastAutoImportKeyRef.current = "";

          return;

        }

        lastAutoImportKeyRef.current = pathsKey(paths);

        void api.stopReplaceRemoteUpload();

        onUploaded(message);

      } catch (err) {

        setError(String(err));

        lastAutoImportKeyRef.current = "";

      } finally {

        setImporting(false);

        setScanning(false);

      }

    },

    [collectionId, mode, onUploaded, refresh, setScanning],

  );



  const startImportForPaths = useCallback(

    async (paths: string[]) => {

      if (paths.length === 0) return;

      setError(null);

      try {

        const conflicts =

          mode === "library"

            ? await api.checkUploadConflicts(paths)

            : await api.checkCollectionUploadConflicts(collectionId!, paths);

        if (conflicts.length > 0) {

          setPendingImport({ sourcePaths: paths, conflicts });

          return;

        }

        await runImport(paths, false);

      } catch (err) {

        setError(String(err));

        lastAutoImportKeyRef.current = "";

      }

    },

    [collectionId, mode, runImport],

  );



  useEffect(() => {

    if (!enabled || sourcePaths.length === 0 || importing || pendingImport) return;



    const key = pathsKey(sourcePaths);

    if (key === lastAutoImportKeyRef.current) return;



    lastAutoImportKeyRef.current = key;

    void startImportForPaths(sourcePaths);

  }, [enabled, importing, pendingImport, sourcePaths, startImportForPaths]);



  const actionsBusy = remoteStarting || importing;



  useEffect(() => {

    onBusyChange?.(actionsBusy);

  }, [actionsBusy, onBusyChange]);



  const importingLabel =

    mode === "library"

      ? `Adding ${sourcePaths.length} file${sourcePaths.length === 1 ? "" : "s"} to project library…`

      : `Adding ${sourcePaths.length} file${sourcePaths.length === 1 ? "" : "s"} to collection…`;



  if (!enabled) return null;



  return (

    <>

      <div className="space-y-3 text-sm text-foreground">

        <p className="text-xs text-muted">

          Send tracks from your phone. Files are added to{" "}

          {mode === "library" ? "your project library" : "this collection"} automatically after upload.

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

          waiting={remoteWaiting && sourcePaths.length === 0 && !importing}

          busy={actionsBusy}

          multipleFiles

          destinationHint={

            mode === "library"

              ? "Uploading to your project library"

              : collectionName

                ? `Uploading to collection “${collectionName}”`

                : "Uploading to collection"

          }

          onCopyError={setError}

        />

        {importing && sourcePaths.length > 0 && (

          <p className="text-muted">{importingLabel}</p>

        )}

        {sourcePaths.length > 0 && !importing && (

          <div className="rounded-md border border-border bg-background/40 p-3">

            <p className="mb-2 font-medium text-foreground">

              Received ({sourcePaths.length})

            </p>

            <ul className="max-h-40 list-inside list-disc overflow-y-auto text-xs text-muted">

              {sourcePaths.map((path) => (

                <li key={path} className="break-all">

                  {fileNameFromPath(path)}

                </li>

              ))}

            </ul>

          </div>

        )}

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



      {pendingImport ? (

        <ConfirmDialog

          title="Replace existing files?"

          message={

            mode === "library"

              ? formatLibraryConflictMessage(pendingImport.conflicts)

              : formatCollectionConflictMessage(pendingImport.conflicts)

          }

          confirmLabel="Overwrite"

          secondaryLabel="Keep both"

          cancelLabel="Cancel"

          destructive

          busy={importing}

          onConfirm={() => {

            const { sourcePaths: paths } = pendingImport;

            setPendingImport(null);

            lastAutoImportKeyRef.current = pathsKey(paths);

            void runImport(paths, true);

          }}

          onSecondary={() => {

            const { sourcePaths: paths } = pendingImport;

            setPendingImport(null);

            lastAutoImportKeyRef.current = pathsKey(paths);

            void runImport(paths, false);

          }}

          onCancel={() => {

            if (importing) return;

            setPendingImport(null);

            lastAutoImportKeyRef.current = "";

          }}

        />

      ) : null}

    </>

  );

}

