/**
 * Development fixture resolution for the static director stage (Prompt 3 /
 * Phase 1 Day 3).
 *
 * Engineering-ready templates may enter the stage ONLY through this explicit
 * development path: the caller must name `engineering_ready` in
 * `includeStatuses`, exactly like tests do. The production loader keeps
 * returning zero templates for the current content, so nothing here can leak
 * into a production-facing gallery.
 *
 * Dependency-injected like src/content/loader.ts: no module-level content
 * import, keeping `npm test` independent of the generated compiled-content
 * module.
 */
import { defaultShotStateIdFactory, type ShotStateIdFactory } from "@/domain/ids";
import type { ShotState } from "@/domain/shot-state";
import { createShotStateFromTemplate } from "@/domain/shot-state";
import type { ShotTemplate, ReviewStatus } from "@/domain/shot-template";
import { loadDevelopmentTemplates } from "@/content/loader";

export interface DevelopmentFixtureOptions {
  /** Template to load for the stage; must be reachable through the opt-in. */
  templateId: string;
  /** Explicit non-production statuses, mirroring DevelopmentLoadOptions. */
  includeStatuses: readonly ReviewStatus[];
  /**
   * Deterministic ID factory override for tests (e.g. a shared sequence
   * factory). The default generates a unique UUIDv4 per load, matching the
   * canonical rule that every template load creates a fresh ShotState ID.
   */
  generateId?: ShotStateIdFactory;
}

export interface DevelopmentFixture {
  template: ShotTemplate;
  shotState: ShotState;
  /** Always false today: no template may be treated as director-approved. */
  isDirectorApproved: boolean;
}

export class FixtureTemplateNotLoadableError extends Error {
  constructor(
    readonly templateId: string,
    readonly includeStatuses: readonly ReviewStatus[],
  ) {
    super(
      `development fixture "${templateId}" is not loadable with includeStatuses=[${includeStatuses.join(", ")}]; ` +
        "engineering_ready content requires an explicit opt-in",
    );
    this.name = "FixtureTemplateNotLoadableError";
  }
}

export function resolveDevelopmentFixture(
  templates: readonly ShotTemplate[],
  options: DevelopmentFixtureOptions,
): DevelopmentFixture {
  const loadable = loadDevelopmentTemplates(templates, {
    includeStatuses: options.includeStatuses,
  });
  const template = loadable.find((candidate) => candidate.id === options.templateId);
  if (template === undefined) {
    throw new FixtureTemplateNotLoadableError(options.templateId, options.includeStatuses);
  }
  const generateId = options.generateId ?? defaultShotStateIdFactory;
  return {
    template,
    shotState: createShotStateFromTemplate(template, { generateId }),
    isDirectorApproved: template.reviewStatus === "approved",
  };
}
