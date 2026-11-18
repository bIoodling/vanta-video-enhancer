export type Quality = "balanced" | "high" | "ultra";
export type Scale = "auto" | "1080" | "1440" | "2160";
export interface Settings {
  enabled: boolean;
  quality: Quality;
  scale: Scale;
  skipUltra: boolean;
  compact: boolean;
}
export const defaults: Settings = {
  enabled: false,
  quality: "balanced",
  scale: "auto",
  skipUltra: false,
  compact: false,
};
export function normalize(s: Partial<Settings> = {}): Settings {
  return {
    ...defaults,
    ...s,
    quality: ["balanced", "high", "ultra"].includes(s.quality!)
      ? s.quality!
      : defaults.quality,
    scale: ["auto", "1080", "1440", "2160"].includes(s.scale!)
      ? s.scale!
      : defaults.scale,
  };
}
export const presets = {
  balanced: { radius: 1, sharp: 0.24, denoise: 0.12 },
  high: { radius: 2, sharp: 0.32, denoise: 0.23 },
  ultra: { radius: 3, sharp: 0.36, denoise: 0.32 },
};
export function dimensions(
  w: number,
  h: number,
  scale: Scale,
  limit = 4096,
  factor = 1,
) {
  const target =
    scale === "auto"
      ? Math.min(Math.max(w, h) * 1.5, 2560)
      : (Number(scale) * 16) / 9;
  const ratio =
    Math.min(
      target / Math.max(w, h),
      limit / Math.max(w, h),
      Math.sqrt(8294400 / (w * h)),
    ) * factor;
  return [
    Math.max(2, Math.round(w * ratio)),
    Math.max(2, Math.round(h * ratio)),
  ];
}
export interface Status {
  state: string;
  detail: string;
  width?: number;
  height?: number;
  fps?: number;
  output?: number[];
  backend?: string;
  processingMs?: number;
  gpuMs?: number;
  dropped?: number;
  memoryBytes?: number;
  score?: number;
  id?: string;
}
export interface Stored {
  settings?: Partial<Settings>;
  sites?: Record<string, Settings>;
}
export async function readSettings(site?: string): Promise<Settings> {
  const s = await chrome.storage.local.get<Stored>(["settings", "sites"]);
  return normalize({ ...s.settings, ...(site ? s.sites?.[site] : {}) });
}
