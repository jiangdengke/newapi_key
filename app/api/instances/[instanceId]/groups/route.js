import { requireInstanceAccess } from "../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  jsonResponse,
} from "../../../../../lib/http.js";
import {
  getInstanceAuthenticatedUser,
  getInstanceRuntime,
  getRuntimeContext,
} from "../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireInstanceAccess(request, instanceId);
    const instanceRuntime = getInstanceRuntime(instanceId);
    await getInstanceAuthenticatedUser(instanceRuntime);
    const groups = await instanceRuntime.client.listAvailableGroups();

    return jsonResponse({
      success: true,
      data: { groups },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "GET",
      path: "/api/instances/:instanceId/groups",
    });
  }
}
