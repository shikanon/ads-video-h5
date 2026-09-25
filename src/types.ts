export type Format = '9:16' | '16:9' | '1:1';

export interface MediaItem {
  id: string;
  name: string;
  mimeType: string;
  duration: number;
  url: string;
}

export interface EditClip {
  sourceId: string;
  start: number;
  end: number;
}

export interface EditPlan {
  format: Format;
  targetSeconds: number;
  summary: string;
  clips: EditClip[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface ProjectState {
  media: MediaItem[];
  messages: ChatMessage[];
  plan: EditPlan | null;
  exportId: string | null;
  mode: 'pi' | 'demo';
}
