# Vellum Assistant Backend — Provider/Model System Map

Repo: `/Users/francisco/Downloads/VELLUM-BY-HERMES/vellum-fork` (assistant package: `assistant/src`)
All paths below are relative to `assistant/src/` unless absolute.

## 1. Provider type/interface definitions

**Core interface** — `providers/types.ts`
- `Provider` interface: lines 477–539 (`name`, `routeAttribution`, `tokenEstimationProvider`, `defaultModel`, `supportsNativeWebSearch`, `sendMessage(messages, options)`, optional `countInputTokens`).
- `SendMessageConfig` (lines 330–467): per-request `model`, `callSite`, `overrideProfile`, `forceOverrideProfile`, `selectionSeed`, `effort`/`speed`/`verbosity`, `logit_bias`, `disableCache`, etc.
- `ProviderResponse` lines 255–289 (`content`, `model`, `actualProvider`, `actualInferenceProfile`, `resolvedEndpoint`, `usage`, `stopReason`).
- `ModelIntent` type lines 248–253: `balanced | cost-optimized | latency-optimized | quality-optimized | vision-optimized`.

**Catalog entry** — `providers/model-catalog.ts`
- `ProviderCatalogEntry` interface: lines 133–160 (`id`, `displayName`, `models: CatalogModel[]`, `defaultModel`, `setupMode: "api-key"|"keyless"`, `envVar`, `supportsPlatformAuth`, `featureFlag`).
- `RAW_PROVIDER_CATALOG` array: line 181. Provider ids in order: `anthropic` (183), `openai` (393), `gemini` (620), `ollama` (866), `openrouter` (1104), `vercel-ai-gateway`, `fireworks`, `together`, `litellm`, `opencode` (2238), **`openai-compatible` (2257)**, `minimax` (2269), `atlascloud` (2307), `baseten` (2337), `poolside` (2376), `vellum` (2415).
- `PROVIDER_CATALOG` export: lines 2441–2450 (derives `supportsPlatformAuth` from `PLATFORM_PROVIDER_META`).
- Helpers: `isModelInCatalog` (2453–2456), `catalogMaxOutputTokens` (2459), `catalogContextWindowTokens` (2469), `getCatalogProviderForModel` (2532), `getModelDisplayName` (2544).

**Adapter creation** — `providers/inference/adapter-factory.ts`
- `AdapterCreateOpts` lines 66–76 (`apiKey`, `model`, `streamTimeoutMs`, `baseURL`, `useNativeWebSearch`, `codexSubscription`).
- `ADAPTER_FACTORIES` table lines 96–213: one factory per catalog id, keyed by provider id. **`"openai-compatible"` factory at lines 176–188** builds `OpenAIChatCompletionsProvider` with `providerName: "openai-compatible"`, `assistantReasoningField: "reasoning_content"`, `omitToolChoiceWhenReasoning: true`, and passes `baseURL` through (keyless endpoints get the placeholder key `"not-needed"`).
- Module-load parity guard `PROVIDER_CATALOG_FACTORY_PARITY` lines 219–240: throws at startup if any catalog id lacks a factory (or vice versa).
- `buildProviderAdapter` lines 248–257; `createAdapterFromConnection` lines 266–547 (wraps in `RetryProvider` + `UsageTrackingProvider` + `MissingCredentialGuardProvider`); `buildConnectionAdapter` lines 549–608 — note lines 573–581: keyed providers refuse `none` auth **except** `openai-compatible` (dual-mode: local keyless, hosted keyed).

**Auth / connection schema** — `providers/inference/auth.ts`
- `AuthSchema` lines 22–43: `api_key | platform | none | oauth_subscription | service_account` (last one accepted by schema, rejected at runtime as "not yet shipped").
- `ResolvedAuth` lines 100–103: `header | runtime_proxy | none`, each optionally carrying `baseUrl`.
- `deriveAuthForProvider` lines 56–73 — **openai-compatible special case at 67–71**: credential presence decides `api_key` vs `none`.
- `VALID_CONNECTION_PROVIDERS` lines 120–135: derived from `PROVIDER_CATALOG` ids + `"vellum"` sentinel + `"chatgpt"`; `ConnectionProviderSchema` (zod enum) lines 159–161 — this is the closed set a connection row's `provider` column may hold.
- `ROUTING_IDENTITY_PROVIDERS` lines 154–157: `{ "vellum", "chatgpt" }`.
- **`PROVIDERS_REQUIRING_BASE_URL_AND_MODELS` lines 180–181: `{ "openai-compatible" }`.**
- **`PROVIDERS_ALLOWING_CUSTOM_BASE_URL` lines 190–194: `{ "openai-compatible", "ollama", "opencode" }`.** Every other provider rejects/strips a client-supplied `baseUrl` (anti-exfiltration).
- `ProviderConnectionSchema` lines 200–219 (`name`, `provider`, `auth`, `label`, `baseUrl: url|null`, `models: ConnectionModel[]|null`).

## 2. Provider registration flow (registry / boot)

**Registry** — `providers/registry.ts`
- In-memory `providers: Map<string, Provider>` line 37; `registerProvider` lines 79–81 (wraps in `UsageTrackingProvider`); `getProvider` lines 83–89 throws `ProviderNotConfiguredError` for unknown names.
- **`initializeProviders(config)` lines 194–285** — the boot path:
  1. Iterates `PROVIDER_CATALOG` (line 208), skipping feature-flagged entries.
  2. Credential resolution `resolveProviderCredentials` lines 173–192: user key (vault/env) first, else Vellum managed proxy (`buildManagedBaseUrl` + assistant API key). Keyless providers (ollama) skip credentials but must be the configured mainAgent provider or hold a key (lines 226–232).
  3. `resolveModel` lines 126–140: model comes from `resolveCallSiteConfig("mainAgent", llm)` if this provider is the main one; **if the model is an Anthropic-catalog model on a non-anthropic provider it silently swaps to `getProviderDefaultModel(providerName)`** (lines 131–136).
  4. `buildProviderAdapter` + `registerProvider` (wraps in `RetryProvider`), `routingSources` records `user-key` vs `managed-proxy`.
- Per-connection cache & resolution: **`resolveProviderFromConnection` lines 306–396** — resolves auth via `resolveAuth` (threading `connection.baseUrl`), builds adapter via `createAdapterFromConnection`, caches 60s TTL (line 63). This is the path that actually serves custom endpoints.
- Boot call sites: `daemon/config-watcher.ts:203`, `providers/inference/credential-rotation.ts:18`, `runtime/routes/conversation-query-routes.ts:1479`, lazy init in `provider-send-message.ts:152–163`.

**Canonical dispatch path** — `providers/provider-send-message.ts`
- `resolveConfiguredProvider(callSite, opts)` lines 146–279: resolves `resolveCallSiteConfig` → `{provider, provider_connection, model}` → routing-identity translation → entry-name or auto-resolved connection → `tryResolveProviderForConnectionName`. Returns `CallSiteConfiguredProvider` wrapper (lines 67–126).

**Connection resolution** — `providers/connection-resolution.ts`
- `tryResolveProviderForConnectionName` lines 227–410: translates routing identities (`resolveRoutingIdentity`), DB lookup, vellum/chatgpt route handling (lines 268–317), provider-mismatch auto-recovery (lines 318–371), then `resolveProviderFromConnection`.
- **A `vellum` connection paired with a non-managed provider (`openrouter`/`ollama`/`openai-compatible`/…) is treated as misconfiguration** (lines 279–304) — the platform proxy can only front `MANAGED_ROUTABLE_PROVIDERS`.
- `resolveDefaultProvider` lines 510–594; `preflightResolvedConfig` lines 615+ (throws `ConnectionResolutionError` on `not_found`, `provider_mismatch`, `missing_credential`, `platform_unauthenticated`, `model_incompatible`).
- Error type: `providers/routing-identity.ts:28–52` (`ConnectionResolutionError`); `resolveRoutingIdentity` lines 64–101 (vellum → managed upstream from model; chatgpt → openai upstream, Codex-only).

**Vellum Cloud routing** — `providers/vellum-model-routing.ts`
- `MANAGED_ROUTABLE_PROVIDERS` lines 29–33 — derived from `PLATFORM_PROVIDER_META` entries with `managed: true`. **The hardcoded "managed/frontier" set** (`providers/platform-proxy/constants.ts:28–73`): `openai`, `anthropic`, `gemini`, `fireworks`, `together`, `vellum` (managed) vs `poolside`, `openrouter`, `vercel-ai-gateway`, `ollama`, `openai-compatible` (managed: false).
- `VELLUM_MANAGED_PROVIDER = "vellum"` (line 44); `VELLUM_MANAGED_CONNECTION_NAME` (55); `formatVellumModel`/`parseVellumModel` (81–123); `getManagedUpstream(model)` lines 138–149 (only catalog models under managed providers).
- Managed proxy base URL construction: `providers/platform-proxy/context.ts` `buildManagedBaseUrl`.

## 3. Custom endpoint flow (openai-compatible)

**Create/update surface** — `runtime/routes/inference-provider-connection-routes.ts`
- Routes registered lines 712–838: `GET/POST /v1/inference/provider-connections`, `GET/PATCH/DELETE .../:name`.
- `parseCustomProviderFields` lines 100–191:
  - **`base_url` gate lines 115–124**: non-null `base_url` on any provider outside `PROVIDERS_ALLOWING_CUSTOM_BASE_URL` → 400 `"base_url is only valid for openai-compatible, ollama, and opencode providers. Remove base_url or use a provider that accepts a custom endpoint."`
  - URL validation (http/https only) lines 126–142; **SSRF protection lines 144–167**: on platform-hosted daemons, private/local/metadata hosts are rejected (self-hosted daemons allow localhost/LAN).
  - `models` parsing lines 177–188.
- `deriveConnectionAuth` lines 199–213; `assertAuthMatchesProvider` lines 222–245.
- **`assertValidCustomProviderIdentity` lines 294–325 + `RESERVED_PROVIDER_IDENTITIES` lines 328–336**: an `openai-compatible` connection's label/name must not collide with a built-in provider id/display name or another custom connection.
- Create handler `handleCreateConnection` lines 338–449; error mapping for `base_url_required` → 400 `"base_url is required for openai-compatible providers."` (432–436) and `models_required` → 400 `"At least one model is required for openai-compatible providers."` (437–441). Save-time probe `testInferenceConnection` (line 445).
- Update handler lines 451–571 (same required-field errors at 554–563).

**CRUD enforcement** — `providers/inference/connections.ts`
- `createConnection` line 197; `updateConnection` line 273; both enforce `PROVIDERS_REQUIRING_BASE_URL_AND_MODELS` → `base_url_required` / `models_required` result codes (lines 230–235 and 306–311).
- `seedCanonicalConnections` line 491 (boot seeds the vellum managed row); `MANAGED_CONNECTION_NAMES` line 475.

**Auth resolution** — `providers/inference/resolve-auth.ts`
- `resolveAuth` lines 31–128. **Defense-in-depth baseUrl strip lines 38–49**: any provider outside `PROVIDERS_ALLOWING_CUSTOM_BASE_URL` has its baseUrl silently nulled (log warn). `none` auth keeps `safeBaseUrl` (lines 86–95) — this is how keyless LM Studio/vLLM endpoints work.

**Adapter** — `providers/openai/chat-completions-provider.ts` (1640 lines)
- Options lines ~120–187: `baseURL`, `maxReasoningEffort`, `assistantReasoningField`, `omitToolChoiceWhenReasoning` (enabled for the generic openai-compatible adapter, lines 180–186), `parseThinkTags`, `coerceObjectArgsToJsonString`.
- Uses the `openai` SDK `chat.completions`; effort mapping `EFFORT_TO_REASONING_EFFORT` lines 211–218; reasoning replay as `reasoning_content` (comment lines 166–173; adapter sets it at factory lines 181–183).

**Endpoint probe** — `providers/inference/endpoint-probe.ts`
- `testInferenceConnection` lines 53–115: fires one minimal `POST {baseUrl}/chat/completions` (`max_tokens: 1`, model = first declared connection model) with 10s timeout; advisory-only hints (404 → "check the base path, e.g. NVIDIA needs /v1, OpenRouter needs /api/v1"; 401/403 → key).

**CLI surface** — `cli/commands/inference-providers.ts`
- `--base-url` required for `openai-compatible` (lines 289–291); `buildCustomProviderFields` lines 155–167 forwards `base_url` + `models` verbatim; auth derivation reuses daemon's `deriveAuthForProvider` (lines 93–105). Help text: `cli/commands/inference.help.ts:219,275,353`.

## 4. Hardcoded model/provider restrictions

1. **Closed provider id set**: `VALID_CONNECTION_PROVIDERS` (auth.ts:120–135) + `ConnectionProviderSchema` enum — unknown provider → 400 `"Invalid provider ... Valid: ..."` (routes line 366–370).
2. **`KNOWN_LLM_PROVIDERS` allowlist** — `config/schemas/llm.ts:45–67` (includes `"openai-compatible"`, `"litellm"`, `"opencode"`; plus identities `"vellum"`, `"chatgpt"`). `unknownLlmProviderIssue` lines 78–82; enforced at profile write (`runtime/routes/conversation-query-routes.ts:1395–1396`) and via `writableProfileProviderIssue` (`connection-resolution.ts:108–121` — known provider OR existing connection-entry name).
3. **`DEFAULT_PROVIDER_CHOICES`** — schemas/llm.ts:94–110: `llm.defaultProvider.provider` enum = `DEFAULT_PROFILE_PROVIDERS` + api-key catalog providers with non-empty `defaultModel`, **explicitly excluding keyless and endpoint-supplied providers (openai-compatible, litellm, opencode, ollama)**. So an OpenAI-compatible endpoint **cannot** back the workspace default provider / default profiles — the `DefaultProviderEnum` (line 129) rejects it.
4. **Model allowlist at profile write** — `runtime/routes/inference-profiles-routes.ts`:
   - `modelReachIssue` lines 200–229: model must be `isModelInCatalog` OR declared on the connection's `models` list (custom endpoints declare their own models); routing identities checked against their routing tables.
   - `validateModel` lines 236–264: uncataloged model → 400 unless `allowUnlisted: true`; openai-compatible remedy text suggests declaring the model on the connection (lines 254–260). `allowUnlisted` never applies to routing identities (246–253).
   - Listing verdict `profileConfigIssue` lines 274–309 flags stored rows with `model_unknown` / `over_output_cap` / `no_input_room`.
5. **Routing-identity model gate**: `routingIdentityModelIssue` (schemas/llm.ts:145–174) — `vellum` requires model resolvable via `getManagedUpstream`; `chatgpt` requires a Codex model (`providers/openai/codex-models.ts`).
6. **Managed-proxy allowlist**: `MANAGED_ROUTABLE_PROVIDERS` (vellum-model-routing.ts:29–33) — the proxy only fronts openai/anthropic/gemini/fireworks/together/vellum. Managed fallback never applies to openai-compatible (PLATFORM_PROVIDER_META `managed: false`, platform-proxy/constants.ts:72).
7. **Catalog-model swap at boot**: registry.ts:131–136 replaces Anthropic models on non-anthropic providers with the provider's default.
8. **Default-profile matrix**: `config/default-profile-names.ts:93–101` `DEFAULT_PROFILE_PROVIDERS = [anthropic, openai, gemini, fireworks, openrouter, chatgpt, vellum]`; intent×provider model pins in `providers/model-intents.ts:18–68` (module-load validated against catalog, lines 84–93; openai column must be Codex-servable, lines 102–110).

## 5. Model profile routing (Quality/Balanced/Fast/Budget)

- Default profile keys — `config/default-profile-names.ts:21–27`: `balanced`, `quality-optimized`, `cost-optimized` (labeled "Budget"), `latency-optimized` (labeled "Fast"). Backups lines 38–44; `FALLBACK_PROFILE_BY_KEY` lines 52–60; `OS_BETA_PROFILE_KEY` line 77.
- Profile templates — `config/default-profile-catalog.ts`:
  - `PROFILE_IMPLS` intent×provider matrix lines 407–427 (per-provider bodies: BYOK templates vs `VELLUM_PROFILE_IMPLS` vs `CHATGPT_PROFILE_IMPLS`).
  - `MANAGED_PROFILE_TEMPLATES` 437–441; `materializeProfile` 560–579 (resolves `intent` → model via `resolveModelIntent`, stamps `provider_connection`).
  - `resolveDefaultProfileForProvider` 804–814 → `defaultProfileBodyForProvider` 845–880 (choke point that picks the body per `llm.defaultProvider`; clamps maxTokens to catalog caps 892–901).
  - `getEffectiveProfiles` 917+, `getUserSelectableProfilesForProvider` 974+.
- Resolution — `config/llm-resolver.ts`:
  - `selectWinningProfile` lines 191–247: single-winner chain = per-turn `overrideProfile` → `llm.activeProfile` (mainAgent only) → `llm.callSites[site].profile` → call-site default intent → `balanced` anchor, each dereferenced provider-aware (`providerAwareEntry` lines 260–286).
  - `resolveCallSiteConfig`/`resolveCallSiteConfigWithProfile` lines 135–153 compose base schema defaults + winning profile + call-site tuning fragment (mix profiles expand via seeded weighted pick).
  - Call sites enum: `config/schemas/llm.ts:187–230` (40+ sites incl. `mainAgent`, `vision`, `workflowLeaf`).
- `llm` config schema — `config/schemas/llm.ts`: `LLMConfigBase` 518–555 (`provider` default `"anthropic"`, `model` default `"claude-opus-4-8"`, `provider_connection` 529); `LLMConfigFragment` 563–580; `ProfileEntry` 614–668 (`source`, `label`, `provider_connection` 635, `allowUnlisted` 642, `mix` 660, `fallbackProfile` 667); `LLMSchema` 917–1116 (profile/mix/fallback/activeProfile/advisorProfile validation); `DefaultProviderSchema` 695–699.
- `llm.defaultProvider` convention: `config/default-provider-resolution.ts:24–37` — `<provider>-personal` connection name convention; `vellum`/`chatgpt` map to canonical rows.
- Profile validation: `config/inference-profile-validation.ts` (key-vs-effective-catalog check); materialization `config/profile-materialization.ts` (`completeCustomProfile` lines 40–170 fills absent fields from base, implies provider from model via `getCatalogProviderForModel`); boot seeding `config/seed-inference-profiles.ts:59` (`seedInferenceProfiles`), backfill `providers/inference/backfill.ts:59` (stamps `provider_connection` on profiles).

## 6. Where custom endpoints currently error / fall short (failure points)

| # | Failure point | File:lines | Behavior |
|---|--------------|-----------|----------|
| 1 | `base_url` on non-custom providers | `runtime/routes/inference-provider-connection-routes.ts:115–124` | 400 "base_url is only valid for openai-compatible, ollama, and opencode providers..." |
| 2 | Defense-in-depth strip | `providers/inference/resolve-auth.ts:38–49` | silently strips baseUrl for other providers (anti key-exfiltration) |
| 3 | Missing base_url/models | `routes/...connection-routes.ts:432–441, 554–563`; `connections.ts:230–235, 306–311` | 400 "base_url is required for openai-compatible providers." / "At least one model is required..." |
| 4 | Unknown provider id | `routes/...connection-routes.ts:365–370` (also `inference-models-routes.ts:37–41` "Unknown provider") | 400 "Invalid provider ... Valid: <closed list>" |
| 5 | **Cannot be the default provider** | `config/schemas/llm.ts:94–110` (`DEFAULT_PROVIDER_CHOICES` excludes `PROVIDERS_REQUIRING_BASE_URL_AND_MODELS`) | `llm.defaultProvider.provider: "openai-compatible"` fails `DefaultProviderEnum`; default profiles (balanced/quality-optimized/etc.) can never materialize on a custom endpoint — it's user-profile-only |
| 6 | Default profile matrix has no custom-endpoint column | `config/default-profile-names.ts:93–101`, `default-profile-catalog.ts:407–427` | no intent→model body for openai-compatible; falls to `getProviderDefaultModel("openai-compatible")` = `""` (empty, `model-catalog.ts:2257–2267` has `models: [], defaultModel: ""`) |
| 7 | Boot registry can build a broken adapter | `registry.ts:208–282` + `resolveModel` 126–140 + `model-intents.ts:116–118` | if a key is stored for `openai-compatible`, boot registers an adapter with `model=""`, no baseURL → OpenAI SDK would target `api.openai.com`; harmless only because dispatch goes through connections |
| 8 | Managed route rejects custom providers | `connection-resolution.ts:279–304`; `vellum-model-routing.ts:29–33` | a `vellum` connection + `openai-compatible` provider = `provider_mismatch`/`unroutable_managed_model` — no Vellum Cloud fallback for custom endpoints |
| 9 | No automatic fallback/backup profiles for BYOK/custom | `adapter-factory.ts:529–534` (`makeFallbackRouteResolver` only wired for managed proxy), `schemas/llm.ts:818–915` (fallbackProfile code-owned, managed-only) | outage fallback profiles (`*-backup`) never apply to a custom-endpoint route |
| 10 | Uncataloged model rejected at profile write | `inference-profiles-routes.ts:200–264` | model must be in catalog OR declared on the connection; otherwise 400 unless `allowUnlisted` |
| 11 | `chatgpt`/`vellum` identity model gates | `routing-identity.ts:64–101`, `schemas/llm.ts:145–174` | hard 400/thrown config errors for non-Codex / non-managed models |
| 12 | SSRF gate on platform daemons | `routes/...connection-routes.ts:144–167` | base_url to private/local/metadata hosts rejected (platform-hosted only) |
| 13 | Reserved-name collisions | `routes/...connection-routes.ts:294–336, 350–363` | custom connection label/name cannot impersonate built-ins or reuse reserved names |
| 14 | Probe can't catch wrong base path until first turn | `endpoint-probe.ts:37–45` | advisory hint only; save always succeeds |

## 7. Files to change for first-class OpenAI-compatible main-model support

1. `assistant/src/config/schemas/llm.ts` — widen `DEFAULT_PROVIDER_CHOICES` (lines 94–110) to admit `openai-compatible` (or per-connection default providers), so `DefaultProviderEnum` (129) accepts it.
2. `assistant/src/config/default-profile-catalog.ts` + `default-profile-names.ts` — add an openai-compatible column/path to `PROFILE_IMPLS`/`DEFAULT_PROFILE_PROVIDERS` so `balanced`/`quality-optimized`/`cost-optimized`/`latency-optimized` can materialize on a custom endpoint (model must come from the connection's `models` list since the catalog has none).
3. `assistant/src/config/default-provider-resolution.ts:24–37` — connection-name convention (`<provider>-personal`) already works, but resolution must handle multiple openai-compatible rows.
4. `assistant/src/providers/model-intents.ts` — intent resolution for custom endpoints (currently `getProviderDefaultModel` → `""`).
5. `assistant/src/providers/registry.ts` (`initializeProviders` 194–285, `resolveModel` 126–140) — stop registering the degenerate boot adapter for openai-compatible (no catalog defaultModel), or resolve model from the connection's declared models.
6. `assistant/src/providers/inference/auth.ts:180–194` — `PROVIDERS_REQUIRING_BASE_URL_AND_MODELS` / `PROVIDERS_ALLOWING_CUSTOM_BASE_URL` drive everything; any new custom-capable provider must be added here.
7. `assistant/src/providers/inference/adapter-factory.ts:176–188` — the openai-compatible factory itself (already functional; may need per-connection option plumb-through for things like `maxReasoningEffort`).
8. `assistant/src/providers/connection-resolution.ts` / `provider-send-message.ts` — ensure entry-name routing and mismatch auto-recovery treat multiple openai-compatible connections correctly.
9. `assistant/src/config/seed-inference-profiles.ts` + `providers/inference/backfill.ts` — boot seeding/backfill must not stamp managed `provider_connection`s onto custom-endpoint profiles.
10. `assistant/src/runtime/routes/inference-profiles-routes.ts` — model-reach validation (200–264) already accepts connection-declared models; relax only if arbitrary models on custom endpoints should be allowed without `allowUnlisted`.

No files were modified (read-only exploration).
