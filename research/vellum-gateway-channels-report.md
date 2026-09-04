# Vellum Gateway Channel System — Architecture Map

Repo: `/Users/francisco/Downloads/VELLUM-BY-HERMES/vellum-fork` (Bun + TypeScript monorepo, v0.11.9)
Scope: `gateway/src/channels/` + per-vendor dirs (`discord/ email/ slack/ telegram/ twilio/ whatsapp/`), `assistant/src/a2a/`, config.

## 1. Architecture in one paragraph

The **gateway** (`gateway/`) is the single public ingress: all webhooks/sockets/APIs arrive here, get signature-verified, normalized, admission-gated, and forwarded to the **assistant daemon** (`assistant/`) over an internal HTTP transport. The daemon runs the agent loop and delivers replies **back through the gateway's callback mechanism** (reply callback URLs) or via its own outbound senders (`assistant/src/messaging/providers/`). Gateway-owned rules: all inbound HTTP routes must live in `gateway/` (see `gateway/AGENTS.md`).

## 2. The channel abstraction & extension points

### 2.1 Canonical channel vocabulary — `packages/service-contracts/src/channels.ts`
- `CHANNEL_IDS` (lines 33–44): `telegram, phone, vellum, whatsapp, slack, email, platform, a2a, discord, plugin`. Single source of truth shared by gateway + daemon.
- `CHANNEL_BOT_PROVIDER` (lines 84–88): maps channel → credential-store provider key (`slack_channel`, `discord_channel`, `telegram`).
- Adding/renaming a channel id happens **exactly here**.

### 2.2 Gateway channel subset — `gateway/src/channels/types.ts`
- `CHANNEL_IDS` (lines 11–21): gateway ingresses `telegram, phone, vellum, whatsapp, slack, email, a2a, discord, plugin` (no `platform`), `satisfies readonly CanonicalChannelId[]` keeps it in sync with the canonical set.
- `INTERFACE_IDS` (lines 32–44) — client-facing interface ids (`macos, ios, cli, web, …`) + legacy alias `vellum → web`.
- `ChannelConnectionHealth` (lines 93–101) — shape long-lived socket channels report health in.

### 2.3 Inbound event model — `gateway/src/channels/inbound-event.ts`
- Discriminated union `GatewayInboundEvent` keyed by `sourceChannel` (lines 174–181): `Telegram | WhatsApp | Slack | Email | A2a | Discord | PluginInboundEvent`.
- Common base carries `message{content, conversationExternalId, externalMessageId, …}`, `actor{actorExternalId, …}`, `source{chatType, conversationType, isDirectMessage, threadId, …}`, `raw` (lines 31–149).
- Each normalizer must produce `(sourceChannel, externalChatId, externalMessageId)` as the dedup triple (lines 38–57).

### 2.4 The shared gate — `gateway/src/handlers/handle-inbound.ts`
- `admitInbound()` (line 117) + `handleInbound()`: admission policy, trust verdict, verification/invite intercepts, forward to runtime. Every channel's inbound goes through this; a channel with its own transport (Discord/Slack sockets) must still call it (doc comment lines 101–116).

### 2.5 Shared plumbing in `gateway/src/channels/`
- `conversation-queue.ts` (35 lines) — per-conversation FIFO serialization for push channels.
- `transport-hints.ts` (88 lines) — per-channel prompt hints/UX briefs (`TELEGRAM_CHANNEL_TRANSPORT_HINTS`, `WHATSAPP_…`, `EMAIL_…` + `EmailReplyContext`).
- `ingress-verification.ts` (419 lines) — **the webhook signature-verification abstraction**: HMAC / `standard-webhooks` / Vellum-signed schemes, declared per route.
- `plugin-ingress.ts` (438 lines) — plugin-declared ingress: reads `channels/ingress.json` from each plugin's workspace dir; `PLUGIN_WEBHOOK_PREFIX = "/webhooks/plugins"` (line 16); route schema (paths, kind http/websocket, signer, handshake) lines 26–100.
- `plugin-inbound.ts` (277 lines) — how a plugin's webhook **reply** becomes a `PluginInboundEvent` (channel `plugin`; ids prefixed with plugin dir name).
- `ingress-inbound.ts` (291 lines) — declarative field mapping for plugin inbound (`identity: opaque|phone|email`, dotted field paths, mappings, defaults).
- `plugin-ingress-approvals.ts` — guardian approval flow; an ingress route is served only after guardian approval (`http/routes/channel-ingress.ts`).

### 2.6 Route registration — `gateway/src/index.ts` (113 KB)
- Webhook routes (lines ~729–768): `/webhooks/telegram` (729), `/webhooks/twilio/voice-verify` (742), `/webhooks/whatsapp` (746), `/webhooks/email` (751), `/webhooks/resend` (755), `/webhooks/mailgun` (759), `PLUGIN_WEBHOOK_PATH_PATTERN` (768), `/webhooks/oauth/callback` (797).
- A2A agent card at `A2A_AGENT_CARD_PATH` (lines 720–722).
- Socket transports started in-process: `startSlackSocket()` (line 2434, Slack Socket Mode), `startDiscordGateway()` (line 2685, Discord gateway socket), both restarted on credential changes (lines 2806/2815/2931).
- Control-plane proxies: twilio (89), slack (115), telegram, plus channel-admission-policy, channel-permission-overrides, channel-readiness (`/v1/channels/readiness` lines 1399–1416), guardian channel create (`/v1/contacts/guardian/channel`, line 784).
- IPC surfaces: `inviteRoutes` (230, 2964), `channelPermissionRoutes` (235), `createChannelSocketHealthRoutes` (239).

## 3. Per-channel summary

### Telegram (`gateway/src/telegram/`) — webhook channel
- Files: `api.ts`, `download.ts`, `normalize.ts`, `send.ts`, `verify.ts`, `webhook-manager.ts`.
- Ingress: `POST /webhooks/telegram` → `http/routes/telegram-webhook.ts`; secret-token verification; webhook auto-registration/reconciliation with the bot API (`webhook-manager.ts`, `reconcileTelegramWebhook` in index.ts:220, re-registered on ingress URL change at index.ts:3045).
- Outbound: gateway `send.ts` (sendMessage/sendDocument), daemon `assistant/src/messaging/providers/telegram-bot/`.
- Credentials: `TELEGRAM_CREDENTIAL_SPEC` (bot token + webhook secret), `.env.example`.
- Config: `telegram.botId/botUsername/apiBaseUrl/…` — `assistant/src/config/schemas/channels.ts` lines 57–113.

### Slack (`gateway/src/slack/`) — Socket Mode channel (no inbound webhook)
- Files: `socket-mode.ts` (Socket Mode client), `envelope.ts`, `classify-event.ts`, `event-text.ts`, `event-ordering.ts`, `message-normalizer.ts`, `message-change-normalizer.ts`, `reaction-normalizer.ts`, `block-actions-normalizer.ts`, `message-schemas.ts` (Zod, cross-checked vs `@slack/types`), `actor.ts`, `attachments.ts`, `download.ts`, `render-text.ts`, `user-directory.ts`, `slack-web.ts`, `source-metadata.ts`, `socket-liveness.ts`, `errors.ts`.
- Wiring: `startSlackSocket()` index.ts:2434; socket health via `channel-socket-health` IPC; control plane proxied (`slack-control-plane-proxy.ts`).
- Outbound: `assistant/src/messaging/providers/slack/`; config `slack.threadMode` etc. (channels.ts lines 156–196).
- Credentials: `SLACK_CHANNEL_CREDENTIAL_SPEC` (bot/app/user tokens).

### Discord (`gateway/src/discord/`) — Gateway-socket channel
- Files: `gateway-socket.ts` (Discord gateway client: heartbeats, close-codes, intents, session-state, backoff), `normalize.ts`, `forward.ts` (`createDiscordInboundEventHandler`), `admit.ts`, `admission-log.ts`, `thread-parents.ts`, `attachments.ts`, `download.ts`, `message-schemas.ts`.
- Wiring: `startDiscordGateway()` index.ts:2685.
- Outbound: `assistant/src/messaging/providers/discord/`; credentials `DISCORD_CHANNEL_CREDENTIAL_SPEC`; config `discord.botUserId/applicationId/inviteUrl` (channels.ts lines 133–154).

### Email (`gateway/src/email/`) — webhook channel (two providers + platform)
- Files: `normalize.ts` (canonical `VellumEmailPayload`; 322 lines), `verify.ts` (Vellum-Signature / `http/vellum-signature.ts`), `inbound-pipeline.ts` (318 lines, shared tail for provider webhooks: dedup, routing, forward, verification/denial reply emails), `attachments.ts`, `register-callback.ts`.
- Ingress routes: `/webhooks/email` (Vellum platform), `/webhooks/resend` (`resend-webhook.ts`), `/webhooks/mailgun` (`mailgun-webhook.ts`), plus `resend-identity.ts` / `mailgun-identity.ts`. Both providers normalize → `VellumEmailPayload` → `runEmailInboundPipeline`.
- Sender auth: SPF/DKIM/DMARC result passed as `senderAuthenticated` (handle-inbound.ts lines 76–85).
- Outbound: replies are sent by the **assistant** via the `assistant email send` CLI (see `EMAIL_CHANNEL_TRANSPORT_UX_BRIEF`, transport-hints.ts lines 39–45; `EmailReplyContext` lines 51–60); user-facing Gmail/Outlook sends in `assistant/src/messaging/providers/{gmail,outlook}/`.
- Body cap: `maxEmailWebhookPayloadBytes` 350 MB (config.ts lines 220–222).

### Twilio → `phone` channel (`gateway/src/twilio/`) — voice + SMS via webhooks
- Files: `validate-webhook.ts` (X-Twilio-Signature), `webhook-sync.ts` (syncs phone-number webhooks), `setup-state.ts`, `verify.ts`, `webhook-sync-trigger.ts`.
- Routes: `twilio-voice-webhook.ts` (TwiML for calls), `twilio-status-webhook.ts`, `twilio-media-websocket.ts` (live audio), `twilio-voice-verify-callback.ts`, `/webhooks/twilio/voice-verify` (index.ts:742); control plane `/v1/integrations/twilio/*` (index.ts:1108–1146).
- Voice verification: `gateway/src/voice/verification.ts` (Twiml, pending phone sessions).
- Credentials: `TWILIO_CREDENTIAL_SPEC` (accountSid etc.); config `twilio.accountSid/phoneNumber/setupStarted` (channels.ts lines 3–18).

### WhatsApp (`gateway/src/whatsapp/`) — **full first-party channel, Meta Cloud API (NOT a Baileys bridge)**
- Files: `api.ts` (467 lines — Meta **Cloud API v20**, `https://graph.facebook.com/v20.0`, line 19; retryable fetch, credential resolution `whatsapp.phone_number_id` / `whatsapp.access_token`), `normalize.ts` (Zod-tolerant webhook payload parsing, required routing fields `id`/`from`), `send.ts`, `download.ts`, `verify.ts` (x-hub-signature).
- Ingress: `POST /webhooks/whatsapp` → `http/routes/whatsapp-webhook.ts` (index.ts:746).
- Config: `whatsapp.phoneNumber/deliverAuthBypass/timeoutMs/…` (channels.ts lines 20–55); credentials `WHATSAPP_CREDENTIAL_SPEC`.
- Outbound: gateway `send.ts` + `assistant/src/messaging/providers/whatsapp/`.
- **Verdict: the WhatsApp channel fully exists and is real** — webhook ingress + API outbound, gated on Meta Business credentials.

## 4. A2A (Agent2Agent, Google A2A v1.0)

### 4.1 Assistant side — `assistant/src/a2a/` (461 lines total) — protocol implementation, no SDK
- `protocol-types.ts` (162 lines): full A2A v1.0 wire types — AgentCard, A2AMessage/Part, Task/TaskState, Artifact, SendMessageRequest, JSON-RPC, TaskStatusUpdateEvent (doc: "Implemented directly from the A2A spec — no SDK dependency").
- `protocol-constants.ts` (21 lines): `A2A_VERSION = "1.0"`, `A2A_CONTENT_TYPE = "application/a2a+json"`, `A2A_VERSION_HEADER`, `AGENT_CARD_PATH`, terminal task states.
- `agent-card.ts` (52 lines): `buildAgentCard()` — **advertises zero `supported_interfaces`** because exchange runs over the authenticated invite flow (doc lines 17–21).
- `task-store.ts` (168 lines): persisted A2A tasks (SQLite, migration `251-a2a-tasks`); used by `deliver.ts` (`completeWithArtifacts`, `getPushUrl`). Note: `createTask()` has **no production callers** — inbound task creation path looks incomplete/stubbed.
- `feature-gate.ts`: A2A gated behind assistant feature flag **`a2a-channel`**.

### 4.2 Assistant integration surface
- `runtime/routes/integrations/a2a.ts` (319 lines): routes `GET/POST/DELETE /v1/integrations/a2a/config`, `POST …/invite`, `…/invite/complete` (sender side), `…/invite/redeem` (receiver side), `…/invite/accept` (self-hosted broker).
- `daemon/handlers/config-a2a.ts` (444 lines): enable/disable + invite lifecycle.
- `persistence/a2a-invite-store.ts` (202 lines) + migrations `315-create-a2a-invites`, `316-drop-contact-channels-invite-id`, `251-a2a-tasks`.
- Outbound **client**: `messaging/providers/a2a/deliver.ts` (162 lines) — completes the task locally, then POSTs the completed task JSON to the requester's **push notification URL** (`pushNotification`, lines 71–116) — i.e. the assistant acts as an A2A *client* toward peers via their callback URLs. `messaging/providers/a2a/transport.ts` (10 lines) registers it as the `ChannelTransport` for `a2a`.
- Inbound trust: `a2a` exempt from admission policy (`EXEMPT_CHANNEL_TYPES` in `gateway/src/db/admission-policy-store.ts:68`; also `assistant/src/runtime/routes/inbound-message-handler.ts:874,1381`).

### 4.3 Gateway side — discovery only, **no A2A client**
- `gateway/src/http/routes/a2a-routes.ts` (126 lines): serves **`GET /.well-known/agent-card.json` only** (registered index.ts:720–722). 404 unless `a2a.enabled` (config-file-cache getBoolean line 98); 503 without `ingress.publicBaseUrl`.
- `a2a` is in the gateway's `CHANNEL_IDS` and `A2aInboundEvent` exists (`channels/inbound-event.ts:155`), but there is **no A2A message/send webhook route** in the gateway — `contacts-control-plane-proxy.ts:260–262` states *"sourceChannel 'a2a' is not a gateway invite channel (A2A invites are daemon-managed)"*.
- **Verdict:** A2A = invite-mediated, daemon-managed; assistant implements protocol + outbound push client; gateway contributes only discovery. An A2A *inbound task* entry point at the gateway and an A2A client in the gateway are **missing**.

## 5. Home Assistant — DOES NOT EXIST
`grep -ri "homeassistant|home_assistant|home-assistant"` across the whole repo: **0 matches**. No integration, no skill, no config.

## 6. "Buzz" — DOES NOT EXIST as anything product-like
10 matches, all unrelated: iOS haptic "buzz" comments (`clients/ios/...VoiceLiveActivityPlugin.swift`, `clients/web/src/utils/haptics.ts`), "buzzwords" in geo-writing skill checklists, `libharfbuzz0b` apt package in `assistant/Dockerfile:75`. Nothing named Buzz.

## 7. Gateway configuration

- **Operational config** — `gateway/src/config.ts` (232 lines): env vars (`GATEWAY_PORT`=7830, `RUNTIME_HTTP_PORT`=7821, `RUNTIME_PROXY_REQUIRE_AUTH`, `GATEWAY_TRUST_PROXY`, `ROUTING_ENTRIES`, `VELAY_BASE_URL`) over workspace `config.json` → `gateway.*` section (lines 115–181). Attachment byte limits per channel (lines 207–217).
- **Channel config** lives **daemon-side** in `assistant/src/config/schemas/channels.ts`: `twilio.*`, `whatsapp.*`, `telegram.*`, `a2a.enabled` (lines 115–122), `discord.*`, `slack.*`. The gateway reads these through **`gateway/src/config-file-cache.ts`** (TTL-cached reader of workspace `config.json`, e.g. `configFile.getBoolean("a2a","enabled")`). There is **no central "enable/disable" switch per channel** except `a2a.enabled` and the feature-flag system; readiness is tracked via `/v1/channels/readiness` (channel-readiness-proxy → daemon).
- **Credentials** — `gateway/src/credential-reader.ts` `ALL_CREDENTIAL_SPECS` (lines 348–355): `TELEGRAM_CREDENTIAL_SPEC, TWILIO_CREDENTIAL_SPEC, WHATSAPP_CREDENTIAL_SPEC, SLACK_CHANNEL_CREDENTIAL_SPEC, DISCORD_CHANNEL_CREDENTIAL_SPEC, VELLUM_CREDENTIAL_SPEC`.
- **Channel display catalog** — `assistant/src/channels/types.ts` `CHANNEL_METADATA` (lines 87–170): slack, telegram, discord, phone, email, whatsapp — feeds `/v1/channels/available`; plugin channels appear as `id = plugin name`, `source = "plugin:<name>"`.

## 8. How to add a new channel

### Option A — first-party built-in channel (e.g. new webhook vendor "X")
Minimal file set, following the WhatsApp/Telegram pattern:
1. `packages/service-contracts/src/channels.ts` — add `"x"` to `CHANNEL_IDS` (+ `CHANNEL_BOT_PROVIDER` entry if it has a bot credential).
2. `gateway/src/channels/types.ts` — add to `CHANNEL_IDS` + `INTERFACE_IDS`.
3. `gateway/src/channels/inbound-event.ts` — add to `InboundChannelId` union, add `XInboundEvent` type, add to `GatewayInboundEvent` union.
4. `gateway/src/x/` — `normalize.ts` (tolerant Zod schema → `XInboundEvent`), `verify.ts` (signature), `send.ts` (outbound if any), `download.ts` (attachments if any).
5. `gateway/src/http/routes/x-webhook.ts` — handler using `readLimitedBody()` + `handleInbound()` + `webhook-pipeline.ts`; register route in `gateway/src/index.ts`.
6. `gateway/src/credential-reader.ts` — add `X_CREDENTIAL_SPEC` to `ALL_CREDENTIAL_SPECS`.
7. `gateway/src/channels/transport-hints.ts` — add channel hints/UX brief.
8. `assistant/src/config/schemas/channels.ts` — add `XConfigSchema` section; wire into daemon config schema.
9. `assistant/src/channels/types.ts` — add `CHANNEL_METADATA` entry.
10. `assistant/src/messaging/providers/x/` — outbound `ChannelTransport` (deliver), registered in `providers/index.ts`.
11. Optional: readiness checks, control-plane proxy route, tests mirroring `ingress-inbound-vendors.test.ts` / `route-schema-guard.test.ts` (the guard cross-checks advertised URLs against the route table).

### Option B — plugin channel (third-party surface, zero core code)
1. Create plugin workspace dir containing `channels/ingress.json` (manifest path constant `PLUGIN_INGRESS_MANIFEST_RELPATH`, plugin-ingress.ts:19) declaring: path, kind (`http`/`websocket`), signer (`plugin`/`vellum`), handshake, verification (HMAC or `standard-webhooks`), and optionally an `inbound` declaration (`IngressInboundSchema`).
2. Route auto-served at `/webhooks/plugins/<plugin>/<path>` (`PLUGIN_WEBHOOK_PATH_PATTERN`, index.ts:768).
3. Guardian approves via `/v1/channel-ingress` (channel-ingress.ts) — approval digest covers the inbound declaration.
4. Plugin reply carries the normalized message; gateway builds `PluginInboundEvent` (channel `plugin`, ids prefixed `plugin-name:…`) and runs the normal gate.

## 9. Exists vs missing

| Item | Status |
|---|---|
| Channel abstraction (ids, events, gate, verification, plugin ingress) | ✅ Complete (`channels/`) |
| Telegram, Slack (Socket Mode), Discord (gateway socket), Email (Vellum/Resend/Mailgun), Twilio/phone (voice+SMS), WhatsApp (Meta Cloud API v20) | ✅ Full channels |
| A2A protocol impl + agent card + task store + invite flow (assistant) | ✅ Present but feature-gated (`a2a-channel`); `createTask()` has no production caller — inbound task intake appears incomplete |
| A2A client in **gateway** | ❌ None — only `/.well-known/agent-card.json` discovery |
| Home Assistant integration | ❌ Zero references repo-wide |
| Anything called "Buzz" | ❌ None (only haptic-buzz comments) |
| WhatsApp Baileys-style self-host bridge | ❌ Not present (official Cloud API only) |
| Central per-channel enable/disable in gateway config | ⚠️ Only `a2a.enabled` + daemon config sections + feature flags |
