import { requireAdministrator } from "../../../../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  jsonResponse,
  requireSameOrigin,
} from "../../../../../../../../lib/http.js";
import { requireInstanceMember } from "../../../../../../../../lib/member-routes.js";
import { getRuntimeContext } from "../../../../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId, memberId } = await params;
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    requireInstanceMember(context.store, instanceId, memberId);
    const regeneratedAccess = context.store.regenerateMemberAccessKey(memberId);
    context.logger.info("instance_access_key_generated", {
      requestId,
      instanceId: Number(instanceId),
      memberId: Number(memberId),
    });
    return jsonResponse({ success: true, data: regeneratedAccess }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/instances/:instanceId/members/:memberId/access-key",
    });
  }
}
