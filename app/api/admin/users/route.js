import { validateOrdinaryUserInput } from "../../../../lib/admin-validation.js";
import { requireAdministrator } from "../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../lib/http.js";
import { getRuntimeContext } from "../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const requestId = createRequestId(request);
  const { store, logger } = getRuntimeContext();
  try {
    requireAdministrator(request);
    return jsonResponse({
      success: true,
      data: {
        users: store.listOrdinaryUsers(),
        instances: store.listInstances(),
        members: store.listUserAssignableMembers(),
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, logger, { method: "GET", path: "/api/admin/users" });
  }
}

async function saveUser(request, creating) {
  const requestId = createRequestId(request);
  const { store, logger } = getRuntimeContext();
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    const body = await readJsonBody(request);
    requireAdministrator(request);
    const userId = creating ? null : body?.id;
    if (!creating && (!Number.isSafeInteger(userId) || userId < 1)) {
      throw new HttpError(400, "普通用户编号无效");
    }
    if (!store.saveOrdinaryUser(userId, validateOrdinaryUserInput(body, { creating }))) {
      throw new HttpError(404, "普通用户不存在");
    }
    return jsonResponse({ success: true }, { status: creating ? 201 : 200, requestId });
  } catch (error) {
    return errorResponse(error, requestId, logger, { method: request.method, path: "/api/admin/users" });
  }
}

export async function POST(request) {
  return saveUser(request, true);
}

export async function PATCH(request) {
  return saveUser(request, false);
}
