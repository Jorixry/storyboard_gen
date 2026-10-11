/**
 * Field-level template diff for the full export package (2026-10-11
 * 技术部反馈回复 §2, director-approved): a DERIVED, read-only summary of how
 * the frozen ShotState deviates from its template defaults — one
 * `path: templateValue -> currentValue` line per changed field, or an
 * explicit no-deviations marker. It is never written back to the canonical
 * state and never feeds the prompts; reviewers get "what changed vs the
 * approved template" without diffing shot-state.json by hand.
 */
import type { ShotTemplate } from "@/domain/shot-template";
import type { ShotState } from "@/domain/shot-state";

export const TEMPLATE_DIFF_NO_DEVIATIONS =
  "(no deviations — the frozen state equals the template defaults)";

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function line(path: string, from: unknown, to: unknown): string {
  return `${path}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`;
}

/**
 * Deterministic diff text. Order: aspectRatio, camera, characters (template
 * order, matched by id), movement, semantics token arrays. Throws when the
 * template does not match the state's template id@version — the caller (the
 * package builder) treats that as a refusal, mirroring prompt-source checks.
 */
export function buildTemplateDiff(state: ShotState, template: ShotTemplate): string {
  if (state.template.id !== template.id || state.template.version !== template.version) {
    throw new Error(
      `template-diff refused: state carries ${state.template.id}@v${state.template.version} ` +
        `but the diff baseline is ${template.id}@v${template.version}`,
    );
  }

  const lines: string[] = [];
  const push = (path: string, from: unknown, to: unknown) => {
    if (!same(from, to)) {
      lines.push(line(path, from, to));
    }
  };

  push("aspectRatio", template.scene.aspectRatio, state.aspectRatio);
  push("camera.position", template.camera.position, state.camera.position);
  push("camera.target", template.camera.target, state.camera.target);
  push("camera.focalLengthMm", template.camera.focalLengthMm, state.camera.focalLengthMm);

  for (const templateCharacter of template.characters) {
    const stateCharacter = state.characters.find((c) => c.id === templateCharacter.id);
    if (stateCharacter === undefined) {
      lines.push(`characters.${templateCharacter.id}: present in template, missing in state`);
      continue;
    }
    push(
      `characters.${templateCharacter.id}.position`,
      templateCharacter.position,
      stateCharacter.position,
    );
    push(
      `characters.${templateCharacter.id}.rotationYDeg`,
      templateCharacter.rotationYDeg,
      stateCharacter.rotationYDeg,
    );
  }

  push("movement.type", template.movement.type, state.movement.type);
  push(
    "movement.durationSeconds",
    template.movement.durationSeconds,
    state.movement.durationSeconds,
  );
  push("movement.easing", template.movement.easing, state.movement.easing);
  push("movement.start.position", template.movement.start.position, state.movement.start.position);
  push("movement.start.target", template.movement.start.target, state.movement.start.target);
  push(
    "movement.start.focalLengthMm",
    template.movement.start.focalLengthMm,
    state.movement.start.focalLengthMm,
  );
  push("movement.end.position", template.movement.end.position, state.movement.end.position);
  push("movement.end.target", template.movement.end.target, state.movement.end.target);
  push(
    "movement.end.focalLengthMm",
    template.movement.end.focalLengthMm,
    state.movement.end.focalLengthMm,
  );

  const categories = ["subjects", "composition", "optics", "motion", "continuity"] as const;
  for (const category of categories) {
    push(`semantics.${category}`, template.promptSemantics[category], state.semantics[category]);
  }

  const header = [
    "template-diff: field-level deviations from the template defaults",
    `source: shot-state=${state.id} template=${template.id}@v${template.version} review-status=${template.reviewStatus}`,
  ];
  return [...header, ...(lines.length > 0 ? lines : [TEMPLATE_DIFF_NO_DEVIATIONS])].join("\n");
}
