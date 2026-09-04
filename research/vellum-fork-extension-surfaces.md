# Vellum Fork — Extension Surface Map

**Repo:** `/Users/francisco/Downloads/VELLUM-BY-HERMES/vellum-fork` (Vellum Assistant monorepo, Bun + TypeScript, v0.11.9)
**Goal:** Determine the correct extension point for shipping new channels and provider-configurable tools.
**Mode:** READ-ONLY exploration; no repo files modified.

---

## 1. TL;DR — decision matrix

| You want to ship… | Use | Key files |
|---|---|---|
| A new **channel reachable from the public internet** (vendor webhooks/WebSocket push to the assistant) | **Plugin with `channels/ingress.json` + `routes/`** | `skills/plugin-builder/references/channels.md`, `gateway/src/channels/plugin-ingress.ts` |
| A new **tool the model calls every turn** (e.g. web search with custom provider, X search, video gen) | **Plugin `tools/<name>.ts`** (+ `resolveCredential` for keys, `config.json` for provider selection) | `skills/plugin-builder/references/tools.md`, `assistant/src/plugin-api/index.ts` |
| A **tool that should only exist while a workflow is relevant** | **Plugin skill with skill-scoped `TOOLS.json` + `tools/<executor>.ts`** | `skills/plugin-builder/references/skills.md`, `assistant/src/config/bundled-skills/**/TOOLS.json` |
| Reusing an **existing MCP server** | **Plugin `mcp.json`** | `skills/plugin-builder/references/mcp.md`, `assistant/src/mcp/manager.ts` |
| Polling an API / bidirectional channel with **no public ingress needed** (Home Assistant, A2A client, WhatsApp via outbound REST) | **Plugin tool (+ optional `init` hook poller/event-hub subscription)** | `references/tools.md`, `references/hooks.md`, `assistant/src/plugin-api/conversation-turn.ts` |
| Turning an existing LLM endpoint into tool logic **without handling keys** | Plugin tool calling **`getConfiguredProvider()`** | `assistant/src/plugin-api/index.ts` (export from `providers/provider-send-message.js`) |
| Personal, non-distributed extension (no packaging) | **Direct workspace contribution**: drop files into `/workspace/tools/`, `/workspace/skills/`, `/workspace/hooks/` | `references/plugins.md` §"Each surface can also be dropped straight into the workspace" |

**Cardinal rule:** Plugins are for distribution; workspace drops are for personal extension. Everything a plugin imports must come from **`@vellumai/plugin-api`** (`assistant/src/plugin-api/index.ts`) — the only supported contract. Plugins are **beta**: declare a real `peerDependencies["@vellumai/plugin-api"]` semver range.

---

## 2. The plugin system

### 2.1 Surfaces a plugin can bundle (from `skills/plugin-builder/SKILL.md`)

| Surface | Lives in | What it does |
|---|---|---|
| Lifecycle hooks | `hooks/<name>.ts` | Code at fixed points of the agent loop / lifecycle; can mutate context (`pre-model-call`, `post-tool-use`, `user-prompt-submit`, `stop`, `init`, `shutdown`, `conversation-deleted`, `post-compact`, `post-model-call`) |
| Skills | `skills/<name>/` | Instruction bundles loaded on demand; may carry skill-scoped `TOOLS.json` |
| Model-visible tools | `tools/<name>.ts` | New tools in the same catalog as built-ins; filename = tool name |
| MCP servers | `mcp.json` | Declared servers, tools land as `mcp__<id>__<tool>` |
| HTTP routes | `routes/<path>.ts` | Served at `/x/plugins/<name>/<path>` (internal callers, apps, handler behind public ingress) |
| **Channels** | **`channels/ingress.json`** | Public webhook/WebSocket routes; gateway signature-checks and forwards |
| Apps | `apps/<name>/` | Preact+TSX interactive panels |

### 2.2 Directory layout & manifest

```
my-plugin/
├── package.json          # Manifest: name, version, peerDependencies["@vellumai/plugin-api"]
├── mcp.json              # Optional MCP servers
├── config.json           # User-editable config (read via InitContext.config; preserved on upgrade)
├── data/                 # Plugin-owned durable state (InitContext.pluginStorageDir)
├── hooks/  tools/  routes/  channels/  skills/  apps/
└── src/                  # Internal modules — NOT walked by the loader
```

Manifest (`references/plugins.md`): `name` (scope stripped at runtime, kebab-case), `version`, `peerDependencies["@vellumai/plugin-api"]` (required range; currently logged, will harden to reject). Optional presentation fields for channels list: `displayName`, `description`, `icon` (Lucide name). Optional `credentialKeyPatterns` in `package.json` to teach the key-scanner provider key formats (validated grammar, max 5, RE2-safe; see `skills/AGENTS.md`).

Loader rules: compiled `.js` beats `.ts`; missing dirs skipped; broken surface fails only itself; 10s import budget per plugin; `config.json`/`data/`/`.disabled` are runtime-owned, excluded from drift detection.

### 2.3 Key implementation files (assistant side)

- `assistant/src/plugins/registry.ts`, `external-plugin-loader.ts`, `plugin-tree-walk.ts`, `pipeline.ts`, `surface-import.ts`, `installed-plugin-dirs.ts`, `mcp-servers.ts`, `source-fingerprint.ts`, `disabled-state.ts`
- `assistant/src/plugins/defaults/` — **in-repo canonical plugin examples**: `image-fallback/` (init/shutdown/conversation-deleted storage lifecycle), `memory/`, `tool-result-truncate/`, `max-tokens-continue/`, `platform-hosted/routes/reengage.ts` (example of a plugin HTTP route), `turn-context/`, `empty-response/`
- `assistant/src/plugins/AGENTS.md` — plugin self-containment rules (state in `data/`, schema in `init`, close in `shutdown`, purge in `conversation-deleted`, fail open)

### 2.4 The public API surface (`assistant/src/plugin-api/index.ts`)

Runtime handles (values) relevant to channels/tools:

- **`getConfiguredProvider({ callSite, overrideProfile })`** → run inference through the workspace's configured profiles/credentials (BYOK or managed) — no plugin-supplied API key. Pair with `getModelProfiles()`, `doesSupportVision()`.
- **`resolveCredential(ref)` / `storeCredential()`** — credential vault access **scoped to the plugin's own service name** (plugin name = credential service). Throws `CredentialResolutionError`/`CredentialStoreError`.
- **`resolveWebhookUrl({ path })`** — public URL for a plugin's own ingress route (never hardcode a hostname).
- **`resolveOauthCallbackUrl()`** — shared OAuth redirect URI.
- **`runConversationTurn({ input, conversationId })`** — run a full agent-loop turn programmatically (for bridges that translate an external message into a turn, e.g. A2A/Home Assistant pollers).
- **`publishEvent` / `assistantEventHub`** (deprecated raw hub) — react to/subscribe to runtime events.
- **`synthesizeText`**, **`openTranscriptionSession`**, **`createLiveVoiceConnection`** — TTS/STT/live-voice, provider-credential-free (e.g. for voice channels).
- **`getWorkspaceDir`**, `listCatalogSkills`/`listInstalledSkills`, conversation-store facade (`getConversation`, `addMessage`, `isConversationProcessing`, …), embeddings facade (`embed`, `queryIndex`, plugin-scoped index), `persistSystemCard`, `resolveMediaSourceData`.
- Types: `ToolDefinition`, `ToolContext`, `ToolExecutionResult`, `RiskLevel`, `HookFunction`, all `*Context` types, `HOOKS`, `isMaxTokensStopReason`.

Other plugin-api files: `assistant/src/plugin-api/types.ts`, `constants.ts`, `credential-scope.ts`, `resolve-credential.ts`, `store-credential.ts`, `webhook-url.ts`, `model-profiles.ts`, `vision-support.ts`, `conversation-turn.ts`, `event-hub-facade.ts`, `publish-event.ts`, `transcription-session.ts`, `system-card.ts`, `ensure-plugin-api-shim.ts` (boot-time re-binding so plugins share the daemon's singletons even in `bun --compile` binaries).

---

## 3. Skills

### 3.1 First-party skills (`skills/` at repo root)

Pattern = **SKILL.md (YAML frontmatter + markdown body) + `scripts/*.ts` CLI helpers + optional `references/` + `assets/icon.svg`**. **No TOOLS.json** — see `skills/AGENTS.md`: "Do not include a TOOLS.json file in skill directories — skills should rely on CLI tools in `scripts/`, not custom tool definitions", and "Do not create new assistant tools and reference them from SKILL.md".

Examples inspected:

- `skills/gmail/` — SKILL.md + 10 scripts (`gmail-email.ts`, `gmail-manage.ts`, `gmail-scan.ts`, `gmail-archive.ts`, `gmail-commit.ts`, `gmail-runs.ts`, `gmail-prefs.ts`, `gmail-reverse.ts`, `gmail-auto-filters.ts`, `lib/gmail-client.ts`). Frontmatter: `name`, `description`, `compatibility`, `metadata.icon`, `metadata.vellum.{category, display-name, user-invocable}`.
- `skills/google-calendar/` — SKILL.md + `scripts/gcal.ts` + `scripts/lib/gcal-client.ts`.
- `skills/discord-app-setup/` — channel-setup skill pattern: check-config script first, then `ui_show` with `surface_type: "channel_setup"` and `data: { channel: "discord" }` (in-product wizard with masked password fields), secrets only via `assistant credentials prompt` / wizard — never pasted into chat. Scripts: `check-config.ts`, `validate-token.ts`, `store-bot-token.ts`, `print-invite-url.ts`.
- Other channel-setup skills: `skills/telegram-setup/`, `skills/slack-app-setup/`, `skills/twilio-setup/`, `skills/email-setup/`, `skills/resend-setup/`, `skills/llm-provider-setup/` (provider-config pattern), `skills/public-ingress/`.

`skills/AGENTS.md` rules that matter: scripts pin dependency versions **in import paths** (`import { Command } from "commander@13.1.0"`), no `package.json` in skill dirs, secrets via `assistant credentials prompt` (exit 130 = user dismissed, valid) or `ui_show channel_setup`, `assistant credentials set --generated` only for machine-generated values, `credentialKeyPatterns` declaration for keyed APIs, user-gated irreversible actions.

### 3.2 Plugin skills & skill-scoped TOOLS.json

A plugin ships skills under `skills/<name>/`. A **plugin skill** may declare `TOOLS.json` at the skill root (format: `{ version: 1, tools: [{ name, description, category, risk, input_schema, executor: "tools/<name>.ts", execution_target: "sandbox" }] }`). Rules (`references/skills.md`):

- Executors export `run(input, context) => { content, isError }`, run in the **skill sandbox** (node stdlib only, no imports outside the skill dir, `VELLUM_WORKSPACE_DIR` available). Plugin skills must declare `execution_target: "sandbox"`; `"host"` refused for non-first-party.
- Tools register when the skill activates, unregister on deactivation; dispatched through `skill_execute` (not top-level wire tools). One owner per tool name; shared tools go in a carrier skill + `metadata.vellum.includes`.
- Reference implementation named in docs: the **`admin-copilot`** marketplace plugin's `admin-copilot-prefs` skill (external — not in this repo).

### 3.3 Bundled skills — the concrete in-repo TOOLS.json examples

`assistant/src/config/bundled-skills/**/TOOLS.json` + `tools/*.ts` executors (20 skills: messaging, transcribe, computer-use, media-processing, phone-calls, app-control, schedule, workflows, playbooks, …). Executor contract per `assistant/src/config/bundled-skills/AGENTS.md`: `run(input, context)` (`SkillToolScript` contract, `assistant/src/tools/skills/script-contract.ts`); host-executed executors get the full `ToolContext`. Example: `assistant/src/config/bundled-skills/transcribe/TOOLS.json` → `tools/transcribe-media.ts` (calls `resolveBatchTranscriber` from `providers/speech-to-text/resolve.js` — a provider-resolving executor). The **`messaging`** bundled skill (`.../messaging/TOOLS.json`) is the shared provider abstraction for gmail/outlook — `messaging_send` (`risk: high`), `messaging_read`, `messaging_search` with a `platform` param — the model for "provider-configurable tool" frontends.

### 3.4 Skills resolution order (`references/skills.md`)

Bundled → workspace `/workspace/skills/` → plugin `skills/`. First-found wins on name collisions. The model matches on `description` + `activation-hints`.

---

## 4. MCP support

- **Plugin-declared MCP:** root `mcp.json` in the plugin (`references/mcp.md`), follows the **Agent Plugins 1.0.0 MCP schema** (`https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`). Transports: `stdio`, `sse`, `streamable-http`. `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` interpolate in args/env/cwd (stdio only). Tool names: `mcp__<serverId>__<tool>` (serverId = plugin name + key, collapsed when identical). No credentials in manifest; plugin servers never resolve workspace `mcp:<serverId>:*` credentials; risk defaults to `low`; cap 20 tools/server; servers start/stop with plugin lifecycle.
- **Workspace MCP:** configured in settings (not by dropping mcp.json into workspace), OAuth support for HTTP transports. Implementation: `assistant/src/mcp/manager.ts` (connect, listTools, filter, maxTools), `client.ts`, `effective-config.ts`, `mcp-auth-orchestrator.ts`, `mcp-oauth-provider.ts`, `mcp-header-store.ts`, `mcp-auth-state.ts`, config schema `assistant/src/config/schemas/mcp.js`. Workspace `config.json` entry of the same id **outranks** a plugin's declaration.
- Plugin loader side: `assistant/src/plugins/mcp-servers.ts` (+ tests).
- **Guidance (`references/mcp.md`):** prefer a native plugin tool when writing the action yourself; ship `mcp.json` only to reuse an existing MCP server.

---

## 5. Channel ingress (the channel extension point)

### 5.1 Mechanism

`channels/ingress.json` in a plugin declares public routes; each is served at **`/webhooks/plugins/<plugin-name>/<path>`** and must have a matching handler in the plugin's `routes/` (e.g. `routes/events.ts` exporting `POST(request)`). Fields per route: `path` (canonical, no leading slash), `kind` (`http` | `websocket`), `description`, `handshake` (`signed-headers` default | `signed-query`, WS-only), `verification` (`hmac` parts or `standard-webhooks`), `inbound` (makes replies flow through the gateway's inbound pipeline as messages).

### 5.2 Gateway ownership

- `gateway/src/channels/plugin-ingress.ts` — zod schemas for the manifest; namespace prefix `PLUGIN_WEBHOOK_PREFIX = "/webhooks/plugins"`; canonical path enforcement; `IngressSignerSchema` (`plugin` | `vellum`).
- `gateway/src/channels/plugin-inbound.ts` — normalizes a plugin's webhook reply into an inbound event. **Hard invariants:** `sourceChannel` is stamped `plugin` (a plugin cannot claim `slack`/`telegram` to inherit their admission floor/contacts); every external id is prefixed `<plugin-name>:` (`pluginScopedId`), so contacts/conversations are disjoint per plugin and from built-in channels.
- `gateway/src/channels/ingress-inbound.ts` — the `inbound` declaration (default envelope vs dotted-path `fields` mapping, `identity`: `opaque`|`phone`|`email`, `map`/`default` vocabulary translation).
- `gateway/src/channels/ingress-verification.ts` — HMAC + standard-webhooks verification.
- `gateway/src/channels/plugin-ingress-approvals.ts` + `gateway/src/db/plugin-ingress-approval-store.ts` — guardian approval of a digest of the declaration (route/transport/handshake/verification/inbound changes re-trigger approval; description rewording does not).
- `gateway/src/http/plugin-ingress-handshake.ts`, `gateway/src/http/routes/channel-ingress.ts`, `channel-ingress-routes.ts`.
- `gateway/AGENTS.md` — all public ingress MUST go through the gateway; use `readLimitedBody()`; schema-first tolerant zod parsing of vendor payloads (`telegram/normalize.ts`, `whatsapp/normalize.ts`, `slack/message-schemas.ts` as reference implementations); gateway URLs only, never daemon `7821`.

### 5.3 Delivery contract for an inbound channel (from `references/channels.md`)

Handler reply shape: `{ message: { content, conversationExternalId, externalMessageId }, actor: { actorExternalId, displayName }, source: { chatType } }`; missing all fields = ack (delivery receipt). Unapproved/misconfigured routes answer `404`. Secret stored via `assistant credentials prompt` under the plugin's own service; declare only the field name in the manifest. After install the **guardian must approve** pending ingress in channels settings; a plugin cannot approve itself. The channels list UI reads `package.json` (`displayName`, `description`, `icon`); a plugin whose directory name is a built-in channel (`slack`, `telegram`) is skipped. Disabled plugins contribute no channel.

---

## 6. Concrete patterns for the target capabilities

### 6.1 New channels

**Pattern A — public-ingress channel (vendor pushes to the assistant):** e.g. a WhatsApp Cloud API bridge or any vendor-webhook channel.

```
whatsapp-bridge/
├── package.json            # name, version, peerDeps, displayName/description/icon, credentialKeyPatterns
├── config.json             # vendor account SID / phone id etc. (non-secret)
├── channels/ingress.json   # { "routes": [{ "path": "webhook", "kind": "http", "description": "...",
│                           #   "verification": { "kind": "hmac", "algorithm": "sha256",
│                           #     "secret": { "field": "webhook_secret" }, "signature": { "header": "X-Hub-Signature-256", "encoding": "hex", "prefix": "sha256=" }, "payload": ["body"] },
│                           #   "inbound": { "identity": "phone", "fields": { "content": "message.body", "conversationExternalId": "message.from", "externalMessageId": "message.id", "actorExternalId": "message.from" } } } ] }
├── routes/webhook.ts       # export async function POST(request) — parse vendor JSON, return the inbound envelope (or ack)
├── hooks/init.ts           # read config.json, set up data/ state
└── skills/whatsapp-bridge/ # optional setup skill (mirror skills/discord-app-setup: ui_show channel_setup + credentials prompt)
```

URL to hand the vendor: `await resolveWebhookUrl({ path: "webhook" })` from `@vellumai/plugin-api` (`assistant/src/plugin-api/webhook-url.ts`). WebSocket variant: `kind: "websocket"` (+ optional `signed-query` handshake). Outbound sends: the plugin's own tool/route calls the vendor REST API using `resolveCredential("<plugin>/<field>")`. If the vendor's payload is not an envelope, the `inbound.fields` mapping does the translation gateway-side.

**Pattern B — polling/bidirectional client channel (no public ingress):** e.g. Home Assistant, an A2A client. Home Assistant has a REST/WebSocket API the assistant dials — no need for ingress.

```
home-assistant/
├── package.json
├── config.json             # base URL, access token field name (non-secret values)
├── tools/ha-status.ts      # default-export ToolDefinition; execute() fetches HA REST API
│                           #   key from await resolveCredential("home-assistant/token") (catch CredentialResolutionError)
├── tools/ha-control.ts     # toggle lights/scenes etc. — defaultRiskLevel "medium"/"high"
└── skills/ha-control/      # optional skill with TOOLS.json if tools only matter during HA workflows
```

A2A client pattern additionally uses **`runConversationTurn`** (`assistant/src/plugin-api/conversation-turn.ts`) to run a turn against an inbound A2A message, and `publishEvent`/event-hub subscription or an `init`-hook poller for event-driven wakeups; `resolveOauthCallbackUrl` for OAuth where needed. For voice channels, `createLiveVoiceConnection` + `openTranscriptionSession` + `synthesizeText` provide the media stack credential-free.

**Where built-in channels differ (for contrast):** first-party channels (Telegram, WhatsApp, Slack, Discord, email/Resend/Mailgun, phone/Twilio) are compiled into the **gateway** (`gateway/src/channels/` — `telegram/normalize.ts`, `whatsapp/normalize.ts`, `slack/message-schemas.ts`) with setup **skills** (`skills/telegram-setup/`, `skills/twilio-setup/` …). Shipping a brand-new first-party channel means gateway code + admission/trust wiring; shipping it as a plugin gets the `plugin`-stamped channel with guardian approval and per-plugin id namespacing instead.

### 6.2 Provider-configurable tools

**Pattern C — always-available provider tool:** e.g. web search with a custom provider, X search, video generation.

```
web-search-pro/
├── package.json            # + "credentialKeyPatterns": [{ "label": "…", "pattern": "…" }]
├── config.json             # { "provider": "tavily" | "brave" | … } — user-editable, read via InitContext.config
├── hooks/init.ts           # load config.json, cache selected provider in data/
└── tools/websearch.ts      # default-export ToolDefinition:
                            #   description (written for the model), input_schema { query, count, freshness },
                            #   category: "search", defaultRiskLevel: "low",
                            #   execute(input, ctx): pick provider adapter from an internal registry
                            #   (mirror the core pattern in assistant/src/tools/network/web-search.ts:
                            #    WEB_SEARCH_ADAPTERS with id / providerKeyName / fallbackOrder / execute),
                            #   key = await resolveCredential("web-search-pro/<provider>_api_key"),
                            #   forward ctx.signal to fetch, return { content, isError }
```

The core's own adapter pattern is the template: `assistant/src/tools/network/web-search.ts` (1618 lines) defines `WebSearchProvider` union, `WebSearchAdapter` interface (`id`, `providerKeyName` → `getProviderKeyAsync` secret-catalog lookup, `fallbackOrder`, optional `keyless`, `execute(args)`), and a fallback chain across BYOK providers (perplexity/brave/tavily/firecrawl/keenable/fastcrw) plus `firecrawl-compat.ts` for Firecrawl-compatible endpoints. A plugin replicates this registry internally with keys from the plugin-scoped credential vault instead of the built-in secret catalog.

- **X search:** same shape — `tools/xsearch.ts` with `input_schema { query, count, since }`, keys via `resolveCredential`, `credentialKeyPatterns` declaring the token format.
- **Video gen:** `tools/videogen.ts` with `input_schema { prompt, style, duration }`, `defaultRiskLevel: "high"` (side effect = provider cost/artifact), provider chosen from `config.json`; store generation job ids in `data/` (plugin-owned state) and `conversation-deleted` purges. If the provider needs LLM calls too, `getConfiguredProvider()` avoids shipping a second key. Result: `{ content, contentBlocks }` can carry the media block back to the model.
- **Provider-configurable alternative when an MCP server already exists:** `mcp.json` entry — but note plugin MCP tools are risk-`low` by default and carry no credential reference fields; workspace `config.json` same-id entry can override risk/transport.

Tool naming: filename = model-visible name; prefix-namespace to dodge collisions (resolution order: core > workspace > MCP > default plugins > user plugins; user-plugin collisions with anything earlier are skipped).

**Pattern D — skill-scoped tools (zero cost when inactive):** when the tool only matters during a workflow (e.g. "generate video" inside a video-production skill), declare it in that skill's `TOOLS.json` with a sandbox `tools/*.ts` executor instead of `tools/` — registers only while the skill is active (`references/skills.md`, `references/tools.md` "Always-on cost — prefer skill-scoped tools").

---

## 7. Constraint & pitfall checklist

1. **`@vellumai/plugin-api` is the only contract** — anything else is internal (`references/plugins.md`). Declare the peer-dep range; it's beta and will harden.
2. **Credentials:** plugin service name = directory name; `resolveCredential` is scoped to it; store secrets via `assistant credentials prompt` / `ui_show channel_setup` (never chat); `storeCredential` writes only within the plugin's own scope.
3. **State:** only under `data/` (init/shutdown/conversation-deleted lifecycle); no main-DB tables, no plugin migrations (`assistant/src/plugins/AGENTS.md`, enforced by `plugin-state-boundary-guard.test.ts`).
4. **Ingress:** gateway-side approval digest; unsigned/undeclared = 404; channel stamped `plugin`; ids prefixed `<plugin>:`. Public URLs only via `resolveWebhookUrl`/`resolveOauthCallbackUrl`. Webhooks must `readLimitedBody()` (gateway-side).
5. **Risk/permissions:** every tool has `defaultRiskLevel` (`medium` prompts once, then allows); `category` feeds channel-scoped `allowedToolCategories`; `executionTarget` resolved by `host_`/`computer_use_` name prefix otherwise sandbox.
6. **First-party `skills/` dir must NOT contain TOOLS.json** (`skills/AGENTS.md`) — that's a plugin-skill/bundled-skill feature only; scripts pin deps in import paths.
7. **New core tools are strongly discouraged** (`assistant/src/tools/AGENTS.md` — pre-commit hook blocks, needs core-team approval): prefer skills/plugins.
8. **Surfaces not yet available via plugins** (`references/plugins.md`): schedules, artifacts, prompts, UIs, bin, integrations, slash commands.

## 8. Authoritative docs shipped in-repo

- `skills/plugin-builder/SKILL.md` + `references/{plugins,hooks,tools,skills,mcp,routes,channels,apps,distribution}.md` — the complete authoring contract (start here).
- `skills/AGENTS.md` — first-party skills contribution rules.
- `assistant/src/plugins/AGENTS.md`, `assistant/src/tools/AGENTS.md`, `assistant/src/config/bundled-skills/AGENTS.md`, `gateway/AGENTS.md` — service rules.
- `assistant/src/plugin-api/index.ts` — the public export surface (types + runtime handles).
