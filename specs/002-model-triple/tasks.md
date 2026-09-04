# Tasks: Model Triple (002)

**Branch**: `002-model-triple` (from `origin/main`, with `001-provider-freedom` merged as baseline)
**Goal**: endpoint + model + key for every function requiring a model.

## Phase 1: Central triple
- [x] T001 Central `ModelTriple` schema + normalize/resolve/inheritance (`providers/model-triple/triple.ts`)
- [x] T002 `probeTriple` with 10-min cache, redacted errors (`providers/model-triple/probe.ts`)
- [x] T003 Unit tests 10/10 green (`triple.test.ts`)

## Phase 2: Gap fixes (001 leftovers)
- [x] T004 STT Whisper streaming honors `baseUrl` (`openai-whisper-stream.ts` + `resolve.ts`)
- [x] T005 Web-search `model` configurable (Perplexity `sonar` no longer hardcoded)
- [x] T006 Embeddings `openai-compatible` provider + keyless-local
- [x] T007 Image `openai-compatible` provider + keyless-local
- [x] T008 TTS `openai` provider (schema + catalog + adapter with apiBase/model/key triple)
- [ ] T009 STT generic `openai-compatible` as first-class provider id (currently via `openai-whisper` + baseUrl; expose alias in UI)
- [ ] T010 Video generic endpoint docs + UI (adapter already supports apiBase/model/key for xAI shape)

## Phase 3: Verify + docs + UI
- [x] T011 `assistant/scripts/verify-triples.ts` (per-function endpoint/model/key presence, keys redacted; ran offline OK)
- [ ] T012 Web UI triple editor reused per service (endpoint + model + key fields; catalog-driven pickers already expose new openai entries)
- [x] T013 Credential docs per function (`specs/002-model-triple/triple-map.md`: vault path + env + Settings path)

## Phase 4: Gates + push
- [x] T014 `bunx tsgo --noEmit` clean (assistant)
- [x] T015 `bun run lint` clean on changed files (eslint --fix applied)
- [x] T016 Targeted `bun test` (triple 10/10 + image 65/65 across 4 files)
- [x] T017 Commit + push `002-model-triple` to fork (d0725416f9, prettier + hooks green)
- [x] T018 Vault: Projects/vellum-by-hermes.md + Sesiones + Daily
