import { describe, expect, test } from "bun:test";

import {
  clearProbeCacheForTesting,
  getCachedProbe,
  probeTriple,
} from "./probe.js";
import {
  describeTriple,
  isKeylessLocal,
  normalizeEndpoint,
  normalizeModel,
  resolveTriple,
} from "./triple.js";

describe("model-triple normalize", () => {
  test("endpoint trims + strips trailing slashes, blank → undefined", () => {
    expect(normalizeEndpoint("  https://api.deepseek.com///  ")).toBe(
      "https://api.deepseek.com",
    );
    expect(normalizeEndpoint("   ")).toBeUndefined();
    expect(normalizeEndpoint(undefined)).toBeUndefined();
  });
  test("model trims, blank → undefined", () => {
    expect(normalizeModel(" deepseek-chat ")).toBe("deepseek-chat");
    expect(normalizeModel("  ")).toBeUndefined();
  });
  test("keyless-local detects loopback without key", () => {
    expect(isKeylessLocal("http://127.0.0.1:11434/v1", undefined)).toBe(true);
    expect(isKeylessLocal("http://localhost:1234/v1", "")).toBe(true);
    expect(isKeylessLocal("http://127.0.0.1:11434/v1", "sk-x")).toBe(false);
    expect(isKeylessLocal("https://api.deepseek.com", undefined)).toBe(false);
  });
});

describe("model-triple resolve (service > workspace default)", () => {
  test("service triple wins", () => {
    const r = resolveTriple(
      {
        endpoint: "http://127.0.0.1:11434/v1",
        model: "qwen3",
        credential: "ollama",
      },
      {
        endpoint: "https://api.deepseek.com",
        model: "deepseek-chat",
        credential: "deepseek",
      },
    );
    expect(r).toEqual({
      endpoint: "http://127.0.0.1:11434/v1",
      model: "qwen3",
      credential: "ollama",
    });
  });
  test("unset service fields inherit workspace default", () => {
    const r = resolveTriple(
      {},
      { endpoint: "https://api.deepseek.com", model: "deepseek-chat" },
    );
    expect(r.endpoint).toBe("https://api.deepseek.com");
    expect(r.model).toBe("deepseek-chat");
  });
  test("001-era apiBase/baseUrl count as endpoint (back-compat)", () => {
    expect(resolveTriple({ apiBase: "https://proxy.local/v1" }).endpoint).toBe(
      "https://proxy.local/v1",
    );
    expect(resolveTriple({ baseUrl: "https://stt.local" }).endpoint).toBe(
      "https://stt.local",
    );
  });
  test("describeTriple never includes key values", () => {
    const s = describeTriple({
      endpoint: "https://x",
      model: "m",
      credential: "openai",
    });
    expect(s).toContain("https://x");
    expect(s).not.toContain("sk-");
  });
});

describe("model-triple probe", () => {
  test("no endpoint → actionable error, no fetch", async () => {
    clearProbeCacheForTesting();
    const r = await probeTriple({ endpoint: "   " });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/No endpoint/i);
  });
  test("unreachable endpoint names the endpoint", async () => {
    clearProbeCacheForTesting();
    const r = await probeTriple({
      endpoint: "http://127.0.0.1:9/v1",
      timeoutMs: 1500,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("http://127.0.0.1:9/v1");
  });
  test("verdict cache round-trips", async () => {
    clearProbeCacheForTesting();
    expect(getCachedProbe("https://example.invalid", "m")).toBeUndefined();
  });
});
