# `aigc_project.rar` Integration Review

Review date: 2026-09-05

## Decision

Do **not** extract this archive over the repository or adopt it as the Web application scaffold. Treat it as a quarantined Python proof of concept and selectively port useful behavior, tests and candidate camera values into the planned TypeScript domain and React Three Fiber implementation.

This decision preserves the current repository as product/content source of truth and prevents a divergent Director handoff, generated files and two bundled Python environments from silently replacing it.

## Provenance and inventory

- Archive: `aigc_project.rar`
- Size: 30,018,383 bytes
- SHA-256: `1D572E7177AE015EC0729E3FCC0A33BE77B16606646052FCF32039CCAA39C2BC`
- Archive entries: 4,120
- Unsafe absolute or parent-traversal paths found: 0
- Embedded Git repository entries: 0
- Filename-only secret scan: no `.env`, private key, credential or Git-config file found; only ordinary `certifi/cacert.pem` certificate bundles appeared.

The archive is mostly packaging noise:

| Area | Entry count | Disposition |
|---|---:|---|
| `.venv-1/` | 3,012 | Reject; never commit or reuse as a dependency source |
| `.venv/` | 1,004 | Reject; never commit or reuse as a dependency source |
| `shot-template-demo/` | 62 | Inspect and selectively port ideas |
| `director-handoff-return-v2 2/` | 24 | Divergent input; preserve as evidence, not canonical content |
| `director/` | 6 | Duplicates an older intake packet; do not merge |
| `docs/` | 5 | Superseded/contradictory planning notes; do not merge |
| `engineer-handoff/` | 4 | Use only as historical rationale |
| `.vscode/` | 2 | Reject editor-local files |

A selected copy was inspected under ignored staging path `tmp/aigc-project-review-20260905/`. The staging directory is disposable and is not a project dependency.

## What the useful part actually implements

`shot-template-demo/` is a Python 3.11+ engineering prototype, not a Web product. It contains:

- CSV completeness, ID and reference-image checks;
- a permissive intake-row JSON Schema;
- a derived JSON parameter layer for three dialogue templates;
- one room, two procedural mannequins and three fixed camera setups;
- a NumPy/Pillow software rasterizer for white-model previews;
- static or 0.30m dolly-in start/end poses;
- generated camera-view/director-view PNGs and screen-space statistics;
- `unittest` checks for template count, positions, focal length and selected framing proxies.

The included output report claims 13/13 automatic checks passed. This claim was not independently reproduced in a clean environment: six dependency-free tests passed, while two test modules failed to import because neither available clean Python runtime had `jsonschema`, `numpy` and `Pillow`. No dependency was downloaded and no packaged virtual environment was trusted or installed.

The generated PNGs were inspected. They prove a basic camera mapping can render, but they are not director-approval evidence: the director view does not show the shot camera or frustum, the mannequins are very coarse, and the OTS foreground metric does not measure the stated horizontal occupancy.

## Conflicts and defects to preserve as findings

1. **Director-input lineage conflict.** The current repository CSV has both OTS templates at 50mm and uses the newer split OTS pair. The archive CSV has both at 75mm and references `L4-4-srs-A/B.jpg`. Their SHA-256 values differ:
   - current: `AD61A3CEABC211938AA29A2553A1850F48A3A3763C11FB51713B461D3A4D3765`
   - archive: `1609074218D9E7F2C88FEF8DCC2B9FE1B8AB0FF7FB6B8FFB4DD6D46E792B39CB`
2. **The archive is behind the latest image correction.** It does not use `dialogue_ots_pair_combined.jpg` or the two current split images supplied after the earlier B-to-A mismatch.
3. **Data contradicts itself.** The derived JSON says top-level priority is `data`, while every template says `source_priority: prompt`.
4. **Notes are copied incorrectly.** The 35mm medium template says a historical 75mm value and prompt 50mm were retained even though neither statement describes that template.
5. **Lifecycle is incompatible.** `director_confirmed_execution` is not a valid `reviewStatus` in the current runtime Schema. No archive output may be converted to `approved` automatically.
6. **Coordinate systems conflict.** The archive puts A at positive X and cameras at negative Z; the current engineering convention puts A at negative X and the default camera on positive Z. Raw vectors cannot be copied without an explicit transform and visual verification.
7. **The archive intake Schema is not a runtime Schema.** It treats every field as a string and permits arbitrary extra properties. The current strict `content/schema/shot-template.schema.json` remains authoritative.
8. **One movement assertion is tautological.** `assertAlmostEqual(d_end, d_end)` cannot fail and does not test a dolly distance.
9. **One pair check is mislabeled.** “OTS pair share same focal length” compares start versus end inside one shot, not A-to-B versus B-to-A.
10. **Framing tolerance is weakened.** The stated OTS foreground range is 25%–33%, but the automatic test accepts 15%–40%. Its `pixel_share` is image area, not horizontal frame occupancy.
11. **The director view is insufficient.** It is the same overview for all templates and omits the camera/frustum, so it cannot support the required 3D mapping review.
12. **Dependency reproduction is weak.** Dependencies use broad minimum versions and there is no lockfile; two complete local virtual environments were shipped instead.

## Selective-port matrix

| Archive artifact or idea | Target in this repository | Action |
|---|---|---|
| CSV/Schema validation concepts | `scripts/validate-content.ts`, `src/domain/` | Reimplement against the strict current Schema |
| Camera/character candidate numbers | Test fixture or dated spike record | Keep as a 75mm alternative only after Director confirms lineage |
| Mirrored OTS relationship | Domain invariant tests | Port semantically using the current coordinate convention |
| 0.30m single-direction dolly | Movement fixture | Compare with current start/end values; do not overwrite silently |
| Screen-space statistics | `src/domain/` geometry checks or browser tests | Rewrite with exact definitions for horizontal occupancy, eyeline and axis |
| Software renderer | None in production | Do not port; React Three Fiber/Three.js is the product renderer |
| Generated PNGs | Director review evidence only | Regenerate in the Web implementation; do not publish as approved content |
| Python Schema/status model | None | Reject as incompatible |
| Virtual environments/caches/editor files | None | Reject and keep ignored |
| Archive planning documents | This audit record | Do not merge; current decisions and scope take precedence |

## Safe integration sequence

1. Establish a reviewed Git baseline before application scaffolding; the repository currently has no commits.
2. Ask the project initiator whether the archive's 75mm CSV is a later authorized Director revision or another developer's engineering rewrite. Record the answer in `docs/DECISIONS.md` before changing templates.
3. Execute Prompt 1 to scaffold the TypeScript Web application. Do not add Python as a production runtime.
4. Execute Prompt 2 to implement the current strict Schema, content compiler and canonical `ShotState`.
5. Port only model-independent invariants: mirrored OTS cameras, same-side-of-axis, shared pair focal length, start/end movement and measurable framing checks.
6. During Prompt 3, create a clearly labeled alternative 75mm engineering fixture only if comparison is useful. It must not enter the gallery or overwrite the current 50mm template before the Director decision.
7. Re-render all three templates in the Web 3D stage with a visible camera/frustum in director view.
8. Return Web-generated director/camera/start/end views to the Director. Only written approval advances `reviewStatus`.

## Requested follow-up from collaborators

From the project initiator/director, request one written answer covering the four focal/reference questions in `docs/OPEN_QUESTIONS.md`.

From the other developer, a resend is optional rather than blocking. If their prototype should retain useful history or attribution, ask for a clean Git commit/branch or source-only archive containing `shot-template-demo/`, with both virtual environments, caches, generated duplicates and editor files removed. Ask them to include:

- the exact source/revision of the Director CSV used;
- the written evidence behind the claimed 75mm Director decision;
- a reproducible dependency lock or exact tested versions;
- the command and clean-environment test output used to produce the 13/13 report.

Do not ask them to continue the Python renderer as the production Web implementation.

## Acceptance gate for any ported behavior

A behavior from this archive is accepted only when all are true:

- it is represented in the current TypeScript `ShotState` and strict content Schema;
- it follows the current coordinate and 36mm long-edge film-gate convention;
- unit tests detect both positive and intentionally broken cases;
- browser/visual evidence is generated by the Web implementation;
- it does not change a Director-authored value without recorded confirmation;
- it does not add Python, video generation, accounts, a database or a general-purpose 3D editor to the MVP.
