# Two-Week MVP Execution Plan

Last updated: 2026-09-05

## Commitment and interpretation

The target is a usable MVP validation build within two elapsed weeks, planned as ten working days. The exact calendar is flexible. AI execution capacity is considered high, but the definition of done, review gates and MVP scope are not relaxed.

This is an AI-first implementation plan:

- zcode/OpenCode with `zai/glm-5.3` is the primary bounded-task implementer;
- a new Codex task independently reviews diffs, runs acceptance checks and records evidence;
- the developer/user controls task order, credentials and final acceptance;
- the project initiator/director supplies knowledge decisions and approves rendered templates.

Only one implementation agent writes a worktree at a time. Fast generation does not justify overlapping edits to the same files or skipping tests.

## Delivery definition

By the end of Day 10, the repository should provide a desktop-Chrome Web application in which a user can:

1. choose one of the three engineering-ready dialogue examples in a clearly non-approved development gallery;
2. create a canonical `ShotState` and make novice-friendly composition adjustments;
3. optionally refine the constrained room, two mannequins and one camera in 3D;
4. define and preview one movement start and end pose;
5. render current/start/end guide PNGs;
6. inspect a deterministic generic prompt and one versioned target-model prompt or explicitly labeled spike adapter;
7. optionally call one image adapter if the provider spike and credentials are ready, otherwise use the deterministic mock;
8. download a coherent package with state, manifest, images and prompts sharing one state ID.

The delivery does not include Director approval, production provider credentials or successful target-user validation unless those external inputs arrive during the window.

## Ten-day schedule

| Day | Implementation packet | Required evidence at day end | Related prompt |
|---:|---|---|---|
| 1 | Establish reviewed Git baseline; scaffold Next.js/TypeScript; add lint, formatting, Vitest and Playwright; mock adapters | clean install/build/lint/test commands; no external API call | Prompt 1 |
| 2 | Implement Zod domain schemas, strict YAML validation, compiled content and template-to-`ShotState` creation | invalid fixtures fail; three current YAML files validate; gallery loader excludes non-approved content by default | Prompt 2 |
| 3 | Build static React Three Fiber room, mannequins, shot camera, director/camera views and visible camera frustum | deterministic screenshot for each view; camera FOV follows documented film-gate convention | Prompt 3 |
| 4 | Add visual template gallery, simple semantic controls, optional constrained 3D refinement, reset and local persistence | unit tests for semantic commands; browser path from selection to changed preview | Prompt 4 |
| 5 | Add start/end tween preview, raw PNG capture, `ShotState`/manifest export and raw ZIP | complete no-provider browser test; M1 raw-export vertical slice | Prompt 5 |
| 6 | Normalize semantics and compile deterministic generic prompt; add mock/generic `VideoPromptAdapter` | prompt snapshots; tests proving geometry/identity/movement facts cannot be changed | Prompt 6 |
| 7 | Run current provider/model spike using official sources; select or explicitly defer one image adapter and target prompt adapter | dated decision record with model/version/input types/cost/access facts; no credit spent without approval | Prompt 7 spike |
| 8 | Implement exactly one server-side image adapter if selected and credentialed; otherwise finish mock path and failure handling | contract tests with mocks; raw export remains usable after provider failure | Prompt 7 adapter |
| 9 | Complete coherent export package, first-use copy, safe-range warnings, visual baselines and full desktop-Chrome flow | unit/integration/browser/visual suite; artifact IDs and versions agree | Prompt 8 |
| 10 | Fix only release blockers, run clean acceptance, package Director review views and write release/readiness report | reproducible validation build; known limitations and deferred items documented | Prompt 8 acceptance |

## Critical path and external gates

### Does not block Day 1-5

- 50mm-versus-75mm archive conflict: RESOLVED 2026-09-10 (D025) — both OTS templates execute at 75mm from template v2 and remain `engineering_ready`; the archive itself stays quarantined;
- production image provider choice: use the mock;
- final target video model: produce generic prompt output and keep provider adapter explicitly provisional;
- Director approval: development gallery may expose fixtures only behind a development label/flag.

### Blocks claims, not core engineering

- no Director confirmation means no template may become `approved`;
- no provider spike means no production-provider support claim;
- no credential means no live enhanced-frame demo;
- no target-user baseline means no 30% improvement claim;
- unresolved reference rights means no public asset-release claim.

## Acceptance gates

Each work packet is complete only when:

- the implementer states the scoped plan and changed files;
- the diff stays within one prompt/task boundary;
- deterministic tests are added for behavior changes;
- no test uses paid provider credits;
- Codex independently reviews the diff and reruns relevant checks;
- failures and skipped checks are recorded, not reframed as passes;
- decisions or data-shape changes update the relevant docs;
- the next prompt does not start until the current packet is accepted.

Day 5 and Day 10 are hard integration checkpoints. If earlier packets slip, reduce polish or keep providers mocked; do not remove canonical-state/export correctness or expand the calendar by silently expanding scope.

## Fallback delivery if external inputs are late

The minimum defensible two-week build is the deterministic no-provider vertical slice plus generic prompt compiler:

- three non-approved development fixtures;
- constrained Web 3D editing and movement preview;
- raw current/start/end guides;
- canonical state and manifest export;
- mock enhanced frame and generic/mock prompt adapter;
- clear warnings that Director approval and production provider support are pending.

This fallback is still an MVP of the input-design workflow. It must not be padded with video generation, accounts, teams, payments or a node workflow.

## After the two-week code delivery

Target-user validation remains a separate elapsed-time activity. Observe 3–5 real users, collect their baseline time and paid-attempt count, then run Prompt 9. Only those results determine whether the product improves outcomes and should continue.

