# MVP Implementation Plan

## Planning basis

- One developer directing an AI-first workflow: zcode/OpenCode/GLM implements bounded packets and Codex independently reviews acceptance.
- Desktop Chrome web application.
- Documentation and content fixtures exist before application scaffold.
- Project initiator supplies and reviews director content.
- Paid provider calls are gated and mocked during normal development.
- Target code-delivery window: two elapsed weeks / ten working days, with flexible calendar timing.

The day-by-day execution order and fallback delivery are in `docs/TWO_WEEK_EXECUTION_PLAN.md`. Unknown provider behavior and Director-content readiness are explicit claim/approval gates; they do not block the deterministic no-provider vertical slice.

## Phase 0 - Content and technical gates (engineering prework complete; external review continues in parallel)

Current state: Prompt 0 and the first three CSV-to-YAML engineering mappings are complete. `aigc_project.rar` has been audited as a divergent Python prototype; use only the selective-port process in `docs/AIGC_PROJECT_INTEGRATION.md`.

### 0.1 Content handoff

- Send and review the self-contained `handoff/director/` packet with the project initiator.
- Obtain exactly 3 complete two-person-dialogue templates for the first mapping/review loop; target 8-12 before validation.
- Confirm reference-image rights notes.
- Map the director's natural-language descriptions to explicit 3D parameters; do not require the director to provide coordinates.
- Mark all current engineering examples as unapproved.

### 0.2 Provider spike

- Compare 2-3 image providers on one fixed composition.
- Confirm one target external video model/version used by pilot users.
- Decide whether movement guide video export has measurable value.
- Record provider selection and adapter constraints.

### Engineering-start criteria

- At least 3 `engineering_ready` templates are representable by the Schema.
- One generic prompt fixture exists.
- Provider adapter boundaries are documented; production provider selection may remain mocked/feature-flagged.

These criteria are met. Director approval, independent asset-rights review and production provider selection remain required before the corresponding public claims or live integrations.

## Phase 1 - Deterministic vertical slice (Days 1-5)

### Day 1: Scaffold and quality gates

- Establish a reviewed initial Git baseline; the repository currently has no commits.
- Scaffold Next.js/TypeScript application.
- Add unit/browser test foundations, linting and formatting.
- Add content validation command.
- Implement mock provider adapters.

### Day 2: Domain and content compiler

- Implement `ShotTemplate` and `ShotState` schemas.
- Compile YAML templates to typed data.
- Reject unapproved templates from production gallery builds.
- Add fixture and validation tests.

### Day 3: Static 3D stage

- Load generic room, two mannequins and one camera.
- Render director and camera views.
- Load one template into deterministic transforms.
- Add screenshot baseline.

### Day 4: Controls and state

- Implement template gallery and selection.
- Add simple semantic controls.
- Add optional constrained transform controls.
- Persist session locally.

### Day 5: Movement and raw export

- Implement start/end camera poses and tween preview.
- Render composition/start/end PNGs.
- Export `ShotState` and manifest.
- Complete a template-to-raw-export browser test.

### Exit criteria

A user can select a template, adjust it, preview movement and download a deterministic raw package without any AI provider.

## Phase 2 - Input compilation and enhanced frame (Days 6-8)

### 2.1 Prompt compiler

- Normalize shot semantics.
- Implement generic deterministic compiler.
- Implement one versioned video-model prompt adapter or a clearly labeled spike adapter.
- Add constrained LLM polish only after deterministic output works.

### 2.2 Image adapter

- Implement server-side provider boundary.
- Upload/use raw composition plus optional 2D character/style references.
- Make generation explicit and failure-tolerant.
- Store provider settings in artifact metadata.

### 2.3 Export package

- Bundle raw images, optional enhanced image, prompts, shot state and manifest.
- Verify every artifact references the same state/template/adapter versions.

### Exit criteria

One complete input package can be used manually on the selected external video platform.

## Phase 3 - Product polish and validation preparation (Days 9-10)

- Improve first-use explanation and progressive disclosure.
- Add plain-language control labels supplied/reviewed by the director.
- Add safe-range warnings and reset-to-template.
- Test on target desktop viewport/browser.
- Add validation-event capture or a manual observation worksheet.
- Run internal rehearsal before target-user sessions.

## Phase 4 - Target-user validation (after the two-week code delivery; approximately 1 week elapsed)

- Observe 3-5 target users.
- Compare baseline and MVP workflow.
- Fix only blockers inside existing scope during the validation window.
- Produce a go/iterate/stop report.

## Milestones

| Milestone | Demonstrable result |
|---|---|
| M0 | Content Schema and provider-spike record |
| M1 | Deterministic template-to-raw-export vertical slice |
| M2 | Complete first-frame/prompt input package |
| M3 | Usable validation build |
| M4 | Evidence-based continuation decision |

## Major risks

| Risk | Early test | Mitigation |
|---|---|---|
| 3D render does not survive AI enhancement | Same fixture across providers | Choose one composition-preserving adapter; always export raw guide |
| Director content arrives late or cannot map to schema | Process 3 templates before scaffold completion | Treat content as a gate; do not invent approved knowledge |
| Users avoid 3D controls | Usability test simple layer first | Keep 3D optional and preserve semantic controls |
| Prompt adapter becomes model-specific folklore | Versioned fixtures and output comparisons | Isolate adapters; record evidence and model version |
| Scope expands toward Blender/LibTV | Review `MVP_SCOPE.md` in every task | Require decision-log update for additions |
| Provider API cost or instability blocks work | Mock-first vertical slice | Raw export remains useful without provider |

## Documentation and external gates

- [x] Product definition.
- [x] Scope and non-goals.
- [x] Architecture and state ownership.
- [x] Content format and intake path.
- [x] End-user/content/validation workflows.
- [x] Project initiator completed the v2 intake for the first three templates.
- [ ] Project initiator reviews the Web-generated 3D/camera/start/end previews and approves named template versions.
- [ ] Provider-spike candidates are named.
- [x] Expected code-delivery window is two elapsed weeks with flexible timing.
- [ ] Expense approval/reimbursement mechanics and post-delivery maintenance expectations are written down if needed for operations.
