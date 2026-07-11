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
  const { instanceId } = await params;
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    const generatedAccess = context.store.regenerateInstanceAccessKey(instanceId);
    if (!generatedAccess) {
      throw new HttpError(404, "New API 实例不存在");
    }
    context.logger.info("instance_access_key_generated", {
      requestId,
      instanceId: Number(instanceId),
    });
    return jsonResponse({
      success: true,
      data: {
        instance: generatedAccess.instance,
        accessKey: generatedAccess.accessKey,
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/instances/:instanceId/access-key",
    });
  }
}

export async function DELETE(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    const instance = context.store.disableInstanceAccessKey(instanceId);
    if (!instance) {
      throw new HttpError(404, "New API 实例不存在");
    }
    context.logger.info("instance_access_key_disabled", {
      requestId,
      instanceId: Number(instanceId),
    });
    return jsonResponse({ success: true, data: { instance } }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "DELETE",
      path: "/api/admin/instances/:instanceId/access-key",
    });
  }
}
