import { useCallback, useState, type KeyboardEvent } from "react";

import {
  formatProjectSearchHit,
  useProjectSearchNavigation,
} from "../hooks/useProjectSearchNavigation";
import type { ProjectSearchHit } from "../lib/tauri";
import { TrackSearchInput } from "./TrackSearchInput";

interface ProjectSearchPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  hits: ProjectSearchHit[];
  isSearching: boolean;
  searchLoading: boolean;
  searchError: string | null;
}

export function ProjectSearchPanel({
  query,
  onQueryChange,
  hits,
  isSearching,
  searchLoading,
  searchError,
}: ProjectSearchPanelProps) {
  const { navigateToHit } = useProjectSearchNavigation();
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const handleQueryChange = useCallback(
    (value: string) => {
      setHighlightIndex(-1);
      onQueryChange(value);
    },
    [onQueryChange],
  );

  const selectHit = useCallback(
    (hit: ProjectSearchHit) => {
      setHighlightIndex(-1);
      navigateToHit(hit);
    },
    [navigateToHit],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isSearching || hits.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((current) => Math.min(current + 1, hits.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && highlightIndex >= 0) {
      event.preventDefault();
      const hit = hits[highlightIndex];
      if (hit) selectHit(hit);
    }
  };

  return (
    <div className="relative">
      <TrackSearchInput
        value={query}
        onChange={handleQueryChange}
        onKeyDown={handleKeyDown}
      />
      {isSearching ? (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {searchLoading ? (
            <p className="px-3 py-2 text-xs text-muted">Searching…</p>
          ) : searchError ? (
            <p className="px-3 py-2 text-xs text-red-400">{searchError}</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No matches in project taglists.</p>
          ) : (
            <ul className="py-1" role="listbox">
              {hits.map((hit, index) => {
                const { primary, secondary } = formatProjectSearchHit(hit);
                const active = index === highlightIndex;
                return (
                  <li key={`${hit.taglist_id}-${hit.partition_value ?? "none"}-${hit.track_id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-surface-hover ${
                        active ? "bg-surface-hover" : ""
                      }`}
                      onMouseEnter={() => setHighlightIndex(index)}
                      onClick={() => selectHit(hit)}
                    >
                      <span className="truncate font-medium text-foreground">{primary}</span>
                      <span className="truncate text-xs text-muted">{secondary}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
