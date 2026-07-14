import { requireAdministrator } from "../../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  requireSameOrigin,
} from "../../../../../../lib/http.js";
import {
  getInstanceAuthenticatedUser,
  getInstanceRuntime,
  getInstanceSystemStatus,
  getRuntimeContext,
} from "../../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    const instanceRuntime = getInstanceRuntime(instanceId);
    if (!instanceRuntime) {
      throw new HttpError(404, "New API 实例不存在");
    }
    const systemStatus = await getInstanceSystemStatus(instanceRuntime);
    const authenticatedUser = await getInstanceAuthenticatedUser(instanceRuntime);
    await instanceRuntime.client.verifyChannelAccess();
    return jsonResponse({
      success: true,
      data: {
        systemName: systemStatus?.system_name || "New API",
        version: systemStatus?.version || "未知版本",
        username: authenticatedUser.username,
        connectionProtocol: instanceRuntime.connection.connectionProtocol,
        adminHubTargetSiteId: instanceRuntime.connection.adminHubTargetSiteId,
        channelAccessVerified: true,
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/instances/:instanceId/test",
    });
  }
}
