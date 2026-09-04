# Model Triple — endpoint + model + key per function (002-model-triple)

Every function that requires a model exposes the same triple. Config holds
**endpoint + model**; the **key** lives in the CES vault / env (never in
config, never logged). Unset fields inherit the workspace default; `vellum`
managed never consults a custom endpoint.

## Triple map

| Function | Endpoint (config) | Model (config) | Key (vault + env fallback) |
|---|---|---|---|
| main chat + all LLM call sites (vision, title, memory extraction, subagents, …) | `provider_connections.baseUrl` on the connection row | `provider_connections` models column / `llm.profiles.<name>.model` | connection auth row (`credential/...`), e.g. `credential/openai/api_key`, `credential/deepseek/api_key`, or empty for keyless-local |
| embeddings | `memory.embeddings.apiBase` | `memory.embeddings.openaiModel` (also used for `openai-compatible`) | `openai` (`credential/openai/api_key`, `OPENAI_API_KEY`); empty + localhost apiBase = keyless-local (Ollama/vLLM/LM Studio) |
| image generation | `services["image-generation"].apiBase` | `services["image-generation"].model` | provider key: `openai` / `gemini` (`credential/openai/api_key`, …); `openai-compatible` reuses the `openai` key, keyless-local allowed |
| video generation | `services["video-generation"].apiBase` | `services["video-generation"].model` | `xai` (`credential/xai/api_key`, `XAI_API_KEY`) |
| TTS | `services.tts.providers.<id>.apiBase` (incl. new `openai`) | `services.tts.providers.<id>.model` / `voice` / `voiceId` | `<id>` vault key, e.g. `credential/openai/api_key`; `openai` + apiBase + empty key = keyless-local |
| STT | `services.stt.baseUrl` (all BYOK adapters incl. streaming whisper after 002 fix) | `services.stt.providers.<id>.model` / `services.stt.roles.<role>.model` | `<id>` vault key (`credential/deepgram/api_key`, `credential/openai/api_key`, …) |
| web search | `services["web-search"].apiBase` | `services["web-search"].model` (Perplexity default `sonar`) | provider key (`perplexity`, `brave`, `tavily`, `firecrawl`, `x`, …) |
| web fetch | `services["web-fetch"].apiBase` | n/a (fetch, not LLM) | provider key (`firecrawl`, …) or none for `default` built-in fetch |
| X/Twitter search | fixed `https://api.x.com` (override via web-search apiBase only for self-hosted proxy) | n/a | `x` Bearer token (`credential/x/api_key`, `X_API_KEY`) |
| vision | same triple as the backing LLM profile (System A) | profile model + connection `supportsVision` flag | same as backing profile |

## Key commands (no values ever printed)

```bash
# store a key
assistant credentials set credential/openai/api_key
assistant credentials set credential/xai/api_key
assistant credentials set credential/deepgram/api_key
# verify triples (offline-safe, keys redacted; --probe adds network check)
cd assistant && bun scripts/verify-triples.ts
cd assistant && bun scripts/verify-triples.ts --probe
```

## Probe behavior (`providers/model-triple/probe.ts`)

GET `{endpoint}/models` (reachability + key validity), fallback POST
`{endpoint}/chat/completions` 1 token (model existence). Verdicts cached
10 min. Failures name the endpoint + model; managed fallback never happens
silently.
