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
src/app/api/               Server-side adapter routes (enhanced-frame)
tests/                     Deterministic fixtures, unit and browser tests
.env.example               Documented names of server-side settings (no secrets)
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

### `enhanced-frame`

- Optional enhanced first frame (Prompt 7B1): collapsed-by-default explicit action.
- Capture the raw guide frame (current pose) through the raw-export readiness gate.
- Compile the deterministic generic prompt (Prompt 6 pipeline) from the same frozen state.
- POST to the server-side `/api/enhanced-frame` route; exactly one adapter active per D027 (deterministic mock by default until Prompt 7B2).
- Failure is a local, retryable message; raw export is never blocked.

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
