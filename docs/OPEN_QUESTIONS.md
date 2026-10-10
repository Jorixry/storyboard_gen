# Open Questions and Evidence Gates

This list contains unresolved facts, not an invitation for Codex to guess.

## Director content

- Which 8-12 two-person-dialogue examples does the project initiator approve? (2026-10-08 capacity note, D029: the director says roughly 50–70 templates of content output are ready for later delivery — well above the original 8–12 wedge; intake batching and any gallery UX implications are open once delivery starts.)
- The first deterministic vertical slice uses `dialogue_medium_two_shot`, `dialogue_ots_a_to_b` and `dialogue_ots_b_to_a`; which exact versions does the Director approve after Web 3D review? (2026-10-08 first director 3D review happened — see D029. Geometry conclusions delivered: OTS camera repositioned (now v3), medium two-shot geometry approved as accurate. Formal written approval of template IDs@versions is still pending, so all templates remain `engineering_ready`.)
- RESOLVED 2026-10-08 (D029) — the OTS foreground-shoulder framing issue. The director supplied a calibration image; both OTS templates were repositioned to v3 (a_to_b camera `[-2.15, 1.45, 0.8]`, target `[0.85, 1.55, -0.2]`; b_to_a mirrored), focal stays 75mm, blocking unchanged. Numeric check at the new pose: character_a's head/shoulder project INSIDE the left frame edge (NDC x ≈ −0.90 head / −0.65 shoulder) instead of outside (was ≈ −1.45 to −1.80 at 50mm). The historical observations below are kept for the record.
- Prompt 3 observation for the Director review (recorded at the former 50mm values; camera `[-1.25, 1.7, 2]`, 16:9): the rendered camera view framed character_b centered but character_a's shoulder fell entirely outside the left frame edge (NDC x ≈ −1.45 to −1.80), so the template's "foreground shoulder occupies about 1/4–1/3 of frame" acceptance criterion was not met by the default pose. Superseded by the D029 v3 reposition above.
- 75mm baseline check (2026-09-10): the director-stage browser visual regression passed against the committed OTS A-to-B v2 camera-view image. Visual inspection of that matching baseline still shows no foreground A shoulder. Superseded by the D029 v3 reposition above; the v3 baseline was regenerated 2026-10-08.
- What are the computable safe ranges for axis, eyeline and foreground occupancy? Foreground occupancy 1/4-1/3 for OTS and two-shot <=40% are supplied as acceptance values; computable axis and eyeline tolerances remain open. (2026-10-08, D029: the director confirmed the focal clamp range 12–200mm and the simple-control copy; the out-of-range clamp-warning UX could not be reviewed — see the open question on controlled-input snapping below.)
- Prompt 4 introduced provisional ENGINEERING edit constraints (camera/target box from the dialogue_room extents inset 0.1 m with a 0.3 m floor clearance, focal clamp from the Schema's 12–200 mm, character x/z inset 0.3 m with y pinned to the floor, 0.6 m minimum character separation, 0.3 m minimum camera-target distance, and the 24/35/50/85 mm "focal feel" presets). Since D025, the current template defaults are 35mm and 75mm; 50mm remains an editable preset, not an OTS default. The focal range 12–200mm and the control copy were director-confirmed on 2026-10-08 (D029); the remaining box/separation constraints are still engineering derivations. OPEN UX QUESTION after the 2026-10-08 review: the numeric inputs are controlled components — an out-of-range fill (e.g. 999) is clamped and written back immediately, so the transient warning text may never be seen ("位置x锁死只能填写范围值"); should out-of-range input instead be held visible with a persistent warning until corrected?
- Which reference images are original or appropriately licensed? RESOLVED 2026-10-08 (D029): the director confirmed all three current reference images are his own AI-generated originals (rights resolved). Independent legal verification before public/approved release remains the standing policy recorded in each template's rights note.
- The paired OTS follow-up image resolves the prior B-to-A reference mismatch; independent rights verification remains outstanding. (Superseded by the D029 rights confirmation above for the three in-repo reference images.)
- Provisional movement defaults (medium shot static; both OTS templates 4-second dolly-in) await director confirmation. (2026-10-08, D029: the director accepted the OTS default movements as adequate for now — the start/end compositions inherit the fixed v3 camera — but detailed blocking/movement design for all three templates is deferred as director intent for a later version.)
- Prompt 6 introduced ENGINEERING verification pairs in the generic prompt compiler (see docs/ARCHITECTURE.md "Prompt compiler"): `focal_*mm` ↔ camera focal length, `character_*_primary` ↔ the character nearest the camera target horizontally, and motion tokens naming a movement ↔ `movement.type`. These mirror the semantic-sync contract and produce warnings only; equal-prominence subject tokens and all composition/optics/continuity tokens are rendered verbatim without geometric checks. Should the Director confirm, extend or replace these pairs and the "unverified engineering template" warning wording?

### 50mm-versus-75mm external prototype conflict — RESOLVED 2026-09-10

The project initiator confirmed in writing that both OTS templates' executable focal length is **75mm** (docs/DECISIONS.md D025). Template v2 applies 75mm to current/movement start/end and the `focal_75mm` semantics token; camera positions, targets and blocking are unchanged; `dialogue_medium_two_shot` keeps 35mm; both OTS templates remain `engineering_ready`.

This confirmation resolves ONLY the focal-length question. It does not approve any other part of `aigc_project.rar` (its Python code, generated docs, virtual environments, status labels or the L4-4 reference images), and the following follow-ups remain open:

- Should the foreground-shoulder occupancy acceptance line (1/4–1/3 of frame) be re-reviewed against the tighter 75mm framing? (Answered 2026-10-08 by D029: instead of relaxing the acceptance line, the camera was repositioned to meet it — v3 places the foreground shoulder inside the left frame edge. The director should still eyeball the v3 3D preview against the 1/4–1/3 occupancy line during the written approval pass.)
- Does the archive's prompt-language phrase “50mm观感” have any remaining meaning now that 75mm is executable, or is it fully superseded by the `focal_75mm` token?

## Provider spike

- (2026-09-21) Prompt 7A read-only image-provider comparison complete: `docs/PROVIDER_SPIKE.md` compares Doubao-Seedream (Volcengine Ark), Wan 2.7 (Alibaba Cloud Model Studio) and Google Gemini image models on official documentation, with third-party claims labeled and uncertain items marked UNCONFIRMED. Empirical composition-preservation testing on the shared 3D fixture is deliberately deferred per the developer's no-credits decision (see the report's section 8 for the deferred-verification hook). Developer selection is recorded as D027 (Seedream primary + Wan 2.7 backup, single-active).
- Image-provider selection is resolved by D027 (2026-09-21). Open remainder: empirical composition-preservation verification on the shared 3D fixture once account access and credits are approved, before the Prompt 8 export-package freeze.
- (2026-09-22, Prompt 7B2) Seedream live-call verification progress: endpoint + auth + model id `doubao-seedream-5-0-pro-260628` verified live; `size` verified to require explicit `WIDTHxHEIGHT` (the adapter derives it from the composition PNG); the success response shape is verified (top-level `model`/`created`, per-image `size`/`output_format` alongside `b64_json` — response contracts are now tolerant of extra provider metadata while strictly validating required fields). Still open: confirm the first fully delivered image and run the composition-preservation check on the shared fixture.
- (2026-09-23, acceptance fix round) Verification-level ledger, to keep "documentation check" / "mocked contract test" / "real call" distinct: Seedream — partial real-call verification 2026-09-22 (endpoint, auth, model id, size contract, success/error response shapes; see above); first delivered image still pending. Wan 2.7 — documentation-only verification (official API reference; its `input.messages[0].content` request contract re-verified 2026-09-23 and the adapter corrected to it, wanxiang@1.1.0 — the pre-fix request shape was never live-verified); all Wan adapter behavior in this repository is mocked-contract-tested only; first live call pending. Ark total input-image count remains UNCONFIRMED on official docs, so no total limit is enforced for seedream (Wan's official 0–9 total IS enforced).
- Seedance v2.0 Pro is provisionally selected by the developer (D026, 2026-09-11). What is its exact official model identifier/version, API availability and correspondence to the platform used by pilot users?
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
