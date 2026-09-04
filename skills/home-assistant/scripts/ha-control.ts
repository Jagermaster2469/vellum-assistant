#!/usr/bin/env bun

/**
 * Home Assistant service calls (device control).
 * Subcommands:
 *   call <domain> <service> — POST /api/services/<domain>/<service>
 *
 * Service data is passed as JSON via --data (optionally merged with
 * --target / --entity-id). High-risk actions can be gated on an explicit
 * user confirmation with --confirm.
 */

import { Command } from "commander@13.1.0";

import {
  confirmIfRequested,
  haPost,
  ok,
  printError,
  resolveHaConfig,
  type HaConfig,
} from "./lib/ha.js";

// ---------------------------------------------------------------------------
// Body building
// ---------------------------------------------------------------------------

function parseJsonFlag(value: string | undefined, flagName: string): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch (err) {
    printError(
      `Invalid JSON for --${flagName}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

interface CallBody {
  target?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Build the POST body from --data, --target, and --entity-id.
 * Precedence: --entity-id is folded into target.entity_id (a bare
 * --data entity_id wins if the caller set one explicitly).
 */
function buildCallBody(opts: {
  data?: unknown;
  target?: unknown;
  entityId?: string;
}): CallBody {
  const body: CallBody = {};

  if (opts.data !== undefined && typeof opts.data === "object" && opts.data !== null) {
    Object.assign(body, opts.data as Record<string, unknown>);
  }

  if (opts.target !== undefined) {
    if (typeof opts.target !== "object" || opts.target === null) {
      printError("--target must be a JSON object, e.g. '{\"area_id\":\"living_room\"}'");
    }
    body.target = { ...(opts.target as Record<string, unknown>) };
  }

  if (opts.entityId) {
    body.target = { ...(body.target ?? {}), entity_id: opts.entityId };
  }

  return body;
}

// ---------------------------------------------------------------------------
// Subcommand action
// ---------------------------------------------------------------------------

async function actionCall(
  cfg: HaConfig,
  opts: {
    domain: string;
    service: string;
    data?: unknown;
    target?: unknown;
    entityId?: string;
    confirm: boolean;
  },
): Promise<void> {
  const body = buildCallBody(opts);

  await confirmIfRequested({
    confirm: opts.confirm,
    title: "Home Assistant service call",
    message:
      `Call ${opts.domain}.${opts.service} on your Home Assistant instance` +
      (Object.keys(body).length > 0 ? ` with data: ${JSON.stringify(body)}` : "") +
      "?",
    confirmLabel: "Call service",
    denyLabel: "Cancel",
  });

  const { data } = await haPost(
    cfg,
    `/api/services/${opts.domain}/${opts.service}`,
    body,
  );
  ok({ domain: opts.domain, service: opts.service, response: data });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("ha-control")
  .description("Call Home Assistant services (device control)")
  .option("--base-url <url>", "Home Assistant base URL (e.g. http://homeassistant.local:8123)")
  .option("--token <token>", "Long-lived access token (usually resolved from the assistant vault)");

program
  .command("call")
  .description("Call a Home Assistant service (POST /api/services/<domain>/<service>)")
  .argument("<domain>", "Service domain (e.g. light, switch, lock, media_player)")
  .argument("<service>", "Service name (e.g. turn_on, set_brightness)")
  .option("--data <json>", "Service data as JSON (e.g. '{\"brightness\":128}')")
  .option(
    "--target <json>",
    "Target selector as JSON (e.g. '{\"entity_id\":\"light.kitchen\"}' or '{\"area_id\":\"living_room\"}')",
  )
  .option("--entity-id <id>", "Convenience shortcut for --target '{\"entity_id\":\"<id>\"}'")
  .option(
    "--confirm",
    "Gate execution on an explicit user confirmation dialog (required for high-risk actions)",
  )
  .action(async (domain: string, service: string, opts: Record<string, unknown>) => {
    const cfg = resolveHaConfig({
      baseUrl: program.opts().baseUrl,
      token: program.opts().token,
    });

    await actionCall(cfg, {
      domain,
      service,
      data: parseJsonFlag(opts.data as string | undefined, "data"),
      target: parseJsonFlag(opts.target as string | undefined, "target"),
      entityId: opts.entityId as string | undefined,
      confirm: opts.confirm === true,
    });
  });

program.parse();
