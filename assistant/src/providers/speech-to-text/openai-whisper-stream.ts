/**
 * OpenAI Whisper incremental-batch streaming STT adapter.
 *
 * OpenAI Whisper does not expose a native WebSocket streaming transcription
 * endpoint, so this adapter rides the shared incremental-batch strategy —
 * see `incremental-batch-stream.ts` for the accumulation/diff semantics.
 */

import {
  IncrementalBatchStreamingTranscriber,
  type IncrementalBatchStreamOptions,
} from "./incremental-batch-stream.js";
import { whisperTranscribe } from "./openai-whisper.js";

export interface OpenAIWhisperStreamOptions extends IncrementalBatchStreamOptions {
  /**
   * Custom STT origin (`services.stt.baseUrl`). When set, batch chunks go to
   * `${baseUrl}/v1/audio/transcriptions` instead of the OpenAI cloud default.
   */
  baseUrl?: string;
}

export class OpenAIWhisperStreamingTranscriber extends IncrementalBatchStreamingTranscriber {
  readonly providerId = "openai-whisper" as const;

  private readonly apiKey: string;
  private readonly baseUrl: string | undefined;

  constructor(apiKey: string, options: OpenAIWhisperStreamOptions = {}) {
    super(options);
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl;
  }

  protected runBatchTranscription(
    audio: Buffer,
    mimeType: string,
    signal: AbortSignal,
  ): Promise<string> {
    return whisperTranscribe(
      this.apiKey,
      audio,
      mimeType,
      signal,
      this.baseUrl,
    );
  }
}
