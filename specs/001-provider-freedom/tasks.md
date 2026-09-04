# Tasks: Provider Freedom

**Input**: plan.md, spec.md, research.md, data-model.md, quickstart.md
**Branch**: `001-provider-freedom`
**Tests**: targeted `bun test` suites after each workstream; full `bunx tsgo --noEmit` + `bun run lint` at the end.

## Phase 1: Setup

- [ ] T001 Create branch `001-provider-freedom` from main in /Users/francisco/Downloads/VELLUM-BY-HERMES/vellum-fork and commit the .specify/ scaffold + specs/ directory
- [ ] T002 Baseline verification: `bun install`, `cd assistant && bunx tsgo --noEmit`, `bun run lint` all clean

## Phase 2: Foundational

- [ ] T003 [P] Widen `DEFAULT_PROVIDER_CHOICES` in assistant/src/config/schemas/llm.ts to admit openai-compatible (custom-endpoint) default providers with connection-derived models
- [ ] T004 [P] Add `provider_connection` to `LLMCallSiteConfig` in assistant/src/config/schemas/llm.ts and thread entry-aware resolution through assistant/src/config/llm-resolver.ts
- [ ] T005 [P] Add Buzz to `CHANNEL_IDS` in packages/service-contracts/src/channels.ts and gateway/src/channels/types.ts (canonical id first so daemon/gateway stay in sync)

## Phase 3: US1 — Main model on any OpenAI-compatible endpoint

- [ ] T006 [US1] Stamp `allowUnlisted` on web saves for connection-declared models in assistant/src/runtime/routes/conversation-query-routes.ts (`completeChangedCustomProfiles` / `handlePatchConfig`)
- [ ] T007 [US1] Materialize default profiles (balanced/quality-optimized/cost-optimized/latency-optimized) on an openai-compatible default provider: assistant/src/config/default-profile-catalog.ts + assistant/src/config/default-provider-resolution.ts + assistant/src/providers/model-intents.ts
- [ ] T008 [US1] Stop degenerate boot adapter registration for openai-compatible in assistant/src/providers/registry.ts (`resolveModel` path)
- [ ] T009 [US1] Soft-landing for endpoint probes: assistant/src/runtime/routes/inference-provider-connection-routes.ts + assistant/src/providers/inference/endpoint-probe.ts (persist verdict, skip re-probe), and clients/web/src/domains/settings/ai/use-profile-save.ts (no toast for allowUnlisted/openai-compatible profiles)
- [ ] T010 [US1] UI: expose openai-compatible in the inference provider picker — clients/web/src/domains/settings/ai/constants.ts + provider-editor-constants.ts + profile-editor-provider-section.tsx (reuse existing provider-create-form flow)
- [ ] T011 [US1] Tests: extend assistant/src/__tests__/llm-context-resolution.test.ts and config schema tests for defaultProvider=custom-connection cases; run `bun test` for config/providers suites

## Phase 4: US2 — Custom endpoints for every tool model role

- [ ] T012 [P] [US2] Embeddings apiBase: assistant/src/config/schemas/memory-storage.ts + assistant/src/persistence/embeddings/embedding-backend.ts + embedding-openai.ts / embedding-gemini.ts (thread baseUrl into SDK clients)
- [ ] T013 [P] [US2] Image gen apiBase: assistant/src/config/schemas/services.ts (`apiBase` on image-generation) + assistant/src/media/image-credentials.ts + openai-image-service.ts (`baseURL`) + gemini-image-service.ts
- [ ] T014 [P] [US2] TTS apiBase: assistant/src/config/schemas/tts.ts + assistant/src/tts/providers/{elevenlabs,deepgram,xai,fish-audio}-provider.ts (URL construction honors apiBase)
- [ ] T015 [P] [US2] STT baseUrl: assistant/src/config/schemas/stt.ts + assistant/src/providers/speech-to-text/{deepgram,openai-whisper,xai}.ts (config plumbing; deepgram class option already exists)
- [ ] T016 [P] [US2] Web search/fetch apiBase for all BYOK adapters: assistant/src/tools/network/web-search.ts + web-fetch.ts (`resolveProviderApiUrl` honors services["web-search"].apiBase for perplexity/brave/tavily/firecrawl/keenable)
- [ ] T017 [P] [US2] Vision capability override for custom-endpoint models: assistant/src/providers/model-catalog.ts + assistant/src/plugin-api/vision-support.ts (per-profile `visionOverride` or connection-declared capability)
- [ ] T018 [US2] UI: call-site overrides picker accepts connections + custom models — clients/web/src/domains/settings/ai/call-site-overrides-row.tsx + overrides-detail-panel.tsx + bulk-override-swap-modal.tsx (reuse expandEndpointEntries); backend entry-aware write check in conversation-query-routes.ts (`assertRoutableIdentityEntries` call-site branch)
- [ ] T019 [US2] Tests: schemas tests for new apiBase fields; embedding/image/tts/stt adapter tests where present; `bun test` targeted suites

## Phase 5: US3 — Platform parity

- [ ] T020 [P] [US3] WhatsApp policy parity: mention patterns + group policy + allowlists in assistant/src/config/schemas/channels.ts (whatsapp.*) and gateway/src/whatsapp/ + gateway/src/handlers/handle-inbound.ts (skip-unless-mentioned for groups); mirror Hermes config semantics
- [ ] T021 [P] [US3] Home Assistant skill: skills/home-assistant/ (SKILL.md + scripts/ha-*.ts using HA REST /api/states and /api/services; token via `assistant credentials prompt`; outbound-proxy registration)
- [ ] T022 [P] [US3] A2A client skill: skills/a2a-client/ (SKILL.md + scripts/a2a-*.ts posting A2A v1.0 JSON-RPC to remote agent cards, polling task state; reuse assistant/src/a2a/protocol-types.ts semantics)
- [ ] T023 [US3] Buzz first-party gateway channel: gateway/src/buzz/ (normalize.ts, verify.ts, send.ts, relay-socket.ts — Nostr NIP-42 WS client with poll fallback, nsec identity) + credential spec in gateway/src/credential-reader.ts + route/wiring in gateway/src/index.ts + transport hints + config section `buzz.*` in assistant/src/config/schemas/channels.ts + outbound ChannelTransport in assistant/src/messaging/providers/buzz/ + CHANNEL_METADATA entry in assistant/src/channels/types.ts
- [ ] T024 [US3] Verify per-channel policy controls for telegram/discord/slack/email (admission policy + mention requirements) and document gaps against Hermes config
- [ ] T025 [US3] Tests: whatsapp normalize/verify tests for mention gating; buzz normalize tests (event → GatewayInboundEvent); ha/a2a script smoke tests; gateway channel tests green

## Phase 6: US4 — Provider-configurable tools

- [ ] T026 [P] [US4] Video generation: new bundled skill assistant/src/config/bundled-skills/video-studio/ (TOOLS.json `media_generate_video`, host executor) + assistant/src/media/video-service.ts + services schema `video-generation` (provider default xai, apiBase-capable) + models catalog in assistant/src/media/video-models.ts
- [ ] T027 [P] [US4] X/Twitter search: add `x` BYOK entry to assistant/src/providers/search-provider-catalog.ts + adapter in assistant/src/tools/network/web-search.ts (X API v2 recent search) + secret/env wiring in assistant/src/providers/provider-secret-catalog.ts + sync catalog (`bun run sync:web-search-catalog`)
- [ ] T028 [P] [US4] TTS model tool: new bundled skill assistant/src/config/bundled-skills/voice-output/ (TOOLS.json `speak_text` host executor calling assistant/src/tts/synthesize-text.ts, saves audio to workspace)
- [ ] T029 [P] [US4] Computer use OS parity: verify `supportedClientOs` on assistant/src/config/bundled-skills/computer-use/TOOLS.json + assistant/src/tools/computer-use/definitions.ts (macos/windows/linux coverage); document Linux client gap if any
- [ ] T030 [US4] Browser backend configuration doc: verify the three CDP backends (local/extension/cdp-inspect) are configurable; add a short section to skills/vellum-browser-use/SKILL.md documenting backend selection
- [ ] T031 [US4] Tests: video-service + x-adapter + voice-output executor unit tests; `bun test` targeted suites

## Phase 7: Polish & Cross-Cutting

- [ ] T032 Full gates: `bunx tsgo --noEmit`, `bun run lint`, `bun test` (assistant + gateway affected suites) in both assistant/ and gateway/
- [ ] T033 Update in-repo docs: AGENTS.md divergence note + specs/001-provider-freedom/* final pass
- [ ] T034 Commit per-workstream atomic commits and push branch to origin (github.com/Jagermaster2469/vellum-assistant)
- [ ] T035 Obsidian vault: update Projects/vellum-by-hermes.md, Notes/Sesiones.md, Daily note

## Dependencies

- Phase 2 → Phase 3-6 (T003-T005 are blockers)
- T007 depends on T003; T010 depends on T006/T009
- T018 depends on T004
- T023 depends on T005 (canonical channel id)
- Within Phase 4: T012-T017 independent of each other
- Phase 7 last.

## Parallel execution

- After Phase 2: run Phase 3 sequentially in-core (config touchpoints), while Phases 4/5/6 tasks can be parallelized via subagents ([P] tasks touch disjoint files).
