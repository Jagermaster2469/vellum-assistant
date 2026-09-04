# Feature Specification: Model Triple (endpoint + model + key for every function)

**Feature Branch**: `002-model-triple`
**Created**: 04/09/26
**Status**: Draft
**Baseline**: `001-provider-freedom` (merged into 002 as starting point)
**Input**: User request — "Goal is to be able to fulfill endpoint, model and secret key for every function that requires a model. Assume 90% of 001 did not achieve its goal. Read twice chain of thought, propose different approach, execute on new branch from GitHub."

## Problem statement

001 scattered optional `apiBase`/`baseUrl` strings across 6+ service schemas (embeddings, image, video, TTS per-provider, STT, web-search/fetch) plus per-adapter URL rewriting. The triple (endpoint, model, key) stayed split:

- endpoint in config (`apiBase`), model in a different config key (or hardcoded, e.g. Perplexity `sonar`), key in env/secure-storage under a different provider name;
- no generic `openai-compatible` provider for non-LLM modalities (image, video, TTS, STT, embeddings);
- gaps: Whisper streaming ignores `baseUrl`, Perplexity model hardcoded, video only `xai`, image only `gemini`/`openai`, no OpenAI-audio generic TTS/STT;
- UI only exposed `openai-compatible` in main picker + call-site overrides; per-service triple editors missing;
- tests missing (001 T019/T025/T031 unchecked), no end-to-end probe proving triple works.

User cannot, in one place per function, set endpoint + model + key and verify it.

## Different approach (vs 001)

Instead of patching each adapter with its own `apiBase`, centralize:

1. **One canonical triple type** (`ModelTriple`: endpoint, model, keyRef) with normalize + resolve + probe, reused by every modality.
2. **Generic `openai-compatible` provider for EVERY modality**, using OpenAI wire protocol (which already covers chat, embeddings `/v1/embeddings`, image `/v1/images/generations`, TTS `/v1/audio/speech`, STT `/v1/audio/transcriptions`). Any LiteLLM / vLLM / LM Studio / OpenRouter / DeepSeek-compatible endpoint works for all functions with same triple pattern.
3. **Inheritance**: service-specific triple wins; unset inherits workspace default (`llm.defaultProvider` connection); never silently fallback to managed `vellum` — throw actionable error naming endpoint.
4. **Key handling**: keys stay in CES vault / env (never in config file, never logged). Each triple documents its key name (`openai`, `xai`, `brave`, etc.) + `credential/...` path + env fallback. UI credential prompts per service.
5. **Probe + verify**: `probeTriple` (GET `/models`, fallback POST chat/completions 1 token, 10-min cache) + `bun run verify:triples` script reporting per-function endpoint+model+key status (keys redacted).
6. **UI**: single triple editor component reused for every service (endpoint, model, key fields), not per-provider bespoke pickers.

## User stories

### US1 — One triple per function (P1)
As owner, for each function (main chat, vision, title, memory extraction, embeddings, image, video, TTS, STT, web-search summarization, X search, subagents) I set endpoint + model + key in one place; unset inherits workspace default; failures name the endpoint, never silently bill managed.

Acceptance:
- Given custom triple (baseUrl, key, model), when selected as default, conversations run with no provider-list error.
- Given unreachable endpoint, when invoked, error names endpoint, no silent managed fallback.
- Given keyless local (Ollama/LM Studio, empty key, localhost), requests succeed with no key prompt.
- Given saved triple, daemon restart preserves it.

### US2 — Generic OpenAI-compatible for all modalities (P1)
As owner, I can point embeddings, image, TTS, STT, video, search-summarization at any OpenAI-compatible endpoint with model + key.

Acceptance:
- Embeddings via `openai-compatible` (custom baseURL + model + key) produce vectors (verified by memory search).
- Image via `openai-compatible` produces image (verified by file).
- TTS via `openai-compatible` (`/v1/audio/speech`) produces audio.
- STT via `openai-compatible` (`/v1/audio/transcriptions`, batch + streaming) transcribes.
- Vision works on custom models (capability override, not static catalog block).

### US3 — Keys documented + verifiable per function (P1)
As owner, for each function I see which key is used (vault path + env var), can set it, and can probe without leaking it.

Acceptance:
- `verify:triples` lists every function with endpoint, model, key presence (present/missing, never values), probe verdict.
- Missing key yields actionable hint (Settings path + env var), not hang.

## Functional requirements

- FR-1: Central `ModelTriple` zod schema + `normalizeTriple`, `resolveTriple` (service triple > workspace default > provider default), `isKeylessLocal`.
- FR-2: `probeTriple` with 10-min verdict cache, redacted logging, actionable errors.
- FR-3: `openai-compatible` provider option for embeddings, image, video, TTS, STT (schema + adapter via OpenAI SDK with custom `baseURL`).
- FR-4: Fix gaps: Whisper streaming honors `baseUrl`; Perplexity model configurable (not hardcoded `sonar`); video/image generic endpoint support.
- FR-5: Per-service credential docs (vault path + env var) + UI triple fields.
- FR-6: Unit tests for triple + adapters; `verify:triples` script; typecheck + lint + targeted tests green.
- FR-7: Backward compatible: existing configs parse unchanged; empty triple = provider cloud default; `vellum` managed never consults custom base.

## Success criteria

- SC-1: User configures custom endpoint triple for main + each tool role in <5 min, zero provider-list errors.
- SC-2: 100% of model roles expose endpoint+model+key; unset inherits default.
- SC-3: `verify:triples` passes for configured triple (or clearly reports missing key/endpoint).
- SC-4: No managed fallback on failure; no key leakage in logs/errors.
- SC-5: Typecheck, lint, targeted tests pass; branch pushed.

## Assumptions

- OpenAI wire protocol is the interop standard for custom endpoints (chat, embeddings, image, audio). Video uses xAI-style POST + poll; generic video allows custom `apiBase` with same shape.
- Keys live in CES vault (`credential/...`) + env fallback via `getProviderKeyAsync`; config file never stores raw keys.
- WhatsApp/Buzz/HA/A2A platform work from 001 is baseline (already merged); 002 focuses on triple correctness, not re-doing platforms.
