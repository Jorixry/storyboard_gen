# Decision Log

Last updated: 2026-09-05

This file records decisions already settled in discussion. Codex should not reopen them during implementation unless new evidence creates a concrete conflict.

| ID | Decision | Status |
|---|---|---|
| D001 | The MVP optimizes inputs to external video models and does not generate video. | Confirmed |
| D002 | The MVP is staged: build the input-design product first; a LibTV-like node workflow is not in scope. | Confirmed |
| D003 | Users start by choosing a 2D shot example linked to a predefined 3D shot template. | Confirmed |
| D004 | The default UX exposes simple choices; the 3D stage is an optional refinement layer. | Confirmed |
| D005 | MVP 3D controls: camera position/orientation, focal length, character position/orientation, aspect ratio, movement start and end. | Confirmed |
| D006 | MVP outputs include raw 3D guide images and an AI-enhanced first frame; structured metadata and prompts are derived from the same state. | Confirmed |
| D007 | Primary target: operators in AI short-drama teams. Interaction must remain simple enough for individual creators. | Confirmed |
| D008 | Initial content wedge: two-person dialogue. | Confirmed, subject to director review |
| D009 | Canonical state is the structured shot specification plus 3D scene state, not a prompt or image. | Confirmed |
| D010 | Prompt compilation is hybrid: deterministic structured rules plus constrained language-model polishing. | Confirmed |
| D011 | MVP is a desktop web application; latest Chrome is the supported browser. | Confirmed |
| D012 | The project initiator/director supplies the director knowledge content pack. | Confirmed |
| D013 | Runtime content uses an intake form compiled to validated YAML/JSON. A Codex Skill may later assist authoring but is not runtime infrastructure. | Confirmed |
| D014 | MVP uses one generic room, two generic mannequins and one camera. | Confirmed |
| D015 | 3D character identity consistency and custom 3D imports are out of scope. | Confirmed |
| D016 | Movement output initially includes interactive preview, start/end guide images and a structured movement description; no required MP4/WebM export. | Confirmed |
| D017 | Candidate mainstream models, including Seedance, will be compared in a technical spike. MVP ships only one image adapter and one prompt adapter. | Confirmed |
| D018 | Accounts, teams, permissions, billing and payments are not in the MVP. | Confirmed |
| D019 | Validation initially uses 3-5 real target users and compares time/generation attempts against their existing process. | Provisional |
| D020 | Project expenses during the agreed development period are paid by the project initiator. | Confirmed by developer; written operating detail pending |
| D021 | The developer delivers the MVP code and currently owns the development code. Director knowledge is supplied by the project initiator. | Current working arrangement; legal detail intentionally deferred |
| D022 | Current priority is technical/product development, not negotiating detailed intellectual-property terms. | Confirmed |
| D023 | The MVP code-delivery target is two elapsed weeks (ten working days), with flexible calendar timing. External review/validation timing does not silently expand the code scope. | Confirmed |
| D024 | Development is AI-first: zcode/OpenCode/GLM may implement bounded packets and Codex independently accepts them; human and Director approval gates remain authoritative. | Confirmed |

## Open implementation gates

These are intentionally unresolved and belong in the technical spike or content handoff:

1. Which image-generation provider best preserves the 3D composition while applying character/style references?
2. Which exact external video model/version is used for the first prompt adapter?
3. Which 8-12 two-person-dialogue templates are professionally approved by the project initiator?
4. What measurable threshold determines whether the validation proceeds to a larger MVP?
5. Are movement-reference video exports useful for the selected external model, or are guide frames plus text sufficient?
6. Is the 75mm OTS CSV embedded in `aigc_project.rar` a later authorized Director revision, or should the current 50mm handoff remain canonical?
