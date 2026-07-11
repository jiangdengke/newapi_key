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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_RECORD_PAGE_SIZE = 100;
const MAXIMUM_RECORD_QUERY_KEY_LENGTH = 16_384;
const MAXIMUM_CHANNEL_NAME_QUERY_LENGTH = 128;

export async function POST(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    const requestBody = await readJsonBody(request);
    const page = Number(requestBody?.page ?? 1);
    const pageSize = Number(requestBody?.pageSize ?? 10);
    const instanceId = requestBody?.instanceId
      ? Number(requestBody.instanceId)
      : null;
    const channelName = String(requestBody?.channelName ?? "").trim();
    const key = String(requestBody?.key ?? "").trim();

    if (!Number.isSafeInteger(page) || page < 1) {
      throw new HttpError(400, "页码必须是大于 0 的整数");
    }
    if (
      !Number.isSafeInteger(pageSize)
      || pageSize < 1
      || pageSize > MAXIMUM_RECORD_PAGE_SIZE
    ) {
      throw new HttpError(
        400,
        `每页数量必须是 1 到 ${MAXIMUM_RECORD_PAGE_SIZE} 之间的整数`,
      );
    }
    if (instanceId !== null && (!Number.isSafeInteger(instanceId) || instanceId < 1)) {
      throw new HttpError(400, "实例筛选条件无效");
    }
    if (channelName.length > MAXIMUM_CHANNEL_NAME_QUERY_LENGTH) {
      throw new HttpError(400, "渠道名称查询长度超过限制");
    }
    if (key.length > MAXIMUM_RECORD_QUERY_KEY_LENGTH) {
      throw new HttpError(400, "查询 Key 长度超过限制");
    }

    const data = context.store.queryAdministratorRecords({
      instanceId,
      channelName,
      key,
      page,
      pageSize,
    });
    return jsonResponse({ success: true, data }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/records/query",
    });
  }
}
