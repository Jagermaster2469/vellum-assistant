#!/usr/bin/env bun

/**
 * Home Assistant read-only queries (list states, services, and instance info).
 * Subcommands:
 *   states    — GET /api/states (optionally filtered by entity-id glob or domain)
 *   entity    — GET /api/states/<entity_id>
 *   services  — GET /api/services (optionally filtered by domain)
 *   domains   — list integration domains that expose at least one service
 *   info      — connectivity + version check (GET /api/ and /api/config)
 */

import { Command } from "commander@13.1.0";

import {
  haGet,
  ok,
  printError,
  resolveHaConfig,
  type HaConfig,
} from "./lib/ha.js";

// ---------------------------------------------------------------------------
// Entity state helpers
// ---------------------------------------------------------------------------

interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context?: Record<string, unknown>;
}

/** True when `entityId` matches the given glob (`*` wildcard), e.g. "light.*". */
function entityMatchesGlob(entityId: string, glob: string): boolean {
  if (!glob.includes("*")) return entityId === glob;
  const regex = new RegExp("^" + glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return regex.test(entityId);
}

// ---------------------------------------------------------------------------
// Subcommand actions
// ---------------------------------------------------------------------------

async function actionStates(
  cfg: HaConfig,
  opts: { entityId?: string; domain?: string },
): Promise<void> {
  const { data } = await haGet<HaState[]>(cfg, "/api/states");
  let states = Array.isArray(data) ? data : [];

  if (opts.entityId) {
    states = states.filter((s) => entityMatchesGlob(s.entity_id, opts.entityId));
  }
  if (opts.domain) {
    const prefix = opts.domain.endsWith(".") ? opts.domain : `${opts.domain}.`;
    states = states.filter((s) => s.entity_id.startsWith(prefix));
  }

  ok({ count: states.length, states });
}

async function actionEntity(cfg: HaConfig, entityId: string): Promise<void> {
  const { data } = await haGet<HaState>(cfg, `/api/states/${entityId}`);
  ok(data);
}

interface HaServicesResponse {
  [domain: string]: Record<string, { name?: string; description?: string }>;
}

async function actionServices(
  cfg: HaConfig,
  opts: { domain?: string },
): Promise<void> {
  const { data } = await haGet<HaServicesResponse>(cfg, "/api/services");

  const result: Record<string, string[]> = {};
  for (const [domain, services] of Object.entries(data)) {
    if (opts.domain && domain !== opts.domain) continue;
    result[domain] = Object.keys(services).sort();
  }
  ok(result);
}

async function actionDomains(cfg: HaConfig): Promise<void> {
  const { data } = await haGet<HaServicesResponse>(cfg, "/api/services");
  ok(Object.keys(data).sort());
}

async function actionInfo(cfg: HaConfig): Promise<void> {
  const api = await haGet<{ message?: string }>(cfg, "/api/");
  const config = await haGet<Record<string, unknown>>(cfg, "/api/config");
  ok({
    connected: true,
    baseUrl: cfg.baseUrl,
    message: api.data?.message,
    version: config.data?.version,
    state: config.data?.state,
    unitSystem: config.data?.unit_system,
    timeZone: config.data?.time_zone,
    components: config.data?.components,
  });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("ha-list")
  .description("Read-only Home Assistant queries (states, services, info)")
  .option("--base-url <url>", "Home Assistant base URL (e.g. http://homeassistant.local:8123)")
  .option("--token <token>", "Long-lived access token (usually resolved from the assistant vault)");

program
  .command("states")
  .description("List all entity states")
  .argument("[entity-id]", "Entity ID or glob to filter (e.g. light.*, sensor.kitchen_temp)")
  .option("--domain <domain>", "Filter by integration domain (e.g. light, sensor)")
  .action(async (entityId: string | undefined, opts: { domain?: string }) => {
    const cfg = resolveHaConfig({ baseUrl: program.opts().baseUrl, token: program.opts().token });
    try {
      await actionStates(cfg, { entityId, domain: opts.domain });
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  });

program
  .command("entity")
  .description("Get a single entity's state")
  .argument("<entity-id>", "Entity ID (e.g. light.living_room)")
  .action(async (entityId: string) => {
    const cfg = resolveHaConfig({ baseUrl: program.opts().baseUrl, token: program.opts().token });
    try {
      await actionEntity(cfg, entityId);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  });

program
  .command("services")
  .description("List available services, grouped by domain")
  .option("--domain <domain>", "Only show services for one domain")
  .action(async (opts: { domain?: string }) => {
    const cfg = resolveHaConfig({ baseUrl: program.opts().baseUrl, token: program.opts().token });
    try {
      await actionServices(cfg, opts);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  });

program
  .command("domains")
  .description("List integration domains that expose at least one service")
  .action(async () => {
    const cfg = resolveHaConfig({ baseUrl: program.opts().baseUrl, token: program.opts().token });
    try {
      await actionDomains(cfg);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  });

program
  .command("info")
  .description("Check connectivity and print instance version/config")
  .action(async () => {
    const cfg = resolveHaConfig({ baseUrl: program.opts().baseUrl, token: program.opts().token });
    try {
      await actionInfo(cfg);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  });

program.parse();
