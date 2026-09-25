import { useEffect } from "react";
import { AppMenuBar } from "./components/AppMenuBar";
import { Sidebar } from "./components/Sidebar";
import { SidebarResizeHandle } from "./components/SidebarResizeHandle";
import { ProjectTracksView } from "./components/ProjectTracksView";
import { PlaylistView } from "./components/PlaylistView";
import { TaglistView } from "./components/TaglistView";
import { CollectionView } from "./components/CollectionView";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { AudioCacheBanner } from "./components/AudioCacheBanner";
import { DeliveryBusyOverlay } from "./components/DeliveryBusyOverlay";
import { useProject, usePlayer } from "./hooks/usePlayer";
import { initPlayerController } from "./playerController";
import { useSidebarWidth } from "./hooks/useSidebarWidth";
import { useTrackCursor } from "./hooks/useTrackCursor";
import { getDeliveryCopy } from "./lib/applicationConfig";
import {
  archiveExportPercent,
  archiveExportTitle,
  formatArchiveExportDetail,
} from "./lib/archiveExportProgress";
import {
  formatProjectLoadProgressDetail,
  projectLoadProgressPercent,
} from "./lib/projectLoadProgress";
import { usePlayerStore, type View } from "./store/playerStore";

function isPlaylistView(view: View): view is { playlistId: number } {
  return typeof view === "object" && "playlistId" in view;
}

function isTaglistView(
  view: View,
): view is { taglistId: number; value: string | null } {
  return typeof view === "object" && "taglistId" in view;
}

function isCollectionView(view: View): view is { collectionId: number } {
  return typeof view === "object" && "collectionId" in view;
}

function MainContent() {
  const { view, tracks, activeProject } = usePlayerStore();
  const deliveryCopy = getDeliveryCopy(activeProject?.application_id);
  useProject();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <AudioCacheBanner />
      <div className="min-h-0 flex-1">
        {view === "project_tracks" ? (
          <ProjectTracksView />
        ) : isCollectionView(view) ? (
          <CollectionView collectionId={view.collectionId} />
        ) : isTaglistView(view) ? (
          <TaglistView taglistId={view.taglistId} value={view.value} />
        ) : isPlaylistView(view) ? (
          <PlaylistView playlistId={view.playlistId} />
        ) : null}
      </div>

      {view === "project_tracks" && tracks.length === 0 && (
        <div className="border-t border-border px-4 py-2 text-xs text-muted">
          {deliveryCopy.appEmptyTracksFooter}
        </div>
      )}
    </main>
  );
}

export default function App() {
  const deliveryStaging = usePlayerStore((state) => state.deliveryStaging);
  const deliveryProgress = usePlayerStore((state) => state.deliveryProgress);
  const deliveryStagingApplicationId = usePlayerStore(
    (state) => state.deliveryStagingApplicationId,
  );
  const projectLoadChecked = usePlayerStore((state) => state.projectLoadChecked);
  const projectLoadProgress = usePlayerStore((state) => state.projectLoadProgress);
  const archiveExportProgress = usePlayerStore((state) => state.archiveExportProgress);
  const activeProject = usePlayerStore((state) => state.activeProject);
  const stagingTitle = getDeliveryCopy(
    deliveryStagingApplicationId ?? activeProject?.application_id,
  ).stagingBusyTitle;
  const projectLoadActive =
    projectLoadProgress != null && !projectLoadProgress.finished;
  const archiveExportActive =
    archiveExportProgress != null && !archiveExportProgress.finished;
  const showProjectLoad =
    !deliveryStaging && !archiveExportActive && (!projectLoadChecked || projectLoadActive);
  const projectLoadTitle =
    projectLoadActive && projectLoadProgress.project_name
      ? `Loading ${projectLoadProgress.project_name}`
      : "Loading project…";

  useEffect(() => {
    initPlayerController();
  }, []);

  const { selectTrack, playTrack, togglePlayPause, adjustVolume, seekToStart, seekToEnd } = usePlayer();
  const { width: sidebarWidth, onResizeStart } = useSidebarWidth();
  const setDraggingTrackId = usePlayerStore((state) => state.setDraggingTrackId);
  useTrackCursor({
    onSelectTrack: selectTrack,
    onPlayTrack: playTrack,
    onTogglePlayPause: togglePlayPause,
    onAdjustVolume: adjustVolume,
    seekToStart,
    seekToEnd,
  });

  useEffect(() => {
    const clearDragState = () => {
      setDraggingTrackId(null);
    };
    window.addEventListener("dragend", clearDragState);
    return () => window.removeEventListener("dragend", clearDragState);
  }, [setDraggingTrackId]);

  return (
    <div className="flex h-full flex-col">
      {deliveryStaging ? (
        <DeliveryBusyOverlay title={stagingTitle} progress={deliveryProgress} />
      ) : archiveExportActive && archiveExportProgress ? (
        <DeliveryBusyOverlay
          title={archiveExportTitle(archiveExportProgress)}
          detail={formatArchiveExportDetail(archiveExportProgress)}
          percent={archiveExportPercent(archiveExportProgress)}
        />
      ) : showProjectLoad ? (
        <DeliveryBusyOverlay
          title={projectLoadTitle}
          detail={
            projectLoadActive
              ? formatProjectLoadProgressDetail(projectLoadProgress)
              : undefined
          }
          percent={
            projectLoadActive ? projectLoadProgressPercent(projectLoadProgress) : null
          }
        />
      ) : null}
      <AppMenuBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar width={sidebarWidth} />
        <SidebarResizeHandle width={sidebarWidth} onResizeStart={onResizeStart} />
        <MainContent />
      </div>
      <NowPlayingBar />
    </div>
  );
}
