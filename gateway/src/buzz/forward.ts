/**
 * Builds the Buzz inbound handler that forwards relay messages to the
 * assistant runtime, mirroring the Discord forward path. Replies route back
 * through the gateway's `/deliver/buzz` endpoint, which the relay socket
 * publishes to the community (see index.ts wiring).
 */

import type { Logger } from "pino";

import type { GatewayConfig } from "../config.js";
import type { ConversationTaskQueue } from "../channels/conversation-queue.js";
import type { BuzzInboundEvent } from "../channels/inbound-event.js";
import { handleInbound } from "../handlers/handle-inbound.js";
import { upsertContactChannel } from "../verification/contact-helpers.js";

export function createBuzzInboundEventHandler(options: {
  config: GatewayConfig;
  log: Logger;
  notifyRecordActivity: () => void;
  forwardQueue: ConversationTaskQueue;
}): (event: BuzzInboundEvent) => void {
  const { config, log, notifyRecordActivity, forwardQueue } = options;

  return (event) => {
    notifyRecordActivity();

    const isDm = event.source.chatType === "dm";
    if (event.message.eventKind === "message") {
      void upsertContactChannel({
        sourceChannel: "buzz",
        externalUserId: event.actor.actorExternalId,
        ...(isDm
          ? { externalChatId: event.message.conversationExternalId }
          : {}),
        displayName: event.actor.displayName,
      }).catch(() => {});
    }

    // Replies carry the conversation address (channel UUID or dm key) and the
    // thread root so the deliver route can publish a threaded note.
    const params = new URLSearchParams({
      conversation: event.message.conversationExternalId,
    });
    if (event.source.threadId) {
      params.set("replyTo", event.source.threadId);
    }
    const replyCallbackUrl = `${config.gatewayInternalBaseUrl}/deliver/buzz?${params}`;

    const forward = async () => {
      await handleInbound(config, event, { replyCallbackUrl }).catch((err) => {
        log.error(
          {
            err,
            conversationExternalId: event.message.conversationExternalId,
          },
          "Failed to forward Buzz event to runtime",
        );
      });
    };

    void forwardQueue
      .enqueue(event.message.conversationExternalId, forward)
      .catch((err) => {
        log.error(
          {
            err,
            conversationExternalId: event.message.conversationExternalId,
          },
          "Unhandled error in Buzz forward",
        );
      });
  };
}
