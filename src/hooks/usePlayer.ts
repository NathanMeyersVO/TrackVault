import { useCallback, useEffect } from "react";

import { listen } from "@tauri-apps/api/event";



import { api } from "../lib/tauri";

import { playerController } from "../playerController";

import { usePlayerStore } from "../store/playerStore";



export function useLibrary() {

  const { setTracks, setPlaylists, setTaglists, setScanning, setLibraryFolder } =

    usePlayerStore();



  const refresh = useCallback(async () => {

    const [tracks, playlists, taglists, libraryFolder] = await Promise.all([

      api.listTracks(),

      api.listPlaylists(),

      api.listTaglists(),

      api.getLibraryFolder(),

    ]);

    setTracks(tracks);

    setPlaylists(playlists);

    setTaglists(taglists);

    setLibraryFolder(libraryFolder);

  }, [setTracks, setPlaylists, setTaglists, setLibraryFolder]);



  useEffect(() => {

    refresh().catch(console.error);



    const unlisten = listen("library-updated", () => {

      refresh().catch(console.error);

    });



    return () => {

      unlisten.then((fn) => fn());

    };

  }, [refresh]);



  const scanLibrary = useCallback(async () => {

    setScanning(true);

    try {

      await api.scanLibrary();

      await refresh();

    } finally {

      setScanning(false);

    }

  }, [refresh, setScanning]);



  return { refresh, scanLibrary };

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


