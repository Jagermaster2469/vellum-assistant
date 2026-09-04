# Vellum-by-Hermes Constitution

The governing principles for this fork of Vellum Assistant. All changes must comply.

## 1. Open Model Freedom (non-negotiable)

Users must be able to use ANY OpenAI-compatible endpoint or local model (Ollama, LM Studio, etc.) for ANY model role the assistant has — main conversation, vision/image analysis, embeddings/memory, title generation, web search, TTS/STT, image/video generation, subagents. No role may be locked to Vellum Cloud or to a fixed list of frontier providers. Managed Vellum Cloud remains an optional default, never the only path.

## 2. Provider Neutrality

No provider is privileged in code. Provider lists in UI and validation must support free-form OpenAI-compatible endpoints. Defaults may exist; exclusivity may not.

## 3. Extensibility Over Forking

Prefer the existing plugin/skill/MCP/channel-ingress extension surfaces. Modify core only where a surface is genuinely insufficient. Every core change must stay mergeable with upstream (isolated modules, minimal diff footprint).

## 4. Platform Parity

These platforms must be first-class configurable channels with per-channel policy (allowlists, mention requirements): A2A protocol, Buzz, Discord, Email, Home Assistant, Slack, Telegram, WhatsApp. Missing platforms are added following the existing channel abstraction.

## 5. Provider-Configurable Tools

These tool categories must accept user-configured providers/keys: web search & scraping, browser automation, vision/image analysis, image generation, video generation, X/Twitter search, text-to-speech, speech-to-text, Home Assistant, computer use (macOS/Windows/Linux).

## 6. Security Invariants

Credentials never reach the model. Sandbox boundaries respected (workspace vs host). Secrets stored via the existing protected store. Never hardcode keys; never log credentials.

## 7. Verified Quality

`bun install`, `bun run typecheck:fast` (or `bunx tsc --noEmit`), targeted `bun test`, and `bun run lint` must pass before any commit is pushed. No commit without verification.

## 8. Upstream Compatibility

MIT license preserved. New deps must be MIT-compatible. Exact version pinning. Keep the diff upstream-mergeable; document intentional divergences in a dedicated note.
