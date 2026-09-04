import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  DEFAULT_VIDEO_MODEL,
  describeVideoModels,
  resolveVideoModel,
} from "../../../../media/video-models.js";
import {
  generateVideo,
  mapVideoGenError,
  VideoGenKeyMissingError,
  VideoGenNotImplementedError,
} from "../../../../media/video-service.js";
import type { FileContent } from "../../../../providers/types.js";
import { sandboxPolicy } from "../../../../tools/shared/filesystem/path-policy.js";
import type {
  ToolContext,
  ToolExecutionResult,
} from "../../../../tools/types.js";
import { getConfig } from "../../../loader.js";

/** Workspace-relative directory where generated videos are saved. */
const GENERATED_MEDIA_DIR = "media/generated";

/**
 * Cap on video bytes inlined into the tool result as a base64 content block.
 * Larger videos still land in the workspace and are delivered via the
 * `vellum://workspace/...` embed in the reply.
 */
const MAX_INLINE_VIDEO_BYTES = 25 * 1024 * 1024;

/** Hard cap on video downloads from the provider URL. */
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

/** Upper bound on filename-collision retries per video. */
const MAX_FILENAME_ATTEMPTS = 1000;

/**
 * Derive a filesystem-safe base name for a generated video from the
 * generation prompt.
 */
function videoFileSlug(prompt: string): string {
  const base = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return base ? `video-${base}` : "video";
}

/**
 * Save a generated video under `media/generated/` in the workspace so the
 * model can reference it by path. The target path is validated through
 * `sandboxPolicy` and files are created exclusively (`wx`) so concurrent
 * generations cannot claim the same filename.
 */
function saveGeneratedVideo(
  data: Buffer,
  filenameBase: string,
  ext: string,
  workingDir: string,
): { relPath?: string; error?: string } {
  try {
    for (let attempt = 1; attempt <= MAX_FILENAME_ATTEMPTS; attempt++) {
      const relPath =
        attempt === 1
          ? `${GENERATED_MEDIA_DIR}/${filenameBase}.${ext}`
          : `${GENERATED_MEDIA_DIR}/${filenameBase}-${attempt}.${ext}`;
      const pathCheck = sandboxPolicy(join(workingDir, relPath), workingDir, {
        mustExist: false,
      });
      if (!pathCheck.ok) {
        throw new Error(pathCheck.error);
      }
      mkdirSync(dirname(pathCheck.resolved), { recursive: true });
      try {
        writeFileSync(pathCheck.resolved, data, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          continue;
        }
        throw error;
      }
      return { relPath };
    }
    throw new Error(
      `Could not find a free filename for "${filenameBase}.${ext}" after ${MAX_FILENAME_ATTEMPTS} attempts.`,
    );
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * Download the finished video so the result outlives the provider's
 * (typically presigned, expiring) URL.
 */
async function downloadVideo(
  url: string,
  signal?: AbortSignal,
): Promise<{ data: Buffer; contentType: string } | { error: string }> {
  try {
    const res = await fetch(url, {
      signal: signal ?? AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      return {
        error: `Could not download the generated video (HTTP ${res.status}).`,
      };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      return {
        error: `Generated video is too large to download (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB).`,
      };
    }
    const contentType = res.headers.get("content-type") ?? "video/mp4";
    return { data: buffer, contentType };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { error: "Cancelled" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { error: `Could not download the generated video: ${message}` };
  }
}

export async function run(
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const svc = getConfig().services["video-generation"];

  // Managed generation is not implemented: the platform runtime proxy has
  // no video-generation route. Fail clearly before touching any key.
  if (svc.provider === "vellum") {
    return {
      content:
        'Managed video generation (services["video-generation"].provider = "vellum") is not available yet: the Vellum platform proxy has no video-generation route. To use this tool, switch the provider to "xai" and configure your own xAI API key in Settings → Models & Services.\n\nReport this error to the user as-is. Do not change service configuration (managed/your-own mode or provider settings) to try to fix it.',
      isError: true,
    };
  }

  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) {
    return {
      content: "Provide a text prompt describing the video to generate.",
      isError: true,
    };
  }

  // Resolve an explicit model against the registry so unknown values fail
  // with the current catalog instead of a provider-side 400.
  let modelOverride: string | undefined;
  if (typeof input.model === "string" && input.model.trim()) {
    const entry = resolveVideoModel(input.model.trim());
    if (!entry) {
      return {
        content: `Unknown model "${input.model}". Available models:\n${describeVideoModels()}\n\nRetry with one of the models above, or omit the model parameter to use the configured default.`,
        isError: true,
      };
    }
    modelOverride = entry.id;
  }

  const style =
    typeof input.style === "string" && input.style.trim()
      ? input.style.trim()
      : undefined;
  const modelUsed = modelOverride ?? svc.model ?? DEFAULT_VIDEO_MODEL;

  try {
    const result = await generateVideo({
      prompt,
      model: modelOverride,
      style,
      signal: context.signal,
      onStatus: (message) => context.onOutput?.(`${message}\n`),
    });

    const video = result.videos[0];
    if (!video) {
      return {
        content: "Video generation returned no video.",
        isError: true,
      };
    }

    // Download into the workspace so the result outlives the provider URL.
    const download = await downloadVideo(video.url, context.signal);
    let relPath: string | undefined;
    let saveError: string | undefined;
    if ("error" in download) {
      saveError = download.error;
    } else {
      const ext =
        download.contentType.split("/")[1]?.replace(/[^a-z0-9+.]/g, "") ||
        "mp4";
      const saved = saveGeneratedVideo(
        download.data,
        videoFileSlug(prompt),
        ext,
        context.workingDir,
      );
      relPath = saved.relPath;
      saveError = saved.error;
    }

    let content = `Generated a video using ${result.resolvedModel}.`;
    if (video.durationMs) {
      content += ` Duration: ${(video.durationMs / 1000).toFixed(1)}s.`;
    }
    content += ` Source URL: ${video.url}`;
    if (relPath) {
      content += ` Saved to ${relPath}.`;
      content += `\n\nShow the user the video by embedding it in your reply: ![description](vellum://workspace/${relPath}).`;
    }
    if (saveError) {
      content += `\n\nCould not save the video to the workspace (${saveError}). Share the source URL with the user instead.`;
    }

    // Inline the video as a file content block when small enough; the
    // workspace embed above covers delivery for larger files.
    const contentBlocks: FileContent[] | undefined =
      !("error" in download) &&
      download.data.byteLength <= MAX_INLINE_VIDEO_BYTES
        ? [
            {
              type: "file" as const,
              source: {
                type: "base64" as const,
                media_type: download.contentType,
                data: download.data.toString("base64"),
                filename: relPath?.split("/").pop(),
              },
            },
          ]
        : undefined;

    return {
      content,
      isError: false,
      contentBlocks,
    };
  } catch (error) {
    if (
      error instanceof VideoGenNotImplementedError ||
      error instanceof VideoGenKeyMissingError
    ) {
      return {
        content: `${error.message}\n\nReport this error to the user as-is. Do not change service configuration (managed/your-own mode or provider/model settings) to try to fix it.`,
        isError: true,
      };
    }
    return {
      content: `${mapVideoGenError(error)}\n\nFailed model: ${modelUsed}`,
      isError: true,
    };
  }
}
