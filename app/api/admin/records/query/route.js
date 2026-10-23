import { requireAdministrator } from "../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../../lib/http.js";
import { getRuntimeContext } from "../../../../../lib/runtime-context.js";
import { validateRecordQueryInput } from "../../../../../lib/validation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    const requestBody = await readJsonBody(request);
    const instanceId = requestBody?.instanceId
      ? Number(requestBody.instanceId)
      : null;
    if (instanceId !== null && (!Number.isSafeInteger(instanceId) || instanceId < 1)) {
      throw new HttpError(400, "实例筛选条件无效");
    }
    const memberId = requestBody?.memberId ? Number(requestBody.memberId) : null;
    if (memberId !== null && (!Number.isSafeInteger(memberId) || memberId < 1)) {
      throw new HttpError(400, "成员筛选条件无效");
    }
    const data = context.store.queryAdministratorRecords({
      ...validateRecordQueryInput(requestBody),
      instanceId,
      memberId,
    });
    return jsonResponse({ success: true, data }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/records/query",
    });
  }
}
