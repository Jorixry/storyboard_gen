# AI Agent Handoff

Last updated: 2026-10-08

## Current handoff baseline

- OTS pair flipped to approved per the 2026-10-11 written approval (branch `1.0`, 2026-10-12, D031): `dialogue_ots_a_to_b@v3` and `dialogue_ots_b_to_a@v3` are now `reviewStatus: approved`; the director's written approval is archived verbatim at docs/approvals/2026-10-11-ots-v3-written-approval.md (scope limits binding: geometry/blocking/composition only). Medium v2 is NOT covered and stays engineering_ready. Consequences in the same packet: production loader returns the pair (gallery count 0 → 2); development include lists widened to `[engineering_ready, approved]` (studio gallery, /director fixture, app store) so approved content stays visible in dev while the production boundary stays loader-side; adapters no longer emit the not-approved warning for the OTS pair and their prompts drop the NOT-professionally-verified clause (goldens regenerated — OTS ×4 changed, medium ×2 byte-identical); per-template approval labels in the gallery and /director badge replace the blanket "not director approved" copy; two visual baselines regenerated (director-stage director view, studio gallery), others within tolerance. Unit suite grew to 472 (new engineering-status warning tests + loader boundary cases). Full suite green: 472 unit + 47 browser, build/TPES clean. Local commit awaiting developer review before push.
- Medium two-shot v2 chest-up reframe (branch `1.0`, 2026-10-12, D030): following the director's 2026-10-11 written-approval round (OTS v3 ×2 APPROVED in writing — content flip pending as its own packet; medium v1 RETURNED as too loose), tech proved a chest crop at blocking ±0.8 geometrically impossible in 16:9 (fixed 1.778 half-width/bottom-drop ratio; v1's actual crop measured at ~0.57 m — shin level), rendered four real stage previews (v1 / A camera-forward waist crop / B-50 / B-35, via a temporary Playwright render in tmp/medium-v2-preview/), and the director picked B with focal kept at 35mm. v2: characters ±0.5 (blocking change approved by D030), camera `[0, 1.62, 1.5]`, target `[0, 1.68, 0]`; copy + acceptance line 1 + composition token waist_up_framing→chest_up_framing synced; shotSize stays medium_two_shot. Cascade: medium golden fixtures regenerated (OTS four byte-identical), medium-derived unit expectations (makeFarther/emphasize/overlap/degenerate-target/version) and e2e constants updated; no visual baseline needed regeneration (gallery v1→v2 text within the 1% tolerance; OTS stagePane/director-stage baselines unaffected). Full suite green: 469 unit + 47 browser, build/TPES clean. v2 remains engineering_ready pending 3D re-review → written approval. Local commit awaiting developer review before push.
- Director 3D review round 1 + OTS v3 camera reposition (branch `1.0`, 2026-10-08, D029): after the Prompt 8 review session the director delivered geometry conclusions — both OTS templates repositioned per his calibration image (a_to_b camera `[-2.15, 1.45, 0.8]` target `[0.85, 1.55, -0.2]`, b_to_a mirrored; focal stays 75mm, blocking unchanged, dolly displacement vector preserved, templates v2→v3); medium two-shot geometry approved; focal range 12–200mm + simple-control copy confirmed; reference-image rights confirmed (director's own AI-generated originals); ~50–70 templates of content ready for later delivery (capacity note). Blocking/movement refinement is deferred director intent. Cascade updated in the same packet: golden prompt fixtures regenerated (medium byte-identical), template-derived unit expectations (versions, coordinates, NDC framing ground truth — the v3 pose now places the OTS foreground shoulder INSIDE the left frame edge), e2e constants/footer strings, and the five affected visual baselines (director-stage ×3, studio stagePane ×2). Full suite green: 469 unit + 47 browser, build/TPES clean. Local commit awaiting developer review before push.
- Prompt 8 (full export package + validation-build finish, Days 9-10) implemented 2026-10-08 on branch `1.0` (developer option a, D028): the versioned `seedance_video` target-model prompt adapter (engineering-derived from the surveyed official prompt guidance; every output disclaims official Seedance support); `buildFullExportPackage` bundling shot-state + three raw rasters + both prompts + optional enhanced frame into a STORE-only ZIP with a strict manifestVersion-2 manifest (fullExportManifestSchema) whose EXECUTABLE same-source verification refuses prompts not compiled from the frozen state and excludes stale enhanced frames (fingerprint rule) with reason "stale"/"absent"; the enhanced-frame result moved to its own derived-artifact store (`enhanced-frame-store`) so the export reads it without touching canonical state; the three-pose capture stage extracted to `capture-stage.tsx` and shared by both exports; Phase 3 surfaces added (first-use onboarding steps in the empty state; visible safe-range clamp feedback in the advanced refinement). Zero real provider calls, zero cost; local commit awaiting developer review before push (per the commit-only workflow adopted 2026-09-22).
- Prompts 1–6 are implemented and accepted; the developer confirmed Prompt 6 acceptance and remote push on 2026-09-10.
- Prompt 7A (read-only image-provider spike) completed 2026-09-21: `docs/PROVIDER_SPIKE.md` compares Doubao-Seedream / Wan 2.7 / Gemini image APIs on official documentation; D027 records the developer's selection (Seedream primary + Wan 2.7 backup, single-active). Empirical composition testing is deferred under the no-credits decision.
- Prompt 7B1 (mock-path finish + failure handling, Day 8 fallback branch) implemented 2026-09-22: server route `/api/enhanced-frame` with the pure handler core, D027 single-active adapter selection (mock default), explicit-action UI with retryable failures that never block raw export, `.env.example` conventions, and `compile:content` now emitting `COMPILED_ADAPTER_CONFIGS` so the client compiles the Prompt 6 generic prompt from the validated config. The new panel is collapsed in the controls aside, which the studio visual baselines do not capture (they scope the gallery and stage pane), so no baseline changed. Zero provider calls, zero credentials, zero cost.
- Prompt 7B2 (production adapters) implemented 2026-09-22: `SeedreamImageGenerationAdapter` (Ark REST, D027 primary) and `WanxiangImageGenerationAdapter` (DashScope sync REST, backup) over one shared injectable HTTP core (timeout, bounded 429-only retry after the 2026-09-23 fix round, Zod response contracts; REST-over-SDK rationale in ARCHITECTURE). Registry registers a provider only when its credential exists; selecting a production provider without its key answers 503 `provider_credentials_missing`. All contract tests fake fetch/sleep — zero real provider calls, zero cost, credentials never committed. Verification wording (reconciled 2026-09-23, see D027 and docs/OPEN_QUESTIONS.md "verification-level ledger"): the 2026-09-22 "live-verified" notes cover PARTIAL real-call checks on Seedream only (endpoint, auth, model id `doubao-seedream-5-0-pro-260628`, explicit-size contract, success/error response shapes) — the first fully delivered Seedream image and the composition-preservation check remain pending, and Wan 2.7 has never been called live (documentation-verified only). Next packet: Prompt 8 (complete export package).
- Prompt 7 acceptance fix round (branch `1.0`, 2026-09-23, this packet): fixed the five blockers from the independent acceptance report `tmp/prompt7-review/ACCEPTANCE-2026-09-23.md`. (P1-1) Wan request body corrected to the official `input.messages[0].content` array — one `{image}` object per image plus one `{text}`, composition image LAST; adapter bumped to wanxiang@1.1.0 and `docs/PROVIDER_SPIKE.md` corrected. (P1-2) The shared HTTP core no longer auto-resubmits outcome-unknown generation requests: only 429 (explicit not-accepted) is retried; network failures, body-read failures, timeouts and 5xx surface as outcome-unknown errors whose 502 message warns that regenerating may incur an additional charge; the unsafe "failed attempts don't bill so retry is safe" rationale was deleted. (P1-3) One total generation budget (AbortController deadline) now propagates from the route core into adapters, the generation POST, response reads, backoff waits and the Wan result download; per-attempt budgets are capped by the remaining total; the 504 message says the local cancellation does not revoke a provider task or guarantee no charge. (P2-1) Enhanced-frame results keep the complete frozen `ShotState` snapshot (never written back to canonical state); staleness is decided by a full-state fingerprint (`shotStateFingerprint`, not the id alone); stale results are visibly marked 已过期 with their source; requests are sequenced against late responses. (P2-2) The route enforces the selected provider's verified input-image TOTAL (wanxiang: 1 composition + character references + optional style ≤ 9, structured 400 `too_many_input_images` before any adapter call; no invented limit for seedream/mock). Production adapters bumped to @1.1.0; mock unchanged at 1.0.0. Also: provider URLs must be http(s) public hosts (loopback/private/reserved refused), and `tmp/` was excluded from tsconfig/eslint so ignored local review copies cannot break root checks. Zero real provider calls, zero credits, no credentials read or written. Evidence: 433 unit tests (baseline 398), full browser suite and build results in the packet delivery report.
- Prompt 7 acceptance fix round 2 (branch `1.0`, 2026-10-02, independently ACCEPTED by Codex on 2026-10-02 after the third review: 450 unit tests, 43 browser tests and the four independent regression probes passed; merge handoff and collaborator checklist: docs/PROMPT7_ACCEPTANCE.md): fixed the two residual issues from the second-round acceptance report (`tmp/prompt7-round2/`). (R2-1) The outcome-unknown classification now covers EVERY submitted-but-unusable path, not only network/5xx: per-attempt timeouts (`ProviderTimeoutError` — message mirrors the total-budget 504 wording: aborted locally, does not cancel any provider task, does not guarantee no charge), accepted 2xx responses that fail JSON parsing or the Zod contract (`ProviderResponseContractError`, message notes the request was accepted and may have been billed), and a new delivered-result class (`ProviderResultDeliveryError`) for a generation that succeeded but whose result could not be delivered — Wan plain-URL download failures/refusals and undecodable image payloads (502 message: the generation was accepted but delivering its result failed; regenerating may incur an additional charge). Definite pre-submission failures (input errors, refused generation URL, missing credentials, 4xx) keep the plain message; the single shared predicate is `isProviderOutcomeUnknown` in provider-http.ts. (R2-2) The outbound-URL check is now a real literal classifier: `net.isIP` separates DNS names from IPv4/IPv6 BEFORE any range rule, so ordinary DNS names starting with fd-/fc-/fe80 are no longer misread as private IPv6; IPv6 literals are parsed into groups so the URL-normalized IPv4-mapped form (`[::ffff:7f00:1]`), the dotted form, the deprecated IPv4-compatible form and the NAT64 prefix `64:ff9b::/96` are all judged by their embedded IPv4 and cannot smuggle loopback/private targets past the check, while mapped/NAT64 public addresses stay allowed. Docs now describe this as LITERAL validation, explicitly not a complete SSRF defense (no DNS resolution; fetch follows redirects). Regression source: the reviewer's four probes in `tmp/prompt7-round2/review.test.ts` were folded into the formal suite (`tests/unit/provider-http-url.test.ts` plus new cases in the adapter/handler tests). Zero real provider calls, zero credits, no credentials read or written.
- D025 sets both OTS templates to v2 at 75mm for current/start/end and `focal_75mm` semantics. The medium two-shot stays v1 at 35mm. All remain `engineering_ready`; camera positions, targets, blocking and reference images are unchanged. (Superseded by the D029 v3 camera reposition, 2026-10-08 — see the first baseline bullet.)
- Paid calls still require explicit per-call authorization from the developer; real provider behavior (Seedance D026 account-level checks; Seedream first delivered image + composition check; Wan 2.7 first live call) remains unverified until then.
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
