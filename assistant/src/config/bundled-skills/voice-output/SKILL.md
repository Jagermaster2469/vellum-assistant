---
name: voice-output
description: Convert text to speech audio using the configured TTS provider. Saves an audio file into the workspace so the user can listen to the result.
compatibility: "Designed for Vellum personal assistants"
metadata:
  emoji: "🔊"
  vellum:
    display-name: "Voice Output"
    category: "voice"
    activation-hints:
      - "User asks you to speak, say, or read text aloud"
      - "User wants an audio file (mp3, wav) generated from text"
      - "User asks for a voice note or spoken summary"
---

Use the `speak_text` tool via `skill_execute` to turn text into speech audio.

## How it works

- Synthesis runs on the configured TTS service (`services.tts`) — the same provider used by voice mode and phone calls (ElevenLabs, Fish Audio, Deepgram, xAI, or managed Vellum).
- The executor saves the audio into the workspace under `media/generated/` and returns the saved path plus an inline audio content block.

## Parameters

- `text` (required): the text to speak. Markdown, URLs, and emoji are sanitized away before synthesis.
- `voice_id` (optional): a provider-specific voice identifier (e.g. an ElevenLabs voice ID). Omit to use the configured default voice.

## Example call

```json
{ "tool": "speak_text", "input": { "text": "Your meeting starts in ten minutes in the main conference room." } }
```

## Output handling

- The audio file is saved under `media/generated/` (extension follows the provider format: mp3, wav, ...) and returned as an inline content block, so it is delivered to the user automatically.
- You can also reference the saved file in your reply: `[listen](vellum://workspace/media/generated/<file>.mp3)`.

## Error handling

- If no TTS provider is configured, the tool returns setup instructions; report them to the user as-is. Do NOT change the TTS service configuration unless the user explicitly asks.
- Synthesis failures (provider errors, text empty after sanitization) are reported as-is; retry once before giving up.

## Complete when

The tool has produced an audio file and your reply presents it to the user (inline embed or mention of the saved path).
