import { useEffect, useMemo, useRef, useState } from "react";

import { filterTracksByProjectLibraryQuery } from "../lib/trackSearch";
import { api, type ProjectLibrarySearchHit, type Track } from "../lib/tauri";
import { usePlayerStore } from "../store/playerStore";

const SEARCH_DEBOUNCE_MS = 200;

export function useProjectLibrarySearch(tracks: Track[]) {
  const query = usePlayerStore((state) => state.projectLibrarySearchQuery);
  const setQuery = usePlayerStore((state) => state.setProjectLibrarySearchQuery);
  const [hits, setHits] = useState<ProjectLibrarySearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const requestIdRef = useRef(0);

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0;

  useEffect(() => {
    if (!trimmedQuery) {
      setHits([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setSearchLoading(true);
    const timer = window.setTimeout(() => {
      void api
        .searchProjectLibrary(trimmedQuery)
        .then((results) => {
          if (requestId !== requestIdRef.current) return;
          setHits(results);
          setSearchError(null);
        })
        .catch((error) => {
          if (requestId !== requestIdRef.current) return;
          setHits([]);
          setSearchError(String(error));
        })
        .finally(() => {
          if (requestId !== requestIdRef.current) return;
          setSearchLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const matchingTrackIds = useMemo(
    () => new Set(hits.map((hit) => hit.track_id)),
    [hits],
  );

  const filteredTracks = useMemo(
    () => filterTracksByProjectLibraryQuery(tracks, query, matchingTrackIds),
    [tracks, query, matchingTrackIds],
  );

  return {
    query,
    setQuery,
    hits,
    filteredTracks,
    isSearching,
    searchLoading,
    searchError,
    globalHitCount: hits.length,
  };
}
