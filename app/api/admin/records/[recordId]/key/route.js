import { requireAdministrator } from "../../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  requireSameOrigin,
} from "../../../../../../lib/http.js";
import { getRuntimeContext } from "../../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    requireAdministrator(request);

    const { recordId } = await params;
    const normalizedRecordId = Number(recordId);
    if (!Number.isSafeInteger(normalizedRecordId) || normalizedRecordId < 1) {
      throw new HttpError(400, "Key 记录 ID 无效");
    }

    const recordKey = context.store.getAdministratorRecordKey(normalizedRecordId);
    if (!recordKey) {
      throw new HttpError(404, "Key 记录不存在");
    }
    if (!recordKey.key) {
      throw new HttpError(409, "该历史记录未保存完整 Key，无法恢复");
    }

    context.logger.info("administrator_record_key_revealed", {
      requestId,
      recordId: normalizedRecordId,
      instanceId: recordKey.instanceId,
    });
    return jsonResponse({
      success: true,
      data: {
        recordId: normalizedRecordId,
        key: recordKey.key,
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/records/:recordId/key",
    });
  }
}
