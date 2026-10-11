/**
 * The application-wide canonical shot-state store singleton.
 *
 * Binds the compiled template content and the explicit development-gallery
 * opt-in (engineering_ready + approved development content — never the
 * production loader; the production boundary stays in the loader itself).
 * Unit tests never import this module; they build stores from
 * createShotStore with injected fixtures.
 */
import { COMPILED_SHOT_TEMPLATES } from "@/content/compiled-content";

import { createShotStore } from "./shot-store";

export const appShotStore = createShotStore({
  templates: COMPILED_SHOT_TEMPLATES,
  includeStatuses: ["engineering_ready", "approved"],
});
