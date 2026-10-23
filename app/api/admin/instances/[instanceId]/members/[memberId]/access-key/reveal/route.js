import { requireAdministrator } from "../../../../../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  requireSameOrigin,
} from "../../../../../../../../../lib/http.js";
import { requireInstanceMember } from "../../../../../../../../../lib/member-routes.js";
import { getRuntimeContext } from "../../../../../../../../../lib/runtime-context.js";

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
    const memberAccess = context.store.getMemberAccessKey(memberId);
    if (!memberAccess.accessKey) {
      throw new HttpError(409, "该访问 Key 生成于加密保存之前，请重新生成后再查看");
    }
    context.logger.info("instance_access_key_revealed", {
      requestId,
      instanceId: Number(instanceId),
      memberId: Number(memberId),
    });
    return jsonResponse({ success: true, data: memberAccess }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/instances/:instanceId/members/:memberId/access-key/reveal",
    });
  }
}
