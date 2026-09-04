/**
 * OpenAI-compatible TTS provider adapter.
 *
 * Synthesizes speech through any OpenAI-compatible `/v1/audio/speech`
 * endpoint: OpenAI cloud (default), a self-hosted/proxy endpoint via
 * `services.tts.providers.openai.apiBase`, or a keyless local server.
 * Reads the API key from the secure credential store under
 * `credential/openai/api_key` (env fallback honored), the voice/model from
 * `services.tts.providers.openai`.
 *
 * Model triple: endpoint = `apiBase` (cloud default when unset),
 * model = `services.tts.providers.openai.model`, key = `openai` vault key.
 */

import { getConfig } from "../../config/loader.js";
import { credentialKey } from "../../security/credential-key.js";
import { getSecureKeyAsync } from "../../security/secure-keys.js";
import { getLogger } from "../../util/logger.js";
import type { TtsProviderDefinition } from "../provider-definition.js";
import type {
  TtsProvider,
  TtsProviderCapabilities,
  TtsSynthesisRequest,
  TtsSynthesisResult,
} from "../types.js";

const log = getLogger("tts:openai");

const OPENAI_API_BASE = "https://api.openai.com";
const SPEECH_PATH = "/v1/audio/speech";
const DEFAULT_VOICE = "alloy";
const DEFAULT_MODEL = "gpt-4o-mini-tts";
const REQUEST_TIMEOUT_MS = 60_000;

export type OpenAiTtsErrorCode =
  | "OPENAI_TTS_NO_API_KEY"
  | "OPENAI_TTS_HTTP_ERROR"
  | "OPENAI_TTS_EMPTY_RESPONSE";

export class OpenAiTtsError extends Error {
  readonly code: OpenAiTtsErrorCode;
  readonly statusCode?: number;

  constructor(code: OpenAiTtsErrorCode, message: string, statusCode?: number) {
    super(message);
    this.name = "OpenAiTtsError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function resolveSpeechUrl(apiBase: string | undefined): string {
  const base = apiBase?.trim();
  if (!base) {
    return `${OPENAI_API_BASE}${SPEECH_PATH}`;
  }
  return `${base.replace(/\/+$/, "")}${SPEECH_PATH}`;
}

function createOpenAiProvider(): TtsProvider {
  const capabilities: TtsProviderCapabilities = {
    supportsStreaming: false,
    supportedFormats: ["mp3", "wav"],
  };

  return {
    id: "openai",
    capabilities,
    async synthesize(
      request: TtsSynthesisRequest,
    ): Promise<TtsSynthesisResult> {
      const config = getConfig().services.tts.providers.openai;
      const voice = (request.voiceId ?? config.voice).trim() || DEFAULT_VOICE;
      const model = config.model?.trim() || DEFAULT_MODEL;
      const apiBase = config.apiBase?.trim() || undefined;
      const url = resolveSpeechUrl(apiBase);

      const apiKey = await getSecureKeyAsync(
        credentialKey("openai", "api_key"),
      );
      if (!apiKey && !apiBase) {
        throw new OpenAiTtsError(
          "OPENAI_TTS_NO_API_KEY",
          "OpenAI API key not configured. " +
            'Add it in Settings → Voice or via: assistant credentials prompt --service openai --field api_key --label "OpenAI API Key"',
        );
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey?.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
      } else {
        log.info(
          { url },
          "Synthesizing without API key (keyless-local endpoint)",
        );
      }

      const responseFormat = request.outputFormat === "pcm" ? "wav" : "mp3";
      const signal = request.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            voice,
            input: request.text,
            response_format: responseFormat,
          }),
          signal,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new OpenAiTtsError(
          "OPENAI_TTS_HTTP_ERROR",
          `OpenAI TTS request failed: ${msg}`,
        );
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new OpenAiTtsError(
          "OPENAI_TTS_HTTP_ERROR",
          `OpenAI TTS returned HTTP ${res.status}: ${body.slice(0, 200) || res.statusText}`,
          res.status,
        );
      }

      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.length === 0) {
        throw new OpenAiTtsError(
          "OPENAI_TTS_EMPTY_RESPONSE",
          "OpenAI TTS returned an empty audio buffer.",
        );
      }
      const contentType = res.headers.get("content-type") ?? "audio/mpeg";
      return { audio, contentType };
    },
  };
}

export const openAiTtsProviderDefinition: TtsProviderDefinition = {
  id: "openai",
  displayName: "OpenAI",
  subtitle:
    "OpenAI-compatible speech synthesis for conversations and read-aloud. Works with OpenAI cloud or any OpenAI-compatible endpoint.",
  supportsVoiceSelection: true,
  apiKeyPlaceholder: "sk-… (or leave empty for keyless local endpoints)",
  credentialsGuide: {
    description:
      "Sign in to OpenAI, go to API keys, and copy your key. For local servers, leave the key empty.",
    url: "https://platform.openai.com/api-keys",
    linkLabel: "Open OpenAI API Keys",
  },
  callMode: "synthesized-play",
  allowNativeFallback: false,
  capabilities: {
    supportsStreaming: false,
    supportedFormats: ["mp3", "wav"],
  },
  mediaStreamPlayback: { outputFormat: "none" },
  secretRequirements: [
    {
      credentialStoreKey: "credential/openai/api_key",
      displayName: "OpenAI API Key",
      setCommand:
        'assistant credentials prompt --service openai --field api_key --label "OpenAI API Key"',
    },
  ],
  adapter: createOpenAiProvider(),
};
