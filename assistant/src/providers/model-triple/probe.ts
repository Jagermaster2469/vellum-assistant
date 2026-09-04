import { normalizeEndpoint } from "./triple.js";

/**
 * Probe verdict cache — mirrors 001's 10-min endpoint-probe cache pattern.
 * Probes verify endpoint + model + key without leaking the key.
 */

interface ProbeVerdict {
  ok: boolean;
  message: string;
  at: number;
}

const CACHE_TTL_MS = 10 * 60_000;
const verdictCache = new Map<string, ProbeVerdict>();

function cacheKey(endpoint: string, model: string | undefined): string {
  return `${endpoint}::${model ?? ""}`;
}

export function getCachedProbe(
  endpoint: string,
  model?: string,
): ProbeVerdict | undefined {
  const key = cacheKey(endpoint, model);
  const v = verdictCache.get(key);
  if (!v) {
    return undefined;
  }
  if (Date.now() - v.at > CACHE_TTL_MS) {
    verdictCache.delete(key);
    return undefined;
  }
  return v;
}

function setCachedProbe(
  endpoint: string,
  model: string | undefined,
  verdict: ProbeVerdict,
): void {
  verdictCache.set(cacheKey(endpoint, model), verdict);
}

export function clearProbeCacheForTesting(): void {
  verdictCache.clear();
}

/**
 * Probe an OpenAI-compatible endpoint triple.
 * Order: GET `{endpoint}/models` (key check + reachability), fallback to
 * minimal POST `{endpoint}/chat/completions` (model existence).
 * Never logs or returns the key value — errors name the endpoint + model.
 */
export async function probeTriple(opts: {
  endpoint: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; message: string }> {
  const base = normalizeEndpoint(opts.endpoint);
  if (!base) {
    return { ok: false, message: "No endpoint configured." };
  }
  const cached = getCachedProbe(base, opts.model);
  if (cached) {
    return { ok: cached.ok, message: cached.message };
  }
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const headers: Record<string, string> = {};
  if (opts.apiKey?.trim()) {
    headers.Authorization = `Bearer ${opts.apiKey.trim()}`;
  }

  // 1) GET /models — proves reachability + key validity.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/models`, {
        headers,
        signal: ctrl.signal,
      });
      if (res.ok) {
        const verdict = {
          ok: true,
          message: `Endpoint ${base} reachable (GET /models ok).`,
          at: Date.now(),
        };
        setCachedProbe(base, opts.model, verdict);
        return { ok: true, message: verdict.message };
      }
      if (res.status === 401 || res.status === 403) {
        const verdict = {
          ok: false,
          message: `Endpoint ${base} rejected the API key (${res.status}). Verify the key in Settings → Models & Services.`,
          at: Date.now(),
        };
        setCachedProbe(base, opts.model, verdict);
        return { ok: false, message: verdict.message };
      }
      // Non-auth failure → try chat/completions (some gateways hide /models).
    } finally {
      clearTimeout(t);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/abort/i.test(msg)) {
      return {
        ok: false,
        message: `Endpoint ${base} timed out after ${timeoutMs}ms. Check the URL and network.`,
      };
    }
    // Network error → report, do not try chat path (no route).
    return { ok: false, message: `Endpoint ${base} unreachable: ${msg}` };
  }

  // 2) POST /chat/completions with 1 token — proves model existence.
  if (!opts.model?.trim()) {
    return {
      ok: true,
      message: `Endpoint ${base} reachable (model list unavailable, no model specified).`,
    };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          model: opts.model.trim(),
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        const verdict = {
          ok: true,
          message: `Endpoint ${base} serves model ${opts.model.trim()}.`,
          at: Date.now(),
        };
        setCachedProbe(base, opts.model, verdict);
        return { ok: true, message: verdict.message };
      }
      const body = await res.text().catch(() => "");
      const verdict = {
        ok: false,
        message: `Endpoint ${base} returned ${res.status} for model ${opts.model.trim()}: ${body.slice(0, 200) || res.statusText}`,
        at: Date.now(),
      };
      setCachedProbe(base, opts.model, verdict);
      return { ok: false, message: verdict.message };
    } finally {
      clearTimeout(t);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Endpoint ${base} probe failed for model ${opts.model?.trim()}: ${msg}`,
    };
  }
}
