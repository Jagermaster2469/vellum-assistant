# Vellum Assistant — Auxiliary/Tool Model Call-Sites Map

Repo: `assistant/src` of `/Users/francisco/Downloads/VELLUM-BY-HERMES/vellum-fork` (v0.11.9, Bun + TS).
Read-only exploration. All paths below are relative to `assistant/src/`.

## 0. Executive summary

Vellum has **two separate model-configuration systems**, and only one of them supports custom endpoints:

| System | Used by | Custom endpoint (baseUrl) support |
|---|---|---|
| **A. LLM call-site system** (`llm.profiles` + `provider_connections`) | Title gen, vision captioning, subagents, heartbeat, filing, compaction, memory extraction/retrieval/consolidation/router, conversation summarization, reply suggestions, greeting, approval copy, classifiers, workflow leaves, live-voice narration/front-door | **YES** — profiles can reference a `provider_connection` row (`provider_connections.baseUrl` is user-supplied), and `openai-compatible`/`litellm`/`opencode` providers exist precisely for custom endpoints |
| **B. Service subsystems with static provider catalogs** | Image generation, TTS, STT, embeddings, web search/web-fetch | **Mostly NO** — endpoints are hardcoded constants or SDK defaults. Exceptions: `services["web-search"].apiBase` (fastcrw only), `services["web-fetch"].apiBase` (firecrawl/fastcrw), Ollama embeddings via env var |

The owner's complaint ("tools use different models with no custom endpoint option") is accurate for **System B** subsystems. System A auxiliaries *are* configurable today — the gap there is discoverability (call-site overrides are a newer feature; see `runtime/routes/llm-call-sites-routes.ts`, `cli/commands/inference-callsites.ts`).

---

## 1. The LLM call-site system (System A — the good news)

### Core files
- `config/schemas/llm.ts`
  - `LLMCallSiteEnum` — **lines 187–230**: the complete call-site registry (40+ sites incl. `vision`, `conversationTitle`, `subagentSpawn`, `heartbeatAgent`, `filingAgent`, `compactionAgent`, `memoryExtraction`, `memoryRouter`, `recall`, `workflowLeaf`, `voiceFrontDoor`, …).
  - `KNOWN_LLM_PROVIDERS` — **lines 45–67**: `anthropic, openai, gemini, ollama, fireworks, openrouter, vercel-ai-gateway, openai-compatible, minimax, atlascloud, together, litellm, opencode, baseten, poolside, vellum, chatgpt`. (`openai-compatible`, `litellm`, `opencode` are the custom-endpoint providers.)
  - `ProfileEntry` — **lines 614–668**: each profile carries `provider_connection` (**line 635**) referencing a `provider_connections` DB row; `mix` profiles at line 660.
- `config/call-site-defaults.ts` — **lines 33–190**: `CALL_SITE_DEFAULTS` maps each call site to a profile intent (`balanced` / `cost-optimized` / `latency-optimized`) plus tuning (maxTokens, temperature, effort, thinking, disableCache).
- `config/llm-resolver.ts` — `resolveCallSiteConfig` / `selectWinningProfile` (**lines 135–247**): single-winner chain: `overrideProfile` → `llm.activeProfile` (mainAgent only) → `llm.callSites[site].profile` → `CALL_SITE_DEFAULTS[site].profile` intent × `llm.defaultProvider` → balanced anchor.
- `config/schemas/call-site-catalog.ts` — display metadata keyed by every `LLMCallSite`.
- `config/prune-seeded-callsite-defaults.ts`, `config/sync-gated-profiles.ts` — seeding/migration machinery.
- `api/constants/call-sites.ts` — wire constants for `llm_request_log.call_site` column.
- DB: `persistence/schema/inference.ts` (provider_connections table); resolution in `providers/inference/connections.ts` (**line 111**: `baseUrl: row.baseUrl ?? null`); auth resolution `providers/inference/resolve-auth.ts`, availability `connection-availability.ts`.

### How an auxiliary call site resolves
`getConfiguredProvider(<callSite>)` (re-exported by `plugin-api/index.ts` **line 218** from `providers/provider-send-message.ts`) → `resolveCallSiteConfig` → winning profile → provider registry dispatch using the profile's provider / connection row (auth + `baseUrl`).

### Every `getConfiguredProvider("<callSite>")` auxiliary emit site (grep, non-test)

| Call site | File | Default profile (call-site-defaults.ts) |
|---|---|---|
| `conversationTitle` | `persistence/conversation-title-service.ts:208, 344` | `cost-optimized` (L82, disableCache) |
| `vision` | `plugins/defaults/image-fallback/src/vision-caption.ts:86` | none — plugin picks vision-capable profile (L93) |
| `skillCategoryInference` | `daemon/handlers/skills.ts` | `cost-optimized` (L161) |
| `conversationSummarization` | `conversations/job-handlers/summarization.ts` | `cost-optimized` (L81) |
| `conversationStarters` | `home/job-handlers/conversation-starters.ts` | `balanced`, effort low (L68) |
| `homeGreeting` | `home/home-greeting.ts` | `cost-optimized` (L166) |
| `homeSuggestedPrompts` | `home/suggested-prompts.ts` | `cost-optimized` (L174) |
| `voiceProgressNarration` | `live-voice/progress-narration.ts` | `latency-optimized` (L140) |
| `styleAnalyzer` | `messaging/style-analyzer.ts` | `cost-optimized` (L86) |
| `notificationDecision` | `notifications/decision-engine.ts` | `cost-optimized` (L116) |
| `preferenceExtraction` | `notifications/preference-extractor.ts` | `cost-optimized` (L121) |
| `recall` | `plugins/defaults/memory/context-search/agent-runner.ts` | `balanced`, maxTokens 4096 (L60) |
| `memoryV2Sweep` | `plugins/defaults/memory/substrate/sweep-job.ts` | `cost-optimized` (L79) |
| `memoryConsolidation` | `plugins/defaults/memory/v1/graph/consolidation.ts` | `balanced`, disableCache (L40) |
| `memoryExtraction` | `plugins/defaults/memory/v1/graph/extraction.ts` | `cost-optimized` (L75) |
| `narrativeRefinement` | `plugins/defaults/memory/v1/graph/narrative.ts` | `balanced` (L38) |
| `patternScan` | `plugins/defaults/memory/v1/graph/pattern-scan.ts` | `balanced` (L37) |
| `memoryRetrieval` | `plugins/defaults/memory/v1/graph/retriever.ts` | `cost-optimized` (L76) |
| `memoryV2Migration` | `plugins/defaults/memory/v2/migration.ts` | `cost-optimized` (L78) |
| `memoryRouter` | `plugins/defaults/memory/v2/router.ts` | `cost-optimized`, 1M ctx (L44) |
| `replySuggestion` | `runtime/routes/conversation-routes.ts` | `cost-optimized` (L105) |
| `interactionClassifier` | `runtime/routes/diagnostics-routes.ts` | `latency-optimized` (L129) |
| `inference` | `runtime/routes/inference-send-routes.ts`, `providers/inference/profile-probe.ts` | `cost-optimized` (L87) |
| `trustRuleSuggestion` | `runtime/routes/suggest-trust-rule-routes.ts` | `cost-optimized` (L85) |
| `mainAgent` (media reduce) | `config/bundled-skills/media-processing/services/reduce.ts` | `balanced` (L34) |
| `workflowLeaf` | `workflows/leaf-runner.ts:67,374` | none — inherits workspace default (L186) |
| `compactionAgent` | `context/compactor.ts:77` (`COMPACTION_LOG_CALL_SITE`) | `balanced` (L36) |
| `heartbeatAgent` | `heartbeat/heartbeat-service.ts:849` | `cost-optimized` (L95) |
| `filingAgent` | `plugins/defaults/memory/v1/filing-jobs.ts:91` | `cost-optimized` (L74) |
| `subagentSpawn` | `tools/subagent/spawn.ts` (spawn path) | `balanced` (L35) |
| `callAgent`, `voiceFrontDoor` | `calls/`, `live-voice/` | `balanced` / `latency-optimized` (L39, L151) |

**Conclusion:** every auxiliary **LLM** task is already endpoint-customizable through `llm.profiles.<name>.provider_connection` → `provider_connections` rows (user-supplied `baseUrl`, models column, auth). No changes needed to route these to custom endpoints; the work is in System B below.

---

## 2. Vision / image analysis

**No dedicated vision model exists.** Vision is "a profile whose model the catalog says supports vision", routed through the LLM system.

- `plugins/defaults/image-fallback/src/vision-caption.ts`
  - `findVisionProfile()` **lines 44–54**: first enabled profile where `doesSupportVision(profile)` — same order as the `/model` picker.
  - `captionImage()` **lines 86–96**: `getConfiguredProvider("vision", { overrideProfile: profileKey, forceOverrideProfile: true })`; `callSite: "vision"` at **line 108**.
- `plugin-api/vision-support.ts` — `doesSupportVision` **lines 41–51** resolves capability from the **static** `PROVIDER_CATALOG` (`providers/model-catalog.ts`, `supportsVision` flag, **line 69**; per-model flags e.g. lines 205, 223, 240, 257). Unknown model → `false` (fail-safe → image is captioned or replaced with placeholder). Custom-endpoint models not listed in the catalog are **always** treated as non-vision.
- Recovery hooks: `plugins/defaults/image-fallback/hooks/post-model-call.ts`, `post-tool-use.ts`; state in `src/recovery-state.ts`; cache `src/caption-cache.ts`.
- Media events pipeline: `media/job-handlers/media-processing.ts:85–87` → `config/bundled-skills/media-processing/services/reduce.ts` uses `getConfiguredProvider("mainAgent")` — i.e. the chat model, not a separate vision model.

**Hardcoded:** the `supportsVision` capability table (`providers/model-catalog.ts`). **Configurable:** which model performs vision (any profile, incl. custom-endpoint connections) — but only if the catalog knows the model. *To support vision on custom endpoints, either add the model to the catalog or allow an explicit vision-capability override on the profile/connection.*

---

## 3. Embeddings / memory

**Config:** `config/schemas/memory-storage.ts`
- `VALID_MEMORY_EMBEDDING_PROVIDERS` **lines 3–9**: `auto | local | openai | gemini | ollama` (no `openai-compatible`).
- `MemoryEmbeddingsConfigSchema` **lines 13–71**: `provider` (default `auto`), `localModel` (default `Xenova/bge-small-en-v1.5`), `openaiModel` (default `text-embedding-3-small`), `geminiModel` (default `gemini-embedding-2`) + `geminiTaskType`/`geminiDimensions`, `ollamaModel` (default `nomic-embed-text`). **No `apiBase`/`baseUrl` field anywhere.**

**Backend selection:** `persistence/embeddings/embedding-backend.ts`
- `selectEmbeddingBackend()` **lines 488–580+**: `local` (L495), `ollama` (L506), managed-proxy Gemini inserted first when platform creds exist (L524–529, `tryGetManagedGeminiBackend` L457–481), then auto chain `["local","openai","gemini","ollama"]` **lines 532–535**.
- `LazyLocalEmbeddingBackend` L78 (ONNX runtime, `embedding-local.ts`; runtime mgmt `embedding-runtime-manager.ts`).

**Endpoints:**
| Provider | File | Endpoint |
|---|---|---|
| local (ONNX) | `embedding-local.ts` | in-process, no endpoint |
| openai | `embedding-openai.ts` | OpenAI SDK default (`api.openai.com`) — **hardcoded, no baseUrl** |
| gemini | `embedding-gemini.ts` | `@google/genai` SDK default, or `managedBaseUrl` = platform proxy path — **hardcoded** |
| ollama | `embedding-ollama.ts` **L14, L73–83** | `OLLAMA_BASE_URL` env (`config/env.ts` `getOllamaBaseUrlEnv`) or default `http://127.0.0.1:11434/v1` — env-only, not workspace config |

Memory **LLM** calls (extraction, consolidation, retrieval, router, v2/v3 select, retrospective, recall, narrative, pattern-scan) all go through System A call sites → fully configurable.

**Needed for custom endpoints:** add `apiBase` (or per-provider base URL) to `MemoryEmbeddingsConfigSchema` and thread it into `OpenAIEmbeddingBackend` / `GeminiEmbeddingBackend` constructors in `embedding-backend.ts` (see `getDirectGeminiBackend` L432–450 and the openai branch L554–578).

---

## 4. Title generation

- `persistence/conversation-title-service.ts` **lines 207–208 and 343–344**: `getConfiguredProvider("conversationTitle")`; deterministic fallback when no provider (`settleForDeterministicTitle`).
- Triggers: `plugins/defaults/title-generate/hooks/user-prompt-submit.ts` (first title) and `stop.ts` (retry placeholder titles, second pass at 3rd user turn, **lines 71–128**).
- Call site default: `conversationTitle: { profile: "cost-optimized", disableCache: true }` (`config/call-site-defaults.ts:82`).
- **Fully endpoint-configurable** via profiles/connections; optionally pin a different profile via `llm.callSites.conversationTitle.profile`.

---

## 5. Web search & web fetch

**Catalog:** `providers/search-provider-catalog.ts` **lines 89–166**: `vellum` (managed), `inference-provider-native` (Provider Native), `perplexity`, `brave`, `tavily`, `firecrawl`, `keenable` (keyless), `fastcrw` — only `fastcrw` has `supportsApiBase: true` (**line 163**).

**Config:** `config/schemas/services.ts`
- `WebSearchServiceSchema` **lines 75–82**: `services["web-search"].provider` (default `inference-provider-native`, line 78) + optional `apiBase` (line 81, only honored by fastcrw today).
- `WebFetchServiceSchema` **lines 88–97**: `services["web-fetch"].provider` (default `default`) + optional `apiBase` (line 96).

**Executors:** `tools/network/web-search.ts`
- **Hardcoded endpoints lines 40–50**: `BRAVE_API_URL` (`https://api.search.brave.com/res/v1/web/search`), `PERPLEXITY_API_URL` (`https://api.perplexity.ai/chat/completions`), `TAVILY_API_URL` (`https://api.tavily.com/search`), `FIRECRAWL_API_URL` (`https://api.firecrawl.dev/v2/search`), `KEENABLE_API_BASE_URL`, `FASTCRW_*`.
- `getWebSearchProvider()` **lines 169–181**: reads config; `inference-provider-native`/`vellum` coerce to `perplexity` when the app-executed tool is still invoked (native path replaces the tool instead); default `perplexity` (L171).
- fastcrw honors `services["web-search"].apiBase` via `resolveProviderApiUrl` **lines 1230–1238, 1540–1543**.
- Managed search: `tools/network/managed-search-proxy.ts` (platform proxy).
- Provider Native wiring: `agent/loop.ts` **lines ~1480–1491** — `attachNativeWebSearch = config.enableNativeWebSearch && provider.supportsNativeWebSearch` (per-adapter capability flag in `providers/inference/adapter-factory.ts` / registry); swaps in `NATIVE_WEB_SEARCH_TOOL` (sentinel at L1546). Only inference providers whose adapter implements native hosted search qualify — unavailable on custom OpenAI-compatible endpoints unless the adapter grows it.
- BYOK keys: `providers/provider-secret-catalog.ts`, `providers/provider-env-vars.ts` (`SEARCH_PROVIDER_ENV_VAR_NAMES`); fallback chain `SEARCH_PROVIDER_FALLBACK_ORDER` (search-provider-catalog.ts L177–180).
- `tools/network/web-fetch.ts`: `FIRECRAWL_SCRAPE_API_URL` hardcoded **line 52**; BYOK branch L1122+; apiBase read at **line 1489** (firecrawl/fastcrw).

**Needed for custom endpoints:** extend the `WEB_SEARCH_ADAPTERS` table + `resolveProviderApiUrl` so `apiBase` applies to perplexity/brave/tavily/firecrawl/keenable (schema field already exists — only the adapters ignore it). Note Perplexity's endpoint is an LLM chat-completions endpoint, so a custom `apiBase` there effectively means any OpenAI-compatible search proxy.

---

## 6. Image generation

**Model catalog:** `media/image-models.ts` **lines 14–45** — provider type is only `"gemini" | "openai"` (L14); models: `gemini-3.1-flash-image-preview` (fast), `gemini-3-pro-image-preview` (quality), `gpt-image-2` (openai). `DEFAULT_IMAGE_MODEL` L47.

**Config:** `config/schemas/services.ts` `ImageGenerationServiceSchema` **lines 62–65**: `provider` ∈ `vellum | gemini | openai` (default `gemini`), `model` string. **No apiBase field.**

**Routing & credentials:** `media/image-credentials.ts`
- `resolveImageGenRouting()` **lines 28–47**: `vellum` = managed proxy, backend derived from model prefix (`providerForImageModelPrefix`); BYOK derives backend from model prefix or configured provider.
- `resolveImageGenCredentials()` **lines 59–96**: managed → `{platformBaseUrl}{PLATFORM_PROVIDER_META[provider].proxyPath}` (L86); direct → `getProviderKeyAsync(provider)` (L91).

**Endpoints (hardcoded):**
- `media/gemini-image-service.ts` — `DEFAULT_MODEL`/`ALLOWED_MODELS` **L15–19**; direct mode uses `GoogleGenAI` SDK (`@google/genai`, default Google endpoint); managed proxy via `fetch` to `{baseUrl}/v1beta/models/{model}:generateContent` (**L78**).
- `media/openai-image-service.ts` — `DEFAULT_MODEL = "gpt-image-2"`, `ALLOWED_MODELS` **L15–16**; uses `openai` SDK with default base URL (no `baseURL` passed).

**Call sites:** image-studio skill `config/bundled-skills/image-studio/tools/media-generate-image.ts` (via `resolveImageGenCredentials`/`resolveImageGenRouting`); avatars `media/avatar-router.ts` **L12–38**; app icons `media/app-icon-generator.ts` **L36–38**. All three share the one service config.

**Needed for custom endpoints:** add `apiBase` to `ImageGenerationServiceSchema`, thread through `ImageGenCredentials` (direct type) into the OpenAI client (`baseURL`) and the Gemini SDK/fetch URL.

---

## 7. TTS

**Catalog:** `tts/provider-catalog.ts` **lines 46–52**: `vellum`, `elevenlabs`, `fish-audio`, `deepgram`, `xai`.

**Config:** `config/schemas/tts.ts`
- `TtsServiceSchema` **lines 345–357**: `services.tts.provider` (default `elevenlabs`, L351), `services.tts.providers.<id>` per-provider blocks.
- Per-provider fields are voice/tuning only — e.g. ElevenLabs `voiceId`, `voiceModelId`, `speed`, `stability`, `similarityBoost`, `languageVoices` (**lines 65–131+**). **No apiBase/baseUrl anywhere.**
- Resolver: `tts/tts-config-resolver.ts` **lines 42–54** (`resolveTtsConfig` reads `services.tts.provider` + `providers.<id>`; `providerOverride` for live voice).

**Endpoints (hardcoded per adapter):**
| Provider | File | Constant |
|---|---|---|
| xAI | `tts/providers/xai-provider.ts` | `XAI_API_BASE = "https://api.x.ai"` L59; WS `wss://api.x.ai/v1/tts` L61 |
| Deepgram | `tts/providers/deepgram-provider.ts` | `DEEPGRAM_API_BASE = "https://api.deepgram.com"` L64 |
| ElevenLabs | `tts/providers/elevenlabs-provider.ts` | `ELEVENLABS_API_BASE = "https://api.elevenlabs.io"` L134 |
| Fish Audio | `tts/providers/fish-audio-provider.ts` | (hardcoded base, same pattern) |
| Vellum | `tts/providers/vellum-provider.ts` + `vellum-tts-socket.ts` | platform speech socket |

**Needed for custom endpoints:** add `apiBase` to `TtsServiceSchema` (and/or per-provider blocks), thread into each adapter's HTTP/WS URL construction.

---

## 8. STT

**Providers:** `config/schemas/stt.ts` `VALID_STT_PROVIDERS` **lines 16–22**: `deepgram`, `google-gemini`, `openai-whisper`, `xai`, `vellum` (aliases openai/whisper → openai-whisper, L29–35).

**Config:** `config/schemas/stt.ts`
- `SttServiceSchema` **lines 175–227**: `services.stt.provider` (default `deepgram` — seeded in `services.ts:174`), `language` (default `multi`, L214), `providers.<id>.model` (model-family enum validated against `provider-catalog.ts` L49–75), `roles.<role>.provider/model` (per-consumer overrides, L90–152).
- **No baseUrl/apiBase field.**
- Resolver: `providers/speech-to-text/resolve.ts` — `resolveSttCatalogKey` (L136 reads `services.stt`), role override (L105, `sttCatalogKeyForRole` L233), provider config read at L456.
- Provider catalog: `providers/speech-to-text/provider-catalog.ts` (model families per provider).

**Endpoints (hardcoded):**
| Provider | File | Constant |
|---|---|---|
| Deepgram | `providers/speech-to-text/deepgram.ts` | `DEFAULT_BASE_URL = "https://api.deepgram.com"` **L3**; class accepts `baseUrl` option (**L21–22, L162**) but nothing wires config into it — daemon batch/streaming construct it internally |
| OpenAI Whisper | `providers/speech-to-text/openai-whisper.ts` | `WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions"` **L3** — fully hardcoded |
| xAI | `providers/speech-to-text/xai.ts` | `XAI_STT_URL = "https://api.x.ai/v1/stt"` **L3** |
| Google Gemini | `providers/speech-to-text/google-gemini.ts` | `GoogleGenAI` SDK (L42–46: Vertex or apiKey) — SDK default endpoint |
| Vellum | `providers/speech-to-text/vellum-managed*.ts`, `vellum-speech-relay-connection.ts` | platform speech relay (`VELAY_BASE_URL` on the gateway, see L107) |

**Needed for custom endpoints:** add baseUrl to `SttServiceSchema`/`SttProvidersSchema` and pass into Deepgram options (plumbing exists on the class), Whisper fetch URL, and xAI fetch URL.

---

## 9. Subagents & background agents

All of these are System A call sites (configurable via profiles/connections):

- **Subagent spawn**: `tools/subagent/spawn.ts` — `inference_profile` param validation (L4), default verdict tier constant near **L107–123** (check spawns get a cheaper profile unless named); `subagent/types.ts` **L164–177**: `overrideProfile` / `forceOverrideProfile` inherited from parent or set at spawn; call site `subagentSpawn` (default `balanced`, `call-site-defaults.ts:35`). Manager: `subagent/manager.ts`.
- **Heartbeat**: `heartbeat/heartbeat-service.ts` **L849** `callSite: "heartbeatAgent"` (default `cost-optimized`, `call-site-defaults.ts:95`).
- **Filing**: `plugins/defaults/memory/v1/filing-jobs.ts` **L91** `callSite: "filingAgent"` (default `cost-optimized`, L74).
- **Compaction**: `context/compactor.ts` **L77** `COMPACTION_LOG_CALL_SITE = "compactionAgent"` (default `balanced`, L36).
- **Workflow leaves**: `workflows/leaf-runner.ts` **L67, L374** `workflowLeaf` (no pinned profile — inherits workspace default, L186).
- **Live voice**: `voiceFrontDoor` / `voiceProgressNarration` (latency-optimized) and `callAgent` (balanced).
- **Skills `inference` tool**: `runtime/routes/inference-send-routes.ts`, `cli/commands/inference.ts` → call site `inference` (`cost-optimized`), accepting explicit profile/connection params.

---

## 10. What needs changing for custom endpoints (checklist)

Already custom-endpoint capable (System A — no change):
1. Title generation, vision captioning, subagents, heartbeat, filing, compaction, conversation summaries, reply suggestions, greetings, approval copy, classifiers, memory LLM passes, workflow leaves → `llm.profiles` + `provider_connections.baseUrl`.

Hardcoded — need schema + adapter changes:
2. **Embeddings**: `config/schemas/memory-storage.ts` (add apiBase) + `persistence/embeddings/embedding-openai.ts`, `embedding-gemini.ts`, wiring in `embedding-backend.ts:432–578`.
3. **Image gen**: `config/schemas/services.ts:62–65` (add apiBase) + `media/openai-image-service.ts` (client `baseURL`), `media/gemini-image-service.ts` (SDK base URL), `media/types.ts` `ImageGenCredentials`.
4. **TTS**: `config/schemas/tts.ts:345–357` (add apiBase) + `tts/providers/{elevenlabs,deepgram,xai,fish-audio}-provider.ts` URL constants.
5. **STT**: `config/schemas/stt.ts:175–227` (add baseUrl) + `providers/speech-to-text/{deepgram,openai-whisper,xai}.ts` (deepgram already has the class option, needs config plumbing).
6. **Web search/fetch**: schema field `services["web-search"].apiBase` exists (`services.ts:81`) — extend `WEB_SEARCH_ADAPTERS` in `tools/network/web-search.ts` (and `web-fetch.ts`) so perplexity/brave/tavily/firecrawl/keenable honor it; currently only fastcrw does (web-search.ts:1230–1238).
7. **Vision capability table** (edge case): `providers/model-catalog.ts` `supportsVision` flags + `plugin-api/vision-support.ts` — custom models not in the catalog are treated as non-vision; allow a per-profile/per-connection vision override if custom-endpoint vision is required.

## 11. Issues encountered

- None blocking. `terminal` with `cd` in the command body failed for the `VELLUM-BY-HERMES` path (shell cwd quirk); using the `workdir` parameter resolved it.
- No files were modified; this was read-only exploration.
