import { requireAdministrator } from "../../../../../lib/auth.js";
import { AdminHubClient } from "../../../../../lib/admin-hub-client.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../../lib/http.js";
import { getRuntimeContext } from "../../../../../lib/runtime-context.js";
import {
  normalizeNewApiBaseUrl,
  validateConnectionInput,
  ValidationError,
} from "../../../../../lib/validation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readOptionalInstanceId(rawInstanceId) {
  if (
    rawInstanceId === undefined
    || rawInstanceId === null
    || String(rawInstanceId).trim() === ""
  ) {
    return null;
  }
  const instanceId = Number(rawInstanceId);
  if (!Number.isSafeInteger(instanceId) || instanceId <= 0) {
    throw new ValidationError("实例 ID 无效");
  }
  return instanceId;
}

export async function POST(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    const requestBody = await readJsonBody(request);
    const instanceId = readOptionalInstanceId(requestBody?.instanceId);
    const storedConnection = instanceId === null
      ? null
      : context.store.getInstanceConnection(instanceId);
    if (instanceId !== null && !storedConnection) {
      throw new HttpError(404, "实例不存在");
    }

    const connectionInput = validateConnectionInput({
      baseUrl: normalizeNewApiBaseUrl(requestBody?.baseUrl),
      username: requestBody?.username,
      password: requestBody?.password || storedConnection?.password,
    });
    const client = new AdminHubClient({
      baseUrl: connectionInput.baseUrl,
      logger: context.logger,
    });
    const authenticatedUser = await client.login(
      connectionInput.username,
      connectionInput.password,
    );
    const sites = await client.listAvailableSites();

    return jsonResponse({
      success: true,
      data: {
        sites,
        username: authenticatedUser.username,
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/admin-hub/sites",
    });
  }
}
