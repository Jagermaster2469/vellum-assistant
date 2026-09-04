# Phase 1 Data Model: Provider Freedom

**Date**: 03/09/26

## Entities (existing + new)

### ProviderConnection (existing — `provider_connections` table)
- name (unique), provider (catalog id or routing identity), auth (`api_key | platform | none | oauth_subscription`), label, baseUrl (custom-endpoint kinds), models[] (declared ids for openai-compatible), timestamps.
- **Change**: none structurally; becomes the reference for default-provider materialization (D2) and call-site fragments (D3).

### InferenceProfile (existing — `llm.profiles`)
- name, source (managed|user), provider, model, provider_connection, label, description, status, mix, allowUnlisted, maxTokens, effort, speed, verbosity, temperature, topP, thinking, contextWindow, openrouter, logitBias, disableCache.
- **Change**: `allowUnlisted` auto-stamped on web saves for connection-declared models (D2). Vision override field (D5).

### LLMCallSiteConfig (existing — `llm.callSites`)
- profile?, provider?, model?, maxTokens?, effort?, temperature?, thinking?, contextWindow?
- **Change**: add `provider_connection` (D3); entry-aware write validation.

### Service configs (existing — `config/schemas/services.ts`, `memory-storage.ts`, `tts.ts`, `stt.ts`)
- **Embeddings** (`memory-storage.ts`): + `apiBase` per provider (D4).
- **Image generation** (`services.ts`): + `apiBase` (D4).
- **Video generation** (`services.ts`, NEW): provider (xai|others), model, apiBase (D10).
- **TTS** (`tts.ts`): + `apiBase` (D4).
- **STT** (`stt.ts`): + `baseUrl` (D4).
- **Web search/fetch** (`services.ts`): existing `apiBase` honored by ALL BYOK adapters (D4); + `x` provider (D11).

### Channel configs (existing — `config/schemas/channels.ts`)
- whatsapp.* — add mentionPatterns, groupPolicy, allowFrom/freeResponseChats equivalents (D6).
- buzz.* (NEW): relayUrl, nsec credential ref, transport, channels, homeChannel, allowedUsers, allowAll, replyInThread, pollInterval (D7).

### New skills/bundled skills
- `skills/home-assistant/` (D8), `skills/a2a-client/` (D9), bundled `video-studio/` (D10), bundled `voice-output/` (D12).

## State transitions
- ProviderConnection: created (probe advisory) -> active (credential present) -> invalid (probe failed / missing key).
- InferenceProfile: draft -> active -> disabled.
- Buzz channel: disconnected -> connecting (relay WS) -> connected -> reconnecting (backoff) -> degraded (poll fallback).
