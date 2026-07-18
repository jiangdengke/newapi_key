import { requireInstanceAccess } from "../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  jsonResponse,
} from "../../../../../lib/http.js";
import { getRuntimeContext } from "../../../../../lib/runtime-context.js";
import {
  CLAUDE_MODELS,
  GROK_MODELS,
  OPENAI_MODELS,
  validateChannelDefaults,
} from "../../../../../lib/validation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    const { instance } = requireInstanceAccess(request, instanceId);
    const {
      adminUsername,
      accessKey,
      adminHubTargetSiteId,
      ...accessibleInstance
    } = instance;
    const channelDefaults = validateChannelDefaults({
      group: instance.group,
      namePrefix: instance.namePrefix,
      startNumber: instance.startNumber,
      continueFromExisting: instance.continueFromExisting,
      priority: instance.priority,
      weight: instance.weight,
      dateMode: instance.dateMode,
    });
    return jsonResponse({
      success: true,
      data: {
        instance: accessibleInstance,
        models: CLAUDE_MODELS,
        modelsByChannelKind: {
          claude: CLAUDE_MODELS,
          openai: OPENAI_MODELS,
          ...(instance.connectionProtocol === "new-api"
            ? { grok: GROK_MODELS }
            : {}),
        },
        channelDefaults,
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "GET",
      path: "/api/instances/:instanceId/config",
    });
  }
}
