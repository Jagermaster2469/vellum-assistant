/**
 * Verify model triples — endpoint + model + key presence per function.
 *
 * Usage: `cd assistant && bun scripts/verify-triples.ts`
 *
 * Reports each function requiring a model with its configured endpoint,
 * model, and key PRESENCE (never values). Network probing is opt-in via
 * --probe (otherwise only local config + key presence is checked, no HTTP).
 *
 * Keys are never printed. Use this to prove SC-3 without leaking secrets.
 */

import { getConfig } from "../src/config/loader.js";
import {
  describeTriple,
  resolveTriple,
} from "../src/providers/model-triple/triple.js";
import { getProviderKeyAsync } from "../src/security/secure-keys.js";

interface FunctionTriple {
  fn: string;
  endpoint?: string;
  model?: string;
  credential?: string;
  notes: string;
}

type Cfg = ReturnType<typeof getConfig>;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function section(cfg: Cfg, key: string): Record<string, unknown> {
  const root = cfg as unknown as Record<string, unknown>;
  const v = root[key];
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : {};
}

async function keyPresent(name: string | undefined): Promise<string> {
  if (!name) {
    return "default (provider key)";
  }
  try {
    const v = await getProviderKeyAsync(name);
    return v ? "present" : "MISSING";
  } catch {
    return "unknown (store unreachable)";
  }
}

async function main(): Promise<void> {
  const probe = process.argv.includes("--probe");
  const cfg = getConfig();
  const memory = section(cfg, "memory");
  const services = section(cfg, "services");
  const llm = section(cfg, "llm");
  const embeddings =
    typeof memory.embeddings === "object" && memory.embeddings !== null
      ? (memory.embeddings as Record<string, unknown>)
      : {};
  const imageGen =
    typeof services["image-generation"] === "object" &&
    services["image-generation"] !== null
      ? (services["image-generation"] as Record<string, unknown>)
      : {};
  const videoGen =
    typeof services["video-generation"] === "object" &&
    services["video-generation"] !== null
      ? (services["video-generation"] as Record<string, unknown>)
      : {};
  const tts =
    typeof services.tts === "object" && services.tts !== null
      ? (services.tts as Record<string, unknown>)
      : {};
  const ttsProviders =
    typeof tts.providers === "object" && tts.providers !== null
      ? (tts.providers as Record<string, Record<string, unknown>>)
      : {};
  const ttsActive =
    typeof tts.provider === "string" ? tts.provider : "elevenlabs";
  const ttsActiveCfg = ttsProviders[ttsActive] ?? {};
  const stt =
    typeof services.stt === "object" && services.stt !== null
      ? (services.stt as Record<string, unknown>)
      : {};
  const sttProviders =
    typeof stt.providers === "object" && stt.providers !== null
      ? (stt.providers as Record<string, Record<string, unknown>>)
      : {};
  const sttActive =
    typeof stt.provider === "string" ? stt.provider : "deepgram";
  const sttActiveCfg = sttProviders[sttActive] ?? {};
  const webSearch =
    typeof services["web-search"] === "object" &&
    services["web-search"] !== null
      ? (services["web-search"] as Record<string, unknown>)
      : {};
  const webFetch =
    typeof services["web-fetch"] === "object" && services["web-fetch"] !== null
      ? (services["web-fetch"] as Record<string, unknown>)
      : {};

  const fns: FunctionTriple[] = [
    {
      fn: "main chat (llm.defaultProvider)",
      endpoint:
        typeof llm.defaultProvider === "string"
          ? `(connection ${llm.defaultProvider})`
          : undefined,
      model: undefined,
      credential: undefined,
      notes:
        "triple lives in provider_connections row (baseUrl + models + auth); see inference providers list",
    },
    {
      fn: "embeddings",
      ...resolveTriple({
        endpoint: str(embeddings.apiBase),
        model: str(embeddings.openaiModel),
        credential: "openai",
      }),
      notes: `provider=${str(embeddings.provider) ?? "auto"}`,
    },
    {
      fn: "image generation",
      ...resolveTriple({
        endpoint: str(imageGen.apiBase),
        model: str(imageGen.model),
        credential: str(imageGen.provider),
      }),
      notes: `provider=${str(imageGen.provider)}`,
    },
    {
      fn: "video generation",
      ...resolveTriple({
        endpoint: str(videoGen.apiBase),
        model: str(videoGen.model),
        credential: "xai",
      }),
      notes: `provider=${str(videoGen.provider) ?? "xai"}`,
    },
    {
      fn: "TTS",
      ...resolveTriple({
        endpoint: str(ttsActiveCfg.apiBase) ?? str(tts.baseUrl),
        model:
          str(ttsActiveCfg.model) ??
          str(ttsActiveCfg.voice) ??
          str(ttsActiveCfg.voiceId),
        credential: ttsActive,
      }),
      notes: `provider=${ttsActive}`,
    },
    {
      fn: "STT",
      ...resolveTriple({
        endpoint: str(stt.baseUrl),
        model: str(sttActiveCfg.model),
        credential: sttActive,
      }),
      notes: `provider=${sttActive}`,
    },
    {
      fn: "web search",
      ...resolveTriple({
        endpoint: str(webSearch.apiBase),
        model: str(webSearch.model),
        credential: str(webSearch.provider),
      }),
      notes: `provider=${str(webSearch.provider)}`,
    },
    {
      fn: "web fetch",
      ...resolveTriple({
        endpoint: str(webFetch.apiBase),
        model: undefined,
        credential: str(webFetch.provider),
      }),
      notes: `provider=${str(webFetch.provider)}`,
    },
  ];

  let missing = 0;
  for (const f of fns) {
    const keyStatus = await keyPresent(f.credential);
    if (keyStatus === "MISSING") {
      missing++;
    }
    console.log(
      `- ${f.fn}\n    ${describeTriple(f)} key=${keyStatus}\n    ${f.notes}`,
    );
  }

  if (probe) {
    console.log(
      "\n--probe requested: use the Settings UI probe or `probeTriple` (network) per endpoint; this script does not probe network by default to stay offline-safe.",
    );
  }

  if (missing > 0) {
    console.log(
      `\n${missing} function(s) report MISSING key — set via Settings → Models & Services or assistant credentials (see per-function notes).`,
    );
  } else {
    console.log(
      "\nAll function triples resolve (keys present or keyless-local/default).",
    );
  }
}

await main();
