/**
 * ShotState ID factory boundary.
 *
 * Production code uses the default factory (locally generated UUIDv4, no
 * network or dependency). Tests inject deterministic factories through
 * `createShotStateFromTemplate({ generateId })` instead of patching globals.
 */

export type ShotStateIdFactory = () => string;

export const defaultShotStateIdFactory: ShotStateIdFactory = () => crypto.randomUUID();

/**
 * Deterministic factory for tests: returns "prefix-1", "prefix-2", ...
 * Each instance produces its own counter, so two factories never collide.
 */
export function createSequenceIdFactory(prefix: string): ShotStateIdFactory {
  let counter = 0;
  return () => `${prefix}-${(counter += 1)}`;
}
