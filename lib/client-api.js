export async function readJsonResponse(response, { notifySessionExpired = true } = {}) {
  let responsePayload;
  try {
    responsePayload = await response.json();
  } catch {
    throw new Error(`服务返回了无法识别的响应（HTTP ${response.status}）`);
  }
  if (!response.ok || responsePayload.success !== true) {
    if (
      notifySessionExpired
      && response.status === 401
      && typeof window !== "undefined"
    ) {
      window.dispatchEvent(new Event("application-session-expired"));
    }
    const requestId = response.headers.get("x-request-id");
    const requestSuffix = requestId ? `（请求 ID：${requestId}）` : "";
    throw new Error(
      `${responsePayload.message || `请求失败（HTTP ${response.status}）`}${requestSuffix}`,
    );
  }
  return responsePayload;
}

export async function requestJson(pathname, options = {}) {
  const {
    suppressSessionExpiredEvent = false,
    ...fetchOptions
  } = options;
  const response = await fetch(pathname, {
    cache: "no-store",
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...fetchOptions.headers,
    },
  });
  return readJsonResponse(response, {
    notifySessionExpired: !suppressSessionExpiredEvent,
  });
}
