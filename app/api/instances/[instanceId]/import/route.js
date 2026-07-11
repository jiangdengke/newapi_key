import { requireInstanceAccess } from "../../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  readJsonBody,
  requireSameOrigin,
} from "../../../../../lib/http.js";
import { prepareChannelImport } from "../../../../../lib/instance-service.js";
import { getRuntimeContext } from "../../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const { instanceId } = await params;
  try {
    requireSameOrigin(request);
    const { instance } = requireInstanceAccess(request, instanceId);
    if (!instance.enabled) {
      throw new HttpError(409, "该 New API 实例已停用");
    }
    const requestBody = await readJsonBody(request);
    const channelImport = prepareChannelImport(instanceId, requestBody?.keys, requestId);
    const eventIterator = channelImport.events();
    const textEncoder = new TextEncoder();
    const responseStream = new ReadableStream({
      async pull(controller) {
        try {
          const nextEvent = await eventIterator.next();
          if (nextEvent.done) {
            controller.close();
            return;
          }
          controller.enqueue(
            textEncoder.encode(`${JSON.stringify(nextEvent.value)}\n`),
          );
        } catch (error) {
          controller.error(error);
        }
      },
      async cancel() {
        await eventIterator.return?.();
      },
    });
    return new Response(responseStream, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "X-Accel-Buffering": "no",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/instances/:instanceId/import",
    });
  }
}
