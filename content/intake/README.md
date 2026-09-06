# Intake Processing Notes

## Director-facing source

The shareable director packet lives at `handoff/director/`. The director fills its human-readable CSV and submits reference images. The director is not expected to provide 3D coordinates or edit YAML.

## Internal processing stages

```text
handoff director CSV + reference images
        -> completeness/rights check
        -> engineering mapping to coordinates and typed semantics
        -> YAML template with engineering_ready status
        -> Schema validation
        -> 3D render review
        -> director_review status
        -> written director approval
        -> approved status
```

`shot-template-intake.csv` in this directory is an earlier engineering-level example containing explicit coordinate fields. Keep it for mapping/reference until the TypeScript compiler and stable internal mapping format exist; do not send it to the director as the primary form.

## Conversion constraints

- Preserve the director's original text and submitted filename in review metadata.
- Never infer professional approval from a complete CSV row.
- Never mark a template `approved` from a conversion script.
- Report fields that cannot map to the current camera/character/movement schema.
- Do not respond to unmappable content by expanding MVP scope automatically.
- Copy only reference images with acceptable rights into public product assets.

