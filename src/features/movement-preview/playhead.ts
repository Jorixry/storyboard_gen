/**
 * Movement-preview playhead timing (Prompt 5 fix P2-1).
 *
 * Preview playback advances progress at the speed of the FULL movement
 * timeline: progress(t) = startProgress + elapsed / duration. The previous
 * formula multiplied the elapsed fraction by the REMAINING span
 * (`startProgress + span * elapsed/duration`), so resuming from any mid-point
 * stretched the remaining segment to the full duration again (a 4 s move
 * resumed from t=0.5 played another 4 s instead of ~2 s).
 *
 * Pure module, no React/browser imports: unit tests drive it with a
 * controlled clock (explicit elapsed milliseconds), never real sleeps.
 * Preview progress stays ephemeral UI state — it never enters ShotState or
 * localStorage; the movement's duration and easing themselves are never
 * modified by playback.
 */

/** Clamps any progress value into [0, 1]. */
export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    throw new RangeError(`playhead progress must be finite; got ${progress}`);
  }
  return Math.min(Math.max(progress, 0), 1);
}

/**
 * Where playback starts when the user presses play:
 * at the end (t >= 1) playback restarts from the beginning, otherwise from
 * the current paused position.
 */
export function resolvePlayStart(progress: number): number {
  const clamped = clampProgress(progress);
  return clamped >= 1 ? 0 : clamped;
}

/**
 * The playhead position after `elapsedMs` of playback that began at
 * `startProgress`, for a movement of `durationMs`. Constant full-timeline
 * speed, so the time to reach t=1 is exactly (1 - startProgress) * duration.
 */
export function advancePlayhead(
  startProgress: number,
  elapsedMs: number,
  durationMs: number,
): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError(`elapsedMs must be a finite non-negative number; got ${elapsedMs}`);
  }
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new RangeError(`durationMs must be a finite positive number; got ${durationMs}`);
  }
  return clampProgress(clampProgress(startProgress) + elapsedMs / durationMs);
}
