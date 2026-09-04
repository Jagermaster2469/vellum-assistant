---
name: video-studio
description: Generate short AI videos from a text prompt (text-to-video). Produces an MP4 saved into the workspace so the user can watch it inline or as an attachment.
compatibility: "Designed for Vellum personal assistants"
metadata:
  emoji: "🎬"
  vellum:
    display-name: "Video Studio"
    category: "content"
    activation-hints:
      - "User asks to generate, create, or make a video from a text description"
      - "User wants a short AI-generated clip, animation, or cinematic shot"
---

Use the `media_generate_video` tool via `skill_execute` to create videos from text prompts.

## How it works

- Generation runs on the configured video-generation service (`services["video-generation"]`).
- Today the only supported provider is `xai` (model `grok-imagine-video`) using the user's own xAI API key. Managed (`vellum`) video generation is not available yet; the tool reports a configuration error if it is selected.
- The tool polls the provider until the video is ready, downloads it into the workspace, and returns the saved path plus the provider URL.

## Parameters

- `prompt` (required): describe the subject, motion, camera work, lighting, and mood. State the aspect ratio in words ("16:9 widescreen banner"); there is no resolution parameter today.
- `style` (optional): a style descriptor appended to the prompt — e.g. "cinematic", "anime", "photorealistic", "stop-motion", "handheld documentary".
- `model` (optional): omit unless the user names a model explicitly. Unknown model IDs fail with an error listing the available models.

## Example calls

```json
{ "tool": "media_generate_video", "input": { "prompt": "A slow crane shot over a neon-lit harbor at dusk, rain on the lens, 16:9 widescreen", "style": "cinematic" } }
```

## Timing

Video generation typically takes 1–3 minutes. The tool polls for up to 10 minutes, but the tool execution timeout (`timeouts.toolExecutionTimeoutSec`) may cut it short. If the tool result reports a timeout ("timed out after Ns"), the request may still complete provider-side; retry once before reporting failure.

## Output handling

The video is saved under `media/generated/` in the workspace and the tool result includes the saved path and the provider URL.

- Present a video to the user by embedding its saved path in your reply: `![short description](vellum://workspace/media/generated/<file>.mp4)`. The app renders it inline where your text refers to it, and chat channels (Slack, Telegram, WhatsApp) deliver it as a native upload.
- The video is also attached to the tool result as a file block (when under 25 MB), so it is never lost even if you do not embed it.

## Error handling

Two kinds of failure. Treat them differently:

1. **Configuration errors** (provider is `vellum`/managed, missing xAI API key): report the error to the user as-is. Do NOT change service configuration (managed vs your-own mode, provider, or model in Settings) unless the user explicitly asks.
2. **Generation failures** (any other error): report the error and stop. Retrying once with the same parameters is allowed if the error suggests a transient failure; do not retry repeatedly.

## Complete when

The tool has returned a video and your reply presents it to the user, preferably as an inline `![description](vellum://workspace/...)` embed of the saved path.
