# MVP Scope and Acceptance

## In scope

### Shot library

- Visual gallery for professionally reviewed two-person-dialogue templates.
- Template details: intent, emotional effect, suitable use, reference image.
- Load a selected template into the canonical shot state.

### Simple adjustment layer

- Human-readable controls mapped to structured parameters.
- Camera distance/shot-size adjustment.
- Left/right subject emphasis.
- Focal-length presets.
- Character position and facing presets.
- Aspect ratio selection.
- Movement type plus start/end intensity or distance.

### 3D director stage

- One generic room.
- Two generic mannequins.
- One perspective camera with visible frustum in director view.
- Director view and camera view.
- Camera and character transform controls constrained to safe ranges.
- Start/end movement states and tween preview.

### Outputs

- Current raw camera-frame PNG.
- Movement start and end PNGs.
- Canonical `ShotState` JSON.
- Generic structured prompt.
- One provider-specific video prompt.
- Optional enhanced first frame through one image adapter.
- Downloadable export package.

### Quality and validation

- Content Schema validation at build/test time.
- Unit tests for state transforms, template loading and prompt compilation.
- Browser tests for the primary template-to-export path.
- Provider adapters mocked in default tests.
- Manual comparison with 3-5 target users.

## Explicitly out of scope

- Authentication, user profiles and cloud project storage.
- Team collaboration, comments, reviews and permissions.
- Pricing, checkout, credits and subscriptions.
- Mobile and touch-first editing.
- Arbitrary 3D asset import/export.
- Skeleton posing, facial animation or wardrobe.
- Lighting and material editing.
- Multi-keyframe animation timeline.
- AI video generation.
- Node-based workflows.
- Multiple production image/video providers.

## Functional definition of done

A new user can, without developer assistance:

1. select a professionally approved two-person-dialogue template;
2. make a simple composition adjustment;
3. optionally refine camera or character placement in 3D;
4. preview a start-to-end camera move;
5. render raw guide images;
6. generate or mock an enhanced first frame;
7. inspect the generic and target-model prompts;
8. download a coherent export package whose files share one `ShotState` ID.

## Validation definition of done

Initial target, subject to revision after baseline measurement:

- 3-5 target users complete the flow.
- At least 3 use the package in a real external video model.
- Mean time-to-acceptable-result or paid generation attempts improves by at least 30% relative to the user's baseline.
- At least 2 users want to use the tool on another real project.
- No repeated blocker requires turning the product into a general-purpose 3D editor.

