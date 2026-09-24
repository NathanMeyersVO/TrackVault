export const AUDIO_EXTENSIONS = [
  "mp3",
  "flac",
  "wav",
  "ogg",
  "m4a",
  "aac",
  "mp4",
  "aiff",
] as const;

export function isAudioFilePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = path.slice(dot + 1).toLowerCase();
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

export function filterAudioPaths(paths: string[]): string[] {
  return paths.filter(isAudioFilePath);
}

export const AUDIO_FILE_DIALOG_FILTER = {
  name: "Audio",
  extensions: [...AUDIO_EXTENSIONS] as string[],
};
