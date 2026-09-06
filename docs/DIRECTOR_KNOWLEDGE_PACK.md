# Director Knowledge Pack

## Purpose

Turn the project initiator's directing expertise into versioned, testable runtime data without asking end users to understand professional terminology.

The knowledge pack is not a single prompt. It contains templates, rules, references and acceptance criteria that compile into a canonical shot state.

## Three representations

| Representation | User | Purpose |
|---|---|---|
| Director handoff packet/CSV | Project initiator/director | Easy structured submission without coordinates or YAML |
| Validated YAML/JSON | Web application and developers | Runtime source of truth |
| Optional repo Codex Skill | Content-authoring workflow | Convert, validate and report missing fields |

Do not create the Codex Skill until at least 3-5 templates have been processed manually and the stable repeated workflow is understood.

## Required package components

```text
content/
├─ intake/                 # Human-authored collection forms
├─ schema/                 # Machine validation
├─ templates/dialogue/     # One versioned file per shot template
├─ rules/                  # Reusable composition/continuity rules
├─ adapters/               # Provider-specific vocabulary and constraints
└─ glossary/               # Friendly labels and professional definitions
```

Reference images and GLB assets live under `public/` and are referenced by stable IDs/paths.

## Intake stages

The shareable packet lives in `handoff/director/`. It deliberately asks the director for visual and professional intent rather than 3D coordinates. After return, the developer performs an engineering-mapping stage that adds coordinates, typed semantics and IDs required by runtime YAML.

```text
director CSV + reference images
  -> completeness and rights check
  -> engineering mapping
  -> validated YAML
  -> 3D preview
  -> director review and written approval
```

## Director-facing intake fields

The director supplies, for every shot template:

1. Stable working ID.
2. Chinese display name.
3. Plain-language description.
4. Intended narrative purpose.
5. Emotional or perceptual effect.
6. When to use and when not to use.
7. Reference image with source/rights note.
8. Aspect ratio and shot size.
9. Default focal length if known; `待确认` is acceptable.
10. Camera viewpoint, height, side and target in natural language.
11. Character A/B blocking and facing in natural language.
12. Movement intent, start/end and duration in natural language.
13. Composition rules.
14. Continuity/axis/eyeline rules.
15. Prompt semantic phrases, not one final provider prompt.
16. Visual acceptance checks.
17. Director notes and unresolved questions.

The provided CSV is an exchange format, not the final runtime format. The developer first maps it to explicit 3D parameters; a compiler then validates and converts the mapped content into a YAML template. The original director text must be retained for review traceability.

## Template lifecycle

```text
draft
  -> engineering_placeholder
  -> engineering_ready
  -> director_review
  -> approved
  -> deprecated
```

- `draft`: incomplete intake.
- `engineering_placeholder`: structurally valid content authored by engineering without director intake; usable for development and tests only, never as approved directing knowledge.
- `engineering_ready`: structurally valid and previewable.
- `director_review`: rendered preview exists and awaits professional review.
- `approved`: may appear in user-facing MVP.
- `deprecated`: retained for reproducibility but hidden from new use.

Only the project initiator/director may approve a template's directing content.

## Separation of rules and examples

Reusable rules such as maintaining an eyeline or staying on one side of an axis should have stable IDs in `content/rules/`. Templates reference rule IDs instead of duplicating prose. This permits:

- consistent validation;
- localized user explanations;
- shared visual warnings in the 3D stage;
- later empirical comparison of which constraints improve outputs.

## Prompt semantics

Store structured meaning:

```yaml
promptSemantics:
  subjects:
    - character_b_is_primary
  composition:
    - over_the_shoulder
    - foreground_shoulder_frame
  optics:
    - medium_close_up
    - moderate_depth_of_field
  motion:
    - subtle_dolly_in
  continuity:
    - preserve_eyeline
```

Do not store the only source of professional knowledge inside opaque prose such as:

```text
Generate a cinematic professional video with perfect composition...
```

## Content handoff checklist

- [ ] First 3 intake rows complete the full review loop; target 8-12 before user validation.
- [ ] Every reference image has a rights/source note.
- [ ] Each template declares intended narrative purpose.
- [ ] Camera and character defaults can be represented by the MVP controls.
- [ ] Every rule has an ID and plain-language explanation.
- [ ] Every template includes visual acceptance criteria.
- [ ] Templates render in the generic dialogue room.
- [ ] Director marks approved templates explicitly.
