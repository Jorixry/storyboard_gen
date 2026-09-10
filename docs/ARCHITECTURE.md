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
