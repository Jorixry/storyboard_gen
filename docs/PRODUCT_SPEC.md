# Product Specification

## One-sentence definition

A 3D-assisted directing input tool that hides professional cinematography logic behind simple visual choices and exports better-controlled inputs for external video-generation models.

## Problem

AIGC video creators often know the result they want only approximately. Free-form prompts are weak at expressing camera geometry, character blocking, shot continuity and movement. Users discover mismatches only after spending time and generation credits.

The product moves decisions earlier into a cheap, inspectable stage:

- show rather than explain shot options;
- convert simple choices into structured directing parameters;
- make spatial relationships editable in a constrained 3D scene;
- derive all output artifacts from one canonical shot state.

## Primary persona

An operator in an AI short-drama team who repeatedly creates dialogue shots, pays for failed generations and needs faster, more predictable input preparation.

## Secondary persona

An individual AIGC video creator without formal directing training. The workflow must be usable without knowing terms such as focal length, eyeline match or the 180-degree rule.

## Job to be done

> When I have a shot in mind, help me choose and refine a visible composition, then give me a coherent first frame and prompt package so I can reach an acceptable generated video with fewer attempts.

## Product principles

1. **Simple outside, professional inside.** Show visual or semantic choices before numerical controls.
2. **One canonical state.** Images, prompts and movement descriptions must derive from the same shot state.
3. **Progressive disclosure.** Template selection and simple controls are primary; 3D manipulation is optional.
4. **Constrained beats general.** The MVP is a shot configurator, not a general-purpose 3D editor.
5. **Evidence over claims.** Success means fewer attempts or less time in real workflows, not positive interview language.
6. **Model adapters decay.** Keep provider-specific behavior isolated, versioned and testable.

## End-user workflow

1. Choose a two-person-dialogue example from a visual gallery.
2. Review the default 2D composition.
3. Make simple adjustments such as closer/farther, left/right emphasis, focal feel and movement.
4. Optionally open the 3D director stage for precise camera and character transforms.
5. Preview movement from one start state to one end state.
6. Render the raw composition and start/end guide frames.
7. Optionally provide 2D character/style references and generate an enhanced first frame.
8. Compile the shot state into a generic semantic prompt and one target-model prompt.
9. Export an input package for use on an external video-generation platform.

## Export package

```text
shot-package/
├─ shot-state.json
├─ composition-raw.png
├─ movement-start.png
├─ movement-end.png
├─ first-frame-enhanced.png       # optional/API-dependent
├─ prompt-generic.txt
├─ prompt-target-model.txt
└─ manifest.json
```

Every generated artifact records the shot-template version, adapter version and generation settings used.

## Non-goals

- Guaranteeing a successful video generation.
- Solving model-side sampling randomness.
- Editing or generating finished videos.
- Replacing Blender, Unreal Engine or a professional previsualization suite.
- Supporting arbitrary scenes, assets, rigs or animation timelines in the MVP.

