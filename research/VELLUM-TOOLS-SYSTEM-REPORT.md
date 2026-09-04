# Vellum Tools System — Mapping Report

Repo: `/Users/francisco/Downloads/VELLUM-BY-HERMES/vellum-fork` (Bun + TypeScript monorepo, v0.11.9)
Scope: `assistant/src/tools/`, `assistant/src/config/bundled-skills/`, `assistant/src/skills/`, `skills/` (repo root)
All paths below are relative to the repo root. Line numbers verified by direct reads.

---

## 1. Tool Registration Architecture (3 layers)

### 1a. Core (built-in) tools — declarative manifest
- **`assistant/src/tools/tool-manifest.ts`** — single source of truth. `explicitTools` array (lines 53–80) lists 26 core tools:
  `shell`, `file_read`, `file_write`, `file_edit`, `file_list`, `code_search`, `web_fetch`, `web_search`,
  `skill_execute`, `skill_load`, `request_system_permission`, `remember`, `recall`, `delete_memory_page`,
  `notify_parent`, `ask_question`, `react_to_message`, `host_file_read`, `host_file_write`, `host_file_edit`,
  `host_file_transfer`, `host_shell`, `ui_show`, `ui_update`, `ui_dismiss`, `watch_retro_report`.
  Comment at lines 42–51: imports MUST be static (Bun `--compile` breaks dynamic imports).
- **`assistant/src/tools/registry.ts`** — global `Map<string, Tool>`:
  - `registerTool()` (line 137) — built-ins, owner = `DEFAULT_TOOL_OWNER` ("default").
  - `initializeTools()` (line 1065) / `runToolInitialization()` (line 1077): registers `explicitTools` → `loadWorkspaceTools()` (workspace overrides, `workspace-tools/loader.ts`) → `loadPluginTools()` (plugin mtime-cache reconcile).
  - `registerSkillTools(skillId, tools)` (line 250) — refcounted, hot-reloadable, skips core-name collisions.
  - `registerPluginTools()` (line 326), `registerMcpTools()` (line 564), `registerWorkspaceTools()` (line 747), `removeCoreToolViaWorkspace()` (line 884, `<name>.removed` sentinels).
  - Owners tracked in `ownersByName` (line 20); `getToolOwner()` (line 230) is the anti-spoofing authority.
  - `getAllToolDefinitions()` (line 1031) excludes skill tools (session-level projection adds them).
- **Gate for new core tools:** `assistant/src/tools/AGENTS.md` — **new non-skill tools strongly discouraged**; pre-commit hook blocks `registerTool()` additions; prefer skills or CLI tools invoked via `bash`.

### 1b. Skill tools (TOOLS.json) — the sanctioned extension path
- **`assistant/src/tools/skills/skill-tool-factory.ts`** — `createSkillTool()` (line 30) maps a `SkillToolEntry` to a runtime `Tool`; execution routes to `runSkillToolScript()` (`skill-script-runner.ts`) using `entry.executor` + `entry.execution_target`.
- **`assistant/src/tools/skills/load.ts`** — `loadToolManifest()` (line 63) reads `TOOLS.json` from a skill dir; `formatToolSchemas()` (line 89) renders an "Available Tools — use `skill_execute`" section into the prompt.
- **`assistant/src/daemon/conversation-skill-tools.ts`** — `projectSkillTools()` projects active skills' tools per turn (preactivation, activation hints, progressive disclosure). `skill_execute` is the dispatch tool.
- **`assistant/src/skills/tool-manifest.ts`** — `parseToolManifest()` (line 14) validates TOOLS.json strictly.
- **Important policy:** repo-root `skills/AGENTS.md` says portable first-party skills **must NOT ship TOOLS.json** ("skills should rely on CLI tools in `scripts/`"). TOOLS.json is used by **bundled skills** (`assistant/src/config/bundled-skills/**`) and user workspace/managed skills.

### 1c. Plugin / MCP / workspace tools
- Plugins: declarative `tools/` dir in plugin package (`plugin-api/index.ts` lines 12–17); registry pulls via `plugins/mtime-cache.ts` → `registerPluginTools`.
- MCP: `tools/mcp/mcp-tool-factory.ts`; `registerMcpTools` / `unregisterAllMcpTools` (registry.ts 564/630), reload via `vellum mcp reload`.
- Workspace: `<workspaceDir>/tools/<name>.{ts,js,json}` + `.removed` sentinels (`tools/workspace-tools/loader.ts`).

### 1d. Per-turn tool gating (the "platform_toolsets" equivalent)
**`assistant/src/daemon/conversation-tool-setup.ts`** is the chokepoint:
- `HOST_TOOL_TO_CAPABILITY` (line 643): `host_bash→host_bash`, `host_file_read/write/edit/transfer→host_file`, `host_browser→host_browser`; `HOST_TOOL_NAMES` derived (line 653).
- `CROSS_CLIENT_EXPOSED_CAPABILITIES` (line 681): host_bash, host_file, host_browser (web/iOS turns route to connected desktop clients; chrome-extension excluded; same-actor guard).
- `CLIENT_CAPABILITY_TOOL_NAMES` (line 687): `ask_question`; `PLATFORM_TOOL_NAMES` (line 688): `request_system_permission` (desktop-OS only).
- `SUBAGENT_ONLY_TOOL_NAMES` (line 695); `ALLOWLIST_ONLY_TOOL_NAMES` (line 712, `delete_memory_page`).
- `isToolActiveForContext()` (line 763): applies subagent allowlists, read-only pass (`READ_ONLY_ALLOWED_TOOLS` line 210), `toolsDisabledDepth`, disk-pressure, memory flag, channel UI capability, per-capability host checks, `supportedClientOs` (Windows parity, line 744), `config.tools.exclude`.
- `createResolveToolsCallback()` (line 941): per-turn merge of core snapshot + live plugin/MCP/workspace defs + skill projection; `getEffectiveEnabledPluginSet()` (line 166).
- Capabilities enum: `assistant/src/channels/types.ts` `HOST_PROXY_CAPABILITIES` (line 306): host_bash, host_file, host_cu, host_browser, host_app_control, host_ui_snapshot.

---

## 2. Web Search & Scraping ✅ (exists, fully provider-configurable)

**Tool:** `web_search` — `assistant/src/tools/network/web-search.ts` line 1448 (`webSearchTool`, schema: query/count/offset/freshness, `executionTarget: "sandbox"`).
**Tool:** `web_fetch` — `assistant/src/tools/network/web-fetch.ts` line 1504 (page extraction → LLM-friendly text; SSRF-guarded: private-host blocking, `allow_private_network` flag; `url-safety.ts`, `domain-normalize.ts`).

**Provider catalog:** `assistant/src/providers/search-provider-catalog.ts` `SEARCH_PROVIDER_CATALOG` (line 89):
| id | kind | env var | fallbackOrder |
|---|---|---|---|
| `vellum` | managed (platform proxy, billed) | — | — |
| `inference-provider-native` | managed (model's hosted search) | — | — |
| `perplexity` | byok | PERPLEXITY_API_KEY | 1 |
| `brave` | byok | BRAVE_API_KEY | 2 |
| `tavily` | byok | TAVILY_API_KEY | 3 |
| `firecrawl` | byok | FIRECRAWL_API_KEY | 4 |
| `keenable` | byok, keyless | KEENABLE_API_KEY | 5 |
| `fastcrw` | byok (self-host capable, `supportsApiBase`) | — | 6 |

**Adapters & fallback chain:** `web-search.ts` `WEB_SEARCH_ADAPTERS` (line 1427) keyed by provider; `WEB_SEARCH_FALLBACK_ORDER` (line 1441) sorted by fallbackOrder. Dispatcher in `execute()` (lines 1496–1595):
1. `provider === "vellum"` → managed search via platform proxy, no BYOK fallback (lines 1496–1534).
2. `inference-provider-native` (default) → model's native hosted search when supported; else app-executed path: user keys win → fallback chain → platform proxy as last resort (lines 1579–1586).
3. Missing key for BYOK provider → try other BYOK providers in fallbackOrder (lines 1553–1570); keyless providers run without a key.

**Config points:**
- `assistant/src/config/schemas/services.ts`: `VALID_WEB_SEARCH_PROVIDERS` (line 32, derived from `SEARCH_PROVIDER_IDS`), `WebSearchServiceSchema` (line 75, default `inference-provider-native`, optional `apiBase`).
- Keys: `security/secure-keys.ts` `getProviderKeyAsync()`; secret catalog `providers/provider-secret-catalog.ts` `SEARCH_API_KEY_PROVIDERS` (line 57); env-var map `providers/provider-env-vars.ts` `SEARCH_PROVIDER_ENV_VAR_NAMES` (line 29); CLI `keys set <provider> <key>`; Settings → API Keys.
- Adding a provider = 4 steps documented in search-provider-catalog.ts lines 19–25 (adapter in web-search.ts → WEB_SEARCH_ADAPTERS → catalog entry → `bun run sync:web-search-catalog`).
- Managed proxy: `tools/network/managed-search-proxy.ts`; Firecrawl-compatible response shape: `tools/network/firecrawl-compat.ts`.
- Outbound network from skills/`bash` is intercepted by the outbound proxy (`assistant/src/outbound-proxy/`; skills declare `network_mode: "proxied"` + `credential_ids` — see gateway/AGENTS.md and skills/AGENTS.md).

---

## 3. Browser Automation ✅ (exists — CLI + skill, NOT an LLM tool)

- **No `browser_*` tools in the tool registry.** Enforced by test `assistant/src/__tests__/browser-skill-baseline-tool-payload.test.ts` (lines 3–6: "Browser automation is provided exclusively through the `assistant browser` CLI commands").
- **Model path:** skill `skills/vellum-browser-use/SKILL.md` → model invokes `assistant browser <operation>` via `bash`/`host_bash` (17 operations: navigate, snapshot, screenshot, click, type, press-key, scroll, select-option, hover, wait-for, extract, wait-for-download, fill-credential, attach, detach, close, status).
- **Backend:** `assistant/src/tools/browser/browser-execution.ts` executors (`executeBrowserNavigate` line 740, `executeBrowserSnapshot` 1330, `executeBrowserScreenshot` 1392, `executeBrowserClick` 1628, `executeBrowserType` 1740, `executeBrowserPressKey` 1816, `executeBrowserScroll` 1891, `executeBrowserSelectOption` 1966, `executeBrowserHover` 2102, `executeBrowserWaitFor` 2157, `executeBrowserExtract` 2252, `executeBrowserFillCredential` 2337, `executeBrowserStatus` 2833). CDP-based, **not** Playwright-first: three backends (`browser-mode-constants.ts`, `cdp-client/factory.ts`): `local` (Playwright-managed Chromium), `extension` (Chrome MV3 extension via `Vellum.*` pseudo-CDP), `cdp-inspect` (existing Chrome via DevTools port). `browser_mode` input param overrides backend per invocation (runtime/AGENTS.md line 150).
- **Wiring:** CLI `assistant/src/cli/commands/browser.ts` + `src/browser/operations.ts` / `operation-meta.ts` (line 17) → HTTP route `runtime/routes/browser-routes.ts` `browser_execute` (lines 27–32) → executors. Session key `browser-cli:<sessionId>` (line 40).
- **Host proxy:** `daemon/host-browser-proxy.ts` forwards raw CDP to a `host_browser`-capable client (Chrome extension or macOS SSE bridge); gated via `HOST_TOOL_TO_CAPABILITY["host_browser"]` (conversation-tool-setup.ts line 649) + `CROSS_CLIENT_EXPOSED_CAPABILITIES`. `tools/browser/` also has auth (`auth-detector.ts`, `jit-auth.ts`, `auth-cache.ts`), pinned tabs, network recording, screencast.
- **Note:** `assistant/src/tools/browser/` (daemon, CDP/Playwright) vs `assistant/src/browser/` (CLI operation layer) vs `assistant/src/browser-session/` (extension session manager) are three distinct layers.

---

## 4. Computer Use ✅ (exists — skill-proxy pattern, macOS/Windows/Linux)

Two parallel surfaces that MUST stay in sync:

1. **Proxy tool definitions (daemon):** `assistant/src/tools/computer-use/definitions.ts` — 11 tools `computer_use_observe/click/type_text/key/scroll/drag/wait/open_app/run_applescript/done/respond` (lines 46–483). All `execute` → `proxyExecute()` (line 27) → `context.proxyToolResolver` → connected desktop client. `supportedClientOs` on drag/open_app (macos, windows), run_applescript (macos only). **Not in `explicitTools`** — they're referenced by the bundled skill.
2. **Bundled skill:** `assistant/src/config/bundled-skills/computer-use/TOOLS.json` (11 matching entries; `execution_target: "host"`, executors `tools/computer-use-*.ts`). Executor wrappers use `assistant/src/tools/computer-use/skill-proxy-bridge.ts` (`forwardComputerUseProxyTool`, line 16) → same proxy resolver.
3. **Preactivation:** `assistant/src/daemon/host-proxy-preactivation.ts` `HOST_PROXY_SKILL_PREACTIVATIONS` (line 77): `host_cu → computer-use` skill, `host_app_control → app-control` skill; `evaluateHostProxyAttachment()` (line 100) decides per-turn (native_support / cross_client / denied_*).
4. **Proxy:** `daemon/host-cu-proxy.ts` + `daemon/host-proxy-base.ts`; clients advertise capability `host_cu` (`channels/types.ts` line 309); CLI `assistant clients list --capability host_cu`; `target_client_id` input on every tool.

**App control** (same pattern): `config/bundled-skills/app-control/TOOLS.json` — `app_control_start/observe/press/combo/sequence` (all `execution_target: "host"`), `tools/app-control/skill-proxy-bridge.ts`, capability `host_app_control`.

**macOS automation skill:** `skills/macos-automation/` (portable, CLI-based); **Windows:** `skills/windows-automation/`.

---

## 5. Vision / Image Analysis ✅ (exists — model-native, no dedicated tool)

- **No `vision`/`analyze_image` tool.** Vision is natively multimodal: model receives images via message attachments, `file_read` (host/`file_read` reads JPEG/PNG/GIF/WebP — `tools/host-filesystem/read.ts` line 72), and browser screenshots (image content blocks). `assistant/src/media/` contains only generation + avatar services.
- Document/image pipeline: `document/` tools, `media-processing` skill (`ingest_media`, `media_status`, `analyze_keyframes`, `extract_keyframes`, `query_media_events`, `generate_clip`), `transcribe` skill (`transcribe_media`).

---

## 6. Image Generation ✅ (exists — bundled skill `media_generate_image`, BYOK + managed)

- **Manifest:** `assistant/src/config/bundled-skills/image-studio/TOOLS.json` — tool `media_generate_image` (line 5), `execution_target: "host"`, executor `tools/media-generate-image.ts`; params: `prompt`, `mode` (generate|edit), `source_paths`, `model` (tier alias fast|quality|openai or concrete ID), `variants` (1–4).
- **Executor:** `assistant/src/config/bundled-skills/image-studio/tools/media-generate-image.ts` — `run()` (line 106): resolves config `services["image-generation"]` → `media/image-models.ts` `resolveImageModel` → `media/image-credentials.ts` `resolveImageGenRouting` (line 28) + `resolveImageGenCredentials` (line 59) → `media/image-service.ts` (`generateImage`). Saves to `media/generated/` in workspace; results embedded as `![...](vellum://workspace/<path>)`.
- **Models:** `assistant/src/media/image-models.ts` `IMAGE_MODELS` (line 26): `gemini-3.1-flash-image-preview` (alias `fast`), `gemini-3-pro-image-preview` (`quality`), `gpt-image-2` (`openai`). Providers: `gemini` | `openai` (`gemini-image-service.ts`, `openai-image-service.ts`) + **managed `vellum`** routing through the platform proxy (model prefix picks backend).
- **Config:** `config/schemas/services.ts` line 161 `"image-generation": ImageGenerationServiceSchema` (provider: vellum|gemini|openai, model, managed vs your-own keys).
- **Other surfaces:** CLI `assistant image-generation` (`cli/commands/image-generation.ts`), HTTP `runtime/routes/image-generation-routes.ts`, app icon generator (`media/app-icon-generator.ts`).

## 7. Video Generation ❌ MISSING

- No `generate_video`/`video_gen` tool, no sora/runway/veo/Luma code anywhere (`grep -i "sora|runway|veo|text-to-video"` → 0 hits in `assistant/src`).
- Closest existing: `media-processing` skill `generate_clip` (`config/bundled-skills/media-processing/tools/generate-clip.ts`) — trims/composes clips from **existing** video via job pipeline (`media/job-handlers/media-processing.ts`), not text-to-video.
- **Minimal change to add:** mirror the image-studio pattern — new bundled skill `video-studio/` with `TOOLS.json` (`media_generate_video`, `execution_target: "host"`) + executor under `config/bundled-skills/video-studio/tools/` calling a new `media/video-service.ts`; extend `services` schema with `"video-generation"` (provider: vellum|openai-sora|runway|…); add models catalog + credential resolution copying `media/image-credentials.ts`; expose via preactivation/activation hints. No registry changes needed (skill tools auto-register).

## 8. X/Twitter Search ❌ MISSING (as a tool)

- Only Twitter OAuth exists: `assistant/src/oauth/seed-providers.ts` line 270 (`provider: "twitter"`, authorize/token URLs, scopes) — for OAuth connections, not search.
- No `x_search`/`twitter` tool, skill, or provider anywhere in assistant/src or skills/.
- **Minimal change to add:** (a) fastest — a portable skill (like `skills/`) with a script using `curl`-via-`bash` against the X API v2 `/tweets/search/recent` with bearer token collected via `assistant credentials prompt` (skills/AGENTS.md patterns) + outbound-proxy domain approval; or (b) provider-native — extend `providers/search-provider-catalog.ts` with an `x` BYOK entry + adapter in `tools/network/web-search.ts` `WEB_SEARCH_ADAPTERS` + secret/env-var wiring (follows the documented 4-step provider addition).

## 9. TTS ✅ (exists — daemon service, NOT an LLM tool) & STT ✅ (daemon + skill tool)

**TTS** (`assistant/src/tts/`):
- Providers: `tts/provider-catalog.ts` `DEFINITIONS` (line 46): `vellum` (managed), `elevenlabs`, `fish-audio`, `deepgram`, `xai`. Implementations in `tts/providers/*-provider.ts` (+ WebSocket streams `vellum-tts-socket.ts`, `xai-tts-socket.ts`).
- Config resolution: `tts/tts-config-resolver.ts`, `synthesize-text.ts`, `synthesis-stream.ts`, `tts-voice-field.ts`; config `services.tts` (provider, voices).
- **Not exposed to the model as a tool** — used by voice mode (`live-voice/`, `calls/`) and CLI (`assistant tts`, `cli/commands/tts.help.ts` line 6). No `speak`/`say` tool.
- **Minimal change to expose:** bundled skill `voice-output/` TOOLS.json entry `speak_text` (execution_target host) whose executor calls `tts/synthesize-text.ts` and saves to workspace (identical to transcribe pattern below).

**STT** (`assistant/src/stt/` + `assistant/src/providers/speech-to-text/`):
- Provider catalog: `providers/speech-to-text/provider-catalog.ts` — ids at lines 177 `deepgram`, 200 `deepgram-flux`, 235 `google-gemini`, 263 `openai-whisper`, 290 `vellum`, 314 `vellum-flux`, 347 `xai`. Credential-provider mapping + supported boundaries (daemon-batch, realtime-ws, incremental-batch) + telephony modes.
- **Model-facing tool exists:** bundled skill `config/bundled-skills/transcribe/TOOLS.json` → `transcribe_media` (file_path in, transcript out; `execution_target: "host"`), executor `transcribe/tools/transcribe-media.ts` using configured `services.stt.provider`.
- Daemon paths: `stt/stt-stream-session.ts`, `stt/daemon-batch-transcriber.ts`, `providers/speech-to-text/resolve.ts`, live-voice (`live-voice/`), phone calls (`calls/`), deepgram-voice skill (`skills/deepgram-voice/`), config `config/schemas/stt.ts` + `services.stt` (services.ts line 173).

## 10. Home Assistant ❌ MISSING

- Zero hits for `home-assistant`/`homeassistant` in assistant/src and skills/. No related tool/skill/OAuth provider.
- **Minimal change to add:** portable skill `home-assistant/` in `skills/` (or user workspace skill) with `scripts/` calling the HA REST/WebSocket API (`/api/states`, `/api/services/<domain>/<service>`); long-lived token collected via `assistant credentials prompt` (exit 130 handling per skills/AGENTS.md); register `http://homeassistant.local:8123` (or user's HA URL) with the outbound proxy for header injection. Optionally an OAuth entry in `oauth/seed-providers.ts` for managed mode.

---

## 11. Skills TOOLS.json Schema (full)

**Type definitions:** `assistant/src/config/skills.ts`:
- `SkillToolManifest` (line 174): `{ version: 1, tools: SkillToolEntry[] }`.
- `SkillToolEntry` (line 182):
  - `name: string` (unique; must not collide with core tool names)
  - `description: string` (shown to the model)
  - `category: string`
  - `risk: "low" | "medium" | "high"` (→ `defaultRiskLevel` for permission checks)
  - `input_schema: Record<string, unknown>` (JSON Schema; validator supports only required/type/enum/items.type + unknown-key detection — `skills/validate-input.ts` lines 1–8)
  - `executor: string` (relative path to executor script inside the skill dir)
  - `execution_target: "host" | "sandbox"`
  - `supported_client_os?: ClientOs[]` (optional; unset = all)

**Runtime validation:** `assistant/src/skills/tool-manifest.ts` `parseToolManifest()` (line 14) / `parseToolEntry()` (line 61); read from `<skillDir>/TOOLS.json` in `tools/skills/load.ts` `loadToolManifest()` (line 63).

**Execution:** `tools/skills/skill-script-runner.ts` — `execution_target: "host"` runs the executor in the daemon process with full `ToolContext` (incl. `proxyToolResolver`); `"sandbox"` runs in the skill sandbox (see `tools/skills/sandbox-runner.ts`, `script-contract.ts` — executor exports `run(input, context)`). Bundled-skill executors live at `config/bundled-skills/<skill>/tools/*.ts` and are resolved at call time from disk (works in compiled binaries — bundled-skills/AGENTS.md); `knip.json` treats them as entry points.
- Name-prefix heuristic fallback: `tools/execution-target.ts` line 20 — `host_*` / `computer_use_*` ⇒ host, else sandbox.

**How skill tools reach the model:** skill becomes active (preactivation `DEFAULT_PREACTIVATED_SKILL_IDS = ["notifications", "subagent"]` conversation-tool-setup.ts line 618, activation hints, or explicit `skill_load`) → `projectSkillTools()` (`daemon/conversation-skill-tools.ts`) → `createSkillToolsFromManifest` (`skill-tool-factory.ts` line 111) → `registerSkillTools` (registry.ts line 250) → defs appended per turn in `createResolveToolsCallback` (conversation-tool-setup.ts lines 1111–1191). Invocation via `skill_execute` (core tool, `tools/skills/execute.ts`).

**Example manifests to copy:** `config/bundled-skills/image-studio/TOOLS.json` (media tool, host executor), `config/bundled-skills/computer-use/TOOLS.json` (proxy tools), `config/bundled-skills/transcribe/TOOLS.json` (provider-backed tool), `config/bundled-skills/app-control/TOOLS.json`, `config/bundled-skills/media-processing/TOOLS.json`.

---

## 12. Summary — Exists vs Missing

| Capability | Status | Mechanism | Key files |
|---|---|---|---|
| Web search (Perplexity/Brave/Tavily/Firecrawl/Keenable/fastCRW + vellum managed + provider-native) | ✅ | core tool + adapter catalog | `tools/network/web-search.ts:1448,1427`, `providers/search-provider-catalog.ts:89` |
| Web scraping / fetch | ✅ | core tool, SSRF-guarded | `tools/network/web-fetch.ts:1504` |
| Browser automation | ✅ (CLI+skill, no LLM tools) | `assistant browser` CLI; CDP backends: local Playwright / extension / cdp-inspect; host_browser proxy | `skills/vellum-browser-use/SKILL.md`, `tools/browser/browser-execution.ts`, `runtime/routes/browser-routes.ts` |
| Vision / image analysis | ✅ model-native | multimodal input, no tool | `tools/host-filesystem/read.ts:72` |
| Image generation (Gemini/OpenAI/vellum managed) | ✅ | bundled skill tool | `config/bundled-skills/image-studio/TOOLS.json`, `media/image-models.ts:26`, `media/image-service.ts` |
| **Video generation** | ❌ | — (only clip generation from existing video) | add: `media/video-service.ts` + `video-studio` bundled skill |
| **X/Twitter search** | ❌ | only OAuth seed (`oauth/seed-providers.ts:270`) | add: skill script or web-search adapter entry |
| TTS (vellum/elevenlabs/fish-audio/deepgram/xai) | ✅ (no model tool) | daemon voice service + CLI | `tts/provider-catalog.ts:46`, `tts/synthesize-text.ts` |
| STT (deepgram(-flux)/google-gemini/openai-whisper/vellum(-flux)/xai) | ✅ | daemon + `transcribe_media` skill tool | `providers/speech-to-text/provider-catalog.ts:177–347`, `config/bundled-skills/transcribe/TOOLS.json` |
| Computer use (macOS/Windows; AppleScript) | ✅ | bundled skill proxy tools + desktop-client capability | `config/bundled-skills/computer-use/TOOLS.json`, `tools/computer-use/definitions.ts:46`, `daemon/host-cu-proxy.ts` |
| App control | ✅ | same proxy pattern | `config/bundled-skills/app-control/TOOLS.json`, `daemon/host-proxy-preactivation.ts:77` |
| **Home Assistant** | ❌ | — | add: portable skill + outbound-proxy registration |

**Key architectural takeaways for the owner:**
1. Core-tool additions are actively discouraged (`tools/AGENTS.md`) — the sanctioned extension surface is skills (TOOLS.json) or CLI-through-bash.
2. Every provider-backed capability follows the same pattern: services config schema (`config/schemas/services.ts`) → catalog (`providers/*-catalog.ts`) → credential resolver (`security/secure-keys.ts` + secret catalog + env-var map) → executor (skill tool or core tool). Reuse it for video gen, X search, and Home Assistant.
3. "Managed (vellum) vs BYOK" is a first-class dimension in every existing catalog (search, image, TTS, STT) — new tools should copy `resolveImageGenRouting`/`resolveImageGenCredentials` (`media/image-credentials.ts`).
4. Per-platform gating is per-turn and capability-driven in `conversation-tool-setup.ts`; new host-proxy tools need a `HOST_TOOL_TO_CAPABILITY` entry (or skill preactivation entry in `host-proxy-preactivation.ts`), a `channels/types.ts` capability, and client-side support.
