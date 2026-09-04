/**
 * Buzz (Nostr) inbound normalization.
 *
 * The Buzz relay delivers Nostr EVENT envelopes over WebSocket:
 * `["EVENT", "<subscription-id>", { id, pubkey, created_at, kind, tags, content, sig }]`.
 * The normalizer parses them tolerantly (untrusted external input — see
 * gateway/AGENTS.md), drops kinds the channel does not handle, and maps the
 * handled kinds onto the shared `BuzzInboundEvent` shape:
 *
 * - kind 42 / 1111: Buzz channel message. `conversationExternalId` is the
 *   channel UUID (from the channel-address tag or the event's `#c`/root
 *   context); `chatType: "channel"`.
 * - kind 1 / 4: text note / encrypted-direct-message. DMs key the
 *   conversation on `dm:<hex pubkey of the sender>`; `chatType: "dm"`.
 * - A root `e` tag makes the message a thread reply: `source.threadId`
 *   carries the root note id so replies stay in the thread.
 *
 * The event id is the dedup key; `raw` preserves the envelope verbatim.
 */

import { z } from "zod";

import type {
  BuzzInboundEvent,
  GatewayInboundAttachment,
} from "../channels/inbound-event.js";

// ---------------------------------------------------------------------------
// Tolerant schemas
// ---------------------------------------------------------------------------

const optionalString = () => z.string().optional().catch(undefined);
const optionalNumber = () => z.number().optional().catch(undefined);

/**
 * Handled kinds. Everything else (profile metadata 0, relay list 10002,
 * reactions 7, reposts 6, channel metadata 40/41, …) is dropped quietly:
 * a valid Nostr event of an unhandled kind is normal relay traffic, not a
 * malformed message.
 */
const HANDLED_KINDS = new Set([1, 4, 42, 1111]);

const tagsSchema = z.array(z.array(z.string())).optional().catch(undefined);

const eventSchema = z.object({
  id: z.string().min(1),
  pubkey: z.string().min(1),
  kind: z.number().int().optional().catch(undefined),
  tags: tagsSchema,
  content: optionalString(),
  created_at: optionalNumber(),
});

/**
 * A Nostr relay message. We only act on `EVENT`; `EOSE`, `OK`, `NOTICE`,
 * `AUTH` and friends are protocol plumbing the socket layer consumes.
 */
const relayMessageSchema = z
  .tuple([
    z.literal("EVENT"),
    z.string().optional().catch(undefined),
    eventSchema,
  ])
  .catch((ctx) => {
    // Non-EVENT frames and malformed envelopes collapse here; callers drop.
    throw ctx.error;
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tagValues(tags: string[][] | undefined, name: string): string[] {
  return (tags ?? [])
    .filter((t) => t[0] === name && t[1])
    .map((t) => t[1] as string);
}

/**
 * The channel UUID a kind-42/1111 event belongs to: an explicit `c` (channel
 * address) tag wins, then the first `e` root tag (the channel's creation
 * note in the Buzz protocol), then the sender's pubkey as a last resort so
 * the event still lands in SOME conversation.
 */
function channelAddressFor(event: z.infer<typeof eventSchema>): string {
  const explicit = tagValues(event.tags, "c")[0];
  if (explicit) {
    return explicit;
  }
  const root = tagValues(event.tags, "e")[0];
  return root ?? `channel:${event.pubkey}`;
}

function chatTypeFor(kind: number | undefined): "channel" | "dm" {
  return kind === 1 || kind === 4 ? "dm" : "channel";
}

function threadRootFor(event: z.infer<typeof eventSchema>): string | undefined {
  // The root of a thread is the `e` tag marked "root"; a bare `e` tag on a
  // channel note is the channel itself, not a thread.
  const rootTags = (event.tags ?? []).filter(
    (t) => t[0] === "e" && t[3] === "root",
  );
  return rootTags[0]?.[1];
}

function isMarkedThreadReply(tags: string[][] | undefined): boolean {
  return (tags ?? []).some((t) => t[0] === "e");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface NormalizedBuzzEvent {
  buzzEventId: string;
  event: BuzzInboundEvent;
}

/**
 * Normalize one relay EVENT frame into a `BuzzInboundEvent`, or null when
 * the frame is protocol plumbing or an unhandled kind.
 */
export function normalizeBuzzEvent(
  raw: unknown,
  receivedAt: string,
): NormalizedBuzzEvent | null {
  let msg: z.infer<typeof eventSchema> & { envelope?: unknown };
  try {
    const parsed = relayMessageSchema.parse(raw);
    msg = parsed[2] as z.infer<typeof eventSchema> & { envelope?: unknown };
  } catch {
    // EOSE/OK/NOTICE frames and malformed envelopes: not message events.
    return null;
  }
  const kind = msg.kind ?? 1;
  if (!HANDLED_KINDS.has(kind)) {
    return null;
  }
  if (!msg.id || !msg.pubkey) {
    return null;
  }

  const chatType = chatTypeFor(kind);
  const content = msg.content?.trim() ?? "";
  if (content.length === 0) {
    return null;
  }

  const isThreadReply = isMarkedThreadReply(msg.tags);
  const threadId = isThreadReply
    ? (threadRootFor(msg) ?? tagValues(msg.tags, "e")[0])
    : undefined;
  const conversationExternalId =
    chatType === "dm" ? `dm:${msg.pubkey}` : channelAddressFor(msg);

  const attachments: GatewayInboundAttachment[] = [];
  const urlTags = tagValues(msg.tags, "url");
  for (const url of urlTags) {
    const ext = url.split("?").at(0)?.split(".").at(-1)?.toLowerCase();
    const type =
      ext && ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)
        ? "image"
        : ext && ["mp4", "mov", "webm"].includes(ext)
          ? "video"
          : "document";
    attachments.push({ type, fileId: url, mimeType: "", fileSize: 0 });
  }

  return {
    buzzEventId: msg.id,
    event: {
      version: "v1",
      sourceChannel: "buzz",
      receivedAt,
      message: {
        eventKind: "message",
        content,
        conversationExternalId,
        externalMessageId: msg.id,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      actor: {
        actorExternalId: msg.pubkey,
        displayName: msg.pubkey.slice(0, 12),
      },
      source: {
        updateId: msg.id,
        messageId: msg.id,
        chatType,
        conversationType:
          chatType === "dm" ? ("dm" as const) : ("public" as const),
        ...(chatType === "dm" ? { isDirectMessage: true as const } : {}),
        ...(threadId ? { threadId } : {}),
      },
      raw: raw as Record<string, unknown>,
    },
  };
}
