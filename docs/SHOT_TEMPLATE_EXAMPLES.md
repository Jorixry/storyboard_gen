# Two-Person Dialogue Shot Examples

These are **engineering planning placeholders**, not professionally approved directing content. Their purpose is to show the intended content coverage and data relationships. The project initiator/director must replace or approve names, purposes, parameters, references and rules through the intake workflow.

## Proposed initial catalog

| Placeholder ID | Working name | Engineering purpose | Likely state differences |
|---|---|---|---|
| `dialogue_establishing_wide` | 对话建立全景 | Establish both characters and room | Wide camera, both bodies visible, static or subtle push |
| `dialogue_medium_two_shot` | 双人中景 | Keep both characters equally present | Medium two-shot, balanced framing |
| `dialogue_ots_a_to_b` | A过肩拍B | Emphasize B while keeping A as spatial reference | Foreground A shoulder, B primary, 75mm (D025) |
| `dialogue_ots_b_to_a` | B过肩拍A | Reverse coverage of the previous shot | Mirrored positions without crossing axis |
| `dialogue_clean_single_a` | A单人反应 | Isolate A's response | A primary, B excluded or minimal |
| `dialogue_clean_single_b` | B单人反应 | Isolate B's response | B primary, A excluded or minimal |
| `dialogue_profile_two_shot` | 双人侧面对话 | Show confrontation/distance | Side-on camera, both profiles visible |
| `dialogue_insert_detail` | 对话细节插入 | Add a hand/object/detail cutaway | Insert framing, object placeholder required |

## Recommended validation sequence

Do not implement all eight before validating the content pipeline.

1. `dialogue_medium_two_shot`
2. `dialogue_ots_a_to_b`
3. `dialogue_ots_b_to_a`

These three are sufficient to test:

- loading different camera/character defaults;
- preserving axis and eyeline relationships;
- mirroring coverage;
- simple semantic controls;
- start/end movement;
- prompt derivation.

## Required director review for every example

- Is the plain-language label understandable to a non-professional?
- Is the narrative purpose accurate?
- Which emotional claims are valid and which are marketing language?
- What camera/character ranges remain professionally acceptable?
- What breaks the axis, eyeline or composition?
- Which raw render demonstrates a passing result?
- What reference image may legally be included?
- Which prompt semantics are essential versus provider-specific?

