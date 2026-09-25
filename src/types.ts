export type Format = '9:16' | '16:9' | '1:1';
export type MediaKind = 'video' | 'image' | 'audio';
export type ArtifactKind = 'image' | 'audio' | 'video';
export type JobKind = 'plan' | 'image' | 'audio' | 'export';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type ModelKind = 'text' | 'image' | 'audio';

export interface Shot {
  start: number;
  end: number;
  thumbnailUrl: string;
}

export interface MediaItem {
  id: string;
  name: string;
  mimeType: string;
  kind: MediaKind;
  duration?: number;
  shots?: Shot[];
  url: string;
  createdAt: string;
  origin?: 'upload' | 'generated';
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
  version?: number;
  coverMediaId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  attachmentIds?: string[];
  artifactIds?: string[];
  jobId?: string;
}

export interface Artifact {
  id: string;
  sessionId: string;
  messageId: string;
  kind: ArtifactKind;
  name: string;
  url: string;
  downloadUrl: string;
  createdAt: string;
  version: number;
  text?: string;
  duration?: number;
  format?: Format;
  mediaId?: string;
  plan?: EditPlan;
  hasNarration?: boolean;
  hasBgm?: boolean;
  coverUrl?: string;
  coverMimeType?: string;
}

export interface Job {
  id: string;
  sessionId: string;
  messageId: string;
  kind: JobKind;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  progress?: number;
  error?: string;
  artifactId?: string;
}

export interface Session {
  id: string;
  title: string;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  plan: EditPlan | null;
}

export interface PublicModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  kind: ModelKind;
  enabled: boolean;
}

export interface AppSettings {
  defaultModelId: string | null;
  language: 'zh-CN' | 'en-US';
  chatBackground: string | null;
}

export interface AppState {
  activeSessionId: string;
  sessions: Session[];
  media: MediaItem[];
  artifacts: Artifact[];
  jobs: Job[];
  settings: AppSettings;
  models: PublicModel[];
  mode: 'pi' | 'unconfigured';
}
