import { requireAdministrator } from "../../../../lib/auth.js";
import { validateAdministratorPasswordChangeInput } from "../../../../lib/admin-validation.js";
import {
  createRequestId,
  errorResponse,
  getSessionToken,
  HttpError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../lib/http.js";
import { getRuntimeContext } from "../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    const administrator = requireAdministrator(request);
    const passwordInput = validateAdministratorPasswordChangeInput(
      await readJsonBody(request),
    );
    const passwordChanged = context.store.changeAdministratorPassword({
      administratorId: administrator.id,
      currentPassword: passwordInput.currentPassword,
      newPassword: passwordInput.newPassword,
      currentSessionToken: getSessionToken(request),
    });
    if (!passwordChanged) {
      throw new HttpError(400, "当前密码不正确");
    }

    context.logger.info("administrator_password_changed", {
      administratorId: administrator.id,
      username: administrator.username,
      requestId,
    });
    return jsonResponse({
      success: true,
      data: { otherSessionsRevoked: true },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/password",
    });
  }
}
