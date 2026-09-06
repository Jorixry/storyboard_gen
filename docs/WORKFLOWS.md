# Product and Team Workflows

## 1. End-user workflow

### A. Choose

1. Open the visual shot library.
2. Filter or browse two-person-dialogue examples.
3. Compare reference image, narrative purpose and emotional effect.
4. Select one example.

### B. Adjust simply

1. Use plain-language controls such as closer/farther and emphasize A/B.
2. Select aspect ratio and focal feel.
3. Select a basic camera movement and amount.
4. See the camera-view preview update immediately.

### C. Refine optionally

1. Open the 3D director stage.
2. Switch between director view and camera view.
3. Adjust camera or character transforms within safe ranges.
4. Observe continuity and composition warnings.
5. Set start and end camera poses.

### D. Produce inputs

1. Preview the movement tween.
2. Render raw composition and movement start/end images.
3. Optionally upload 2D character/style references.
4. Explicitly request an enhanced first frame.
5. Compile generic and target-model prompts.
6. Download the complete input package.

### E. Use externally

1. User opens the chosen external video platform.
2. User supplies the exported first frame/reference images and prompt.
3. User records attempts, time and whether the result was acceptable during validation.

## 2. Director-content authoring workflow

1. Developer sends the complete `handoff/director/` packet.
2. Director copies the blank CSV, fills three initial templates and returns it with reference images and rights notes.
3. Developer checks completeness and scope without judging professional correctness.
4. Developer maps natural-language camera/blocking descriptions to explicit 3D coordinates and typed semantics.
5. Content compiler converts the engineering mapping to template YAML.
6. Schema validation reports missing or invalid fields.
7. Application renders camera/director previews plus movement start/end frames.
8. Director reviews visual geometry, plain-language labels and acceptance rules.
9. Corrections are made to structured fields, not patched into final prompt prose.
10. Director approves a named template ID/version in writing; only then is `reviewStatus` changed to `approved`.
11. Build includes the approved version and preserves older versions for reproducibility.

## 3. Prompt compilation workflow

1. Normalize `ShotState` into model-independent semantics.
2. Apply deterministic composition and continuity rules.
3. Render a generic prompt for human inspection.
4. Select one versioned provider adapter.
5. Map semantics to provider-preferred phrasing and supported input types.
6. Optionally ask an LLM for constrained polishing using structured output.
7. Compare the polished result with immutable geometry/movement facts.
8. Reject or repair any prompt that changes those facts.
9. Export prompt text with adapter name and version.

## 4. Model technical-spike workflow

1. Choose 2-3 image-generation candidates with reference-image or image-to-image support.
2. Use the same 3D composition fixture and reference assets for each.
3. Evaluate composition preservation, character/reference following, latency, cost and API reliability.
4. Choose one image adapter for the MVP.
5. Interview/test the target short-drama operators' actual external video platforms.
6. Select one video model/version for the first prompt adapter.
7. Verify whether it benefits from start/end images, first-frame input, reference video or text-only movement.
8. Record findings in a dated architecture decision record before implementation.

## 5. Validation workflow

For each of 3-5 users:

1. Select a real two-person-dialogue shot task.
2. Capture baseline workflow, attempts, time and approximate generation cost.
3. Run the same or comparable task with the MVP.
4. Record which exported artifacts were actually used.
5. Record attempts, time and result acceptance.
6. Ask what blocked completion, not whether the user “liked” the tool.
7. Identify any repeated demand for general-purpose 3D functionality.

Aggregate:

- median and mean time-to-acceptable-result;
- paid generation attempts;
- completion without developer assistance;
- reuse intent on a named real project;
- repeated blockers and template gaps.

## 6. Codex development workflow

1. Start with `AGENTS.md` and one task from `docs/IMPLEMENTATION_PLAN.md`.
2. Read only the referenced domain/content files required for that task.
3. State scope and expected file changes.
4. Implement the smallest vertical behavior.
5. Run deterministic tests and visual/browser QA where relevant.
6. Report evidence and remaining risks.
7. Update documentation when data shapes or decisions change.
8. Stop before the next staged prompt; do not silently implement later scope.
