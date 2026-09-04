import { describe, expect, test } from "bun:test";

import {
  BYOK_FETCH_PROVIDER_IDS,
  FETCH_PROVIDER_CATALOG,
  FETCH_PROVIDER_IDS,
  getFetchProvider,
} from "../fetch-provider-catalog.js";

describe("fetch-provider-catalog", () => {
  test("Browser Use is offered as a builtin (keyless) provider", () => {
    expect(FETCH_PROVIDER_IDS).toContain("browser-use");
    const entry = getFetchProvider("browser-use");
    expect(entry).toBeDefined();
    expect(entry?.displayName).toBe("Browser Use");
    // builtin, like the default Vellum fetcher: no API key required.
    expect(entry?.kind).toBe("builtin");
    expect(entry?.secretKey).toBeUndefined();
    expect(entry?.envVar).toBeUndefined();
    // Not in the BYOK key-gated set — settings UI must not demand a key.
    expect(BYOK_FETCH_PROVIDER_IDS).not.toContain("browser-use");
  });

  test("existing provider ids remain stable", () => {
    expect(FETCH_PROVIDER_IDS).toEqual([
      "default",
      "firecrawl",
      "fastcrw",
      "browser-use",
    ]);
    expect(FETCH_PROVIDER_CATALOG.length).toBe(FETCH_PROVIDER_IDS.length);
  });
});
