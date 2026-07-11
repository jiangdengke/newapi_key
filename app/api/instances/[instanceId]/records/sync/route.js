import { requireInstanceAccess } from "../../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../../../lib/http.js";
import { synchronizeInstanceRecords } from "../../../../../../lib/instance-service.js";
import { getRuntimeContext } from "../../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireSameOrigin(request);
    const { instance } = requireInstanceAccess(request, instanceId);
    if (!instance.enabled) {
      throw new HttpError(409, "该 New API 实例已停用");
    }
    await readJsonBody(request);
    const synchronization = await synchronizeInstanceRecords(instanceId, requestId);
    return jsonResponse({
      success: true,
      data: {
        ...synchronization,
        records: context.store.listRecords(instanceId),
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/instances/:instanceId/records/sync",
    });
  }
}
