import { validateMemberInput } from "../../../../../../../lib/admin-validation.js";
import { requireAdministrator } from "../../../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../../../../lib/http.js";
import {
  requireInstanceMember,
  withMemberUniquenessMessage,
} from "../../../../../../../lib/member-routes.js";
import { getRuntimeContext } from "../../../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId, memberId } = await params;
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    requireInstanceMember(context.store, instanceId, memberId);
    const memberInput = validateMemberInput(await readJsonBody(request));
    const member = withMemberUniquenessMessage(
      () => context.store.updateInstanceMember(memberId, memberInput),
    );
    context.logger.info("instance_member_updated", {
      requestId,
      instanceId: Number(instanceId),
      memberId: member.id,
    });
    return jsonResponse({ success: true, data: { member } }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "PATCH",
      path: "/api/admin/instances/:instanceId/members/:memberId",
    });
  }
}

export async function DELETE(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId, memberId } = await params;
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    requireInstanceMember(context.store, instanceId, memberId);
    const member = context.store.deleteInstanceMember(memberId);
    context.logger.info("instance_member_deleted", {
      requestId,
      instanceId: Number(instanceId),
      memberId: member.id,
    });
    return jsonResponse({ success: true, data: { member } }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "DELETE",
      path: "/api/admin/instances/:instanceId/members/:memberId",
    });
  }
}
