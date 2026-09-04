# Phase 0 Research: Provider Freedom

**Date**: 03/09/26
**Source**: 6 parallel read-only exploration reports (saved in `research/` at repo root: vellum-provider-system-report.md, vellum-aux-model-callsites-report.md, vellum-gateway-channels-report.md, VELLUM-TOOLS-SYSTEM-REPORT.md, vellum-fork-provider-model-map.md, vellum-fork-extension-surfaces.md) + official docs mirrors in the Obsidian vault (Reference/Vellum-Docs/).

## Decision log

| # | Topic | Decision | Rationale |
|---|---|---|---|
| D1 | Custom-endpoint mechanism | Use the EXISTING `provider_connections` rows + `openai-compatible` provider (already dispatchable) | Adapter, auth, resolution and dispatch already work; only write surfaces / defaults / UI are restrictive. Minimal diff, upstream-mergeable. |
| D2 | Main-model custom endpoint gaps | (1) admit openai-compatible to `llm.defaultProvider` choices; (2) stamp `allowUnlisted` on the web save path; (3) quiet repeated probe toasts; (4) let default profiles materialize on a custom connection | Root causes of "errors occur eventually" per UI report section 5.4: permanent `model_unknown` config issue, probe toasts on every save, vendor-only provider enum. |
| D3 | Tool-model roles (System A) | No core change needed for LLM call-sites (vision caption, titles, memory LLM, subagents, heartbeat...) — they already resolve through profiles+connections. Add `provider_connection` to call-site fragments + UI exposure. | Callsites report section 0: System A already custom-endpoint capable. |
| D4 | System B (hardcoded endpoints) | Add `apiBase`/`baseUrl` config to embeddings, image gen, TTS, STT schemas; thread into adapters; extend web-search/fetch adapters to honor existing `apiBase` field. | Callsites report section 10 checklist. |
| D5 | Vision capability on custom models | Allow per-profile/per-connection vision override (catalog flag otherwise says "not vision" for unknown models). | Callsites report section 2: `supportsVision` is static. |
| D6 | WhatsApp | Keep official Meta Cloud API channel (exists, full-featured); add Hermes-parity policy: mention gating, group policy, allowlists, notification routing. No Baileys bridge. | User clarify timed out; recommended option. Channel report section 3: WhatsApp fully implemented. |
| D7 | Buzz | First-party gateway channel (compiled like Discord/Slack sockets): Nostr relay WebSocket, nsec identity, NIP-42 auth, channels/DMs, thread replies, allowlist, poll fallback. Reference: Hermes `plugins/platforms/buzz/adapter.py` + `plugin.yaml`. | User clarify timed out; recommended option. Channels report section 6: absent; extension report: plugin channels are namespaced/second-class, user wants first-class platform. |
| D8 | Home Assistant | Portable skill `skills/home-assistant/` with CLI scripts (REST API states/services), long-lived token via `assistant credentials prompt`, outbound-proxy registration for the HA host. | Tools report section 10: absent; skills are the sanctioned surface (tools/AGENTS.md). |
| D9 | A2A client | Add an A2A client capability (skill + CLI script posting A2A v1.0 JSON-RPC tasks to remote agent cards, polling task state). Server side already exists behind flag `a2a-channel`. | Channels report section 4: assistant implements protocol; gateway has no client. |
| D10 | Video generation | New bundled skill `video-studio/` (TOOLS.json `media_generate_video`, host executor) + `media/video-service.ts` + `services["video-generation"]` schema (provider: xai default, configurable). | Tools report section 7: missing; image-studio is the template. |
| D11 | X/Twitter search | Add `x` BYOK entry to the web-search provider catalog + adapter in `tools/network/web-search.ts` (X API v2 recent search via xAI-compatible endpoint), key via existing secret catalog (`XAI_API_KEY`-style env). | Tools report section 8: missing; documented 4-step provider addition. |
| D12 | TTS as model tool | New bundled skill `voice-output/` (`speak_text` host executor calling `tts/synthesize-text.ts`). | Tools report section 9: TTS is daemon-only today. |
| D13 | Computer use OS parity | Verify `supportedClientOs` on computer-use tools (macOS/Windows exist; ensure Linux client works where present); no new core tools. | Tools report section 4: exists via proxy pattern. |
| D14 | Browser automation | Keep existing CDP backends (local/extension/cdp-inspect); document configuration; no core changes. | Tools report section 3: exists as CLI+skill. |
| D15 | New tools generally | Skills/plugins only; never new core tool registrations (tools/AGENTS.md). | Extension-surfaces report section 1. |
| D16 | Git strategy | One feature branch `001-provider-freedom` on the fork; atomic commits per workstream; push at the end. | User wants the fork as the working repo. |
