/** Contracts between the track pipeline and outside services. */

export interface DeezerTrack {
  deezerId: number;
  title: string;
  artists: string[];
  durationMs: number;
  artworkUrl: string | null;
  /** Deezer's own BPM; null when Deezer reports 0 (most tracks). */
  bpm: number | null;
  /** Signed, short-lived URL: use immediately, never store. */
  previewUrl: string | null;
  genres: string[];
}

export interface DeezerSource {
  /** null = Deezer has no track for this ISRC. */
  byIsrc(isrc: string): Promise<DeezerTrack | null>;
}

export interface ReccoBeatsFeatures {
  tempo: number | null;
  energy: number | null;
  danceability: number | null;
}

export interface ReccoBeatsSource {
  /** Tracks ReccoBeats doesn't know are absent from the map. */
  audioFeatures(spotifyIds: string[]): Promise<Map<string, ReccoBeatsFeatures>>;
}

export interface PreviewSearch {
  /** Fallback preview when Deezer has none. */
  findPreview(artist: string, title: string): Promise<string | null>;
}

export interface AnalyzerFeatures {
  bpm: number;
  bpmConfidence: number;
  energy: number;
  danceability: number;
  key: string;
  scale: "major" | "minor";
}

export interface Analyzer {
  /** Downloads and analyzes the preview in memory (step 3 service). */
  analyze(previewUrl: string): Promise<AnalyzerFeatures>;
}

export interface TrackSources {
  deezer: DeezerSource;
  reccobeats: ReccoBeatsSource;
  previews: PreviewSearch;
  analyzer: Analyzer;
}
