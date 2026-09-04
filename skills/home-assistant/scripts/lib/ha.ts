#!/usr/bin/env bun

/**
 * Shared Home Assistant REST client and configuration resolution for the
 * home-assistant skill scripts.
 *
 * Portable by design: reads the base URL and long-lived token from, in order:
 *   base URL:  --base-url flag > HA_BASE_URL env > `assistant config get
 *              integrations.homeassistant.base_url` > `assistant credentials
 *              reveal --service homeassistant --field base_url`
 *   token:     --token flag > HA_TOKEN env > `assistant credentials reveal
 *              --service homeassistant --field token`
 *
 * The `assistant` CLI lookups fail open (return undefined) when the CLI is
 * not installed, so the same scripts run under any Bun runtime with plain
 * environment variables.
 */

export interface HaConfig {
  /** Normalized base URL (no trailing slash), e.g. http://homeassistant.local:8123 */
  baseUrl: string;
  /** Long-lived access token (sent as `Authorization: Bearer <token>`) */
  token: string;
}

export interface HaCliOptions {
  baseUrl?: string;
  token?: string;
}

export interface HaHttpResult<T = unknown> {
  status: number;
  data: T;
}

const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// JSON output helpers (gmail skill convention)
// ---------------------------------------------------------------------------

export function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + "\n");
}

/** Write `{ ok: false, error: message }` to stdout and exit 1. */
export function printError(message: string): never {
  printJson({ ok: false, error: message });
  process.exit(1);
}

/** Write `{ ok: true, data }` to stdout. */
export function ok(data: unknown): void {
  printJson({ ok: true, data });
}

// ---------------------------------------------------------------------------
// Subprocess helpers (assistant CLI, fail-open when absent)
// ---------------------------------------------------------------------------

interface RunSyncResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run a command synchronously. Returns null when the binary does not exist. */
function runSync(cmd: string, args: string[]): RunSyncResult | null {
  try {
    const proc = Bun.spawnSync([cmd, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    return {
      stdout: new TextDecoder().decode(proc.stdout),
      stderr: new TextDecoder().decode(proc.stderr),
      exitCode: proc.exitCode,
    };
  } catch {
    // ENOENT (assistant CLI not installed) — caller treats this as "unset"
    return null;
  }
}

/**
 * Read a non-secret value from `assistant config get <key>`.
 * Returns undefined when the CLI is missing, the key is unset, or the lookup
 * errors.
 */
export function assistantConfigGet(key: string): string | undefined {
  const r = runSync("assistant", ["config", "get", key]);
  if (!r || r.exitCode !== 0) return undefined;
  const value = r.stdout.trim();
  if (!value || value === "null" || value === "undefined" || value === "{}") {
    return undefined;
  }
  return value;
}

/**
 * Reveal a stored credential from the assistant vault
 * (`assistant credentials reveal --service <service> --field <field> --json`).
 * Returns undefined when the CLI is missing or the credential is unset.
 */
export function assistantCredential(
  service: string,
  field: string,
): string | undefined {
  const r = runSync("assistant", [
    "credentials",
    "reveal",
    "--service",
    service,
    "--field",
    field,
    "--json",
  ]);
  if (!r || r.exitCode !== 0) return undefined;
  try {
    const parsed = JSON.parse(r.stdout) as { ok?: boolean; value?: unknown };
    if (parsed.ok === true && typeof parsed.value === "string" && parsed.value.length > 0) {
      return parsed.value;
    }
  } catch {
    // non-JSON output — treat as unset
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Configuration resolution
// ---------------------------------------------------------------------------

export const CONFIG_KEY_BASE_URL = "integrations.homeassistant.base_url";

const SERVICE = "homeassistant";
const FIELD_TOKEN = "token";
const FIELD_BASE_URL = "base_url";

/** Resolve base URL + token from CLI flags, env vars, then the assistant CLI. */
export function resolveHaConfig(opts: HaCliOptions): HaConfig {
  let baseUrl = opts.baseUrl ?? process.env.HA_BASE_URL;
  if (!baseUrl) baseUrl = assistantConfigGet(CONFIG_KEY_BASE_URL);
  if (!baseUrl) baseUrl = assistantCredential(SERVICE, FIELD_BASE_URL);
  if (!baseUrl) {
    printError(
      "No Home Assistant URL configured. Pass --base-url, set HA_BASE_URL, " +
        `or store one with \`assistant config set ${CONFIG_KEY_BASE_URL} <url>\` ` +
        "(see the Setup section of this skill).",
    );
  }

  let token = opts.token ?? process.env.HA_TOKEN;
  if (!token) token = assistantCredential(SERVICE, FIELD_TOKEN);
  if (!token) {
    printError(
      "No Home Assistant token found. Pass --token, set HA_TOKEN, or collect one " +
        "with `assistant credentials prompt --service homeassistant --field token` " +
        "(see the Setup section of this skill).",
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), token };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface HaRequestOptions {
  method?: "GET" | "POST";
  path: string;
  body?: unknown;
  timeoutMs?: number;
}

/** Execute an authenticated Home Assistant REST API request. */
export async function haRequest<T = unknown>(
  cfg: HaConfig,
  opts: HaRequestOptions,
): Promise<HaHttpResult<T>> {
  const method = opts.method ?? "GET";
  const url = cfg.baseUrl + opts.path;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
        "User-Agent": "vellum-home-assistant-skill/1.0",
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Request to ${url} failed: ${detail}`);
  }

  const text = await response.text();
  let data: T;
  try {
    data = (text ? JSON.parse(text) : ({} as T)) as T;
  } catch {
    data = text as unknown as T;
  }

  if (!response.ok) {
    throw new Error(
      `Home Assistant returned HTTP ${response.status} for ${method} ${opts.path}: ` +
        `${typeof data === "string" ? data : JSON.stringify(data)}`,
    );
  }

  return { status: response.status, data };
}

export function haGet<T = unknown>(cfg: HaConfig, path: string): Promise<HaHttpResult<T>> {
  return haRequest<T>(cfg, { method: "GET", path });
}

export function haPost<T = unknown>(
  cfg: HaConfig,
  path: string,
  body: unknown,
): Promise<HaHttpResult<T>> {
  return haRequest<T>(cfg, { method: "POST", path, body });
}

// ---------------------------------------------------------------------------
// Interactive confirmation gate (high-risk device actions)
// ---------------------------------------------------------------------------

/**
 * Gate execution on an explicit user confirmation via `assistant ui confirm`
 * (gmail skill pattern). Blocks until the user confirms, denies, or the prompt
 * times out.
 *
 * - Not requested (`confirm === false`): returns true (no gate).
 * - Denied/cancelled: prints `{ ok: false, cancelled: true }` and exits 0.
 * - CLI unavailable: fails safe — refuses to run a gated action.
 */
export async function confirmIfRequested(opts: {
  confirm: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  denyLabel?: string;
}): Promise<boolean> {
  if (!opts.confirm) return true;

  let result: RunSyncResult | null;
  try {
    const proc = Bun.spawn(
      [
        "assistant",
        "ui",
        "confirm",
        "--title",
        opts.title,
        "--message",
        opts.message,
        "--confirm-label",
        opts.confirmLabel ?? "Confirm",
        "--deny-label",
        opts.denyLabel ?? "Cancel",
        "--json",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    result = { stdout, stderr, exitCode };
  } catch {
    result = null;
  }

  if (!result || result.exitCode !== 0) {
    if (result === null) {
      printError(
        "--confirm requires the assistant CLI (`assistant ui confirm`), which is " +
          "not available here. Refusing to run this action without confirmation.",
      );
    }
    printJson({
      ok: false,
      cancelled: true,
      error: "User did not confirm the action.",
    });
    process.exit(0);
  }

  try {
    const parsed = JSON.parse(result.stdout) as { ok?: boolean; confirmed?: boolean };
    if (parsed.ok === true && parsed.confirmed === true) return true;
  } catch {
    // fall through to cancelled
  }

  printJson({
    ok: false,
    cancelled: true,
    error: "User did not confirm the action.",
  });
  process.exit(0);
}
