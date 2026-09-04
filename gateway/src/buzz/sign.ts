/**
 * Event signing for the Buzz channel.
 *
 * Nostr events are signed with secp256k1-Schnorr, which Bun's WebCrypto does
 * not provide, and this repo takes no new dependencies. Mirroring the Hermes
 * Buzz adapter, signing shells out to the `buzz` CLI binary when available:
 * `buzz sign --nsec <hex> <json-event>` returns the signed event JSON. When
 * no CLI is present the signer returns null and outbound notes are dropped
 * with a warning (inbound stays fully functional).
 */

import { spawnSync } from "node:child_process";

import { getLogger } from "../logger.js";

const log = getLogger("buzz-sign");

export interface BuzzSignOptions {
  nsecHex?: string;
  cliPath?: string;
}

function findBuzzCli(cliPath?: string): string | null {
  const candidates = [
    cliPath,
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

export function createBuzzSigner(options: BuzzSignOptions) {
  const cli = findBuzzCli(options.cliPath);
  if (!cli) {
    log.warn(
      "buzz CLI not found — Buzz outbound signing disabled (inbound unaffected)",
    );
  }
  return async (unsignedEvent: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
  }): Promise<string | null> => {
    if (!cli || !options.nsecHex) {
      return null;
    }
    try {
      const result = spawnSync(
        cli,
        ["sign", "--nsec", options.nsecHex, JSON.stringify(unsignedEvent)],
        { timeout: 10_000, encoding: "utf-8" },
      );
      if (result.status !== 0) {
        log.warn(
          { stderr: result.stderr?.slice(0, 200) },
          "buzz CLI signing failed",
        );
        return null;
      }
      return result.stdout.trim();
    } catch (err) {
      log.warn({ err }, "buzz CLI signing threw");
      return null;
    }
  };
}

/**
 * Derive the assistant's hex public key from its nsec via the buzz CLI
 * (`buzz pubkey --nsec <hex>`). Returns null when the CLI is unavailable or
 * the key is not configured — the channel then stays offline (inbound
 * identity filtering cannot run without the key).
 */
export function deriveBuzzHexPubkey(
  nsecHex: string,
  cliPath?: string,
): string | null {
  const cli = findBuzzCli(cliPath);
  if (!cli) {
    return null;
  }
  try {
    const result = spawnSync(cli, ["pubkey", "--nsec", nsecHex], {
      timeout: 10_000,
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      return null;
    }
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}
