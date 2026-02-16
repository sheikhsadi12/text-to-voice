
export enum AudioMode {
  STUDY = 'STUDY',
  STORY = 'STORY'
}

export interface LibraryItem {
  id: string;
  title: string;
  timestamp: number;
  duration: number; // in seconds
  blob: Blob;
  mode: AudioMode;
  voice: string;
}

export interface AudioState {
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  currentTitle: string;
  currentVoice: string;
}
