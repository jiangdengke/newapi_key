import { validateMemberInput } from "../../../../../../lib/admin-validation.js";
import { requireAdministrator } from "../../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../../../lib/http.js";
import { withMemberUniquenessMessage } from "../../../../../../lib/member-routes.js";
import { getRuntimeContext } from "../../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireAdministrator(request);
    if (!context.store.getInstance(instanceId)) {
      throw new HttpError(404, "New API 实例不存在");
    }
    return jsonResponse({
      success: true,
      data: { members: context.store.listInstanceMembers(instanceId) },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "GET",
      path: "/api/admin/instances/:instanceId/members",
    });
  }
}

export async function POST(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    const memberInput = validateMemberInput(await readJsonBody(request));
    const createdMember = withMemberUniquenessMessage(
      () => context.store.createInstanceMember(instanceId, memberInput),
    );
    if (!createdMember) {
      throw new HttpError(404, "New API 实例不存在");
    }
    context.logger.info("instance_member_created", {
      requestId,
      instanceId: Number(instanceId),
      memberId: createdMember.member.id,
    });
    return jsonResponse({ success: true, data: createdMember }, { status: 201, requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/instances/:instanceId/members",
    });
  }
}
