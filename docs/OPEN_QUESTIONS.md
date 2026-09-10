# Open Questions and Evidence Gates

This list contains unresolved facts, not an invitation for Codex to guess.

## Director content

- Which 8-12 two-person-dialogue examples does the project initiator approve?
- The first deterministic vertical slice uses `dialogue_medium_two_shot`, `dialogue_ots_a_to_b` and `dialogue_ots_b_to_a`; which exact versions does the Director approve after Web 3D review?
- Prompt 3 observation for the Director review: at the current engineering-mapped `dialogue_ots_a_to_b` values (camera `[-1.25, 1.7, 2]`, now 75mm per D025, 16:9), the rendered camera view frames character_b centered but character_a's shoulder still falls entirely outside the left frame edge (at 50mm it was NDC x ≈ −1.45 to −1.80; the 75mm migration narrows the FOV and scales NDC magnitudes by ≈1.5×, widening the margin), so the template's "foreground shoulder occupies about 1/4–1/3 of frame" acceptance criterion is still not met by the default pose. The Web stage renders the canonical numbers faithfully; resolving this (camera x position or blocking) is a Director mapping decision, not an engineering fix.
- What are the computable safe ranges for axis, eyeline and foreground occupancy? Foreground occupancy 1/4-1/3 for OTS and two-shot <=40% are supplied as acceptance values; computable axis and eyeline tolerances remain open.
- Prompt 4 introduced provisional ENGINEERING edit constraints (camera/target box from the dialogue_room extents inset 0.1 m with a 0.3 m floor clearance, focal clamp from the Schema's 12–200 mm, character x/z inset 0.3 m with y pinned to the floor, 0.6 m minimum character separation, 0.3 m minimum camera-target distance, and the 24/35/50/85 mm "focal feel" presets where only 35/50 come from current templates). These are engineering derivations, not director-approved safe ranges; should the Director confirm or replace them? (Defined centrally in `src/domain/engineering-constraints.ts`.)
- Which reference images are original or appropriately licensed?
- The paired OTS follow-up image resolves the prior B-to-A reference mismatch; independent rights verification remains outstanding.
- Provisional movement defaults (medium shot static; both OTS templates 4-second dolly-in) await director confirmation.

### 50mm-versus-75mm external prototype conflict — RESOLVED 2026-09-10

The project initiator answered all four questions; see D025 in `docs/DECISIONS.md`:

1. Yes — archive CSV SHA-256 `1609074218D9E7F2C88FEF8DCC2B9FE1B8AB0FF7FB6B8FFB4DD6D46E792B39CB` is the authorized v2.1 revision (the hash was re-verified against the returned file before migration).
2. The executable default focal length for both OTS templates is **75mm**; both template YAMLs were migrated on 2026-09-10 and the guard tests now pin 75mm.
3. "50mm观感" is retained only as a product/UI-level "standard portrait" alias (the 50mm portrait preset label); it is no longer mathematically bound to any template and does not appear as an executable optics token.
4. Yes — the split OTS pair images remain the visual references.

## Provider spike

- Which image provider best preserves the raw 3D composition? (Spike not yet authorized — initiator answered "待定" on 2026-09-10.)
- Named 2026-09-10 (D026): the intended target video model is 即梦 (Seedance) v2.0 Pro. Still open: verify its exact input types against official documentation before any adapter ships.
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
