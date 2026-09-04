# Vellum Assistant — Provider/Model Config & Settings UI Map

Repo: `/Users/francisco/Downloads/VELLUM-BY-HERMES/vellum-fork` (v0.11.9, Bun + TypeScript monorepo)
Scope: workspace `config.json` schema, provider/model validation, web settings UI for Inference Profiles, and every place a fixed provider list is enforced. READ-ONLY exploration; nothing was modified.

---

## 1. Workspace config.json schema

### 1.1 Top-level assembly
`assistant/src/config/schema.ts`
- `AssistantConfigSchema` (Zod object, lines 68–172). The `llm` block is the single source of truth for provider/model config:
  - Line 99: `llm: LLMSchema.default(LLMSchema.parse({}))`
- Config file lives at `getWorkspaceConfigPath()` (`assistant/src/util/platform.ts`), loaded/cached by `assistant/src/config/loader.ts` (`getConfigPath()` lines 61–63; `loadRawConfig`/`loadConfig` with a salvage ladder and `lastKnownGoodConfig`).

### 1.2 The `llm` block — `assistant/src/config/schemas/llm.ts` (1118 lines)
`LLMSchema` (lines 917–1118):
| Field | Line | Shape |
|---|---|---|
| `llm.profiles` | 919 | `z.record(z.string().min(1), ProfileEntry).default({})` |
| `llm.profileOrder` | 922 | `z.array(z.string().min(1)).default([])` (presentation order) |
| `llm.callSites` | 930–933 | `z.preprocess(dropUnknownCallSiteKeys, z.partialRecord(LLMCallSiteEnum, LLMCallSiteConfig).default({}))` |
| `llm.activeProfile` | 934 | optional string |
| `llm.advisorProfile` | 938 | optional string |
| `llm.defaultProvider` | 939 | `DefaultProviderSchema` = `{ provider: DefaultProviderEnum, connectionName?: string }` (lines 695–698) |
| `llm.profileSession` | 943–948 | TTL bounds (default 1800 / max 43200) |
| `llm.pricingOverrides` | 949 | array of `{provider, modelPattern, inputPer1M, outputPer1M}` (500–505) |
- `superRefine` (951–1116): routing-identity model checks, profile-reference integrity (`activeProfile`, `advisorProfile`, call-site pins), mix-profile validation, `fallbackProfile` validation.

`ProfileEntry` (lines 614–668) = `LLMConfigFragment` (563–580) + metadata:
- `source: "managed" | "user"`, `label` (nullable), `description`
- **`provider_connection`** (line 635): name of a `provider_connections` DB row; dispatcher resolves auth from it (the modern way to bind custom endpoints)
- **`allowUnlisted`** (line 642): stamped when a profile deliberately uses a model the catalog doesn't list (write routes' escape hatch)
- `status: "active" | "disabled"` (nullable), `mix` (weighted arms), `fallbackProfile` (read-only code-owned)

`LLMConfigFragment` fields: `provider`, `model`, `maxTokens`, `effort` (`none|low|medium|high|xhigh|max`), `speed`, `verbosity`, `temperature`, `topP`, `thinking`, `contextWindow`, `openrouter.only`, `logitBias`, `disableCache`.

### 1.3 Provider enums
- **`KNOWN_LLM_PROVIDERS`** (lines 45–67): fixed 17-value list — 15 vendors (`anthropic`, `openai`, `gemini`, `ollama`, `fireworks`, `openrouter`, `vercel-ai-gateway`, `openai-compatible`, `minimax`, `atlascloud`, `together`, `litellm`, `opencode`, `baseten`, `poolside`) + routing identities `vellum`, `chatgpt`.
- `LLMProvider = z.string().min(1)` (line 69) — deliberately an **open string** at parse time; membership is enforced at write time via `unknownLlmProviderIssue()` (lines 78–82).
- `DEFAULT_PROVIDER_CHOICES` (lines 94–110) — narrower set for `llm.defaultProvider` (keyless/endpoint-supplied providers excluded); `DefaultProviderEnum = z.enum(...)` (129–131).
- `routingIdentityModelIssue()` (145–174): `vellum`/`chatgpt` require explicit, routable models.

---

## 2. Where config is persisted / validated

- **Write choke point**: `commitConfigWrite()` — `assistant/src/runtime/routes/conversation-query-routes.ts:1433–1493`. Runs before every save:
  - `completeChangedCustomProfiles` (defined ~1280–1321) — completes partial profile entries against defaults
  - `assertInvariantProfilesPreserved` — managed-profile protection
  - **`assertRoutableIdentityEntries` (1370–1409)** — the provider membership gate: for provider values *changed by this write*, profiles are checked with `writableProfileProviderIssue()` (line 1394–1396), call sites and `llm.default` with `unknownLlmProviderIssue()`; plus `routingIdentityModelIssue` for every entry
  - `assertCodeOwnedFallbackProfiles` (1419–1431)
- **Write paths** (all in `conversation-query-routes.ts`):
  - `handlePatchConfig` (1545–1576) — `PATCH /v1/config` (deep merge; what the settings UI uses)
  - `handleSetConfig` (1593–1691) — `config set` (CLI)
  - `handleReplaceInferenceProfile` (1719–1978) — `PUT /v1/config/llm/profiles/:name`
- **`writableProfileProviderIssue`** — `assistant/src/providers/connection-resolution.ts:108–121`: accepts `KNOWN_LLM_PROVIDERS` members **or the name of an existing `provider_connections` row** (fail-closed on DB errors).
- **Provider-connection validation**: `assistant/src/providers/inference/auth.ts`
  - `VALID_CONNECTION_PROVIDERS` (120–135) = `PROVIDER_CATALOG` ids + `vellum` + `chatgpt`; `ConnectionProviderSchema = z.enum(...)` (159–161)
  - `PROVIDERS_REQUIRING_BASE_URL_AND_MODELS = {"openai-compatible"}` (180–181)
  - `PROVIDERS_ALLOWING_CUSTOM_BASE_URL = {openai-compatible, ollama, opencode}` (190–194) — **every other provider rejects a client-supplied `base_url`** (anti-exfiltration)
  - `AuthSchema` (22–43): `api_key | platform | none | oauth_subscription | service_account`
- **DB layer**: `assistant/src/providers/inference/connections.ts` — `createConnection` enforces `base_url_required`/`models_required` for openai-compatible (lines 227–246, 302–308).

---

## 3. Assistant-side fixed provider lists (validation schemas that enforce strictness)

| File | Line(s) | What is fixed |
|---|---|---|
| `assistant/src/config/schemas/llm.ts` | 45–67 | `KNOWN_LLM_PROVIDERS` (17 values) — write-surface membership |
| `assistant/src/config/schemas/llm.ts` | 94–110, 129–131 | `DEFAULT_PROVIDER_CHOICES` / `DefaultProviderEnum` for `llm.defaultProvider` |
| `assistant/src/providers/model-catalog.ts` | whole file (2597 lines) | `PROVIDER_CATALOG` — **source of truth** for the closed provider set; syncs to `meta/llm-provider-catalog.json` via `bun run sync:llm-catalog` |
| `assistant/src/providers/inference/auth.ts` | 120–135, 159–161 | `VALID_CONNECTION_PROVIDERS` / `ConnectionProviderSchema` (connection rows) |
| `assistant/src/providers/inference/auth.ts` | 180–194 | which providers may carry `base_url` |
| `assistant/src/providers/connection-resolution.ts` | 108–121 | `writableProfileProviderIssue` (profile writes) |
| `assistant/src/config/schemas/services.ts` | 25 | `VALID_IMAGE_GEN_PROVIDERS = ["vellum","gemini","openai"]` |
| `assistant/src/config/schemas/services.ts` | 32, 39 | web-search / web-fetch provider enums (catalog-derived) |
| `assistant/src/config/schemas/stt.ts` | 16–22 | `VALID_STT_PROVIDERS = ["deepgram","google-gemini","openai-whisper","xai","vellum"]` |
| `assistant/src/config/schemas/tts.ts` | 31–117 | per-provider TTS blocks (elevenlabs etc.), keyed record |

Model-catalog membership check used by the profile write routes: `isModelInCatalog` / `catalogMaxOutputTokens` / `catalogContextWindowTokens` from `assistant/src/providers/model-catalog.ts` (imported in `inference-profiles-routes.ts:51–56`).

---

## 4. API endpoints involved

### 4.1 Inference profiles — `assistant/src/runtime/routes/inference-profiles-routes.ts` (ROUTES at 919–1057)
- `GET /v1/inference/profiles` — effective catalog with per-profile `availability` + `config_issue` (schemas 83–115)
- `GET /v1/inference/profiles/:name`, `POST /v1/inference/profiles` (create), `PATCH .../:name` (update), `DELETE .../:name`, `PUT .../:name/active`, `POST .../:name/validate` (live probe → `check {ok, blame: profile|provider|transient|unknown}`)
- **Create/update strictness** (used by CLI; the web settings UI instead saves via `PATCH /v1/config`):
  - `createRequestSchema` (152–165) / `updateRequestSchema` (167–179): include `allowUnlisted`, `allowUnavailable` escape flags
  - `assertValidProvider` (185–190) → `writableProfileProviderIssue`
  - **`modelReachIssue` (200–229)**: model must be in the catalog for the provider, OR in the named connection's `models` list
  - `validateModel` (236–264): throws 400 unless `allowUnlisted`; openai-compatible remedy message suggests declaring the model on the connection
  - `guardProfileAvailability` (358–385): rejects a profile that provably cannot dispatch (no credential/connection) unless `allowUnavailable`
  - `profileConfigIssue` (274–309): static `model_unknown` / `over_output_cap` / `no_input_room` verdicts shown in every listing — **a custom-typed model not declared on the connection and not stamped `allowUnlisted` will permanently show `config_issue.model_unknown` here**

### 4.2 Provider connections — `assistant/src/runtime/routes/inference-provider-connection-routes.ts` (ROUTES ~700–830)
- `GET /v1/inference/provider-connections`, `GET/PATCH/DELETE .../:name`, `POST /v1/inference/provider-connections`
- `handleCreateConnection` (338–449): provider enum gate (365–370), reserved names (350–363), custom-identity collision vs built-ins (294–325, `RESERVED_PROVIDER_IDENTITIES` 328–336), `parseCustomProviderFields` (100–191) — `base_url` only for openai-compatible/ollama/opencode, http(s) URL check, **SSRF guard for platform-hosted daemons** (149–167), `models` array parse (177–188), `base_url_required` / `models_required` for openai-compatible (432–441), then a save-time **endpoint probe** `testInferenceConnection` (445; `endpoint-probe.ts`, advisory only).
- `handleUpdateConnection` (451–571): label-change identity checks, same custom-field validation.

### 4.3 Config write routes (what the web settings UI actually calls)
- `PATCH /v1/config` — `handlePatchConfig` (`conversation-query-routes.ts:1545`)
- `PUT /v1/config/llm/profiles/:name` — `handleReplaceInferenceProfile` (1719)
- `GET /v1/config` — effective config for the UI
- Read-only: `GET /v1/inference/callsites` (`inference-callsites-routes.ts`), `GET /v1/inference/models` (`inference-models-routes.ts`)

### 4.4 Web client → API mapping
- `clients/web/src/domains/settings/ai/use-llm-config-patch.ts` — profile saves go through **`PATCH /v1/config`** (`{ llm: { profiles: { [name]: entry } } }`)
- `use-profile-save.ts` (82–178) — replace = delete + recreate via two PATCHes; then `POST /v1/inference/profiles/:name/validate` fire-and-forget (`probeSavedProfile` 36–67) → warning toast on `blame: profile|provider`
- `provider-create-form.tsx` (320–327) — `POST /v1/inference/provider-connections` via `inferenceProviderconnectionsPost`, key via `secretsPost`
- `use-inference-profiles.ts` (36–40) — `GET /v1/inference/profiles` for the profile list

---

## 5. Web settings UI — Inference Profiles screens

Directory: `clients/web/src/domains/settings/ai/` (route page `ai-page.tsx`, sections `profiles-section.tsx`, `providers-section.tsx`, `language-model-section.tsx`).

### 5.1 Fixed provider lists in the UI
| File | Line(s) | List |
|---|---|---|
| `clients/web/src/domains/settings/ai/constants.ts` | 12–27 | **`INFERENCE_PROVIDERS`** — 15 hardcoded vendors; `openai-compatible` deliberately excluded from this picker; `isInferenceProvider` (34–41); `VELLUM_CONNECTION_PROVIDER="vellum"`, `CHATGPT_CONNECTION_PROVIDER="chatgpt"` |
| `clients/web/src/domains/settings/ai/provider-editor-constants.ts` | 28–44 | **`CONNECTION_PROVIDERS`** — 15 vendors + `openai-compatible` (the Add-provider dropdown) |
| `clients/web/src/assistant/llm-model-catalog.ts` | 43–1392 | `MODELS_BY_PROVIDER` (hand-maintained mirror of the daemon catalog; `openai-compatible: []` at 1133, display names at 1175); parity test `llm-model-catalog.test.ts` |
| `clients/web/src/lib/provider-catalogs.ts` | 33, 148, 220, 256 | TTS/STT/Email/ImageGen fixed provider lists (`IMAGE_GEN_PROVIDERS = ["vellum","gemini","openai"]`) |

### 5.2 Profile editor (chat models)
- **`profile-editor-fields.tsx`** (472 lines) — create-mode provider picker:
  - Provider options built from `expandEndpointEntries(providersServedByConnections(...))` + `unconnectedProviders(...)` (217–261); "Create new provider" sentinel (line 38, 248–254); inline `ProviderCreateForm` (353–368)
- **`profile-editor-provider-section.tsx`** (588 lines) — edit-mode provider + connection + model picker:
  - `CUSTOM_MODEL_OPTION_VALUE = "__custom-model-id__"` (line 57) — free-text model-id escape hatch; `allowsCustomModel` (137–140) — enabled for openai-compatible (disabled only for chatgpt/subscription)
  - `availableModels` (207–253) — for openai-compatible the model list comes **from the connection's `models` array** (229–247), merged across connections when unbound
  - `providerOptions` (360–397) — connection entries expanded via `expandEndpointEntries`; unbound openai-compatible gets a bare protocol row (388–396)
- **`use-profile-editor.ts`** (978 lines) — save payload construction:
  - `provider_connection` binding resolution (724–733); entry-name wire shape for openai-compatible (783–799: `provider` becomes the connection *name* when the daemon supports entry binding); write entry 800–825
- **`use-profile-save.ts`** — sends to `PATCH /v1/config` (see 4.4); **never stamps `allowUnlisted`**
- **`provider-create-form.tsx`** (665 lines) — the "Custom provider" flow:
  - Picker option "Custom provider" pinned at bottom (456–472); label/name input (489–509); base URL input (511–547, per-provider placeholders); comma-separated models input (548–567); auth handling: key → `api_key`, no key → `none` for openai-compatible (282–291); payload (303–319): `{name, provider, auth, label, base_url, models:[{id}]}` → `POST /v1/inference/provider-connections`
- `custom-provider-names.ts` — client-side name collision checks
- `provider-picker-availability.ts` — disables unreachable providers (`useProviderPickerAvailability`); `provider-availability.ts` — `expandEndpointEntries` (232–287) renders each openai-compatible connection as its own picker row

### 5.3 Call-site overrides / tool models
- **`call-site-overrides-row.tsx`** — the "tool model" picker per call site:
  - Line 113–116: `pickableProviders = [...INFERENCE_PROVIDERS, chatgpt?]` — **fixed 15-provider list; no `openai-compatible`, no connection entries**
  - Lines 149–159: model options come **only** from the static catalog (`getVisibleModelsForProvider`) — no connection-derived models, no free-text escape hatch
- `overrides-detail-panel.tsx`, `bulk-override-swap-modal.tsx`, `overrides-call-site-list.tsx` — same picker domain
- **Service "tool model" cards** (each with its own fixed provider list):
  - `image-generation-card.tsx` — `IMAGE_GEN_PROVIDERS` (`lib/provider-catalogs.ts:256`); saves via `modelImagegenPut` → `services.image-generation`
  - `web-search-card.tsx`, `web-fetch-card.tsx`, `speech-to-text-card.tsx` (`STT_PROVIDERS`), `text-to-speech-card.tsx` (`TTS_PROVIDERS`)

### 5.4 Why "multiple errors occur eventually" with custom endpoints (code-level causes)
1. **Save-time endpoint probe** (`endpoint-probe.ts` / `testInferenceConnection`, connection routes 445, 567): failing probes are advisory but `warnOnFailedEndpointCheck` (`provider-editor-constants.ts:138–157`) toasts on every save.
2. **`probeSavedProfile`** (`use-profile-save.ts:36–67`): after every profile save the UI calls `POST /v1/inference/profiles/:name/validate`; a custom endpoint that can't be reached with a minimal request toasts `profileCheck.providerError`.
3. **`profileConfigIssue`** (`inference-profiles-routes.ts:274–309`): a model typed via the free-text escape hatch is not in the catalog and (if not in the connection's `models`) yields a permanent `config_issue: { code: "model_unknown" }` in the profile listing — unless `allowUnlisted: true` is stamped, **which the web save path never does** (only the CLI create/update routes accept the flag).
4. **Availability verdicts** (`connection-availability.ts`, 380 lines; `inference-profile-availability-guard.ts`): profiles whose connection/credential can't be verified render as unavailable with repair hints; the dedicated create route *rejects* them unless `allowUnavailable`.
5. **SSRF gate** (connection routes 149–167): platform-hosted daemons reject `base_url` to private/local networks — local vLLM/LM Studio endpoints only work on self-hosted daemons.
6. **Call-site pins are vendor-only**: `assertRoutableIdentityEntries` uses `unknownLlmProviderIssue` for `llm.callSites.*` (conversation-query-routes.ts:1395–1396) and connection-resolution comments state call-site fragments keep vendor-only membership (`connection-resolution.ts:104–106`).

---

## 6. Minimal change list

### (a) Allow arbitrary OpenAI-compatible endpoints in profiles
Already largely supported via `openai-compatible` connections (named entry = base_url + models + optional key). Remaining gaps:

1. **Stamp `allowUnlisted` on the web save path** — in `completeChangedCustomProfiles` (`conversation-query-routes.ts` ~1280–1321) or `handlePatchConfig` (1545): when a profile's provider resolves to an openai-compatible connection and its `model` is not in `connection.models` or the catalog, set `allowUnlisted: true` before persisting. This kills the permanent `model_unknown` config issue (cause #3) and matches what the CLI routes already support (`inference-profiles-routes.ts:163, 236–264`).
2. **Soft-landing for probes** — either suppress the `POST /v1/inference/profiles/:name/validate` toast for `allowUnlisted`/openai-compatible profiles in `probeSavedProfile` (`use-profile-save.ts:36–67`), or make `endpoint-probe.ts` skip keyless/unreachable endpoints after first failure (persist the verdict) so repeated saves stop re-toasting (causes #1/#2).
3. *(Optional)* Widen `VALID_CONNECTION_PROVIDERS` if truly arbitrary provider ids are wanted; not needed — openai-compatible entries already cover arbitrary OpenAI-compatible hosts, and `writableProfileProviderIssue` accepts any existing connection name (`connection-resolution.ts:108–121`).
4. *(Optional)* For local endpoints on platform-hosted daemons, relax the SSRF gate for explicit user-confirmed hosts (`inference-provider-connection-routes.ts:149–167`).

### (b) Expose custom endpoints for tool models in the UI
1. **Call-site overrides picker** — `call-site-overrides-row.tsx:113–116`: extend `pickableProviders` with openai-compatible connection entries (reuse `expandEndpointEntries`/`providersServedByConnections` from `provider-availability.ts`, as `profile-editor-provider-section.tsx` does); derive model options from the connection's `models` at lines 149–159 (add connection fallback + free-text option). Mirror in `overrides-detail-panel.tsx` / `bulk-override-swap-modal.tsx` / `call-site-overrides-row` tests.
2. **Backend for call-site endpoints** — allow `provider_connection` (or entry-name providers) on `llm.callSites.*` fragments: change the call-site branch of `assertRoutableIdentityEntries` (`conversation-query-routes.ts:1395–1396`) from `unknownLlmProviderIssue` to the entry-aware check, add `provider_connection` to `LLMCallSiteConfig` (`schemas/llm.ts:676–679`), and resolve it in `resolveCallSiteConfig` (`llm-resolver.ts`). The connection model lists must then feed call-site model resolution the same way profiles do (`modelReachIssue`).
3. **Service tool cards** (image-gen / STT / TTS / web search) — the largest effort: each service has a closed `z.enum` (`services.ts:25`, `stt.ts:16–22`, `tts.ts`) plus per-provider adapters; adding a custom-endpoint option means a new "openai-compatible"-style provider id + adapter + schema enum widening in both assistant and the web `lib/provider-catalogs.ts` lists, plus the corresponding cards (`image-generation-card.tsx`, `speech-to-text-card.tsx`, `text-to-speech-card.tsx`). Defer unless explicitly needed; the inference-profile path (a) covers chat/tool models served by LLM endpoints already.

### Key files to touch (summary)
- Assistant: `config/schemas/llm.ts`, `runtime/routes/conversation-query-routes.ts`, `runtime/routes/inference-profiles-routes.ts`, `runtime/routes/inference-provider-connection-routes.ts`, `providers/inference/auth.ts`, `providers/connection-resolution.ts`, `config/schemas/services.ts` / `stt.ts` / `tts.ts` (only for service cards)
- Web: `domains/settings/ai/constants.ts`, `provider-editor-constants.ts`, `call-site-overrides-row.tsx`, `overrides-detail-panel.tsx`, `profile-editor-provider-section.tsx`, `provider-create-form.tsx`, `use-profile-save.ts`, `use-profile-editor.ts`, `assistant/llm-model-catalog.ts`, `lib/provider-catalogs.ts`
