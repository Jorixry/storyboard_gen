# Open Questions and Evidence Gates

This list contains unresolved facts, not an invitation for Codex to guess.

## Director content

- Which 8-12 two-person-dialogue examples does the project initiator approve?
- The first deterministic vertical slice uses `dialogue_medium_two_shot`, `dialogue_ots_a_to_b` and `dialogue_ots_b_to_a`; which exact versions does the Director approve after Web 3D review?
- What are the computable safe ranges for axis, eyeline and foreground occupancy? Foreground occupancy 1/4-1/3 for OTS and two-shot <=40% are supplied as acceptance values; computable axis and eyeline tolerances remain open.
- Which reference images are original or appropriately licensed?
- The paired OTS follow-up image resolves the prior B-to-A reference mismatch; independent rights verification remains outstanding.
- Provisional movement defaults (medium shot static; both OTS templates 4-second dolly-in) await director confirmation.

### 50mm-versus-75mm external prototype conflict

The current repository handoff and YAML use 50mm for both OTS templates. The CSV embedded in `aigc_project.rar` uses 75mm while retaining “50mm观感” in prompt semantics, and the archive's generated docs claim that the Director made data/75mm authoritative.

This cannot be inferred from recency or another developer's generated status text. Ask the project initiator/director:

1. Is archive CSV SHA-256 `1609074218D9E7F2C88FEF8DCC2B9FE1B8AB0FF7FB6B8FFB4DD6D46E792B39CB` a later authorized revision of the current CSV?
2. For both OTS templates, is the executable default focal length 50mm or 75mm?
3. If 75mm is executable, should “50mm观感” be removed from structured prompt semantics or intentionally retained only as non-executable language?
4. Do the newer split OTS pair images remain the visual references regardless of the focal-length answer?

Until answered, current 50mm YAML remains unchanged and `engineering_ready`; the archive's 75mm camera values may be used only as a labeled comparison fixture.

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
