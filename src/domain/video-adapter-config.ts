/**
 * Executable contract for the versioned adapter-content files under
 * content/adapters/ (Prompt 6).
 *
 * content/adapters/generic-video.yaml is runtime product data, not a free-form
 * prompt: the content pipeline validates it against this schema, and the
 * generic VideoPromptAdapter consumes the validated config, so the YAML's
 * ordering and constraints have a real, test-pinned effect instead of being
 * silently copied into a second drifting configuration.
 *
 * Adapter files currently have no separate JSON-Schema mirror (unlike shot
 * templates); this Zod schema is the executable truth, enforced by
 * validate:content / compile:content.
 */
import { z } from "zod";

import { SEMANTIC_CATEGORIES } from "./schemas";
import { reviewStatusSchema, templateIdSchema } from "./shot-template";

export const videoPromptAdapterConfigSchema = z
  .strictObject({
    /** Stable adapter identity, e.g. "generic_video". */
    id: templateIdSchema,
    /** Version of the adapter-content file itself (bumped when it changes). */
    version: z.number().int().min(1),
    /** Review lifecycle of the adapter content; engineering files stay unapproved. */
    status: reviewStatusSchema,
    descriptionZh: z.string().min(1),
    /** Must be a permutation of exactly the five semantic categories. */
    ordering: z
      .array(z.enum(SEMANTIC_CATEGORIES))
      .length(SEMANTIC_CATEGORIES.length)
      .superRefine((ordering, ctx) => {
        const expected = [...SEMANTIC_CATEGORIES].sort();
        const actual = [...ordering].sort();
        if (actual.some((category, index) => category !== expected[index])) {
          ctx.addIssue({
            code: "custom",
            path: [],
            message: `ordering must contain each semantic category exactly once; expected a permutation of [${SEMANTIC_CATEGORIES.join(", ")}], got [${ordering.join(", ")}]`,
          });
        }
      }),
    constraints: z.strictObject({
      /** When true, numeric geometry facts always win over semantic tokens. */
      preserveStructuredFacts: z.boolean(),
      /** Permitted capability flag; NOT an obligation to implement polish. */
      allowLlmPolish: z.boolean(),
      llmMayChange: z.array(z.string().min(1)).min(1),
      llmMayNotChange: z.array(z.string().min(1)).min(1),
    }),
    directorNotes: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    if (!config.constraints.preserveStructuredFacts) {
      ctx.addIssue({
        code: "custom",
        path: ["constraints", "preserveStructuredFacts"],
        message:
          "adapter content must preserve structured facts; an adapter config that allows semantic tokens to override geometry cannot be wired into the deterministic compiler",
      });
    }
  });

export type VideoPromptAdapterConfig = z.infer<typeof videoPromptAdapterConfigSchema>;
