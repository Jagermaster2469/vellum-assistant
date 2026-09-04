/**
 * Video generation service layer.
 *
 * Dispatches text-to-video generation to provider-specific implementations
 * and resolves credentials the same way the TTS layer does: the provider
 * key comes from secure storage (with env-var fallback) via
 * `getProviderKeyAsync`. Provider set today:
 *
 * - `xai` — the xAI video generation API (`POST /v1/videos/generations`,
 *   polled via `GET /v1/videos/{id}`), grok-imagine-video family, BYOK.
 * - `vellum` — reserved for the managed platform proxy. The platform has no
 *   video-generation route yet, so managed requests throw
 *   {@link VideoGenNotImplementedError} instead of silently failing.
 *
 * The service reads `services["video-generation"]` from the live config
 * itself (provider, model, apiBase), so callers only pass the generation
 * request. `apiBase` follows the OpenAI-compatible convention: it replaces
 * the full `https://api.x.ai/v1` base including the `/v1` prefix.
 */

import { getConfig } from "../config/loader.js";
import { getProviderKeyAsync } from "../security/secure-keys.js";
import { DEFAULT_VIDEO_MODEL } from "./video-models.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VideoGenerationRequest {
  /** Text description of the video to generate. */
  prompt: string;
  /** Concrete model ID; falls back to the service default when omitted. */
  model?: string;
  /** Optional style descriptor appended to the prompt. */
  style?: string;
  /** Optional abort signal checked between poll iterations. */
  signal?: AbortSignal;
  /** Optional progress callback invoked while polling. */
  onStatus?: (message: string) => void;
}

export interface GeneratedVideo {
  /** Public URL of the finished video. */
  url: string;
  /** MIME type reported by the API (e.g. `video/mp4`). */
  contentType?: string;
  /** Duration in milliseconds, when reported. */
  durationMs?: number;
  /** Resolution label, when reported (e.g. `720p`). */
  resolution?: string;
}

export interface VideoGenerationResult {
  videos: GeneratedVideo[];
  /** Model ID that actually served the request. */
  resolvedModel: string;
  /** Provider-side generation id (also the poll handle). */
  requestId: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Managed (`vellum`) video generation was requested but is not implemented. */
export class VideoGenNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoGenNotImplementedError";
  }
}

/** The xAI API key is missing from secure storage and the env-var fallback. */
export class VideoGenKeyMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoGenKeyMissingError";
  }
}

/** A non-2xx response from the provider HTTP API. */
class VideoGenHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "VideoGenHttpError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const XAI_DEFAULT_API_BASE = "https://api.x.ai/v1";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_WAIT_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Wire types (xAI video generation API)
// ---------------------------------------------------------------------------

interface XaiCreateVideoResponse {
  request_id?: string;
  id?: string;
}

interface XaiVideoStatusResponse {
  status?: string;
  video?: {
    url?: string;
    content_type?: string;
    duration_ms?: number;
    resolution?: string;
  };
  error?: unknown;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a video using the configured `services["video-generation"]`
 * provider. `xai` starts an async generation and polls until the video is
 * ready; `vellum` (managed) is not implemented and throws
 * {@link VideoGenNotImplementedError}.
 */
export async function generateVideo(
  request: VideoGenerationRequest,
): Promise<VideoGenerationResult> {
  const svc = getConfig().services["video-generation"];
  if (svc.provider === "vellum") {
    throw new VideoGenNotImplementedError(
      'Managed video generation is not available yet: services["video-generation"].provider = "vellum" has no platform proxy route. ' +
        'Switch the provider to "xai" and configure your own xAI API key in Settings → Models & Services to use this tool.',
    );
  }
  // `openai-compatible` reuses the xAI-shaped async API (POST
  // `{apiBase}/videos/generations`, poll `GET {apiBase}/videos/{id}`) against
  // a custom endpoint with the `openai` vault key (keyless-local allowed).
  return generateVideoXai(request);
}

/**
 * Map a video generation failure to a user-facing message. HTTP statuses get
 * provider-aware hints (auth, billing/rate limit); everything else echoes
 * the error message.
 */
export function mapVideoGenError(error: unknown): string {
  if (error instanceof VideoGenHttpError) {
    const { status } = error;
    if (status === 401 || status === 403) {
      return "The xAI API key was rejected (401/403). Verify the key is valid in Settings → Models & Services.";
    }
    if (status === 402 || status === 429) {
      return `The xAI video API returned ${status} (billing or rate limit). Check your xAI account credits and try again later.`;
    }
    return `The xAI video API returned HTTP ${status}: ${error.message}`;
  }
  return `Video generation failed: ${errorMessage(error)}`;
}

// ---------------------------------------------------------------------------
// xAI implementation
// ---------------------------------------------------------------------------

async function generateVideoXai(
  request: VideoGenerationRequest,
): Promise<VideoGenerationResult> {
  const svc = getConfig().services["video-generation"];
  const apiBase = (svc.apiBase?.trim() || XAI_DEFAULT_API_BASE).replace(
    /\/+$/,
    "",
  );
  const model =
    request.model?.trim() || svc.model?.trim() || DEFAULT_VIDEO_MODEL;
  const prompt = request.style?.trim()
    ? `${request.prompt.trim()}, ${request.style.trim()}`
    : request.prompt.trim();

  const keyProvider = svc.provider === "openai-compatible" ? "openai" : "xai";
  const apiKey = await getProviderKeyAsync(keyProvider);
  if (!apiKey) {
    const keylessLocal =
      svc.provider === "openai-compatible" && Boolean(svc.apiBase?.trim());
    if (!keylessLocal) {
      throw new VideoGenKeyMissingError(
        "No xAI API key configured. Set your xAI API key in Settings → Models & Services to enable video generation.",
      );
    }
  }

  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey?.trim()) {
    authHeaders.Authorization = `Bearer ${apiKey.trim()}`;
  }

  // 1. Start the generation.
  let create: XaiCreateVideoResponse;
  try {
    const res = await fetch(`${apiBase}/videos/generations`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ model, prompt }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new VideoGenHttpError(res.status, await readErrorMessage(res));
    }
    create = (await res.json()) as XaiCreateVideoResponse;
  } catch (error) {
    if (error instanceof VideoGenHttpError) {
      throw error;
    }
    throw new Error(`Failed to start video generation: ${errorMessage(error)}`);
  }

  const requestId = create.request_id ?? create.id;
  if (!requestId) {
    throw new Error(
      `Video generation API returned no request id: ${JSON.stringify(create)}`,
    );
  }

  // 2. Poll until the video is ready (or fails/expires/times out).
  const deadline = Date.now() + MAX_POLL_WAIT_MS;
  let status: XaiVideoStatusResponse | undefined;
  for (;;) {
    if (request.signal?.aborted) {
      throw new Error("Cancelled");
    }
    status = await pollVideoStatus(apiBase, authHeaders, requestId);
    if (status.status === "done") {
      break;
    }
    if (status.status === "failed" || status.status === "expired") {
      throw new Error(
        `Video generation ${status.status}: ${JSON.stringify(status.error ?? status)}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for video generation to complete (request id ${requestId}, last status "${status.status ?? "unknown"}").`,
      );
    }
    request.onStatus?.(
      `Video still generating (status: ${status.status ?? "unknown"}, request ${requestId})...`,
    );
    await sleep(POLL_INTERVAL_MS, request.signal);
  }

  const video = status?.video;
  const url = video?.url;
  if (!url) {
    throw new Error(
      `Video generation completed without a video URL: ${JSON.stringify(status)}`,
    );
  }

  return {
    videos: [
      {
        url,
        contentType: video.content_type,
        durationMs: video.duration_ms,
        resolution: video.resolution,
      },
    ],
    resolvedModel: model,
    requestId,
  };
}

async function pollVideoStatus(
  apiBase: string,
  authHeaders: Record<string, string>,
  requestId: string,
): Promise<XaiVideoStatusResponse> {
  const res = await fetch(`${apiBase}/videos/${requestId}`, {
    headers: authHeaders,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new VideoGenHttpError(res.status, await readErrorMessage(res));
  }
  return (await res.json()) as XaiVideoStatusResponse;
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = (await res.text().catch(() => "")).slice(0, 500);
  return text || `HTTP ${res.status}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
