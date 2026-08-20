import type { TrackTagInfo } from "../lib/tauri";
import { api } from "../lib/tauri";

const cache = new Map<number, TrackTagInfo>();
const inflight = new Map<number, Promise<TrackTagInfo>>();

export function getCachedTrackTags(trackId: number): TrackTagInfo | undefined {
  return cache.get(trackId);
}

export function invalidateTrackTags(trackId: number): void {
  cache.delete(trackId);
  inflight.delete(trackId);
}

export function clearTrackTagsCache(): void {
  cache.clear();
  inflight.clear();
}

export async function fetchTrackTags(trackId: number): Promise<TrackTagInfo> {
  const cached = cache.get(trackId);
  if (cached) return cached;

  const pending = inflight.get(trackId);
  if (pending) return pending;

  const request = api.getTrackTags(trackId).then((info) => {
    cache.set(trackId, info);
    inflight.delete(trackId);
    return info;
  });

  inflight.set(trackId, request);
  return request;
}
