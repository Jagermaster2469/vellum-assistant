# Feature Specification: Provider Freedom

**Feature Branch**: `001-provider-freedom`
**Created**: 03/09/26
**Status**: Draft
**Input**: User description: "Modify Vellum Assistant so users are not locked to frontier-lab subscriptions: (1) custom OpenAI-compatible endpoints for the main model AND for every tool model (vision, web search, etc.) that currently only accept Vellum's own or hand-picked providers; (2) platform support matching Hermes config: A2A, Buzz, Discord, Email, Home Assistant, Slack, Telegram, WhatsApp; (3) provider-configurable tools: web search & scraping, browser automation, vision/image analysis, image generation, video generation, X/Twitter search, TTS, STT, Home Assistant, computer use (macOS/Windows/Linux)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Main model on any OpenAI-compatible endpoint (Priority: P1)

As an assistant owner, I can configure my main conversation model to run on any OpenAI-compatible endpoint I choose (a paid gateway, a local LM Studio/vLLM instance, a proxy), by supplying a base URL, an API key (or none for local), and a model id — and it works without provider-list rejections or confusing errors.

**Why this priority**: This is the user's primary pain today; the existing custom-endpoint option is "not really an option" and errors out. It is also the foundation the other stories build on.

**Independent Test**: Create a custom connection with base URL + model, select it as the workspace default profile, send a message, receive a correct reply.

**Acceptance Scenarios**:

1. **Given** the user creates a custom OpenAI-compatible connection (base URL, key, model list), **When** they select it as the default model, **Then** conversations run on that endpoint with no error and replies stream normally.
2. **Given** a custom connection whose endpoint is unreachable, **When** a message is sent, **Then** the assistant reports a clear, actionable error naming the endpoint (never a silent fallback to a paid managed route).
3. **Given** a custom connection to a local endpoint (no API key), **When** a message is sent, **Then** the request reaches the local model with no key prompt.
4. **Given** a custom connection with multiple declared models, **When** the user switches between them, **Then** each model dispatches to the same endpoint without re-entering the base URL.
5. **Given** a saved custom connection, **When** the daemon restarts, **Then** the connection and profile selections survive and still dispatch correctly (no reset to managed defaults, no error).

### User Story 2 - Custom endpoints for every tool model role (Priority: P1)

As an assistant owner, I can point every auxiliary model role the assistant uses — vision/image analysis, memory/embeddings, title generation, web search summarization, subagents, image generation, video generation, TTS, STT — at a provider and endpoint I choose (custom OpenAI-compatible, local, or a named BYOK provider), with per-role configuration.

**Why this priority**: These are exactly the roles the user reports are locked ("they do not offer custom endpoints... it's either theirs or one of their choice"). Fixing them is the core of the request.

**Independent Test**: Configure a custom endpoint for vision; send an image; the image is analyzed by the configured endpoint (verified by endpoint logs/response).

**Acceptance Scenarios**:

1. **Given** a vision-capable model on a custom endpoint, **When** the user sends an image, **Then** analysis runs on the configured endpoint.
2. **Given** per-role configuration exists, **When** the user sets role-specific provider/model/base URL for vision, embeddings, title generation, web search model, image generation, video generation, TTS and STT, **Then** each role dispatches to its configured provider (inheriting the workspace default when a role is left unset).
3. **Given** a role points at a provider without the needed capability (e.g. no vision support), **When** that role is invoked, **Then** the assistant explains the gap instead of hanging or charging an unrelated managed service.
4. **Given** local embedding models (e.g. Ollama), **When** memory extraction runs, **Then** embeddings use the local model (already-defaulted local ONNX path remains available).

### User Story 3 - Platform parity: WhatsApp, Telegram, Discord, Slack, Email, A2A, Buzz, Home Assistant (Priority: P1)

As an assistant owner, I can reach and be reached on WhatsApp, Telegram, Discord, Slack, Email, A2A, Buzz, and Home Assistant, with per-platform configuration for who may talk to the assistant (allowlists, mention gating) and where notifications go.

**Why this priority**: The user's second explicit requirement; WhatsApp is called out as most important, with Hermes's config as the behavioral reference.

**Independent Test**: Connect a WhatsApp number (Meta Cloud API) and a Buzz relay, exchange messages on both, control a Home Assistant entity via chat.

**Acceptance Scenarios**:

1. **Given** Meta WhatsApp credentials, **When** the user messages the assistant number, **Then** the assistant replies in the same chat (groups and DMs both work; media attachments flow).
2. **Given** a WhatsApp group, **When** the assistant is configured with a mention pattern, **Then** it only responds when mentioned (matching the Hermes @hermes_responde behavior), and never speaks unprompted in groups.
3. **Given** a Buzz community relay URL and a Nostr identity, **When** messages arrive in a Buzz channel or DM, **Then** the assistant replies in the right thread/channel.
4. **Given** Home Assistant URL and long-lived token, **When** the user asks the assistant to toggle a light, **Then** the assistant calls the HA API and the light toggles; and when an HA automation posts a message, the assistant can read it.
5. **Given** another A2A-capable agent's agent card, **When** the user asks the assistant to delegate a task to that agent, **Then** the assistant sends the A2A request, tracks the task, and reports the result (the assistant must also keep serving its own agent card).
6. **Given** per-platform allowlists, **When** an unapproved identity messages the assistant, **Then** the message is ignored (no tool runs, no memory writes) and optionally the guardian is notified.

### User Story 4 - Provider-configurable tools (Priority: P1)

As an assistant owner, I can configure the provider for each capability tool: web search & scraping, browser automation, vision/image analysis, image generation, video generation, X/Twitter search, text-to-speech, speech-to-text, Home Assistant, and computer use (macOS/Windows/Linux) — choosing managed, BYOK, custom-endpoint, or local options per tool.

**Why this priority**: The user's third explicit requirement, mirroring Hermes's toolsets.

**Independent Test**: Set a custom search provider; ask a question requiring live data; answer cites results from that provider.

**Acceptance Scenarios**:

1. **Given** search API keys (or a self-hosted search endpoint), **When** the assistant needs live information, **Then** it searches through the configured provider and cites sources; fallback chains continue to work when a provider fails.
2. **Given** a custom image-generation provider (e.g. self-hosted or BYOK), **When** the user asks for an image, **Then** the image comes from that provider.
3. **Given** X API credentials, **When** the user asks what's happening on X, **Then** the assistant searches posts via the configured X provider.
4. **Given** video generation provider choice, **When** the user asks for a video, **Then** generation runs on the selected provider and the result is delivered.
5. **Given** TTS/STT provider choice (edge/local/cloud BYOK), **When** the assistant speaks or transcribes, **Then** the selected provider is used.
6. **Given** browser automation configuration, **When** the assistant browses, **Then** it uses the configured browser backend (local CDP or cloud) under the existing sandbox/permission model.
7. **Given** computer use on the desktop app, **When** the assistant needs to operate the host machine, **Then** it works on the user's OS (macOS today; Windows/Linux where the client exists), still gated by approvals.

## Requirements *(mandatory)*

### Functional Requirements

**Model freedom (A)**

- **FR-A1**: The system MUST accept a custom OpenAI-compatible connection (base URL, optional API key, declared model list) as a first-class configuration through the settings UI, with no restriction to a fixed provider list.
- **FR-A2**: The system MUST allow a custom connection to be selected as the workspace default provider, with the standard profiles (Balanced/Quality/Budget/Fast) materializing on its declared models.
- **FR-A3**: The system MUST allow per-role (per-call-site) provider/model/endpoint selection for at least: main agent, vision/image analysis, embeddings/memory, title generation, web search model, image generation, video generation, TTS, STT, and subagents. Unset roles inherit the workspace default.
- **FR-A4**: The system MUST never silently route a custom-endpoint request to a paid managed route on failure; failures surface with actionable errors.
- **FR-A5**: The system MUST support keyless local endpoints (Ollama, LM Studio, vLLM) for any role.
- **FR-A6**: Custom connection configuration MUST survive daemon restarts and upgrades without being reset or rewritten.

**Platforms (B)**

- **FR-B1**: WhatsApp MUST work end-to-end (Cloud API): DMs, groups, media, replies; with per-chat allowlists and mention-pattern gating for groups.
- **FR-B2**: Buzz MUST be available as a channel: connect to a Buzz/Nostr community relay with an nsec identity, watch channels, handle DMs, reply in threads, with allowlist controls.
- **FR-B3**: Home Assistant MUST be available: assistant controls entities (lights, scenes, switches) via HA REST/WebSocket using a long-lived token, and can receive messages posted to it.
- **FR-B4**: A2A MUST work both directions: the assistant serves its agent card (existing), AND can act as an A2A client — sending tasks to other agents' cards and tracking results.
- **FR-B5**: Telegram, Slack, Discord, and Email MUST continue to work with their existing credentials, now with per-channel allowlist/mention policy where supported.
- **FR-B6**: Every platform MUST have per-channel policy controls (allowed identities/chats, mention requirement, notification routing) at least at the level Hermes's config provides.

**Provider tools (C)**

- **FR-C1**: Web search & scraping MUST be provider-configurable: the existing BYOK chain (Perplexity, Brave, Tavily, Firecrawl) plus at least one self-hosted/custom search option (e.g. SearXNG or a custom OpenAI-compatible search endpoint), with fallback chains and clear billing provenance.
- **FR-C2**: Browser automation MUST be backend-configurable (local browser/CDP or cloud), preserving the existing permission model.
- **FR-C3**: Vision/image analysis MUST dispatch to the configured vision role model (see FR-A3), including custom endpoints.
- **FR-C4**: Image generation MUST support provider choice (managed, BYOK, custom endpoint, or local).
- **FR-C5**: Video generation MUST exist as a configurable capability (provider choice incl. BYOK).
- **FR-C6**: X/Twitter search MUST exist as a tool configured with the user's X API credentials.
- **FR-C7**: TTS and STT MUST accept provider choice (local whisper/edge/cloud BYOK) per provider.
- **FR-C8**: Computer use MUST remain available on macOS (existing) and work on Windows/Linux clients where the desktop app exists, still gated by the approval system.
- **FR-C9**: New capabilities MUST ship through the sanctioned extension surfaces (skills/plugins) unless a core change is strictly required; core changes must stay upstream-mergeable.

### Key Entities

- **Provider Connection**: named row storing provider kind, auth type (api_key / none / platform), base URL (custom-endpoint kinds), declared models, and label. Lives in the credential/connection store, referenced by profiles.
- **Inference Profile**: named configuration (provider, model, token budget, effort, thinking) selectable per conversation or per call-site; defaults are code-owned; user profiles overlay.
- **Model Role (call site)**: a named LLM consumer (mainAgent, vision, embeddings, title, web search model, TTS, STT, …) resolved against a profile with role-level overrides.
- **Tool Provider Config**: per-capability provider selection (search, image gen, video gen, X search, TTS, STT, HA, browser) with credentials stored in the protected vault.
- **Channel Policy**: per-platform admission controls (allowed identities, allowed chats, mention patterns, group policy, notification routing).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-1**: A user can configure a custom OpenAI-compatible endpoint for the main model and complete a conversation on it in under 5 minutes, with zero provider-list errors.
- **SC-2**: 100% of the model roles listed in FR-A3 expose provider/model/endpoint configuration; any role without an explicit choice correctly inherits the workspace default.
- **SC-3**: All eight platforms (WhatsApp, Telegram, Discord, Slack, Email, A2A, Buzz, Home Assistant) are reachable; each passes a documented end-to-end exchange test.
- **SC-4**: Every tool category in FR-C1–C8 has at least one working provider configuration that does not require a Vellum-managed subscription (BYOK or self-hosted).
- **SC-5**: No regression in the existing managed experience: default (Vellum Cloud) flows keep working, and the full repo test suite passes.
- **SC-6**: The complete change set compiles (typecheck), lints, and passes targeted tests before being committed to the fork.

## Assumptions

- WhatsApp uses the official Meta Cloud API (already implemented in the fork); "embedded fix" = ensuring parity of behavior with Hermes's WhatsApp config (mention gating, group policy, allowlists, notification routing), not building a Baileys-style bridge. [DECIDED: user did not respond to clarify; recommended option taken]
- "Buzz" means the Buzz platform (Block's Nostr-based human+agent workspace, buzz-main in Downloads); the Hermes Buzz adapter (relay URL + nsec, channels/DMs, threads, allowlists) is the behavioral reference. Implemented as a first-party gateway channel (compiled into the gateway like Discord/Slack), not a namespaced plugin channel. [DECIDED: recommended option taken]
- A2A means Google's Agent2Agent protocol v1.0 (already partially implemented server-side in the fork).
- Computer use on Windows/Linux applies to the existing desktop clients where present; macOS remains the reference implementation.
- Managed Vellum Cloud routes remain supported; this feature adds freedom, it does not remove the managed option.
