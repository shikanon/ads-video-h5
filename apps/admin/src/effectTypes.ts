export type EffectValues = { eyebrow: string; title: string; subtitle: string; imageUrl?: string; videoUrl?: string; assetId?: string; accent: string };
export type HtmlEffect = { id: string; name: string; description: string; html: string; duration: number; width: number; height: number; enabled: boolean; defaults: EffectValues; createdAt: string; updatedAt: string };
export type EffectRender = { id: string; effectId: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; error?: string; downloadUrl?: string };
export type EffectAsset = { id: string; name: string; kind: 'image' | 'video'; size: number; createdAt: string };
export type Playback = { playing: boolean; revision: number };
