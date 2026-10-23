import { requireInstanceAccess } from "../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  jsonResponse,
} from "../../../../../lib/http.js";
import { getRuntimeContext } from "../../../../../lib/runtime-context.js";
import { resolveChannelDefaults } from "../../../../../lib/instance-service.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    const { instance, principal } = requireInstanceAccess(request, instanceId);
    const member = principal.kind === "visitor"
      ? context.store.getInstanceMember(principal.memberId)
      : null;
    const { adminUsername, memberCount, activeMemberCount, ...accessibleInstance } = instance;
    const channelDefaults = resolveChannelDefaults(instance, member);
    return jsonResponse({
      success: true,
      data: {
        instance: accessibleInstance,
        models: instance.channelModels.claude,
        modelsByChannelKind: instance.channelModels,
        channelDefaults,
        member: member ? { id: member.id, name: member.name, namePrefix: member.namePrefix } : null,
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "GET",
      path: "/api/instances/:instanceId/config",
    });
  }
}
