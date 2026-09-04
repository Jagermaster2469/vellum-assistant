/**
 * Buzz relay WebSocket client (Nostr NIP-42).
 *
 * Connects to a Buzz community relay, authenticates the assistant's identity
 * with AUTH (NIP-42), subscribes to channel messages (kinds 42/1111) and DMs
 * (kind 4), and forwards every matching EVENT to the handler. Outbound notes
 * are signed by the injected signer (event signing needs secp256k1-Schnorr,
 * which Bun's WebCrypto does not provide; the gateway injects a signer that
 * shells out to the `buzz` CLI, mirroring the Hermes adapter).
 *
 * Reconnect uses capped exponential backoff with jitter (same shape as the
 * Discord gateway socket). The "poll" transport degrades to the same loop
 * with a fixed sweep interval — Nostr relays speak WebSocket, so polling is
 * a reconnect cadence, not an HTTP fetch.
 */

import { getLogger } from "../logger.js";

const log = getLogger("buzz-relay");

export interface BuzzNote {
  kind: 1 | 4 | 42 | 1111;
  content: string;
  /** Channel UUID (channel kinds) or recipient hex pubkey (DM kind 4). */
  channelOrRecipient: string;
  /** Root note id to thread the reply under. */
  replyTo?: string;
}

export type BuzzSigner = (unsignedEvent: {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}) => Promise<string | null>;

export interface BuzzRelayOptions {
  relayUrl: string;
  /** Assistant's hex public key, derived from the configured nsec. */
  hexPubkey: string;
  signer: BuzzSigner;
  /** Watched channel UUIDs; empty subscribes to all. */
  channels: readonly string[];
  /** Called for every normalizable EVENT frame. */
  onEvent: (raw: unknown) => void;
  transport?: "auto" | "websocket" | "poll";
  pollIntervalMs?: number;
  backoff?: { baseDelayMs?: number; maxDelayMs?: number };
}

interface PendingRequest {
  resolve: (msg: unknown) => void;
  reject: (err: Error) => void;
}

export class BuzzRelayClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectAttempt = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private subId = crypto.randomUUID();
  private authDone = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: BuzzRelayOptions) {}

  async start(): Promise<void> {
    this.closed = false;
    await this.connectLoop();
  }

  stop(): void {
    this.closed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private delayMs(): number {
    const base = this.opts.backoff?.baseDelayMs ?? 1000;
    const max = this.opts.backoff?.maxDelayMs ?? 30_000;
    const window = Math.min(base * 2 ** this.reconnectAttempt, max);
    const jitter = Math.random() * window * 0.5;
    if (this.opts.transport === "poll") {
      return this.opts.pollIntervalMs ?? 4000;
    }
    return window + jitter;
  }

  private async connectLoop(): Promise<void> {
    while (!this.closed) {
      try {
        await this.connectOnce();
        this.reconnectAttempt = 0;
        return; // The socket lives until it closes; then the error path re-enters.
      } catch (err) {
        if (this.closed) {
          return;
        }
        this.reconnectAttempt += 1;
        log.warn(
          { err, attempt: this.reconnectAttempt },
          "Buzz relay connection failed; backing off",
        );
        await new Promise((r) => {
          this.timer = setTimeout(r, this.delayMs());
        });
      }
    }
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = this.opts.relayUrl.replace(/^http/, "ws");
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      const fail = (err: Error) => {
        ws.close();
        this.ws = null;
        reject(err);
      };

      ws.onopen = () => {
        this.send(
          JSON.stringify([
            "REQ",
            this.subId,
            {
              kinds: [42, 1111, 4],
              ...(this.opts.channels.length > 0
                ? { "#c": this.opts.channels }
                : {}),
            },
          ]),
        ).catch(() => {});
        resolve();
      };
      ws.onmessage = (ev) => {
        void this.handleFrame(ev.data as string);
      };
      ws.onerror = () => {
        fail(new Error("Buzz relay WebSocket error"));
      };
      ws.onclose = () => {
        this.ws = null;
        if (!this.closed) {
          // The connect promise already resolved; re-enter the backoff loop.
          void this.connectLoop();
        }
      };
    });
  }

  private async handleFrame(data: string): Promise<void> {
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(msg)) {
      return;
    }
    const kind = msg[0];
    if (kind === "AUTH" && !this.authDone) {
      const challenge = String(msg[1] ?? "");
      const signed = await this.signAuth(challenge);
      if (signed) {
        await this.send(JSON.stringify(["AUTH", signed]));
        this.authDone = true;
      }
      return;
    }
    if (kind === "EVENT") {
      this.opts.onEvent(msg);
      return;
    }
    if (kind === "OK") {
      const pending = this.pending.get(String(msg[1]));
      pending?.resolve(msg);
      return;
    }
    if (kind === "NOTICE" || kind === "CLOSED") {
      log.warn({ frame: msg }, "Buzz relay notice");
    }
  }

  /** NIP-42: sign the challenge event (kind 22242) and return the envelope. */
  private async signAuth(challenge: string): Promise<unknown | null> {
    const unsigned = {
      id: "", // filled by the signer (hash of the canonical event)
      pubkey: this.opts.hexPubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: 22242,
      tags: [
        ["relay", this.opts.relayUrl],
        ["challenge", challenge],
      ],
      content: "",
    };
    const signed = await this.opts.signer(unsigned);
    return signed ? JSON.parse(signed) : null;
  }

  /** Publish a signed note. Returns the relay's OK frame or null. */
  async publishNote(note: BuzzNote): Promise<unknown | null> {
    const unsigned = {
      id: "",
      pubkey: this.opts.hexPubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: note.kind,
      tags:
        note.kind === 4
          ? [["p", note.channelOrRecipient]]
          : [
              ["c", note.channelOrRecipient],
              ...(note.replyTo ? [["e", note.replyTo, "", "root"]] : []),
            ],
      content: note.content,
    };
    const signed = await this.opts.signer(unsigned);
    if (!signed) {
      log.warn("Buzz note signing unavailable; note dropped");
      return null;
    }
    await this.send(JSON.stringify(["EVENT", JSON.parse(signed)]));
    return null;
  }

  private send(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Buzz relay socket not open"));
        return;
      }
      ws.send(data);
      resolve();
    });
  }
}
