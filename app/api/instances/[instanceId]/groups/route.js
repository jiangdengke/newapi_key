import { requireInstanceAccess } from "../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
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
    const { instance } = requireInstanceAccess(request, instanceId);
    if (instance.connectionProtocol !== "new-api") {
      throw new HttpError(400, "分组选择仅支持标准 New API 实例");
    }
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
