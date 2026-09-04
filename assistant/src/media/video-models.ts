/**
 * Single source of truth for the video generation model catalog.
 *
 * Concrete model IDs change as providers ship new versions. Everything that
 * needs a video model name (service default, skill executor, error messages)
 * imports from here so a version bump is a one-line change. This module is
 * intentionally dependency-free so the config schema layer can import it
 * without cycles.
 */

export type VideoModelProvider = "xai";

export interface VideoModelEntry {
  /** Concrete provider model ID sent on the API request. */
  id: string;
  provider: VideoModelProvider;
  /** Human-readable label for help text and error messages. */
  label: string;
}

export const VIDEO_MODELS: readonly VideoModelEntry[] = [
  {
    id: "grok-imagine-video",
    provider: "xai",
    label: "Grok Imagine Video",
  },
] as const;

export const DEFAULT_VIDEO_MODEL = VIDEO_MODELS[0].id;

/**
 * Resolve a model input (concrete ID) to a registry entry. Returns undefined
 * for unknown values so callers can produce an error that lists the
 * currently available models.
 */
export function resolveVideoModel(model: string): VideoModelEntry | undefined {
  return VIDEO_MODELS.find((m) => m.id === model);
}

/**
 * One line per model: "id (label)". Used in unknown-model error messages so
 * the available set is always current.
 */
export function describeVideoModels(): string {
  return VIDEO_MODELS.map((m) => `  ${m.id} (${m.label})`).join("\n");
}
