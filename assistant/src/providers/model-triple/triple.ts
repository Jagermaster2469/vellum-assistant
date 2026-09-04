import { z } from "zod";

/**
 * Canonical ModelTriple — endpoint + model + key reference for every
 * function that requires a model.
 *
 * Different approach vs 001 (which scattered optional `apiBase` strings):
 * every modality reuses this one triple shape, with inheritance:
 * service-specific triple > workspace default > provider cloud default.
 * Keys are NEVER stored in config — config holds endpoint + model;
 * the key lives in CES vault / env and is resolved via
 * `getProviderKeyAsync`. This file holds only shape + normalize logic
 * (no I/O) so it can be imported by schemas, adapters, and UI constants.
 */

/** Raw triple as written in config (all fields optional for back-compat). */
export const ModelTripleSchema = z.object({
  /** Custom endpoint origin, e.g. `https://api.deepseek.com` or `http://127.0.0.1:11434/v1`. Empty = provider cloud default. */
  endpoint: z.string().optional(),
  /** Model id served at the endpoint, e.g. `deepseek-chat`, `nomic-embed-text`. Empty = provider default model. */
  model: z.string().optional(),
  /**
   * Credential store key for `getProviderKeyAsync` (e.g. `openai`, `xai`,
   * `deepgram`). Empty = adapter's default provider key. The raw key value
   * never appears in config — only the key NAME.
   */
  credential: z.string().optional(),
});

export type ModelTriple = z.infer<typeof ModelTripleSchema>;

/** Resolved triple after inheritance — endpoint/model may still be undefined (= cloud default). */
export interface ResolvedTriple {
  endpoint?: string;
  model?: string;
  /** Credential NAME (not value) to resolve via `getProviderKeyAsync`. */
  credential?: string;
}

/**
 * Normalize a configured endpoint: trim whitespace (empty → undefined) and
 * strip trailing slashes so SDK path joins (`{base}/v1/...`) never produce `//`.
 * Managed (`vellum`) callers must not pass a custom endpoint here — they own
 * their proxy URL and ignore this field (fail-closed, never redirect billing).
 */
export function normalizeEndpoint(
  raw: string | undefined | null,
): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/\/+$/, "");
}

/** Normalize a model id: trim, empty → undefined (= provider default). */
export function normalizeModel(
  raw: string | undefined | null,
): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/** True for keyless-local endpoints (loopback, no key required). */
export function isKeylessLocal(
  endpoint: string | undefined,
  apiKey: string | undefined,
): boolean {
  if (apiKey?.trim()) {
    return false;
  }
  if (!endpoint) {
    return false;
  }
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    );
  } catch {
    // Non-URL values (e.g. `ollama` shorthand) are not treated as keyless-local here.
    return false;
  }
}

/**
 * Resolve the effective triple: service-specific fields win; unset fields
 * inherit from the workspace default triple; still-unset = provider default.
 * Never falls back to `vellum` managed — managed is an explicit provider
 * choice, not a silent default.
 */
export function resolveTriple(
  service:
    | {
        endpoint?: string;
        model?: string;
        credential?: string;
        apiBase?: string;
        baseUrl?: string;
      }
    | undefined,
  workspaceDefault?: { endpoint?: string; model?: string; credential?: string },
): ResolvedTriple {
  // Back-compat: 001-era `apiBase`/`baseUrl` count as `endpoint`.
  const serviceEndpoint =
    normalizeEndpoint(service?.endpoint) ??
    normalizeEndpoint(service?.apiBase) ??
    normalizeEndpoint(service?.baseUrl);
  const serviceModel = normalizeModel(service?.model);
  const serviceCred = service?.credential?.trim() || undefined;
  return {
    endpoint: serviceEndpoint ?? normalizeEndpoint(workspaceDefault?.endpoint),
    model: serviceModel ?? normalizeModel(workspaceDefault?.model),
    credential:
      serviceCred ?? (workspaceDefault?.credential?.trim() || undefined),
  };
}

/**
 * Human-readable triple for logs/errors — endpoint + model + key PRESENCE
 * only. Never include key values.
 */
export function describeTriple(t: ResolvedTriple): string {
  const ep = t.endpoint ?? "(provider default)";
  const mo = t.model ?? "(provider default)";
  const key = t.credential ? `key:${t.credential}(set?)` : "key:default";
  return `endpoint=${ep} model=${mo} ${key}`;
}
