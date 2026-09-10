/**
 * Contract tests for the VideoPromptAdapter boundary (Prompt 6 / Phase 2).
 *
 * Two tiers, documented honestly:
 *
 * Shared tier (every adapter, including the Prompt 1 mock):
 * - stable identity (adapterId + adapterVersion), deterministic output,
 *   non-empty prompt, string-array warnings;
 * - identity/geometry facts appear in the text with the EXACT numbers and ids
 *   of the spec: template id, template version, aspect ratio, focal length
 *   (and no focal number other than the spec's).
 *
 * Verbatim tier (currently the generic-video compiler; the tier every
 * production adapter must satisfy before leaving mock status):
 * - movement type, duration, primary-subject token and every continuity rule
 *   id appear VERBATIM — nothing the spec states may be reworded or dropped
 *   (the llmMayNotChange guarantees of content/adapters/generic-video.yaml,
 *   enforced before any LLM exists).
 *
 * Known gap, deliberately not patched here (Prompt 1 mock logic is frozen):
 * the mock renders humanized movement/subject labels and omits duration and
 * continuity ids; it stays a labeled placeholder and must not be treated as
 * the production compiler. See the Prompt 6 acceptance report.
 */
import { describe, expect, it } from "vitest";

import type { NormalizedShotSpec } from "@/domain/normalized-spec";
import { normalizeShotState } from "@/domain/normalized-spec";
import { createSequenceIdFactory } from "@/domain/ids";
import { createShotStateFromTemplate, type ShotState } from "@/domain/shot-state";
import type { VideoPromptAdapter } from "@/adapters/video-prompts/types";
import { MockVideoPromptAdapter } from "@/adapters/video-prompts/mock";
import {
  compileGenericPrompt,
  GENERIC_PROMPT_ADAPTER_ID,
  GENERIC_PROMPT_ADAPTER_VERSION,
} from "@/features/prompt-compiler/generic-compiler";

import { loadRealTemplates } from "../helpers/content-test-utils";

async function loadNormalized(templateId: string): Promise<NormalizedShotSpec> {
  const templates = await loadRealTemplates();
  const template = templates.find((candidate) => candidate.id === templateId);
  if (template === undefined) {
    throw new Error(`${templateId} not found in real content`);
  }
  const state: ShotState = createShotStateFromTemplate(template, {
    generateId: createSequenceIdFactory("shot"),
  });
  return normalizeShotState(state);
}

/** The deterministic generic compiler behind the same adapter interface. */
const genericAdapter: VideoPromptAdapter = {
  id: GENERIC_PROMPT_ADAPTER_ID,
  version: GENERIC_PROMPT_ADAPTER_VERSION,
  compile: async (spec) => compileGenericPrompt(spec),
};

const adapters: Array<{ name: string; adapter: VideoPromptAdapter }> = [
  { name: "generic-video", adapter: genericAdapter },
  { name: "mock-video-prompt", adapter: new MockVideoPromptAdapter() },
];

describe.each(adapters)("VideoPromptAdapter contract (shared tier): $name", ({ adapter }) => {
  it("reports a stable identity matching its compile output", async () => {
    const spec = await loadNormalized("dialogue_ots_a_to_b");
    const compiled = await adapter.compile(spec);
    expect(adapter.id.length).toBeGreaterThan(0);
    expect(adapter.version.length).toBeGreaterThan(0);
    expect(compiled.adapterId).toBe(adapter.id);
    expect(compiled.adapterVersion).toBe(adapter.version);
  });

  it("returns deterministic output for identical input", async () => {
    const spec = await loadNormalized("dialogue_ots_a_to_b");
    expect(await adapter.compile(spec)).toEqual(await adapter.compile(spec));
  });

  it("emits a non-empty prompt and string-array warnings", async () => {
    const spec = await loadNormalized("dialogue_ots_a_to_b");
    const compiled = await adapter.compile(spec);
    expect(compiled.prompt.length).toBeGreaterThan(0);
    expect(compiled.warnings.every((warning) => typeof warning === "string")).toBe(true);
  });

  it("preserves identity facts: template id and version", async () => {
    const spec = await loadNormalized("dialogue_ots_b_to_a");
    const { prompt } = await adapter.compile(spec);
    expect(prompt).toContain(spec.templateId);
    expect(prompt).toContain(`v${spec.templateVersion}`);
  });

  it("preserves geometry facts: aspect ratio and exactly one focal number", async () => {
    const spec = await loadNormalized("dialogue_ots_b_to_a");
    const { prompt } = await adapter.compile(spec);
    expect(prompt).toContain(spec.aspectRatio);
    const printedFocals = [...prompt.matchAll(/(\d+(?:\.\d+)?)mm/g)].map((match) =>
      Number(match[1]),
    );
    expect(printedFocals.length).toBeGreaterThan(0);
    expect(new Set(printedFocals)).toEqual(new Set([spec.focalLengthMm]));
  });
});

describe("VideoPromptAdapter contract (verbatim tier): generic-video", () => {
  it("preserves movement facts verbatim: type and duration", async () => {
    const spec = await loadNormalized("dialogue_ots_a_to_b");
    const { prompt } = await compileGenericPrompt(spec);
    expect(prompt).toContain(spec.movementType);
    expect(prompt).toContain(`${spec.movementDurationSeconds.toFixed(1)}s`);
    expect(prompt).toContain(spec.movementEasing);
  });

  it("preserves the primary-subject token verbatim", async () => {
    const spec = await loadNormalized("dialogue_ots_a_to_b");
    const { prompt } = await compileGenericPrompt(spec);
    expect(prompt).toContain(`primary subject: ${spec.primarySubject}`);
  });

  it("preserves every continuity rule id verbatim", async () => {
    const spec = await loadNormalized("dialogue_ots_a_to_b");
    const { prompt } = await compileGenericPrompt(spec);
    for (const ruleId of spec.continuityRuleIds) {
      expect(prompt).toContain(ruleId);
    }
  });
});

describe("VideoPromptAdapter contract: both paths on one fixture", () => {
  it("agrees on every shared-tier fact even though wording differs", async () => {
    const spec = await loadNormalized("dialogue_ots_a_to_b");
    const outputs = await Promise.all(
      adapters.map(async ({ adapter }) => ({
        id: adapter.id,
        compiled: await adapter.compile(spec),
      })),
    );
    for (const { compiled } of outputs) {
      expect(compiled.prompt).toContain(spec.templateId);
      expect(compiled.prompt).toContain(`${spec.focalLengthMm}mm`);
      expect(compiled.prompt).toContain(spec.aspectRatio);
    }
    expect(new Set(outputs.map((output) => output.id)).size).toBe(2);
  });
});
