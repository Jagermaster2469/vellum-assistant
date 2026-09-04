# Quickstart: Validating Provider Freedom

**Date**: 03/09/26

## Prereqs
- bun 1.4.0+ (PATH: ~/.bun/bin)
- Repo at /Users/francisco/Downloads/VELLUM-BY-HERMES/vellum-fork, branch 001-provider-freedom
- `bun install` complete

## Baseline gates (run before/after every workstream)
```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/francisco/Downloads/VELLUM-BY-HERMES/vellum-fork/assistant
bunx tsgo --noEmit                      # fast typecheck
bun test src/__tests__/<target>.test.ts # targeted tests
bun run lint                            # lint
```

## Scenario 1 — Custom endpoint as main model
1. Create connection: POST /v1/inference/provider-connections {"provider":"openai-compatible","base_url":"http://127.0.0.1:11434/v1","models":[{"id":"llama3.1:8b"}]} (or via UI -> AI -> Add provider).
2. Settings -> AI: set workspace default provider to the new connection.
3. Send a message; expect a reply from the local model; expect NO config_issue badge and no repeated probe toasts.

## Scenario 2 — Tool model roles on custom endpoints
1. Set vision call-site (or a vision-capable profile) to the custom connection + model; send an image; confirm analysis via endpoint logs.
2. Set embeddings apiBase to a local server; trigger memory extraction; confirm the local endpoint received embedding calls.
3. Set web-search provider to a BYOK key (e.g. Brave); ask a live question; confirm citations.

## Scenario 3 — Platforms
1. WhatsApp: configure Meta creds via the existing setup skill; DM the number; confirm reply. Configure a group + mention pattern; confirm it only answers when mentioned.
2. Buzz: run a local buzz relay (`buzz-main`, `just relay`); configure relay URL + nsec in gateway config; post in a channel; confirm threaded reply.
3. Home Assistant: `assistant credentials prompt` for the HA token; ask to list entities; ask to toggle a light.
4. A2A: point the a2a-client skill at another agent card (e.g. a local A2A agent); delegate a task; confirm result.

## Scenario 4 — Provider tools
1. X search: set X API key; ask "what's trending on X about <topic>".
2. Video gen: set xAI key; ask for a short video.
3. TTS tool: ask the assistant to speak a text; confirm audio file in workspace.

## Acceptance
All scenarios above pass + `bunx tsgo --noEmit` + `bun run lint` clean + targeted test suites green.
