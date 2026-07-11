import { validateAccessKeyInput } from "../../../../lib/admin-validation.js";
import {
  createRequestId,
  createSessionCookie,
  errorResponse,
  getSessionToken,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../lib/http.js";
import { getRuntimeContext } from "../../../../lib/runtime-context.js";
import { hashInstanceAccessKey } from "../../../../lib/security.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_FAILED_ATTEMPTS = 5;
const ACCESS_WINDOW_MILLISECONDS = 15 * 60 * 1_000;

export async function POST(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    const { accessKey } = validateAccessKeyInput(await readJsonBody(request));
    const clientAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || "unknown";
    const accessKeyReference = hashInstanceAccessKey(accessKey).slice(0, 16);
    const attemptKey = `${clientAddress}:${accessKeyReference}`;
    const currentTime = Date.now();
    const accessAttempts = context.accessAttempts || new Map();
    context.accessAttempts = accessAttempts;
    const attemptState = accessAttempts.get(attemptKey);
    if (
      attemptState
      && attemptState.expiresAt > currentTime
      && attemptState.failedCount >= MAXIMUM_FAILED_ATTEMPTS
    ) {
      return jsonResponse({ success: false, message: "验证失败次数过多，请稍后再试" }, {
        status: 429,
        requestId,
      });
    }

    const session = context.store.createVisitorSessionForAccessKey(accessKey);
    if (!session) {
      const failedCount = attemptState?.expiresAt > currentTime
        ? attemptState.failedCount + 1
        : 1;
      accessAttempts.set(attemptKey, {
        failedCount,
        expiresAt: currentTime + ACCESS_WINDOW_MILLISECONDS,
      });
      context.logger.warn("instance_access_failed", {
        requestId,
        failedCount,
      });
      return jsonResponse({ success: false, message: "实例访问 Key 无效或已停用" }, {
        status: 401,
        requestId,
      });
    }

    accessAttempts.delete(attemptKey);
    context.store.deleteSession(getSessionToken(request));
    context.logger.info("instance_access_succeeded", {
      requestId,
      instanceId: session.principal.instanceId,
    });
    return jsonResponse({
      success: true,
      data: { principal: session.principal },
    }, {
      requestId,
      headers: { "Set-Cookie": createSessionCookie(session.token, session.expiresAt) },
    });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/access/login",
    });
  }
}
