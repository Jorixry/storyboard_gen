/**
 * POST /api/enhanced-frame (Prompt 7B1 / Phase 2 Day 8 fallback).
 *
 * Thin transport wrapper: the entire contract (validation, single-active
 * adapter selection per D027, timeout, structured errors) lives in the pure
 * core src/features/enhanced-frame/server.ts, which is unit-tested directly.
 * The handler reads no secrets beyond IMAGE_PROVIDER, logs none of them and
 * performs no calls of its own — the selected adapter owns generation (the
 * deterministic mock by default; production adapters arrive in Prompt 7B2).
 */
import { handleEnhancedFrameRequest } from "@/features/enhanced-frame/server";

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "invalid_form_data", message: "request body must be multipart/form-data" },
      { status: 400 },
    );
  }
  const result = await handleEnhancedFrameRequest(formData, {
    imageProvider: process.env.IMAGE_PROVIDER,
  });
  return Response.json(result.body, { status: result.status });
}
