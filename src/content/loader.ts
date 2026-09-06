/**
 * Production/test template-loading boundary.
 *
 * - `loadProductionTemplates` is the only production-facing entry. It returns
 *   exclusively `reviewStatus === "approved"` templates. With the current
 *   content (three `engineering_ready` templates) it returns an empty list.
 * - `loadDevelopmentTemplates` is the explicit opt-in for tests and clearly
 *   labeled development APIs: the caller must name the non-production
 *   statuses it wants; nothing is included implicitly.
 *
 * The review-status boundary must not be bypassed through environment
 * variables, implicit defaults or UI flags. Templates are treated as
 * immutable shared data; the loaders return new arrays, not copies of the
 * template objects themselves.
 */
import type { ReviewStatus, ShotTemplate } from "@/domain/shot-template";

export function isProductionLoadable(template: ShotTemplate): boolean {
  return template.reviewStatus === "approved";
}

/** Production-facing loader: only director-approved templates, sorted by id. */
export function loadProductionTemplates(
  templates: readonly ShotTemplate[],
): ShotTemplate[] {
  return templates.filter(isProductionLoadable).sort(byTemplateId);
}

export interface DevelopmentLoadOptions {
  /**
   * Explicitly declared statuses to include. There is no implicit default:
   * an omitted or empty list loads nothing, and `engineering_ready` content
   * only loads when it is named here by a test or development API.
   */
  includeStatuses: readonly ReviewStatus[];
}

/** Development/test loader: explicit opt-in only, sorted by id. */
export function loadDevelopmentTemplates(
  templates: readonly ShotTemplate[],
  options: DevelopmentLoadOptions,
): ShotTemplate[] {
  const included = new Set(options.includeStatuses);
  return templates.filter((template) => included.has(template.reviewStatus)).sort(byTemplateId);
}

function byTemplateId(a: ShotTemplate, b: ShotTemplate): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
