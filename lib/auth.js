import { HttpError, getSessionToken } from "./http.js";
import { getRuntimeContext } from "./runtime-context.js";

export function getAuthenticatedPrincipal(request) {
  const sessionToken = getSessionToken(request);
  return getRuntimeContext().store.getPrincipalBySessionToken(sessionToken);
}

export function requireAuthenticatedPrincipal(request) {
  const principal = getAuthenticatedPrincipal(request);
  if (!principal) {
    throw new HttpError(401, "当前会话已失效，请重新进入");
  }
  return principal;
}

export function requireAdministrator(request) {
  const principal = requireAuthenticatedPrincipal(request);
  if (principal.kind !== "admin") {
    throw new HttpError(403, "当前账号没有管理权限");
  }
  return principal;
}

export function requireInstanceAccess(request, instanceId) {
  const principal = requireAuthenticatedPrincipal(request);
  const normalizedInstanceId = Number(instanceId);
  if (!Number.isSafeInteger(normalizedInstanceId) || normalizedInstanceId < 1) {
    throw new HttpError(404, "New API 实例不存在");
  }
  if (principal.kind === "visitor" && principal.instanceId !== normalizedInstanceId) {
    throw new HttpError(403, "无权访问该 New API 实例");
  }

  const instance = getRuntimeContext().store.getInstance(normalizedInstanceId);
  if (!instance) {
    throw new HttpError(404, "New API 实例不存在");
  }
  if (!instance.enabled && principal.kind !== "admin") {
    throw new HttpError(403, "该 New API 实例已停用");
  }
  return { principal, instance };
}
