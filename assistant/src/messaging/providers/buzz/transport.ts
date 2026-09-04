/**
 * Buzz direct-delivery transport: the daemon publishes the assistant's reply
 * to the community relay itself (one-shot WebSocket), bypassing the gateway.
 *
 * Event signing uses secp256k1-Schnorr, which Bun's WebCrypto does not
 * provide, so signing shells out to the `buzz` CLI (`buzz sign --nsec <hex>
 * <json>`), mirroring the Hermes Buzz adapter. Without the CLI (or without a
 * configured nsec) delivery fails with a descriptive error.
 */

import { spawnSync } from "node:child_process";

import { ChannelDeliveryError } from "@vellumai/gateway-client/http-delivery";

import { getConfig } from "../../../config/loader.js";
import { credentialKey } from "../../../security/credential-key.js";
import { getSecureKeyAsync } from "../../../security/secure-keys.js";
import { getLogger } from "../../../util/logger.js";
import type {
  CallbackContext,
  ChannelTransport,
} from "../channel-transport.js";

const log = getLogger("buzz-transport");

function findBuzzCli(): string | null {
  const candidates = [
    process.env.BUZZ_CLI_PATH,
    "buzz",
    `${process.env.HOME ?? ""}/bin/buzz`,
  ].filter((c): c is string => typeof c === "string" && c.length > 0);
  for (const candidate of candidates) {
    try {
      const probe = spawnSync(candidate, ["--version"], {
        timeout: 3000,
        stdio: "ignore",
      });
      if (probe.status === 0 || probe.error == null) {
        return candidate;
      }
    } catch {
      // keep looking
    }
  }
  return null;
}

function signNote(
  cli: string,
  nsecHex: string,
  note: {
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  },
): string | null {
  const result = spawnSync(
    cli,
    ["sign", "--nsec", nsecHex, JSON.stringify({ ...note, id: "" })],
    { timeout: 10_000, encoding: "utf-8" },
  );
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

async function publishToRelay(
  relayUrl: string,
  signedEvent: string,
): Promise<void> {
  const wsUrl = relayUrl.replace(/^http/, "ws");
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Buzz relay publish timed out"));
    }, 10_000);
    ws.onopen = () => {
      ws.send(JSON.stringify(["EVENT", JSON.parse(signedEvent)]));
      setTimeout(() => {
        clearTimeout(timer);
        ws.close();
        resolve();
      }, 500);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Buzz relay connection failed"));
    };
  });
}

export const buzzTransport: ChannelTransport = {
  channel: "buzz",

  async deliver(ctx: CallbackContext, payload) {
    const { text, approval } = payload;
    const content = text || approval?.plainTextFallback || "";
    if (!content) {
      return { ok: true };
    }

    const buzzConfig = getConfig().buzz;
    const relayUrl = buzzConfig?.relayUrl?.trim();
    if (!relayUrl) {
      throw new ChannelDeliveryError(
        502,
        "Buzz channel is not configured (buzz.relayUrl is empty)",
      );
    }
    const nsecHex = await getSecureKeyAsync(credentialKey("buzz", "nsec"));
    if (!nsecHex) {
      throw new ChannelDeliveryError(
        502,
        "Buzz nsec credential is not configured",
      );
    }
    const cli = findBuzzCli();
    if (!cli) {
      throw new ChannelDeliveryError(
        502,
        "buzz CLI not found — Buzz outbound delivery requires the buzz CLI for event signing",
      );
    }

    // The pubkey is derived from the nsec by the same CLI; a one-shot call
    // keeps the transport stateless across deliveries.
    const pubkeyResult = spawnSync(cli, ["pubkey", "--nsec", nsecHex], {
      timeout: 10_000,
      encoding: "utf-8",
    });
    const pubkey = pubkeyResult.stdout?.trim();
    if (!pubkey) {
      throw new ChannelDeliveryError(502, "Failed to derive Buzz identity");
    }

    // The conversation coordinate: channel UUID for channel replies,
    // `dm:<pubkey>` for DMs (the gateway normalizer's convention).
    const conversation =
      ctx.params.conversation?.trim() || payload.chatId?.trim() || "";
    if (!conversation) {
      throw new ChannelDeliveryError(502, "Buzz reply has no conversation");
    }
    const isDm = conversation.startsWith("dm:");
    const recipient = isDm ? conversation.slice(3) : conversation;
    const replyTo = ctx.params.replyTo?.trim();

    const signed = signNote(cli, nsecHex, {
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: isDm ? 4 : 42,
      tags: isDm
        ? [["p", recipient]]
        : [["c", recipient], ...(replyTo ? [["e", replyTo, "", "root"]] : [])],
      content,
    });
    if (!signed) {
      throw new ChannelDeliveryError(502, "Buzz CLI failed to sign the note");
    }

    await publishToRelay(relayUrl, signed);
    log.info(
      { relayUrl, isDm },
      "Buzz reply delivered (direct, one-shot socket)",
    );
    return { ok: true };
  },
};
