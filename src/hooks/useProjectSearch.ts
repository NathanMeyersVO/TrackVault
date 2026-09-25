import { useEffect, useRef, useState } from "react";

import { api, type ProjectSearchHit } from "../lib/tauri";
import { usePlayerStore } from "../store/playerStore";

const SEARCH_DEBOUNCE_MS = 200;

export function useProjectSearch() {
  const query = usePlayerStore((state) => state.projectSearchQuery);
  const setQuery = usePlayerStore((state) => state.setProjectSearchQuery);
  const [hits, setHits] = useState<ProjectSearchHit[]>([]);
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
        .searchProject(trimmedQuery)
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

  return {
    query,
    setQuery,
    hits,
    isSearching,
    searchLoading,
    searchError,
    globalHitCount: hits.length,
  };
}
