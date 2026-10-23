import { requireInstanceAccess } from "../../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../../../lib/http.js";
import { getRuntimeContext } from "../../../../../../lib/runtime-context.js";
import { validateRecordQueryInput } from "../../../../../../lib/validation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireSameOrigin(request);
    requireInstanceAccess(request, instanceId);
    const requestBody = await readJsonBody(request);
    const data = context.store.queryRecords({
      ...validateRecordQueryInput(requestBody),
      instanceId,
    });
    return jsonResponse({ success: true, data }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/instances/:instanceId/records/query",
    });
  }
}
