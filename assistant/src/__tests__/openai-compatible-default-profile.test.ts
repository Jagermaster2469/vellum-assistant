/**
 * Tests for openai-compatible default-provider materialization (T007):
 * default profiles resolve their model from the connection's declared models
 * rather than the static catalog.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";

import type { DefaultProviderConfig } from "../config/schemas/llm.js";

const DP: DefaultProviderConfig = {
  provider: "openai-compatible" as never,
  connectionName: "custom-1",
};

function mockConnectionRow(row: unknown): void {
  mock.module("../persistence/db-connection.js", () => ({
    getDb: () => ({}),
  }));
  mock.module("../providers/inference/connections.js", () => ({
    getConnection: () => row,
  }));
}

afterEach(() => {
  mock.restore();
});

describe("openai-compatible default provider materialization", () => {
  test("balanced materializes from the connection's first declared model", async () => {
    mockConnectionRow({
      name: "custom-1",
      provider: "openai-compatible",
      auth: { type: "api_key" },
      label: "Custom",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: [{ id: "llama3.1:8b" }],
      createdAt: 0,
      updatedAt: 0,
    });
    const { resolveDefaultProfileForProvider } =
      await import("../config/default-profile-catalog.js");
    const entry = resolveDefaultProfileForProvider(undefined, "balanced", DP);
    expect(entry).not.toBeUndefined();
    expect(entry?.provider).toBe("openai-compatible");
    expect(entry?.model).toBe("llama3.1:8b");
    expect(entry?.provider_connection).toBe("custom-1");
    expect(entry?.source).toBe("managed");
  });

  test("all four default keys materialize on the connection", async () => {
    mockConnectionRow({
      name: "custom-1",
      provider: "openai-compatible",
      auth: { type: "api_key" },
      label: "Custom",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: [{ id: "llama3.1:8b" }],
      createdAt: 0,
      updatedAt: 0,
    });
    const { resolveDefaultProfileForProvider } =
      await import("../config/default-profile-catalog.js");
    for (const key of [
      "balanced",
      "quality-optimized",
      "cost-optimized",
      "latency-optimized",
    ]) {
      const entry = resolveDefaultProfileForProvider(undefined, key, DP);
      expect(entry?.model, key).toBe("llama3.1:8b");
    }
  });

  test("missing connection row resolves to undefined (explainable gap)", async () => {
    mockConnectionRow(null);
    const { resolveDefaultProfileForProvider } =
      await import("../config/default-profile-catalog.js");
    const entry = resolveDefaultProfileForProvider(undefined, "balanced", DP);
    expect(entry).toBeUndefined();
  });

  test("connection without declared models resolves to undefined", async () => {
    mockConnectionRow({
      name: "custom-1",
      provider: "openai-compatible",
      auth: { type: "api_key" },
      label: "Custom",
      baseUrl: "http://127.0.0.1:11434/v1",
      models: [],
      createdAt: 0,
      updatedAt: 0,
    });
    const { resolveDefaultProfileForProvider } =
      await import("../config/default-profile-catalog.js");
    const entry = resolveDefaultProfileForProvider(undefined, "balanced", DP);
    expect(entry).toBeUndefined();
  });
});
