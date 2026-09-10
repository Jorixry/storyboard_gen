# Staged Codex Implementation Prompts

Use these prompts in order. Each prompt is intentionally bounded. Start a fresh task or explicitly tell Codex to execute only one stage. Codex must read `AGENTS.md` first.

Current sequence as of 2026-09-05: Prompt 0 and the initial CSV-to-YAML mapping are complete; start with Prompt 1. Use `docs/TWO_WEEK_EXECUTION_PLAN.md` for scheduling and `docs/AI_AGENT_HANDOFF.md` for the zcode/Codex implement-review protocol. Do not batch multiple prompts merely because AI execution time is available.

## Prompt 0 - Audit readiness without writing application code

```text
Read AGENTS.md and all documents in its required reading order. Audit whether the repository is ready for Phase 0 of docs/IMPLEMENTATION_PLAN.md.

Do not scaffold the application and do not install dependencies.

Check:
1. internal consistency between decisions, MVP scope, architecture and workflows;
2. whether the shot-template Schema can represent the placeholder YAML;
3. which director-supplied inputs are still blocking;
4. which model/provider facts require current official documentation or a technical spike;
5. whether any proposed task crosses an explicit non-goal.

Return a prioritized readiness report with exact file references and the smallest corrections needed.
```

## Prompt 1 - Scaffold the deterministic web application

```text
Read AGENTS.md, docs/DECISIONS.md, docs/MVP_SCOPE.md, docs/ARCHITECTURE.md, docs/PROJECT_STRUCTURE.md, docs/AIGC_PROJECT_INTEGRATION.md and docs/TWO_WEEK_EXECUTION_PLAN.md.

Execute only Phase 1 Day 1 from docs/IMPLEMENTATION_PLAN.md.

Create a desktop-Chrome Next.js TypeScript application with the chosen current stable package versions. Add linting, formatting, Vitest and Playwright foundations. Add placeholder scripts for content validation. Implement deterministic mock image and video-prompt adapters; do not call any paid API.

Do not add authentication, Supabase, billing, mobile-specific UI, video generation or a general-purpose 3D editor.

Do not extract/import `aigc_project.rar` or add Python as a production runtime. Preserve all existing documents, content and reference images.

Before editing, list the expected files. After editing, run the relevant checks, report exact evidence, and stop. Do not continue to later implementation-plan days.
```

## Prompt 2 - Implement domain schemas and content compilation

```text
Read AGENTS.md, docs/DIRECTOR_KNOWLEDGE_PACK.md, docs/ARCHITECTURE.md and the files under content/.

Execute only Phase 1 Day 2 from docs/IMPLEMENTATION_PLAN.md.

Implement framework-independent TypeScript/Zod schemas for ShotTemplate and ShotState. Build scripts that validate YAML templates and compile them into typed application data. Ensure production-facing template loading excludes every reviewStatus except approved, while tests may load engineering placeholders explicitly.

Use the D025-confirmed 75mm OTS baseline (template v2): current camera, movement start/end and focal_75mm semantics must agree. Keep the medium two-shot at 35mm. This confirmation covers focal length only; preserve the existing camera positions, targets, blocking, reference images and engineering_ready status. The archive remains quarantined.

Add tests proving:
- the placeholder YAML is structurally valid;
- malformed vectors, focal lengths, duplicate/missing character IDs and unknown rule IDs fail;
- template versions and review status are preserved;
- loading a template creates a new canonical ShotState ID.

Do not implement React UI or Three.js. Run all checks and stop.
```

## Prompt 3 - Build the static 3D director stage

```text
Read AGENTS.md, docs/ARCHITECTURE.md, docs/MVP_SCOPE.md and the existing domain/content code.

Execute only Phase 1 Day 3 from docs/IMPLEMENTATION_PLAN.md.

Use React Three Fiber/Three.js to render one generic room, two generic mannequins and one camera from canonical ShotState data. Provide a director view and camera view. Load the engineering placeholder template only in a clearly labeled development fixture.

The Three.js scene must be a projection of ShotState, not an independent source of truth. Do not add asset import, skeleton posing, materials editing, lighting controls, accounts or provider integrations.

Add deterministic visual/browser evidence for the fixed fixture. Run checks and stop.
```

## Prompt 4 - Add template gallery and progressive controls

```text
Read AGENTS.md, docs/PRODUCT_SPEC.md, docs/WORKFLOWS.md and the existing implementation.

Execute only Phase 1 Day 4 from docs/IMPLEMENTATION_PLAN.md.

Implement the visual template-selection flow and novice-friendly semantic controls. Keep the optional 3D refinement behind progressive disclosure. Commands such as closer/farther or emphasize A/B must update typed ShotState fields, never prompt strings.

Add constrained direct transforms for camera position/orientation, focal length and character position/orientation. Add aspect-ratio selection, reset-to-template and local session persistence.

Use clear development labels for unapproved placeholder content. Add unit and browser tests, run checks and stop.
```

## Prompt 5 - Implement movement preview and raw export

```text
Read AGENTS.md, docs/MVP_SCOPE.md, docs/ARCHITECTURE.md and docs/WORKFLOWS.md.

Execute only Phase 1 Day 5 from docs/IMPLEMENTATION_PLAN.md.

Implement one camera movement start pose and one end pose with deterministic interpolation and preview. Render camera-view PNGs for current composition, movement start and movement end. Export ShotState JSON plus a versioned manifest in one downloadable archive.

Do not export AI video, add a multi-keyframe timeline or implement MP4/WebM capture. Add a browser test covering template selection through raw export. Run checks and stop.
```

## Prompt 6 - Implement prompt compilation with mocks first

```text
Read AGENTS.md, docs/ARCHITECTURE.md, docs/DIRECTOR_KNOWLEDGE_PACK.md, docs/WORKFLOWS.md and content/adapters/generic-video.yaml.

Implement the model-independent prompt pipeline from normalized ShotState semantics. Produce a deterministic generic prompt, warnings and adapter metadata. Implement the VideoPromptAdapter interface and one mock/generic adapter.

Do not claim Seedance or another provider is supported until its exact model/version and official/current input behavior have been verified and recorded in an architecture decision. Do not allow optional LLM polishing to change geometry, identities, movement or continuity facts.

Add snapshot and invariant tests. Run checks and stop before any production provider integration.
```

## Prompt 7 - Run the provider spike and implement one image adapter

```text
Read AGENTS.md, docs/OPEN_QUESTIONS.md and the provider-spike section of docs/WORKFLOWS.md.

First produce a read-only comparison of 2-3 currently available image-generation APIs using primary official documentation. Evaluate composition preservation, reference-image support, API availability, latency/cost information and regional constraints. Do not spend credits without explicit approval.

After the developer selects one candidate and supplies credentials through the approved secret mechanism, implement exactly one server-side ImageGenerationAdapter. Keep a deterministic mock as the default. Generation must be an explicit user action and provider failure must not block raw export.

Add contract tests with mocked responses, document the chosen provider/model version and stop.
```

## Prompt 8 - Complete the export package and validation build

```text
Read AGENTS.md and the definition of done in docs/MVP_SCOPE.md.

Complete only the remaining Phase 2 and Phase 3 tasks required for the agreed end-to-end validation build. Bundle raw images, optional enhanced first frame, generic prompt, one target-model prompt, ShotState and manifest. Verify every artifact points to the same state/template/adapter versions.

Run unit, integration, browser and visual checks. Perform the complete no-account desktop-Chrome workflow. Report remaining risks and validation blockers. Do not add accounts, billing, teams, video generation, mobile support or extra providers.
```

## Prompt 9 - Analyze validation results without scope creep

```text
Read AGENTS.md, docs/MVP_SCOPE.md and the validation workflow in docs/WORKFLOWS.md. Analyze the collected baseline and MVP results for 3-5 target users.

Report:
- completion without developer assistance;
- time-to-acceptable-result change;
- paid generation-attempt change;
- artifacts actually used;
- repeat blockers;
- evidence for go, iterate or stop.

Separate observed evidence from user opinion. Do not convert every request into roadmap scope. Flag any request that would turn the MVP into a general-purpose 3D editor or video-generation workflow.
```
