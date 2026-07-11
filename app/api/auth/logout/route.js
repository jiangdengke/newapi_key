import {
  createExpiredSessionCookie,
  createRequestId,
  errorResponse,
  getSessionToken,
  jsonResponse,
  requireSameOrigin,
} from "../../../../lib/http.js";
import { getRuntimeContext } from "../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    context.store.deleteSession(getSessionToken(request));
    return jsonResponse({ success: true }, {
      requestId,
      headers: { "Set-Cookie": createExpiredSessionCookie() },
    });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/auth/logout",
    });
  }
}
