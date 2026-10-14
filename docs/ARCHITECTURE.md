# MVP Architecture

## Architecture goal

Preserve a single structured `ShotState` from template selection through 3D editing, image rendering and prompt compilation. Provider-specific code and UI components must not become sources of truth.

## System view

```text
Static director content (YAML)
            |
            v
    Content loader + validator
            |
            v
      Canonical ShotState <----------------------+
       |       |       |                         |
       |       |       +--> Prompt compiler      |
       |       |                |                |
       |       |                +--> model adapter
       |       |
       |       +--> Three.js scene projection/render
       |                        |
       |                        +--> raw/start/end PNG
       |
       +--> Image-generation adapter --> enhanced first frame
            |
            v
        Artifact manifest + downloadable package
```

## Recommended stack

| Concern | Default choice | Reason |
|---|---|---|
| Web framework | Next.js App Router + TypeScript | Existing project assumption; simple server/API boundary |
| UI | React | Fits Next.js and React Three Fiber |
| 3D | Three.js + React Three Fiber + Drei | Web-native constrained 3D scene |
| Client state | Zustand with Immer or equivalent small store | Explicit canonical shot state and undoable transforms |
| Validation | Zod at runtime; generated/exported JSON Schema for content authors | Shared TypeScript and content validation |
| Styling | Tailwind CSS or CSS Modules; choose once during scaffold | No UI framework requirement yet |
| Unit tests | Vitest | Fast TypeScript/domain tests |
| Browser tests | Playwright | Primary latest-Chrome workflow validation |
| Static content | YAML compiled/validated at build time | Director-friendly diffs and version control |
| Session persistence | In-memory state plus browser local storage | No accounts or database in MVP |
| Export packaging | In-repo deterministic STORE-only ZIP writer (Prompt 5); JSZip or a server-side equivalent remain acceptable alternatives | One coherent downloadable package with no new dependency |

The dependency versions must be resolved from current official package documentation when scaffolding; do not copy version numbers into this architecture document.

## Proposed repository structure

```text
/
├─ AGENTS.md
├─ README.md
├─ docs/
├─ content/
│  ├─ intake/
│  ├─ schema/
│  ├─ templates/
│  │  └─ dialogue/
│  ├─ rules/
│  ├─ adapters/
│  └─ glossary/
├─ public/
│  ├─ reference-images/
│  └─ 3d-assets/
├─ scripts/
│  ├─ compile-content.ts
│  └─ validate-content.ts
├─ src/
│  ├─ app/
│  │  ├─ page.tsx
│  │  ├─ director/page.tsx
│  │  └─ api/
│  │     └─ image-generation/route.ts
│  ├─ domain/
│  │  ├─ shot-state.ts
│  │  ├─ shot-template.ts
│  │  ├─ artifacts.ts
│  │  └─ schemas.ts
│  ├─ content/
│  │  ├─ loader.ts
│  │  └─ compiled-content.ts
│  ├─ features/
│  │  ├─ shot-library/
│  │  ├─ simple-controls/
│  │  ├─ director-stage/
│  │  ├─ movement-preview/
│  │  ├─ first-frame/
│  │  ├─ prompt-compiler/
│  │  └─ export-package/
│  ├─ adapters/
│  │  ├─ image-generation/
│  │  └─ video-prompts/
│  ├─ state/
│  │  └─ shot-store.ts
│  └─ shared/
│     ├─ components/
│     └─ utils/
└─ tests/
   ├─ fixtures/
   ├─ unit/
   └─ e2e/
```

## Canonical domain model

The implementation may refine names, but it must preserve these concepts.

```ts
type Vec3 = [number, number, number];

interface ShotState {
  id: string;
  schemaVersion: number;
  template: {
    id: string;
    version: number;
  };
  aspectRatio: "9:16" | "16:9";
  scene: SceneState;
  camera: CameraState;
  characters: CharacterState[];
  movement: MovementState;
  semantics: PromptSemantics;
}

interface SceneState {
  presetId: string;
}

interface CameraPose {
  position: Vec3;
  target: Vec3;
  focalLengthMm: number;
}

interface CameraState extends CameraPose {
  safeRanges: {
    focalLengthMm: [number, number];
  };
}

interface CharacterState {
  id: "character_a" | "character_b";
  position: Vec3;
  rotationYDeg: number;
}

interface MovementState {
  type: "static" | "dolly_in" | "dolly_out" | "truck_left" | "truck_right";
  start: CameraPose;
  end: CameraPose;
  durationSeconds: number;
  easing: "linear" | "ease_in_out";
}
```

## Engineering camera convention

This is an engineering convention, not director knowledge.

- `+X` is scene right, `+Y` is up, and `+Z` points toward the default camera from the subject plane.
- Domain character yaw `0` faces `+Z`; character A at negative X uses `+90` degrees to face character B, and character B uses `-90`.
- `focalLengthMm` assumes a 36mm long-edge virtual film gate. The 16:9 gate is 36x20.25mm; the 9:16 gate rotates to 20.25x36mm.
- The Three.js vertical FOV is derived as `2 * atan(active vertical gate / (2 * focal length))`.


## State-flow rules

1. Loading a template creates a fresh `ShotState` with a unique ID.
2. Simple controls dispatch semantic commands such as `makeCloser` or `emphasizeCharacterB`.
3. Semantic commands mutate explicit fields in `ShotState`; they never concatenate prompt text.
4. Direct 3D manipulation writes the same fields used by simple controls.
5. Three.js renders from `ShotState` without storing a second canonical scene representation.
6. Prompt compilation reads `ShotState` and the selected adapter version.
7. Artifact export includes the exact `ShotState` used to produce every output.

## Prompt compiler

```text
ShotState
   -> normalized semantic specification
   -> deterministic directing rules
   -> provider adapter template
   -> optional constrained LLM polish
   -> final prompt + warnings + adapter version
```

The LLM may rewrite wording but must not change camera geometry, character identities, movement type or continuity constraints. Validate polished output against a structured response before rendering it to text.

Prompt 6 (Day 6) implements the deterministic, model-agnostic part of this pipeline; LLM polish is not implemented (it remains a config-permitted later capability):

- `normalizedShotSpecSchema` in `src/domain/prompt-normalization.ts` is the single executable definition of the normalized specification (`NormalizedShotSpec` is Zod-inferred there and re-exported at the adapter boundary — no second type copy). `normalizeShotState` re-runs the canonical `shotStateSchema` gate (invalid input throws; no partial output), deep-copies everything, orders characters canonically (`character_a` then `character_b`) and keeps the CURRENT camera pose separate from the movement start/end poses.
- The callable entry is `compileVideoPrompt(state, adapter)` in `src/features/prompt-compiler/compile.ts` — read-only; compiled prompts are never written back into canonical state or localStorage.
- `GenericVideoPromptAdapter` (`src/adapters/video-prompts/generic.ts`, id `generic_video`) is the local mock/generic adapter and the only prompt pipeline in the repository (the Prompt 1 placeholder was superseded). Its behavior is a pure function of the validated spec plus the adapter-content config: `content/adapters/generic-video.yaml` is validated by validate:content/compile:content against `videoPromptAdapterConfigSchema` and injected into the adapter, so its `ordering` drives the prompt's semantics-section order and its `constraints` are enforced (a config with `preserveStructuredFacts: false` is refused; `llmMayNotChange` is rendered as the protected-facts line; `allowLlmPolish: true` yields a standing "not implemented" warning). Adapter-content files have no JSON-Schema mirror; the Zod schema is their executable truth.
- Determinism: one valid input plus one adapter/config version produce byte-identical prompts and warnings in identical order (no randomness, clocks or unstable sort). Structured numbers are geometry facts: semantic tokens never override coordinates, focal length or movement — contradictions become locatable warnings (`focal_*mm` ↔ camera focal, `character_*_primary` ↔ the character nearest the camera target, motion tokens naming a movement ↔ `movement.type`; these pairs mirror the established semantic-sync contract). Unknown semantic tokens are rendered verbatim and reported in one locatable aggregate warning, never dropped and never given invented directing meaning. Templates whose `reviewStatus` is not `approved` produce a standing unverified-content warning, and the output is labeled a model-agnostic engineering reference that claims support for no specific video model.
- Golden snapshots: each development template compiles byte-exactly to `tests/fixtures/prompts/<template>.generic-prompt.txt`; the semantics block format matches the committed semantic-reference fixture `dialogue_ots_a_to_b.generic.txt`.

## Adapter boundaries

```ts
interface VideoPromptAdapter {
  id: string;
  version: string;
  compile(input: NormalizedShotSpec): Promise<CompiledPrompt>;
}

interface ImageGenerationAdapter {
  id: string;
  version: string;
  generate(input: {
    compositionImage: Blob;
    characterReferences?: Blob[];
    styleReference?: Blob;
    prompt: string;
  }): Promise<GeneratedImageArtifact>;
}
```

The first implementation should include deterministic mock adapters before any paid provider.

## Target-model prompt adapter (Prompt 8, developer option a, 2026-10-08)

- `SeedanceVideoPromptAdapter` (`src/adapters/video-prompts/seedance.ts`, id `seedance_video@1.0.0`) is the ONE versioned target-model prompt adapter the MVP carries next to the generic one, selected by the developer (option a). It is ENGINEERING-DERIVED from the official prompt guidance surveyed in `docs/Seedance-API-调研报告-2026-09-14.md` — Shot-structured over second-level time codes, descriptive movement language, ONE main camera movement, no parametrized focal/ISO/f-number prose (geometry is carried by the exported reference images and shot-state.json) — and every output states it does NOT claim official Seedance support (D026 account-level verification still open). Its config is versioned content (`content/adapters/seedance-video.yaml`, validated by the content pipeline and injected like the generic config; `compile:content` emits both). Same guarantees as the generic adapter: deterministic byte-identical output, fixed-order warnings, purity, and golden snapshots per template (`tests/fixtures/prompts/*.seedance-prompt.txt`).

## Full input package (Prompt 8 / Phase 2 §2.3 + Phase 3 Day 9)

- `buildFullExportPackage` (`src/features/export-package/full-export-package.ts`) bundles the MVP "Outputs" set from ONE frozen ShotState: shot-state.json, composition-raw.png, movement-start.png, movement-end.png (the same readiness-gated rasters the raw export captures — the capture stage is now shared in `capture-stage.tsx`), prompt-generic.txt, prompt-seedance.txt, template-diff.txt (v3), and an OPTIONAL enhanced first frame whose filename extension follows the artifact's actual MIME type (mock results are SVG).
- Same-source verification is EXECUTABLE: the builder REFUSES the package when either prompt was not compiled from this exact state — identity fields (state id, schema version, template id/version/review status) PLUS the complete-state canonical fingerprint (Prompt 8 acceptance fix R3, 2026-10-14: a shot keeps its id/template through ordinary edits, so identity alone accepted stale prompts; `NormalizedShotSpec.state.stateFingerprint` / `CompiledPrompt.source.stateFingerprint` carry the fingerprint — taken over the canonical character order, so an order-only difference is not a mismatch) — and an enhanced frame whose full-state fingerprint no longer matches is excluded with manifest reason "stale" (missing frames record "absent") rather than shipping a frame that no longer describes the state.
- `template-diff.txt` (`src/features/export-package/template-diff.ts`, 2026-10-11 director-approved addition): a DERIVED, read-only, field-level summary of the frozen state's deviations from its template defaults (`path: templateValue -> currentValue` per changed field, or an explicit no-deviations marker). The baseline must match the state's template id@version or the package is refused; the diff never writes back to the canonical state.
- `fullExportManifestSchema` (`src/domain/artifacts.ts`, manifestVersion 4, strict) covers every hashed file plus both prompt adapters' identities AND their verbatim compiler warnings in emission order (Prompt 8 acceptance fix R4, 2026-10-14: the per-fact diagnostics — semantic conflicts, movement inconsistencies, uninterpreted tokens — ship next to each prompt record instead of being dropped, and the FullExport UI lists them after export; they never block the export or the raw path), plus the enhanced frame's provenance (adapter, provider, source fingerprint) and its ALLOWLISTED generation settings (fix R1: `ENHANCED_FRAME_METADATA_KEYS` — model, response model, output format, size/sizeSource, request id, prompt/composition byte counts, reference counts, style-reference flag, total input images, watermark, mock signature; credentials, server-environment values such as the endpoint, and unvetted provider keys are never exported); the builder validates the manifest before wrapping and cross-checks byte counts, mirroring the raw package. STORE-only ZIP, byte-deterministic for one snapshot + one timestamp; filename `shot-<id>-full.zip`.
- UI (`src/features/export-package/FullExport.tsx`): a second, independent export button next to the raw ZIP; the raw export remains fully usable on its own. The enhanced-frame result moved into its own derived-artifact store (`src/state/enhanced-frame-store.ts`) — never into the canonical appShotStore — so the export reads the current result while the provenance/staleness rules stay the 9b320fa ones.
- Phase 3 (Day 9, reworked 2026-10-12 per D032): first-use onboarding steps render in the studio empty state; the advanced-refinement fields gate out-of-range input at the FIELD level — an out-of-range draft stays visible, is never committed (canonical state keeps the last valid value) and a persistent per-field warning shows until corrected; yaw keeps its wrap-into-range behavior (no warning); the command-layer clamp remains as defense-in-depth. Draft lifecycle (Prompt 8 acceptance fix R2, 2026-10-14): a held draft is invalidated by exactly two events — the store's `stateEpoch` changing (incremented ONLY by selectTemplate and resetToTemplate; reset keeps the ShotState ID, so the id must never be the invalidation key) or the SAME field's canonical value changing from another valid control (e.g. a simple focal preset); an unrelated field's edit deliberately does not clear a draft still being corrected.

## Enhanced first-frame service (Prompt 7B1 / Phase 2 Day 8 fallback)

Implemented 2026-09-22 as the mock-path finish; the production adapters that followed the same day (Prompt 7B2) are documented in the next section.

- Server route `POST /api/enhanced-frame` (`src/app/api/enhanced-frame/route.ts`) is a thin transport wrapper. The whole contract — input validation, adapter selection, timeout, structured errors — lives in the pure core `src/features/enhanced-frame/server.ts` and is unit-tested directly without a running server.
- D027 single-active selection: the server-side `IMAGE_PROVIDER` setting (`mock` when unset, `seedream`, `wanxiang`) resolves to exactly one adapter via `selectImageGenerationAdapter` (`src/features/enhanced-frame/adapter-selection.ts`) with an injectable registry. In 7B1 the registry is empty, so a production setting answers a structured `501 provider_adapter_not_implemented` — never a silent mock fall-back (mock output must never be mistaken for provider output).
- Request contract (multipart/form-data): generic transport hygiene limits (`compositionImage` png/jpeg/webp ≤20MB, optional `characterReferences` ≤9 files with the same limits, optional `styleReference`, `prompt` ≤5000 chars) PLUS provider-verified input contracts enforced per selected provider: Wan 2.7's official limit of at most 9 input images IN TOTAL (1 composition + character references + optional style) is rejected with a structured 400 `too_many_input_images` before the adapter is called; providers without a verified total (seedream: UNCONFIRMED, mock: none) get no invented limit.
- Response: `{ imageBase64, imageMimeType, adapterId, adapterVersion, provider, metadata }`. Failures are structured `{ error, message }`: 400/413 input errors, 500 provider misconfiguration, 501 not implemented, 502 adapter failure (message distinguishes definitive failures from UNKNOWN-OUTCOME failures and DELIVERED-RESULT failures, both of which warn that regenerating may incur an additional charge), 504 generation timeout. The 120s outer budget is a hard total deadline (see "Production image adapters" above; per provider HTTP attempt 100s capped by the remaining budget — pro-tier image generation legitimately exceeds 30s, live-verified 2026-09-22).
- UI (`src/features/enhanced-frame/EnhancedFrame.tsx`): a collapsed-by-default explicit action. One click freezes the canonical ShotState, captures the current camera pose through the raw-export readiness gate, compiles the Prompt 6 deterministic generic prompt from the same frozen state, and sends composition + prompt to the route. Every failure is a local, retryable message; the raw export shares no state with this path and is never blocked (pinned by a browser test). Result provenance (acceptance fix round 2026-09-23): each result keeps the COMPLETE frozen `ShotState` it was generated from plus adapter metadata — never written back into canonical state; a result whose full-state fingerprint (`shotStateFingerprint`, canonical JSON over every field — not just the id, because same-shot edits keep the id) no longer matches the current state is marked 已过期/stale with its source (template, version, shot id) instead of being presented as the current shot's valid first frame; requests are sequenced so a late older response can never overwrite a newer result.
- Credentials: none in 7B1. `.env.example` documents the 7B2 conventions (`IMAGE_PROVIDER`, later `ARK_API_KEY` / `DASHSCOPE_API_KEY`), read only by the matching server-side adapter; values never reach the client, logs, fixtures or the prompt text.
- Content pipeline: `compile:content` now also emits `COMPILED_ADAPTER_CONFIGS` (validated, sorted, byte-deterministic) so the client compiles prompts through the content-pipeline-validated adapter config without a second drifting copy.

## Production image adapters (Prompt 7B2, 2026-09-22)

Both D027 providers are implemented server-side. Zero real provider calls were made in development or tests; the deterministic mock remains the default until the server-side `IMAGE_PROVIDER` selects a credentialed provider.

- Transport decision: plain REST over the Web `fetch` API — no vendor SDK (the Volcengine SDK is Python-only; Python is banned as a production runtime) and no OpenAI SDK (Ark's Seedream-specific fields do not fit its types, and one POST does not justify the dependency; consistent with the in-repo ZIP-writer precedent of keeping the dependency tree unchanged). Both providers share one injectable HTTP core, `src/adapters/image-generation/provider-http.ts`, with caller-supplied Zod schemas so no provider payload is trusted beyond its declared contract.
- Submission policy (acceptance fix round 2026-09-23; outcome classification completed in round 2, 2026-10-02): a generation POST is auto-retried ONLY on HTTP 429 — the one status whose semantics explicitly say the provider refused the request before processing it (bounded 3 attempts, exponential backoff). Nothing that cannot prove non-execution is ever auto-resubmitted: network failures, interrupted response bodies, 5xx responses, per-attempt timeouts (the POST was submitted and then aborted locally — cancelling the connection does not revoke a provider-side task), and an accepted 2xx whose body fails JSON parsing or the declared Zod contract. All of these surface as outcome-unknown errors (`ProviderOutcomeUnknownError`, `ProviderTimeoutError`, `ProviderResponseContractError`, 5xx `ProviderHttpError`) whose mapped 502 message states an UNKNOWN OUTCOME and warns that generating again may incur an additional charge; the per-attempt timeout message carries the same honest wording as the total-budget 504 (a local abort does not cancel any provider task and does not guarantee that no charge occurred). A third class, delivered-result failures (`ProviderResultDeliveryError`), covers a generation that succeeded (2xx + contract) but whose result could not be delivered — the Wan plain-URL result download failing or being refused, or an undecodable image payload; its 502 message says the generation was accepted but its result could not be delivered and warns about the additional charge. Definite pre-submission refusals (input errors, a refused generation URL, missing credentials, 4xx) keep the plain failure message — not every exception is outcome-unknown. Neither provider documents an idempotency token, so none is invented. Outbound provider URLs pass a LITERAL validation: http(s) to a hostname whose text is not a loopback/private/reserved address literal — IPv4, IPv6 (including the URL-normalized IPv4-mapped form `[::ffff:7f00:1]`, the deprecated IPv4-compatible form and the NAT64 prefix, all judged by their embedded IPv4), or a localhost-style suffix; hostnames are classified with `net.isIP` first, never by string prefix (round 2, 2026-10-02 — an ordinary DNS name may legitimately start with "fc"/"fd"/"fe80"). This is configuration hygiene against a misconfigured base URL, NOT a complete SSRF defense: DNS is not resolved and `fetch` follows redirects, so a public-looking hostname can still resolve or redirect to an internal target.
- Total generation budget (acceptance fix round 2026-09-23): `/api/enhanced-frame` arms ONE deadline (default 120s) as an `AbortController` and passes it to the adapter as `ImageGenerationContext` (`src/adapters/image-generation/types.ts`). The signal and `deadlineAt` propagate to the generation POST, its response read, every backoff wait and the Wan result-image download; each per-attempt timeout is capped by the remaining total budget; after the deadline no new POST or download can start, in-flight fetches are aborted, and timers/listeners are cleaned up (no unhandled rejections — the losing side of the race is muted). The 504 message says the LOCAL wait/connection was cancelled and explicitly does not claim to revoke a provider-side task or guarantee no charge.
- `SeedreamImageGenerationAdapter` (`src/adapters/image-generation/seedream.ts`, id `seedream@1.1.0`, the D027 primary): POSTs `{base}/images/generations` with Bearer `ARK_API_KEY`, model default `doubao-seedream-5-0-pro-260628` (the developer's activated Ark-console model, 2026-09-22; overridable via `SEEDREAM_MODEL`), images as data URLs with the composition FIRST (references then style follow), `response_format: b64_json`. Size is live-verified (2026-09-22, doubao-seedream-5-0-pro): the API requires an explicit `WIDTHxHEIGHT` or supported preset — the adapter derives `WIDTHxHEIGHT` from the composition PNG's own IHDR dimensions (1280x720 landscape / 720x1280 portrait, matching the Seedance 720p first-frame raster), falls back to `SEEDREAM_FALLBACK_SIZE` (1280x720) for unparseable compositions, and an explicit `SEEDREAM_SIZE` always wins; the metadata records which source produced the value. Base URL and model are equally constructor/env overridable. The account-side path is live-verified (endpoint + auth + structured error surfacing through the full 7B1 error contract). Ark documents no total input-image limit (UNCONFIRMED in docs/PROVIDER_SPIKE.md), so the route invents none for seedream.
- `WanxiangImageGenerationAdapter` (`src/adapters/image-generation/wanxiang.ts`, id `wanxiang@1.1.0`, the D027 backup): POSTs the official SYNCHRONOUS multimodal-generation endpoint (no `X-DashScope-Async`, no polling) with Bearer `DASHSCOPE_API_KEY`, model default `wan2.7-image`, size `2K`. Request body follows the official contract (re-verified 2026-09-23): text and images are separate objects inside `input.messages[0].content` — one `{image}` object per input image plus one `{text}` object; the legacy `messages[0].text`/`messages[0].image` shape was an error and is gone. Per the official rule that the output aspect ratio follows the LAST input image, the composition frame is the last `{image}` object (references/style first) and the prompt text follows it. The official 0–9 TOTAL input-image limit (composition + character references + optional style) is enforced by the route before the adapter is called (structured 400 `too_many_input_images`) and defensively re-checked in the adapter. Result images are decoded inline from data URIs or downloaded when returned as URLs — under the same total-budget signal. Base URL defaults to the legacy `dashscope.aliyuncs.com` domain; workspace-dedicated domains are a `DASHSCOPE_BASE_URL` override.
- Registry & credentials (`src/features/enhanced-frame/registry.ts`): a production adapter registers ONLY when its credential (`ARK_API_KEY` / `DASHSCOPE_API_KEY`) is present and non-blank — the switch can never route an unauthenticated request. Selecting a production provider without its credential answers a structured `503 provider_credentials_missing`; `501 provider_adapter_not_implemented` remains only as the defensive case of a credentialed provider lacking a registered adapter.
- Contract tests (`tests/unit/{seedream,wanxiang}-adapter.test.ts`, `image-adapter-registry.test.ts`, `enhanced-frame-server.test.ts`): the `fetch` and `sleep` dependencies are fully faked, so the suite pins each adapter's request shape (URL, auth header, body fields, image ordering, decoded content correspondence), response-Zod enforcement, the single-submission/cancellation policy (fake timers: no resubmission after the budget expires, in-flight fetch aborted, cancelled backoff never re-POSTs, the Wan download under the same budget, timers cleaned up) and the provider total-image boundaries — with zero network and zero cost. Provider-side behavior on real infrastructure remains deliberately untested until the developer authorizes live calls.

## Rendering and export

- Render composition frames from the camera view at the selected aspect ratio.
- Produce start/end movement frames from explicit poses, not screenshots of UI chrome.
- Use deterministic filenames from the `ShotState` ID.
- Build a manifest containing template, schema and adapter versions plus hashes where practical.
- Enhanced first-frame generation is optional; a failed provider call must not block raw export.
- Prompt 5 (Day 5) raw export contract: a five-file STORE-only ZIP (`shot-state.json`, `composition-raw.png`, `movement-start.png`, `movement-end.png`, `manifest.json`) built from one validated `ShotState` snapshot; PNG rasters use a 1280 px long edge at the selected aspect ratio (dpr 1); the manifest is versioned (`manifestVersion`), SHA-256-covers the other four files, and the archive is byte-deterministic for one snapshot plus one generation timestamp. Implemented with a small in-repo ZIP writer instead of JSZip to keep the dependency tree unchanged; the unit suite cross-checks CRC-32 against `node:zlib.crc32`.
- The raw-export manifest has an executable strict Zod schema (`rawExportManifestSchema` in `src/domain/artifacts.ts`); the TypeScript type is derived from it, the package builder validates the manifest against it before wrapping the archive, and the browser test re-validates the manifest extracted from the actual download. The schema rejects unknown fields, wrong kinds/versions, malformed ISO-8601-Z timestamps, non-64-hex digests, non-integer byte counts, and any files list that is not exactly the four hashed artifacts. Determinism conditions: the full ZIP is byte-identical only for the SAME snapshot, SAME image bytes and SAME generation timestamp (unit-proven); two real-time exports of one session differ legitimately in `manifest.generatedAt` and the archive's DOS timestamp fields and nowhere else.
- PNG capture gating (fix round): a capture is authorized only by a stage snapshot matching the COMPLETE pose — position, orientation (world direction), field of view — plus the exact export raster size (`src/features/export-package/capture-readiness.ts`); identical poses (static movement) capture immediately without waiting for a change.

## Security and cost controls

- Provider credentials remain server-side in environment variables.
- Client logs must not contain secrets or complete provider responses by default.
- Limit upload type, dimensions and size.
- No paid API call occurs automatically when moving a slider.
- Display an explicit generate action and estimated/known cost when provider information permits.
- Default development and CI use mocks.

## Testing strategy

### Unit

- YAML/Schema validation.
- Template-to-`ShotState` conversion.
- Semantic commands and safe ranges.
- Movement interpolation.
- Normalized prompt semantics.
- Adapter snapshots using model-independent fixtures.
- Export manifest consistency.

### Browser

- Load template -> simple adjustment -> open 3D -> preview movement -> render guides -> compile prompt -> download package.
- Verify no account or database dependency.
- Verify provider failure still allows raw export.

### Visual

- Fixed browser viewport and deterministic 3D fixtures.
- Screenshot baselines for the director stage and camera view.
- Director review for content correctness is separate from rendering regression tests.
