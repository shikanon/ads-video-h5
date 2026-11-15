export interface StickerItem {
  id: string;
  name: string;
  action: string;
  durations: number[];
  thumbnailUrl: string;
  previewUrl: string;
}
export interface StickerPack {
  private?: boolean;
  projectId?: string;
  mode?: 'static' | 'dynamic';
  id: string;
  name: string;
  version: string;
  count: number;
  items: StickerItem[];
  defaultSceneIds: string[];
  sampleUrl: string;
  posterUrl: string;
}
export interface StickerTask {
  packId: string;
  title: string;
  makeVideo: boolean;
  bgm: boolean;
  sceneIds: string[];
  captions: string[];
}
export interface StickerDelivery {
  mode?: 'static' | 'dynamic';
  task?: StickerTask;
  packId: string;
  packVersion: string;
  sourceHash: string;
  count: number;
  sceneIds: string[];
  videoId?: string;
  packArtifactId?: string;
  width?: number;
  height?: number;
}

export interface StickerGenerationTask {
  projectId: string;
  phase: 'samples' | 'batch';
  approvalHash?: string;
  makeVideo: boolean;
  bgm: boolean;
}
