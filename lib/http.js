import { randomUUID } from "node:crypto";

import { NewApiRequestError } from "./new-api-client.js";
import { ValidationError } from "./validation.js";

export const SESSION_COOKIE_NAME = "newapi_key_session";
const MAXIMUM_REQUEST_BODY_BYTES = 9 * 1024 * 1024;

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function createRequestId(request) {
  return request.headers.get("X-Request-Id") || randomUUID();
}

export function getSessionToken(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const cookiePart of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookiePart.trim().split("=");
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(valueParts.join("="));
    }
  }
  return "";
}

export function createSessionCookie(sessionToken, expiresAt) {
  const secureAttribute = process.env.SESSION_COOKIE_SECURE === "false"
    ? ""
    : "; Secure";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`
    + `; Path=/; HttpOnly; SameSite=Strict${secureAttribute}`
    + `; Expires=${expiresAt.toUTCString()}`;
}

export function createExpiredSessionCookie() {
  const secureAttribute = process.env.SESSION_COOKIE_SECURE === "false"
    ? ""
    : "; Secure";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict`
    + `${secureAttribute}; Max-Age=0`;
}

export function requireSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return;
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  const requestHost = forwardedHost || request.headers.get("host");
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, "请求来源无效");
  }
  if (!requestHost || originHost !== requestHost) {
    throw new HttpError(403, "拒绝跨站请求");
  }
}

export async function readJsonBody(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAXIMUM_REQUEST_BODY_BYTES) {
    throw new HttpError(413, "请求内容过大");
  }
  let requestText;
  try {
    requestText = await request.text();
  } catch {
    throw new HttpError(400, "无法读取请求内容");
  }
  if (!requestText) {
    throw new HttpError(400, "请求内容不能为空");
  }
  if (Buffer.byteLength(requestText, "utf8") > MAXIMUM_REQUEST_BODY_BYTES) {
    throw new HttpError(413, "请求内容过大");
  }
  try {
    return JSON.parse(requestText);
  } catch {
    throw new HttpError(400, "请求内容不是有效的 JSON");
  }
}

export function jsonResponse(responseBody, {
  status = 200,
  requestId,
  headers = {},
} = {}) {
  return Response.json(responseBody, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(requestId ? { "X-Request-Id": requestId } : {}),
      ...headers,
    },
  });
}

export function errorResponse(error, requestId, logger, requestMetadata = {}) {
  const statusCode = error instanceof HttpError
    ? error.statusCode
    : error instanceof ValidationError
      ? 400
      : error instanceof NewApiRequestError
        ? 502
        : /UNIQUE constraint failed/i.test(String(error?.message))
          ? 409
          : 500;
  const message = statusCode === 500
    ? "服务处理请求失败"
    : statusCode === 409
      ? "名称、地址或用户名已存在"
      : error.message;
  logger.error("http_request_handler_failed", {
    requestId,
    statusCode,
    ...requestMetadata,
    error,
  });
  return jsonResponse({ success: false, message }, {
    status: statusCode,
    requestId,
  });
}
