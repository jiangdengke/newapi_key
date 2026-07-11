import { getAuthenticatedPrincipal } from "../../../../lib/auth.js";
import { createRequestId, jsonResponse } from "../../../../lib/http.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const requestId = createRequestId(request);
  const principal = getAuthenticatedPrincipal(request);
  if (!principal) {
    return jsonResponse({ success: false, message: "当前会话已失效，请重新进入" }, {
      status: 401,
      requestId,
    });
  }
  return jsonResponse({ success: true, data: { principal } }, { requestId });
}
