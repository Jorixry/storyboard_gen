# Project Structure and Module Boundaries

## Top-level map

```text
AGENTS.md                  Codex scope and implementation rules
README.md                  Human entry point
docs/                      Product, architecture, plans and prompts
content/                   Director-authored runtime knowledge
public/reference-images/   Approved visual shot examples
public/3d-assets/          Generic room/mannequin GLB assets
scripts/                   Content compilation and validation
src/domain/                Framework-independent canonical types/rules
src/content/               Compiled-content loader
src/features/              User-facing vertical features
src/adapters/              External image and prompt-provider boundaries
src/state/                 Canonical shot-state store
tests/                     Deterministic fixtures, unit and browser tests
```

Important engineering documents inside `docs/`:

- `AIGC_PROJECT_INTEGRATION.md`: external prototype inventory and selective-port boundary;
- `TWO_WEEK_EXECUTION_PLAN.md`: day-by-day delivery plan and fallback;
- `AI_AGENT_HANDOFF.md`: zcode writer/Codex reviewer protocol;
- `PHASE_0_READINESS.md`: current evidence and external gates.

`aigc_project.rar` and `tmp/` are ignored local review inputs. Neither is a runtime, build, test or content dependency. A future checkout must be able to build without them.

## Dependency direction

```text
content files
    -> content loader
        -> domain
            -> state
                -> features/UI

domain
    -> prompt adapter interfaces
    -> image adapter interfaces

features/UI must not define domain truth
provider adapters must not mutate canonical state
```

## Feature responsibilities

### `shot-library`

- Display approved template cards.
- Explain purpose in plain language.
- Load a template as a new shot state.

### `simple-controls`

- Convert novice-friendly choices into typed domain commands.
- Never append prompt strings directly.
- Enforce template safe ranges.

### `director-stage`

- Project the canonical state into Three.js objects.
- Support director and camera views.
- Write constrained transforms back to canonical state.

### `movement-preview`

- Maintain one start and one end camera pose.
- Preview deterministic interpolation.
- Capture start/end camera-view images.

### `first-frame`

- Render the raw guide frame.
- Collect optional 2D character/style references.
- Call one server-side image adapter explicitly.
- Preserve raw export when generation fails.

### `prompt-compiler`

- Normalize state into semantic facts.
- Apply director rules.
- Produce generic and target-model prompts.
- Report unsupported or conflicting facts.

### `export-package`

- Collect artifacts from the same shot state.
- Include IDs, template/schema/adapter versions and timestamps.
- Create a deterministic archive layout.

## Files that must remain human-editable

- `docs/DECISIONS.md`
- `docs/OPEN_QUESTIONS.md`
- `content/intake/*.csv`
- `content/templates/**/*.yaml`
- `content/rules/*.yaml`
- `content/adapters/*.yaml`

Generated TypeScript or JSON derived from content must not be edited manually.
