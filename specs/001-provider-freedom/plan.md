# Implementation Plan: Provider Freedom

**Branch**: `001-provider-freedom` | **Date**: 03/09/26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-provider-freedom/spec.md`

## Summary

Three pillars: (A) make custom OpenAI-compatible endpoints first-class for the main model AND every tool-model role; (B) bring platforms to Hermes parity (WhatsApp policy controls, new first-party Buzz channel, Home Assistant, A2A client); (C) ship provider-configurable tools (video gen, X search, TTS tool, embeddings/search/image/TTS/STT custom endpoints). Implementation rides the existing provider_connections / profiles / skills / bundled-skills extension surfaces; no new core tools.

## Technical Context

**Language/Version**: TypeScript (Bun 1.4.0, strict tsgo typecheck)
**Primary Dependencies**: existing (openai SDK, @google/genai, zod); no new runtime deps planned
**Storage**: workspace config.json + sqlite (provider_connections, channels) + credential vault
**Testing**: bun test (targeted suites); baseline typecheck tsgo --noEmit
**Target Platform**: assistant/ (daemon), gateway/ (ingress), clients/web/ (settings UI), skills/
**Project Type**: monorepo services
**Performance Goals**: none beyond existing (no per-turn cost increases)
**Constraints**: upstream-mergeable diffs; no new core tools (tools/AGENTS.md); credentials never reach the model; gateway owns all public ingress; MIT-compatible deps; exact version pinning
**Scale/Scope**: ~20 assistant files, ~10 gateway files, ~8 web files, ~5 new skill dirs

## Constitution Check

1. Open Model Freedom — the feature itself. PASS.
2. Provider Neutrality — no new privileged provider; xAI only as a DEFAULT, user-overridable. PASS.
3. Extensibility Over Forking — skills/bundled skills/plugins for new capabilities; core changes are minimal and follow existing patterns. PASS.
4. Platform Parity — all 8 platforms covered (6 existing + Buzz + Home Assistant; A2A completed). PASS.
5. Provider-Configurable Tools — all 10 categories covered. PASS.
6. Security Invariants — credentials via existing vault/secret catalog; webhooks via gateway; SSRF guard preserved. PASS.
7. Verified Quality — typecheck/lint/tests gates per workstream. PASS.
8. Upstream Compatibility — no new deps; isolated modules. PASS.

## Project Structure

| Document | Purpose |
|---|---|
| spec.md | Feature specification |
| plan.md | This plan |
| research.md | Phase 0 decisions (D1-D16) |
| data-model.md | Entities & schema changes |
| quickstart.md | Validation scenarios |
| tasks.md | Task breakdown |

### Source layout (new/changed)
- assistant/src/config/schemas/{llm,services,tts,stt,memory-storage,channels}.ts
- assistant/src/config/{default-profile-catalog,default-provider-resolution,llm-resolver}.ts
- assistant/src/providers/{model-intents,registry,model-catalog}.ts + inference/{auth,connections}.ts + speech-to-text/*
- assistant/src/runtime/routes/{conversation-query-routes,inference-profiles-routes,inference-provider-connection-routes}.ts
- assistant/src/{media,tts,persistence/embeddings}/** — apiBase threading + video-service
- assistant/src/config/bundled-skills/{video-studio,voice-output}/ (new)
- assistant/src/tools/network/web-search.ts, web-fetch.ts (+ x adapter)
- gateway/src/{whatsapp,buzz(new),channels,index.ts,credential-reader.ts}
- packages/service-contracts/src/channels.ts (+ buzz)
- clients/web/src/domains/settings/ai/* (providers exposure, call-site overrides, probes)
- skills/{home-assistant,a2a-client}/ (new)
