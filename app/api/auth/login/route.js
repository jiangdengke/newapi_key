import { validateLoginInput } from "../../../../lib/admin-validation.js";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_FAILED_ATTEMPTS = 5;
const LOGIN_WINDOW_MILLISECONDS = 15 * 60 * 1_000;

export async function POST(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  const startedAt = Date.now();
  try {
    requireSameOrigin(request);
    const loginInput = validateLoginInput(await readJsonBody(request));
    const clientAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || "unknown";
    const attemptKey = `${clientAddress}:${loginInput.username.toLowerCase()}`;
    const currentTime = Date.now();
    const attemptState = context.loginAttempts.get(attemptKey);
    if (
      attemptState
      && attemptState.expiresAt > currentTime
      && attemptState.failedCount >= MAXIMUM_FAILED_ATTEMPTS
    ) {
      return jsonResponse({ success: false, message: "登录失败次数过多，请稍后再试" }, {
        status: 429,
        requestId,
      });
    }

    const account = context.store.authenticateAccount(
      loginInput.username,
      loginInput.password,
    );
    if (!account) {
      const failedCount = attemptState?.expiresAt > currentTime
        ? attemptState.failedCount + 1
        : 1;
      context.loginAttempts.set(attemptKey, {
        failedCount,
        expiresAt: currentTime + LOGIN_WINDOW_MILLISECONDS,
      });
      context.logger.warn("application_login_failed", {
        username: loginInput.username,
        failedCount,
        durationMilliseconds: Date.now() - startedAt,
        requestId,
      });
      return jsonResponse({ success: false, message: "用户名或密码错误" }, {
        status: 401,
        requestId,
      });
    }

    context.loginAttempts.delete(attemptKey);
    context.store.deleteSession(getSessionToken(request));
    const session = context.store.createAccountSession(account.id);
    context.logger.info("application_login_succeeded", {
      username: account.username,
      durationMilliseconds: Date.now() - startedAt,
      ...(account.kind === "admin" ? { administratorId: account.id } : { userId: account.id }),
      requestId,
    });
    return jsonResponse({ success: true, data: { principal: account } }, {
      requestId,
      headers: { "Set-Cookie": createSessionCookie(session.token, session.expiresAt) },
    });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/auth/login",
    });
  }
}
