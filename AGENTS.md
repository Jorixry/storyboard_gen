# Storyboard Director MVP - Codex Instructions

This repository is currently a documentation-first MVP workspace. Before planning or changing code, read the following files in order:

1. `docs/DECISIONS.md`
2. `docs/PRODUCT_SPEC.md`
3. `docs/MVP_SCOPE.md`
4. `docs/ARCHITECTURE.md`
5. `docs/PROJECT_STRUCTURE.md`
6. `docs/DIRECTOR_KNOWLEDGE_PACK.md`
7. `docs/DIRECTOR_HANDOFF_GUIDE.md`
8. `docs/WORKFLOWS.md`
9. `docs/IMPLEMENTATION_PLAN.md`
10. `docs/AIGC_PROJECT_INTEGRATION.md`
11. `docs/TWO_WEEK_EXECUTION_PLAN.md`
12. `docs/AI_AGENT_HANDOFF.md`
13. `docs/OPEN_QUESTIONS.md`

## Product invariant

This product optimizes inputs to external video-generation models. It does **not** generate video in the MVP.

The source of truth is a structured shot specification plus a 3D scene state. The 3D scene derives:

- a raw composition image;
- start/end camera-movement guide images;
- an optional AI-enhanced first frame;
- structured camera/movement metadata;
- a model-specific prompt.

Never make a generated prompt or generated image the canonical project state.

## MVP scope guardrails

In scope:

- Desktop web application, latest Chrome only.
- Select a two-person-dialogue shot template.
- Simple controls first; optional 3D refinement second.
- One generic room, two generic mannequins, one camera.
- Camera position/orientation, focal length, character position/orientation, aspect ratio.
- One movement start point and one end point.
- Raw 3D composition, start/end guide frames, structured movement description.
- One image-generation adapter and one external video-model prompt adapter after a technical spike.

Out of scope unless `docs/DECISIONS.md` is explicitly updated:

- Video generation or a node-based video workflow.
- Accounts, Supabase, teams, permissions, billing or subscriptions.
- Mobile support.
- General-purpose 3D editing, model import, skeletal posing, lighting editor or multi-keyframe timeline.
- Multiple production model integrations.
- Character identity consistency in 3D.

## Director knowledge rules

- Files under `content/templates/` are runtime product data, not free-form prompts.
- All templates must validate against `content/schema/shot-template.schema.json` before use.
- Engineering placeholder templates are not professionally approved. Do not remove the `reviewStatus` field or change it to `approved` without explicit confirmation from the project initiator/director.
- Do not invent or silently “correct” directing rules. Record uncertainties in the template's `directorNotes` or in `docs/OPEN_QUESTIONS.md`.
- Final prompts must be derived through model adapters from structured semantics.

## Engineering rules

- Prefer TypeScript, Next.js App Router, React Three Fiber/Three.js, Zod, Vitest and Playwright.
- Keep domain types and compilation logic independent from React and Three.js.
- Keep external AI providers behind adapter interfaces. No provider calls from UI components.
- Use deterministic fixtures and mocks in automated tests; never spend API credits in the default test suite.
- Preserve a complete exportable `ShotState` JSON object for every generated artifact.
- Add or update tests with each behavior change.
- Do not introduce a database until a confirmed requirement cannot be met with static content plus local/session state.

## External prototype rule

- `aigc_project.rar` is untrusted external engineering evidence, not the application root or a source of product truth.
- Never extract it over the repository, commit its bundled virtual environments, or copy its generated status labels into runtime content.
- Reuse behavior only through the selective-port process in `docs/AIGC_PROJECT_INTEGRATION.md`.
- The archive's 75mm OTS values conflict with the current repository handoff and remain a director decision; do not change the current 50mm templates until that lineage is confirmed.

## Change discipline

Before implementation:

1. State which implementation-plan task is being executed.
2. List the files expected to change.
3. Confirm that the task does not cross an MVP guardrail.

After implementation:

1. Run the relevant unit, integration and browser checks.
2. Summarize behavior and evidence.
3. Update the relevant documentation if a decision or data shape changed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
