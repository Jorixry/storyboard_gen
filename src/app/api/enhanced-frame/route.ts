/**
 * POST /api/enhanced-frame (Prompt 7B1 transport + Prompt 7B2 registry).
 *
 * Thin transport wrapper: the entire contract (validation, single-active
 * adapter selection per D027, credentials-missing 503, timeout, structured
 * errors) lives in the pure core src/features/enhanced-frame/server.ts, which
 * is unit-tested directly. The handler reads the server-side environment
 * (IMAGE_PROVIDER + production keys), builds the production registry and
 * forwards everything; credentials never reach the client, logs or prompts.
 * Default state (no env) is the deterministic mock — zero network, zero cost.
 */
import { handleEnhancedFrameRequest } from "@/features/enhanced-frame/server";
import { buildImageAdapterRegistry } from "@/features/enhanced-frame/registry";

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
  const env = {
    imageProvider: process.env.IMAGE_PROVIDER,
    arkApiKey: process.env.ARK_API_KEY,
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY,
    dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL,
  };
  const result = await handleEnhancedFrameRequest(formData, env, {
    registry: buildImageAdapterRegistry(env),
  });
  return Response.json(result.body, { status: result.status });
}
