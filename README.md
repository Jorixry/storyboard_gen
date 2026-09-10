# Storyboard Director MVP

A desktop web tool that helps AIGC video creators turn visual intent into professional, structured inputs for external video-generation models.

The user selects an understandable 2D shot example, adjusts a constrained 3D scene, and exports a raw composition, an optional AI-enhanced first frame, camera/movement metadata and a model-adapted prompt. The MVP does not generate video.

## Current status

Prompts 1–6 are implemented; the developer confirmed Prompt 6 acceptance and remote push on 2026-09-10. The application supports constrained 3D editing, movement preview, raw export and deterministic generic prompt compilation. Production image generation and target-model prompt support remain pending Prompt 7's provider spike.

The current focal baseline is D025: both OTS templates are v2 with 75mm for the current camera and movement start/end, and `focal_75mm` prompt semantics. The medium two-shot remains v1 at 35mm. All three templates remain `engineering_ready`; focal confirmation does not approve their composition or other directing content. Camera positions, targets, blocking and split OTS references are unchanged. Foreground-shoulder framing still requires Director review.

The supplied `aigc_project.rar` is an audited Python proof of concept, not the product scaffold. It is intentionally ignored and must be selectively ported according to the integration review.

## Read first

- [Codex instructions](AGENTS.md)
- [Decision log](docs/DECISIONS.md)
- [Product specification](docs/PRODUCT_SPEC.md)
- [MVP scope](docs/MVP_SCOPE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Director knowledge pack](docs/DIRECTOR_KNOWLEDGE_PACK.md)
- [Director handoff guide](docs/DIRECTOR_HANDOFF_GUIDE.md)
- [Workflows](docs/WORKFLOWS.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Two-week execution plan](docs/TWO_WEEK_EXECUTION_PLAN.md)
- [External prototype integration review](docs/AIGC_PROJECT_INTEGRATION.md)
- [AI agent handoff](docs/AI_AGENT_HANDOFF.md)
- [Staged Codex prompts](docs/CODEX_PROMPTS.md)

## Core workflow

```text
Choose a 2D shot example
        -> apply its structured shot template
        -> make simple semantic adjustments
        -> optionally refine the 3D scene
        -> preview the start/end camera movement
        -> render raw guide images
        -> optionally generate an enhanced first frame
        -> compile a target-model prompt
        -> export the input package
```

## Content ownership

The project initiator/director supplies and approves the director knowledge pack. Current shot examples are engineering placeholders only. The developer currently owns the development code; legal/IP terms are outside the present technical-design scope.

The shareable intake packet for the project initiator is under [`handoff/director/`](handoff/director/README.md).
