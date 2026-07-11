import { requireAdministrator } from "../../../../lib/auth.js";
import { validateInstanceInput } from "../../../../lib/admin-validation.js";
import {
  createRequestId,
  errorResponse,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../lib/http.js";
import { getRuntimeContext } from "../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    return jsonResponse({
      success: true,
      data: { instances: context.store.listInstances() },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "GET",
      path: "/api/admin/instances",
    });
  }
}

export async function POST(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    const instanceInput = validateInstanceInput(await readJsonBody(request));
    const instance = context.store.createInstance(instanceInput);
    context.logger.info("new_api_instance_created", {
      requestId,
      instanceId: instance.id,
    });
    return jsonResponse({ success: true, data: { instance } }, {
      status: 201,
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/instances",
    });
  }
}
