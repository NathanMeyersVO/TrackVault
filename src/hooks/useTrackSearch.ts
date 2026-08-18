import { useMemo, useState } from "react";

import { filterTracksByTitle } from "../lib/trackSearch";
import type { Track } from "../lib/tauri";

export function useTrackSearch(tracks: Track[]) {
  const [query, setQuery] = useState("");

  const filteredTracks = useMemo(
    () => filterTracksByTitle(tracks, query),
    [tracks, query],
  );

  const isSearching = query.trim().length > 0;

  return { query, setQuery, filteredTracks, isSearching };
}
