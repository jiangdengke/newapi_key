import { requireAuthenticatedPrincipal } from "../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  jsonResponse,
} from "../../../lib/http.js";
import { getRuntimeContext } from "../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createAccessibleInstance(instance) {
  if (!instance) {
    return null;
  }
  const {
    adminUsername,
    accessKey,
    adminHubTargetSiteId,
    ...accessibleInstance
  } = instance;
  return accessibleInstance;
}

export async function GET(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    const principal = requireAuthenticatedPrincipal(request);
    const storedInstances = principal.kind === "admin"
      ? context.store.listInstances()
      : [context.store.getInstance(principal.instanceId)].filter(Boolean);
    const instances = storedInstances.map(createAccessibleInstance);
    return jsonResponse({ success: true, data: { instances } }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "GET",
      path: "/api/instances",
    });
  }
}
