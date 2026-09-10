# AI Agent Handoff

Last updated: 2026-09-11

## Current handoff baseline

- Prompts 1–6 are implemented and accepted; the developer confirmed Prompt 6 acceptance and remote push on 2026-09-10.
- D025 sets both OTS templates to v2 at 75mm for current/start/end and `focal_75mm` semantics. The medium two-shot stays v1 at 35mm. All remain `engineering_ready`; camera positions, targets, blocking and reference images are unchanged.
- The next implementation packet is Prompt 7's read-only provider spike. Paid calls still require explicit authorization; production provider/model support remains unconfirmed.
- The start state and Prompt 1 instructions below are retained as historical onboarding records, not instructions to restart the project.

### Branch reconciliation (2026-09-11)

- Keep accepted main commit `28a5098` as the Prompt 6 implementation baseline. The parallel implementation at `feature/acceptance-test` commit `335efd1` shares parent `38eb4a8` but is not merged into main. Do not add its second normalized-spec/compiler path or revert OTS templates to v1.
- Retain the collaborator branch for reference. Its Vitest major upgrade is deferred to a separate dependency-maintenance packet with advisory/version verification and main's tests; no dependency upgrade is included in this baseline reconciliation.
- Adopt the developer's provisional Seedance v2.0 Pro selection as D026; verify the official model identity and capabilities during Prompt 7 before claiming support. Image-provider selection and paid-call authorization remain separate gates.
- Baseline revision checks: 349 unit tests and 17 director-stage/raw-export browser tests passed, including the existing 75mm visual baselines; content validation, lint, TypeScript, build, changed-file formatting and diff whitespace checks passed. Local tool entry points were used because the npm wrapper failed; content validation and browser launch needed execution outside the sandbox. No paid provider calls were made. These checks validate main, not the collaborator branch.

## Historical start state (2026-09-05)

- Prompt 0 readiness audit is complete.
- Three Director-v2 rows have been mapped to Schema-valid YAML with `reviewStatus: engineering_ready`.
- The combined OTS follow-up image was split into A-to-B and B-to-A runtime reference images.
- A generic prompt fixture and engineering camera convention exist.
- Application code has **not** been scaffolded.
- The Git repository has **no commits yet**. Review the initial documentation/content set and establish a baseline commit before parallel collaboration.
- `aigc_project.rar` has been audited but not merged. Read `docs/AIGC_PROJECT_INTEGRATION.md`; do not extract it over the repository.
- The next implementation packet is Prompt 1, not a repeat of Prompt 0.

## Roles

### zcode / OpenCode / GLM

Primary implementation writer. Execute one prompt from `docs/CODEX_PROMPTS.md` at a time, modify only the declared files, and return commands/results with the diff.

Use `zai/glm-5.3` with `high` for bounded implementation by default. In earlier work, `max` was useful for read-only architecture/audit reasoning but repeatedly stalled during tool-driven file editing; `high` completed structured implementation output more reliably. Use `max` for a difficult read-only design review, not by default for routine writes. Model effort never substitutes for tests.

### Codex acceptance task

Independent reviewer and release gate. Do not merely accept the implementer's summary. Inspect the actual diff, rerun checks, test negative cases, inspect browser/visual output and compare behavior with the required docs. Fix code only when the user explicitly assigns implementation; otherwise return findings and a pass/fail decision.

### Developer/user

Owns task ordering, credentials, provider spend, conflict resolution and final acceptance. Keeps one writer active per worktree and decides when an accepted packet is committed.

### Project initiator/director

Owns Director knowledge decisions and professional approval. Required next answers are listed in `docs/OPEN_QUESTIONS.md`. Only the Director can advance templates to `approved`.

## Safe context sent to zcode

For each task, send only the minimum allowlist:

- `AGENTS.md`;
- required documents named by that prompt, including the integration and two-week plans when relevant;
- `content/schema/`, relevant templates/rules/adapters and runtime reference images;
- relevant source, configuration and tests created by earlier accepted prompts;
- the exact task prompt and latest acceptance findings.

Never send or read for transmission:

- `.env*`, credentials, tokens or shell history;
- `.git/` configuration or object data;
- `aigc_project.rar`, its bundled virtual environments or ignored staging directories;
- unrelated personal files, editor state or raw handoff material not needed for the current task.

If a future provider task requires a credential, the human configures it locally/server-side. Do not paste the value into a prompt, log, fixture or chat.

## One-packet protocol

1. Create or select one clean branch/worktree from the last accepted baseline.
2. Read `AGENTS.md` and the prompt-specific documents.
3. State the implementation-plan task, expected changed files and MVP-boundary check.
4. Give zcode one bounded prompt; do not combine Prompt 1–8 into a single run.
5. Require zcode to run local deterministic checks and provide its actual diff.
6. Give the same commit/diff to the Codex acceptance task.
7. Codex checks implementation, negative tests, browser/visual evidence and documentation consistency.
8. If rejected, return only concrete findings to the same implementation task; do not start the next packet.
9. When accepted, record evidence and commit before moving on.

Do not have zcode and Codex edit the same working directory concurrently. Review can run in parallel only on an immutable commit or separate worktree.

## Historical first zcode prompt (Prompt 1)

Copy the following as the first new implementation task:

```text
Read AGENTS.md in full, then read docs/DECISIONS.md, docs/PRODUCT_SPEC.md,
docs/MVP_SCOPE.md, docs/ARCHITECTURE.md, docs/PROJECT_STRUCTURE.md,
docs/IMPLEMENTATION_PLAN.md, docs/AIGC_PROJECT_INTEGRATION.md,
docs/TWO_WEEK_EXECUTION_PLAN.md and docs/OPEN_QUESTIONS.md.

Execute only Prompt 1 / Phase 1 Day 1: scaffold the deterministic desktop-Chrome
Next.js TypeScript application and its quality gates.

Before editing, report:
1. the exact implementation-plan task;
2. expected files;
3. confirmation that no MVP guardrail is crossed;
4. current package versions selected from official package metadata.

Requirements:
- preserve every existing document, content file and reference image;
- do not extract or import aigc_project.rar;
- do not add Python as a production runtime;
- add lint/format, Vitest and Playwright foundations;
- add deterministic mock image and video-prompt adapter interfaces;
- add a placeholder content-validation command without duplicating content truth;
- no paid calls, credentials, accounts, database, video generation, mobile work,
  node workflow or general-purpose 3D editor;
- add/update tests for every behavior introduced.

After editing, run the relevant clean install/build/lint/unit/browser-foundation checks,
show exact results and stop. Do not start Prompt 2.
```

## Codex acceptance prompt for Prompt 1

```text
Act only as the acceptance reviewer for Prompt 1. Read AGENTS.md and the documents
required there, especially docs/AIGC_PROJECT_INTEGRATION.md and
docs/TWO_WEEK_EXECUTION_PLAN.md. Inspect the actual Git diff and working tree.

Verify:
- existing docs/content/reference images were preserved;
- the application is Next.js App Router + TypeScript and supports latest desktop Chrome;
- scripts for build, lint, unit tests, browser tests and content validation exist and run;
- mock adapters cannot make paid/provider calls;
- domain/provider boundaries are not implemented inside UI components;
- no Python runtime, archive contents, virtual environments, secrets, accounts,
  database, video generation or out-of-scope feature was added;
- dependency versions and lockfile are coherent;
- failures/skips are reported honestly.

Run the relevant checks independently. Return PASS or FAIL, findings ordered by
severity with exact file/line references, commands/evidence, and the smallest
required corrections. Do not implement Prompt 2.
```

## Subsequent packets

After Prompt 1 is accepted, continue with Prompts 2 through 8 in order and map them to `docs/TWO_WEEK_EXECUTION_PLAN.md`. The external Python prototype may inform Prompt 2/3 tests only through the selective-port matrix. Prompt 9 is reserved for real-user validation after the code-delivery window.

## Required handoff record after every packet

Record in the task summary or a dated project note:

- prompt number and commit/branch;
- files changed;
- commands run and pass/fail/skip counts;
- visual artifacts inspected;
- adapter/provider calls made and cost (normally zero);
- open questions or Director decisions created;
- acceptance verdict and reviewer.
