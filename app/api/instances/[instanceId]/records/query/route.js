import { requireInstanceAccess } from "../../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../../../lib/http.js";
import { getRuntimeContext } from "../../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_RECORD_PAGE_SIZE = 100;
const MAXIMUM_RECORD_QUERY_KEY_LENGTH = 16_384;

export async function POST(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireSameOrigin(request);
    requireInstanceAccess(request, instanceId);
    const requestBody = await readJsonBody(request);
    const page = Number(requestBody?.page ?? 1);
    const pageSize = Number(requestBody?.pageSize ?? 10);
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
    if (key.length > MAXIMUM_RECORD_QUERY_KEY_LENGTH) {
      throw new HttpError(400, "查询 Key 长度超过限制");
    }
    const data = context.store.queryRecords({
      instanceId,
      key,
      page,
      pageSize,
    });
    return jsonResponse({ success: true, data }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/instances/:instanceId/records/query",
    });
  }
}
