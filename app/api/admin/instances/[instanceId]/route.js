import { validateInstanceInput } from "../../../../../lib/admin-validation.js";
import { requireAdministrator } from "../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../../lib/http.js";
import {
  clearInstanceRuntime,
  getRuntimeContext,
} from "../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    if (!context.store.getInstance(instanceId)) {
      throw new HttpError(404, "New API 实例不存在");
    }
    const instanceInput = validateInstanceInput(await readJsonBody(request), {
      passwordRequired: false,
    });
    const instance = context.store.updateInstance(instanceId, instanceInput);
    clearInstanceRuntime(instanceId);
    context.logger.info("new_api_instance_updated", {
      requestId,
      instanceId: Number(instanceId),
    });
    return jsonResponse({ success: true, data: { instance } }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "PATCH",
      path: "/api/admin/instances/:instanceId",
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
    const deletion = context.store.deleteInstance(instanceId);
    if (!deletion) {
      throw new HttpError(404, "New API 实例不存在");
    }
    clearInstanceRuntime(instanceId);
    context.logger.info("new_api_instance_deleted", {
      requestId,
      instanceId: Number(instanceId),
      deletedChannelRecordCount: deletion.deletedChannelRecordCount,
    });
    return jsonResponse({
      success: true,
      data: {
        instanceId: Number(instanceId),
        deletedChannelRecordCount: deletion.deletedChannelRecordCount,
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "DELETE",
      path: "/api/admin/instances/:instanceId",
    });
  }
}
