#!/usr/bin/env bun

/**
 * A2A v1.0 JSON-RPC client.
 *
 * Sends a message to a remote A2A agent (discovered via its agent card) and
 * polls the task until it reaches a terminal state, then prints the result.
 *
 * Subcommands:
 *   send <--card <url>> <message>   — fetch agent card, POST message/send, poll
 *   status <--card <url>> --task-id <id> — poll an existing task to completion
 *
 * Self-contained: implements the wire format directly (no A2A SDK), and only
 * depends on commander pinned in the import path.
 *
 * Wire format reference: A2A v1.0 spec (see references/a2a-wire-format.md).
 */

import { Command } from "commander@13.1.0";

// ---------------------------------------------------------------------------
// JSON output helpers (gmail skill convention)
// ---------------------------------------------------------------------------

function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + "\n");
}

function printError(message: string): never {
  printJson({ ok: false, error: message });
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Protocol constants (mirrors A2A v1.0)
// ---------------------------------------------------------------------------

const A2A_CONTENT_TYPE = "application/a2a+json";
const A2A_VERSION_HEADER = "A2A-Version";
const A2A_VERSION = "1.0";
const AGENT_CARD_SUFFIX = "/.well-known/agent-card.json";

/** Terminal states per the A2A v1.0 spec (including input_required — see note). */
const TERMINAL_STATES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "canceled",
  "rejected",
  "input_required",
]);

// ---------------------------------------------------------------------------
// Types (subset of the A2A v1.0 wire types)
// ---------------------------------------------------------------------------

interface AgentCard {
  name?: string;
  description?: string;
  version?: string;
  supported_interfaces?: AgentInterface[];
  default_input_modes?: string[];
  default_output_modes?: string[];
  capabilities?: { streaming?: boolean; push_notifications?: boolean };
  skills?: Array<{ id: string; name?: string; description?: string }>;
}

interface AgentInterface {
  url: string;
  protocol_binding?: string;
  protocol_version?: string;
}

interface TextPart {
  kind: "text";
  text: string;
}

interface Part {
  kind: string;
  text?: string;
  data?: Record<string, unknown>;
  media_type?: string;
  url?: string;
  filename?: string;
}

interface TaskStatus {
  state: string;
  message?: { role: string; parts: Part[] };
  timestamp?: string;
}

interface Artifact {
  artifact_id?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
}

interface A2ATask {
  id: string;
  context_id?: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: unknown[];
  metadata?: Record<string, unknown>;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: { task?: A2ATask; message?: { role: string; parts: Part[] } };
  error?: JsonRpcError;
}

// ---------------------------------------------------------------------------
// Card resolution
// ---------------------------------------------------------------------------

/** Normalize a --card / --base argument into an agent card URL. */
function cardUrlFrom(input: string): string {
  const trimmed = input.replace(/\/+$/, "");
  if (trimmed.endsWith("agent-card.json")) return trimmed;
  return trimmed + AGENT_CARD_SUFFIX;
}

/** Fetch and validate an agent card. */
async function fetchAgentCard(cardUrl: string): Promise<AgentCard> {
  let response: Response;
  try {
    response = await fetch(cardUrl, {
      headers: { Accept: A2A_CONTENT_TYPE + ", application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not fetch agent card at ${cardUrl}: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(`Agent card fetch failed: HTTP ${response.status} from ${cardUrl}`);
  }
  try {
    return (await response.json()) as AgentCard;
  } catch {
    throw new Error(`Agent card at ${cardUrl} is not valid JSON`);
  }
}

/**
 * Pick the JSON-RPC endpoint for the agent.
 * Prefers a supported_interfaces entry with protocol_binding "jsonrpc",
 * then any interface entry, then the card URL's origin as a fallback.
 */
function resolveEndpoint(card: AgentCard, cardUrl: string): string {
  const interfaces = card.supported_interfaces ?? [];
  const jsonRpc = interfaces.find((i) => (i.protocol_binding ?? "").toLowerCase() === "jsonrpc");
  const chosen = jsonRpc ?? interfaces[0];
  if (chosen?.url) return chosen.url.replace(/\/+$/, "");
  // Fallback: the agent card URL lives at {base}/.well-known/agent-card.json
  const base = cardUrl.replace(/\/\.well-known\/agent-card\.json\/?$/, "");
  return base.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// JSON-RPC transport
// ---------------------------------------------------------------------------

function buildHeaders(): Record<string, string> {
  return {
    "Content-Type": A2A_CONTENT_TYPE,
    Accept: A2A_CONTENT_TYPE,
    [A2A_VERSION_HEADER]: A2A_VERSION,
    "User-Agent": "vellum-a2a-client-skill/1.0",
  };
}

async function rpcCall(
  endpoint: string,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<JsonRpcResponse> {
  const body = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method,
    params,
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${method} against ${endpoint} failed: ${detail}`);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  let parsed: JsonRpcResponse;
  try {
    parsed = JSON.parse(text) as JsonRpcResponse;
  } catch {
    throw new Error(`${method} returned a non-JSON response: ${text.slice(0, 200)}`);
  }

  if (parsed.error) {
    throw new Error(
      `JSON-RPC error ${parsed.error.code}: ${parsed.error.message}` +
        (parsed.error.data !== undefined ? ` (${JSON.stringify(parsed.error.data)})` : ""),
    );
  }
  return parsed;
}

/** Concatenate all text parts of a message into a single string. */
function extractText(parts: Part[] | undefined): string {
  return (parts ?? [])
    .filter((p): p is TextPart => p.kind === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

/** Extract text from task artifacts (and status message) for a readable result. */
function extractTaskText(task: A2ATask): string {
  const chunks: string[] = [];
  for (const artifact of task.artifacts ?? []) {
    const text = extractText(artifact.parts);
    if (text) chunks.push(text);
  }
  const statusText = extractText(task.status.message?.parts);
  if (statusText) chunks.push(statusText);
  return chunks.join("\n");
}

// ---------------------------------------------------------------------------
// Task lifecycle
// ---------------------------------------------------------------------------

interface PollOptions {
  intervalMs: number;
  timeoutMs: number;
}

const DEFAULT_POLL: PollOptions = { intervalMs: 2_000, timeoutMs: 120_000 };

/**
 * Poll tasks/get until the task reaches a terminal state or the deadline.
 * Returns the last known task and whether it is terminal.
 */
async function pollUntilTerminal(
  endpoint: string,
  taskId: string,
  poll: PollOptions,
): Promise<{ task: A2ATask; terminal: boolean }> {
  const deadline = Date.now() + poll.timeoutMs;
  let task: A2ATask | null = null;

  while (true) {
    const res = await rpcCall(endpoint, "tasks/get", { id: taskId }, poll.timeoutMs);
    task = res.result?.task ?? null;
    if (!task) {
      throw new Error(`tasks/get for ${taskId} returned no task`);
    }
    if (TERMINAL_STATES.has(task.status.state)) {
      return { task, terminal: true };
    }
    if (Date.now() >= deadline) {
      return { task, terminal: false };
    }
    await Bun.sleep(Math.min(poll.intervalMs, Math.max(0, deadline - Date.now())));
  }
}

interface SendResult {
  endpoint: string;
  agentName?: string;
  taskId: string;
  state: string;
  terminal: boolean;
  text: string;
  task: A2ATask;
}

async function sendMessage(opts: {
  endpoint: string;
  card: AgentCard;
  messageText: string;
  configuration?: unknown;
  poll: PollOptions;
  once: boolean;
}): Promise<SendResult> {
  const message = {
    message_id: crypto.randomUUID(),
    role: "user",
    parts: [{ kind: "text", text: opts.messageText }],
  };

  const params: Record<string, unknown> = { message };
  if (opts.configuration !== undefined) {
    params.configuration = opts.configuration;
  }

  const res = await rpcCall(opts.endpoint, "message/send", params, opts.poll.timeoutMs);

  // Immediate reply (e.g. return_immediately) — no task to poll
  if (res.result?.message) {
    const text = extractText(res.result.message.parts);
    const synthetic: A2ATask = {
      id: "n/a",
      status: { state: "completed", message: res.result.message },
    };
    return {
      endpoint: opts.endpoint,
      agentName: opts.card.name,
      taskId: "n/a",
      state: "completed",
      terminal: true,
      text,
      task: synthetic,
    };
  }

  const initialTask = res.result?.task;
  if (!initialTask) {
    throw new Error("message/send response contained neither a task nor a message");
  }

  const { task, terminal } = opts.once
    ? { task: initialTask, terminal: TERMINAL_STATES.has(initialTask.status.state) }
    : await pollUntilTerminal(opts.endpoint, initialTask.id, opts.poll);

  return {
    endpoint: opts.endpoint,
    agentName: opts.card.name,
    taskId: task.id,
    state: task.status.state,
    terminal,
    text: extractTaskText(task),
    task,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("a2a-task")
  .description("Send tasks to remote A2A agents via the A2A v1.0 JSON-RPC protocol");

const cardOption = (cmd: Command): Command =>
  cmd.option(
    "--card <url>",
    "Agent card URL or base URL of the remote agent (e.g. https://agent.example.com or https://agent.example.com/.well-known/agent-card.json)",
  );

function parsePollFlags(opts: {
  timeout?: string;
  interval?: string;
}): PollOptions {
  const poll: PollOptions = { ...DEFAULT_POLL };
  if (opts.timeout) {
    const s = Number(opts.timeout);
    if (!Number.isFinite(s) || s <= 0) printError("--timeout must be a positive number of seconds");
    poll.timeoutMs = Math.round(s * 1000);
  }
  if (opts.interval) {
    const s = Number(opts.interval);
    if (!Number.isFinite(s) || s <= 0) printError("--interval must be a positive number of seconds");
    poll.intervalMs = Math.round(s * 1000);
  }
  return poll;
}

cardOption(program.command("send"))
  .description("Send a message to a remote agent and wait for the task to finish")
  .argument("<message>", "Message text to send")
  .option("--url <endpoint>", "Skip agent-card discovery and POST directly to this endpoint")
  .option("--config <json>", "Extra SendMessage configuration as JSON (e.g. '{\"history_length\":0}')")
  .option("--timeout <seconds>", `Max polling time (default ${DEFAULT_POLL.timeoutMs / 1000}s)`)
  .option("--interval <seconds>", `Poll interval (default ${DEFAULT_POLL.intervalMs / 1000}s)`)
  .option("--once", "Do not poll — return the task state right after message/send")
  .action(async (messageText: string, opts: Record<string, unknown>) => {
    const parent = program.opts();
    const cardArg = (opts.card ?? parent.card) as string | undefined;
    const poll = parsePollFlags({ timeout: opts.timeout as string, interval: opts.interval as string });

    let configuration: unknown;
    if (opts.config !== undefined) {
      try {
        configuration = JSON.parse(opts.config as string);
      } catch (err) {
        printError(`Invalid JSON for --config: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      let endpoint: string;
      let card: AgentCard = {};
      if (opts.url !== undefined) {
        endpoint = (opts.url as string).replace(/\/+$/, "");
      } else {
        if (!cardArg) printError("Missing required option --card (or --url)");
        const cardUrl = cardUrlFrom(cardArg);
        card = await fetchAgentCard(cardUrl);
        endpoint = resolveEndpoint(card, cardUrl);
      }

      const result = await sendMessage({
        endpoint,
        card,
        messageText,
        configuration,
        poll,
        once: opts.once === true,
      });

      printJson({ ok: true, data: result });
      if (!result.terminal) process.exit(2);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  });

cardOption(program.command("status"))
  .description("Poll an existing task on a remote agent until it reaches a terminal state")
  .requiredOption("--task-id <id>", "Task ID returned by a previous send")
  .option("--url <endpoint>", "Skip agent-card discovery and POST directly to this endpoint")
  .option("--timeout <seconds>", `Max polling time (default ${DEFAULT_POLL.timeoutMs / 1000}s)`)
  .option("--interval <seconds>", `Poll interval (default ${DEFAULT_POLL.intervalMs / 1000}s)`)
  .action(async (opts: Record<string, unknown>) => {
    const parent = program.opts();
    const cardArg = (opts.card ?? parent.card) as string | undefined;
    const poll = parsePollFlags({ timeout: opts.timeout as string, interval: opts.interval as string });

    try {
      let endpoint: string;
      if (opts.url !== undefined) {
        endpoint = (opts.url as string).replace(/\/+$/, "");
      } else {
        if (!cardArg) printError("Missing required option --card (or --url)");
        const cardUrl = cardUrlFrom(cardArg);
        const card = await fetchAgentCard(cardUrl);
        endpoint = resolveEndpoint(card, cardUrl);
      }

      const { task, terminal } = await pollUntilTerminal(
        endpoint,
        opts.taskId as string,
        poll,
      );
      printJson({
        ok: true,
        data: {
          endpoint,
          taskId: task.id,
          state: task.status.state,
          terminal,
          text: extractTaskText(task),
          task,
        },
      });
      if (!terminal) process.exit(2);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
    }
  });

program.parse();
