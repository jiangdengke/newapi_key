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
    const { instance, principal } = requireInstanceAccess(request, instanceId);
    const memberId = principal.kind === "visitor" ? principal.memberId : null;
    if (!instance.enabled) {
      throw new HttpError(409, "该 New API 实例已停用");
    }
    await readJsonBody(request);
    const { memberCounts, ...synchronization } = await synchronizeInstanceRecords(instanceId, requestId);
    const visibleSynchronization = memberId
      ? {
        ...synchronization,
        synchronizedCount: memberCounts.get(memberId)?.synchronizedCount ?? 0,
        missingCount: memberCounts.get(memberId)?.missingCount ?? 0,
        usageStartedRecords: synchronization.usageStartedRecords
          .filter((record) => record.memberId === memberId),
      }
      : synchronization;
    return jsonResponse({
      success: true,
      data: {
        ...visibleSynchronization,
        records: context.store.listRecords(instanceId, memberId),
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/instances/:instanceId/records/sync",
    });
  }
}
