import { useCallback, useEffect } from "react";

import { listen } from "@tauri-apps/api/event";



import {
  api,
  type ArchiveExportProgress,
  type AudioCacheProgress,
  type DeliveryProgress,
  type ProjectLoadProgress,
} from "../lib/tauri";

import { playerController } from "../playerController";

import { usePlayerStore } from "../store/playerStore";



export function useProject() {

  const {
    setTracks,
    setPlaylists,
    setTaglists,
    setCollections,
    setProjectFolder,
    setActiveProject,
    setProjectScanProgress,
    setDeliveryProgress,
    setArchiveExportProgress,
    setProjectLoadProgress,
    markProjectLoadChecked,
  } = usePlayerStore();



  const refresh = useCallback(async () => {

    const [tracks, playlists, taglists, collections, projectFolder, activeProject] =
      await Promise.all([
        api.listTracks(),
        api.listPlaylists(),
        api.listTaglists(),
        api.listCollections(),
        api.getProjectFolder(),
        api.getActiveProject(),
      ]);

    setTracks(tracks);
    setPlaylists(playlists);
    setTaglists(taglists);
    setCollections(collections);
    setProjectFolder(projectFolder);
    setActiveProject(activeProject);

  }, [
    setTracks,
    setPlaylists,
    setTaglists,
    setCollections,
    setProjectFolder,
    setActiveProject,
  ]);



  useEffect(() => {

    refresh().catch(console.error);



    const unlisten = listen("project-updated", () => {

      refresh().catch(console.error);

    });



    return () => {

      unlisten.then((fn) => fn());

    };

  }, [refresh]);



  useEffect(() => {
    let cancelled = false;
    api
      .getProjectLoadProgress()
      .then((progress) => {
        if (!cancelled) {
          markProjectLoadChecked(progress);
        }
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) {
          markProjectLoadChecked(null);
        }
      });

    const unlisten = listen<ProjectLoadProgress>("project-load-progress", (event) => {
      setProjectLoadProgress(event.payload);
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, [markProjectLoadChecked, setProjectLoadProgress]);

  useEffect(() => {

    const unlisten = listen<AudioCacheProgress>("project-scan-progress", (event) => {

      setProjectScanProgress(event.payload);

    });



    return () => {

      unlisten.then((fn) => fn());

    };

  }, [setProjectScanProgress]);



  useEffect(() => {

    const unlisten = listen<DeliveryProgress>("delivery-progress", (event) => {

      setDeliveryProgress(event.payload);

    });



    return () => {

      unlisten.then((fn) => fn());

    };

  }, [setDeliveryProgress]);

  useEffect(() => {
    const unlisten = listen<ArchiveExportProgress>("archive-export-progress", (event) => {
      if (event.payload.finished) {
        setArchiveExportProgress(null);
      } else {
        setArchiveExportProgress(event.payload);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setArchiveExportProgress]);

  return { refresh };

}



export const VOLUME_STEP = 0.05;



export function usePlayer() {

  const { playback, cursorTrackId } = usePlayerStore();



  return {

    playback,

    playTrack: playerController.playTrack,

    selectTrack: playerController.selectTrack,

    togglePlayPause: playerController.togglePlayPause,

    setVolume: playerController.setVolume,

    adjustVolume: playerController.adjustVolume,

    seek: playerController.seek,

    stop: playerController.stop,

    seekToStart: playerController.seekToStart,

    seekToEnd: playerController.seekToEnd,

    cursorTrackId,

  };

}


