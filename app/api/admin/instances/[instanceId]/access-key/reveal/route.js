import { requireAdministrator } from "../../../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  requireSameOrigin,
} from "../../../../../../../lib/http.js";
import { getRuntimeContext } from "../../../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    const instanceAccess = context.store.getInstanceAccessKey(instanceId);
    if (!instanceAccess) {
      throw new HttpError(404, "New API 实例不存在");
    }
    if (!instanceAccess.accessKey) {
      throw new HttpError(409, "该访问 Key 生成于加密保存之前，请重新生成后再查看");
    }
    context.logger.info("instance_access_key_revealed", {
      requestId,
      instanceId: instanceAccess.instanceId,
    });
    return jsonResponse({
      success: true,
      data: {
        instanceId: instanceAccess.instanceId,
        accessKey: instanceAccess.accessKey,
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/instances/:instanceId/access-key/reveal",
    });
  }
}
