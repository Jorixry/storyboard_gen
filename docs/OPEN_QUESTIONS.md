# Open Questions and Evidence Gates

This list contains unresolved facts, not an invitation for Codex to guess.

## Director content

- Which 8-12 two-person-dialogue examples does the project initiator approve?
- The first deterministic vertical slice uses `dialogue_medium_two_shot`, `dialogue_ots_a_to_b` and `dialogue_ots_b_to_a`; which exact versions does the Director approve after Web 3D review?
- Prompt 3 observation for the Director review (recorded at the former 50mm values; camera `[-1.25, 1.7, 2]`, 16:9): the rendered camera view framed character_b centered but character_a's shoulder fell entirely outside the left frame edge (NDC x ≈ −1.45 to −1.80), so the template's "foreground shoulder occupies about 1/4–1/3 of frame" acceptance criterion was not met by the default pose. With the confirmed 75mm executable focal (D025, v2 templates) the field of view is narrower still, so the observation must be re-verified during the next director review; resolving it (camera x/focal or blocking) remains a Director mapping decision, not an engineering fix.
- What are the computable safe ranges for axis, eyeline and foreground occupancy? Foreground occupancy 1/4-1/3 for OTS and two-shot <=40% are supplied as acceptance values; computable axis and eyeline tolerances remain open.
- Prompt 4 introduced provisional ENGINEERING edit constraints (camera/target box from the dialogue_room extents inset 0.1 m with a 0.3 m floor clearance, focal clamp from the Schema's 12–200 mm, character x/z inset 0.3 m with y pinned to the floor, 0.6 m minimum character separation, 0.3 m minimum camera-target distance, and the 24/35/50/85 mm "focal feel" presets where only 35/50 come from current templates). These are engineering derivations, not director-approved safe ranges; should the Director confirm or replace them? (Defined centrally in `src/domain/engineering-constraints.ts`.)
- Which reference images are original or appropriately licensed?
- The paired OTS follow-up image resolves the prior B-to-A reference mismatch; independent rights verification remains outstanding.
- Provisional movement defaults (medium shot static; both OTS templates 4-second dolly-in) await director confirmation.
- Prompt 6 introduced ENGINEERING verification pairs in the generic prompt compiler (see docs/ARCHITECTURE.md "Prompt compiler"): `focal_*mm` ↔ camera focal length, `character_*_primary` ↔ the character nearest the camera target horizontally, and motion tokens naming a movement ↔ `movement.type`. These mirror the semantic-sync contract and produce warnings only; equal-prominence subject tokens and all composition/optics/continuity tokens are rendered verbatim without geometric checks. Should the Director confirm, extend or replace these pairs and the "unverified engineering template" warning wording?

### 50mm-versus-75mm external prototype conflict — RESOLVED 2026-09-10

The project initiator confirmed in writing that both OTS templates' executable focal length is **75mm** (docs/DECISIONS.md D025). Template v2 applies 75mm to current/movement start/end and the `focal_75mm` semantics token; camera positions, targets and blocking are unchanged; `dialogue_medium_two_shot` keeps 35mm; both OTS templates remain `engineering_ready`.

This confirmation resolves ONLY the focal-length question. It does not approve any other part of `aigc_project.rar` (its Python code, generated docs, virtual environments, status labels or the L4-4 reference images), and the following follow-ups remain open:

- Should the foreground-shoulder occupancy acceptance line (1/4–1/3 of frame) be re-reviewed against the tighter 75mm framing? (Recorded in each template's directorNotes.)
- Does the archive's prompt-language phrase “50mm观感” have any remaining meaning now that 75mm is executable, or is it fully superseded by the `focal_75mm` token?

## Provider spike

- Which image provider best preserves the raw 3D composition?
- Which exact Seedance or other mainstream video-model version is used by pilot users?
- What input types does that selected version accept at implementation time?
- Does reference movement video add enough value to justify export work?
- What are the current cost, latency, rate limits and regional/API-access constraints?

## Validation

- What is each pilot user's baseline time and generation-attempt count?
- Is 30% improvement a realistic go/no-go threshold after baseline measurement?
- How will acceptable output be judged consistently?

## Operating details

- Resolved: target code delivery is two elapsed weeks / ten working days with flexible calendar timing.
- Resolved: AI execution capacity is high; zcode may implement bounded packets and Codex independently accepts them. Human/Director availability, not token runtime, is the likely review bottleneck.
- How are provider and asset expenses approved and reimbursed?
- What level of maintenance is expected after the validation build?
