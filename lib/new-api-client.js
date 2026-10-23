import { ANTHROPIC_CHANNEL_TYPE, CLAUDE_MODELS } from "./validation.js";

const REQUEST_TIMEOUT_MILLISECONDS = 20_000;
const CHANNEL_PAGE_SIZE = 100;
const MAXIMUM_CHANNEL_PAGES = 100;
const MAXIMUM_RATE_LIMIT_RETRY_DELAY_MILLISECONDS = 5_000;
const ACCESS_TOKEN_REFRESH_MARGIN_MILLISECONDS = 60_000;
const DEFAULT_ACCESS_TOKEN_LIFETIME_MILLISECONDS = 10 * 60 * 1_000;
const REFRESH_COOKIE_NAME = "new_api_refresh";
const SESSION_COOKIE_AUTHENTICATION = "session-cookie";
const ACCESS_TOKEN_AUTHENTICATION = "access-token";

export class NewApiRequestError extends Error {
  constructor(message, statusCode = 0) {
    super(message);
    this.name = "NewApiRequestError";
    this.statusCode = statusCode;
  }
}

function buildRequestSignal(externalSignal) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS);
  return externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getRateLimitRetryDelay(response) {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) {
    return 1_000;
  }

  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds)) {
    return Math.min(
      Math.max(retryAfterSeconds * 1_000, 0),
      MAXIMUM_RATE_LIMIT_RETRY_DELAY_MILLISECONDS,
    );
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) {
    return 1_000;
  }
  return Math.min(
    Math.max(retryAt - Date.now(), 0),
    MAXIMUM_RATE_LIMIT_RETRY_DELAY_MILLISECONDS,
  );
}

function getRateLimitMessage(response) {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) {
    return "New API 请求过于频繁，请稍后再试";
  }

  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return `New API 请求过于频繁，请在 ${Math.ceil(retryAfterSeconds)} 秒后再试`;
  }

  const retryAt = Date.parse(retryAfter);
  const remainingSeconds = Math.ceil((retryAt - Date.now()) / 1_000);
  if (!Number.isNaN(retryAt) && remainingSeconds > 0) {
    return `New API 请求过于频繁，请在 ${remainingSeconds} 秒后再试`;
  }
  return "New API 请求过于频繁，请稍后再试";
}

async function parseJsonResponse(response) {
  const responseText = await response.text();
  if (!responseText) {
    throw new NewApiRequestError(
      `New API 返回了空响应（HTTP ${response.status}）`,
      response.status,
    );
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new NewApiRequestError(
      `New API 返回了非 JSON 响应（HTTP ${response.status}）`,
      response.status,
    );
  }
}

function readCookiePairs(response) {
  return response.headers.getSetCookie()
    .map((setCookieHeader) => setCookieHeader.split(";", 1)[0].trim())
    .filter(Boolean);
}

function extractSessionCookie(response) {
  const cookiePairs = readCookiePairs(response);

  if (cookiePairs.length === 0) {
    throw new NewApiRequestError("登录成功，但 New API 没有返回会话 Cookie");
  }
  return cookiePairs.join("; ");
}

function extractRefreshCookie(response) {
  return readCookiePairs(response).find(
    (cookiePair) => cookiePair.startsWith(`${REFRESH_COOKIE_NAME}=`),
  ) || "";
}

function readAccessTokenSubject(accessToken) {
  try {
    const encodedPayload = String(accessToken).split(".")[1];
    const tokenPayload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    return tokenPayload?.sub ?? null;
  } catch {
    return null;
  }
}

function ensureSuccessfulPayload(responsePayload, fallbackMessage, statusCode) {
  if (!responsePayload || responsePayload.success !== true) {
    throw new NewApiRequestError(
      responsePayload?.message || fallbackMessage,
      statusCode,
    );
  }
  return responsePayload;
}

export class NewApiClient {
  constructor({ baseUrl, signal, logger } = {}) {
    this.baseUrl = baseUrl;
    this.externalSignal = signal;
    this.logger = logger;
    this.authenticationMode = null;
    this.sessionCookie = "";
    this.userId = null;
    this.credentials = null;
    this.accessToken = "";
    this.accessTokenExpiresAt = 0;
    this.authenticationSessionId = "";
    this.refreshCookie = "";
    this.accessTokenRenewalPromise = null;
  }

  async requestJson(pathname, requestOptions = {}) {
    const result = await this.sendRequest(pathname, requestOptions);
    if (
      requestOptions.authenticated
      && this.authenticationMode === ACCESS_TOKEN_AUTHENTICATION
      && result.response.status === 401
    ) {
      this.logger?.warn("new_api_access_token_rejected", {
        operation: requestOptions.operation || "request",
        statusCode: result.response.status,
      });
      this.accessTokenExpiresAt = 0;
      return this.sendRequest(pathname, requestOptions);
    }
    return result;
  }

  async createAuthenticationHeaders() {
    if (this.authenticationMode === ACCESS_TOKEN_AUTHENTICATION) {
      await this.ensureFreshAccessToken();
      return {
        Authorization: `Bearer ${this.accessToken}`,
        "New-Api-User": String(this.userId),
      };
    }
    if (
      this.authenticationMode === SESSION_COOKIE_AUTHENTICATION
      && this.sessionCookie
      && this.userId !== null
    ) {
      return {
        Cookie: this.sessionCookie,
        "New-Api-User": String(this.userId),
      };
    }
    throw new NewApiRequestError("尚未建立管理员会话");
  }

  async ensureFreshAccessToken() {
    if (Date.now() < this.accessTokenExpiresAt - ACCESS_TOKEN_REFRESH_MARGIN_MILLISECONDS) {
      return;
    }
    if (!this.accessTokenRenewalPromise) {
      this.accessTokenRenewalPromise = this.renewAccessToken().finally(() => {
        this.accessTokenRenewalPromise = null;
      });
    }
    await this.accessTokenRenewalPromise;
  }

  async renewAccessToken() {
    if (this.refreshCookie) {
      const { response, responsePayload } = await this.sendRequest("/api/user/auth/refresh", {
        method: "POST",
        headers: {
          Cookie: this.refreshCookie,
          ...(this.authenticationSessionId
            ? { "X-Auth-Session": this.authenticationSessionId }
            : {}),
        },
        operation: "refresh_access_token",
      });
      if (responsePayload?.success === true && responsePayload.data?.access_token) {
        this.applyAccessTokenSession(response, responsePayload.data);
        return;
      }
      this.logger?.warn("new_api_access_token_refresh_failed", {
        statusCode: response.status,
      });
    }
    if (!this.credentials) {
      throw new NewApiRequestError("New API 访问令牌已过期，请重新测试连接");
    }
    await this.login(this.credentials.username, this.credentials.password);
  }

  applyAccessTokenSession(response, sessionData) {
    const userId = sessionData.user?.id ?? readAccessTokenSubject(sessionData.access_token);
    if (userId === undefined || userId === null || userId === "") {
      throw new NewApiRequestError("登录响应中缺少管理员用户 ID");
    }
    const expiresAtSeconds = Number(sessionData.access_expires_at);
    this.authenticationMode = ACCESS_TOKEN_AUTHENTICATION;
    this.accessToken = sessionData.access_token;
    this.accessTokenExpiresAt = Number.isFinite(expiresAtSeconds) && expiresAtSeconds > 0
      ? expiresAtSeconds * 1_000
      : Date.now() + DEFAULT_ACCESS_TOKEN_LIFETIME_MILLISECONDS;
    this.authenticationSessionId = sessionData.session?.sid || this.authenticationSessionId;
    this.refreshCookie = extractRefreshCookie(response) || this.refreshCookie;
    this.userId = userId;
    return {
      id: userId,
      username: sessionData.user?.username,
      role: sessionData.user?.role,
    };
  }

  async sendRequest(
    pathname,
    {
      method = "GET",
      body,
      headers = {},
      authenticated = false,
      retryOnRateLimit = false,
      operation = "request",
    } = {},
  ) {
    const requestHeaders = {
      Accept: "application/json",
      ...headers,
    };
    if (body !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
    }
    if (authenticated) {
      Object.assign(requestHeaders, await this.createAuthenticationHeaders());
    }

    const maximumAttempts = retryOnRateLimit ? 2 : 1;
    for (let attemptNumber = 1; attemptNumber <= maximumAttempts; attemptNumber += 1) {
      const requestStartedAt = Date.now();
      let response;
      try {
        response = await fetch(`${this.baseUrl}${pathname}`, {
          method,
          headers: requestHeaders,
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
          redirect: "manual",
          signal: buildRequestSignal(this.externalSignal),
        });
      } catch (error) {
        this.logger?.error("new_api_request_failed", {
          operation,
          method,
          attemptNumber,
          durationMilliseconds: Date.now() - requestStartedAt,
          error,
        });
        if (error?.name === "TimeoutError") {
          throw new NewApiRequestError("连接 New API 超时，请检查地址和网络");
        }
        if (error?.name === "AbortError") {
          throw new NewApiRequestError("请求已取消");
        }
        throw new NewApiRequestError(`无法连接 New API：${error?.message || "网络错误"}`);
      }

      if (response.status === 429) {
        const retryDelay = getRateLimitRetryDelay(response);
        const willRetry = attemptNumber < maximumAttempts;
        this.logger?.warn("new_api_rate_limited", {
          operation,
          statusCode: response.status,
          ...(willRetry
            ? { retryAfterMilliseconds: retryDelay }
            : {}),
        });
        if (willRetry) {
          await response.body?.cancel();
          await wait(retryDelay);
          continue;
        }
        throw new NewApiRequestError(
          getRateLimitMessage(response),
          response.status,
        );
      }

      this.logger?.debug("new_api_request_completed", {
        operation,
        method,
        statusCode: response.status,
        attemptNumber,
        durationMilliseconds: Date.now() - requestStartedAt,
      });
      const responsePayload = await parseJsonResponse(response);
      return { response, responsePayload };
    }

    throw new NewApiRequestError("New API 请求失败");
  }

  async getStatus() {
    const { response, responsePayload } = await this.requestJson("/api/status", {
      retryOnRateLimit: true,
      operation: "get_status",
    });
    const successfulPayload = ensureSuccessfulPayload(
      responsePayload,
      "无法读取 New API 状态",
      response.status,
    );
    const statusData = successfulPayload.data;
    if (!statusData || typeof statusData !== "object" || Array.isArray(statusData)) {
      return successfulPayload;
    }
    return {
      ...successfulPayload,
      ...statusData,
    };
  }

  async login(username, password) {
    const { response, responsePayload } = await this.requestJson("/api/user/login", {
      method: "POST",
      body: { username, password },
      operation: "login",
    });
    ensureSuccessfulPayload(responsePayload, "管理员登录失败", response.status);

    if (responsePayload.data?.require_2fa === true) {
      throw new NewApiRequestError("该管理员账号启用了两步验证，当前工具暂不支持");
    }
    this.credentials = { username, password };
    if (typeof responsePayload.data?.access_token === "string") {
      const authenticatedUser = this.applyAccessTokenSession(response, responsePayload.data);
      return {
        ...authenticatedUser,
        username: authenticatedUser.username || username,
      };
    }
    if (responsePayload.data?.id === undefined || responsePayload.data?.id === null) {
      throw new NewApiRequestError("登录响应中缺少管理员用户 ID");
    }

    this.authenticationMode = SESSION_COOKIE_AUTHENTICATION;
    this.sessionCookie = extractSessionCookie(response);
    this.userId = responsePayload.data.id;
    return {
      id: responsePayload.data.id,
      username: responsePayload.data.username || username,
      role: responsePayload.data.role,
    };
  }

  async listAllChannels() {
    const channels = [];
    let pageNumber = 1;
    let totalChannels = Number.POSITIVE_INFINITY;

    while (
      channels.length < totalChannels &&
      pageNumber <= MAXIMUM_CHANNEL_PAGES
    ) {
      const queryParameters = new URLSearchParams({
        p: String(pageNumber),
        page_size: String(CHANNEL_PAGE_SIZE),
        type: String(ANTHROPIC_CHANNEL_TYPE),
      });
      const { response, responsePayload } = await this.requestJson(
        `/api/channel/?${queryParameters}`,
        {
          authenticated: true,
          retryOnRateLimit: true,
          operation: "list_channels",
        },
      );
      const successfulPayload = ensureSuccessfulPayload(
        responsePayload,
        "无法读取现有渠道",
        response.status,
      );
      const channelItems = Array.isArray(successfulPayload.data?.items)
        ? successfulPayload.data.items
        : [];
      totalChannels = Number(successfulPayload.data?.total ?? channelItems.length);
      channels.push(...channelItems);

      if (channelItems.length < CHANNEL_PAGE_SIZE) {
        break;
      }
      pageNumber += 1;
    }

    if (pageNumber > MAXIMUM_CHANNEL_PAGES && channels.length < totalChannels) {
      throw new NewApiRequestError("现有渠道数量过多，无法安全计算下一个名称");
    }
    return channels;
  }

  async listAllChannelNames() {
    const channels = await this.listAllChannels();
    return channels
      .map((channel) => channel?.name)
      .filter((channelName) => typeof channelName === "string");
  }

  async listChannelNamesByPrefix(channelNamePrefix) {
    const matchingChannelNames = [];
    let pageNumber = 1;
    let totalChannels = Number.POSITIVE_INFINITY;

    while (
      matchingChannelNames.length < totalChannels
      && pageNumber <= MAXIMUM_CHANNEL_PAGES
    ) {
      const queryParameters = new URLSearchParams({
        keyword: channelNamePrefix,
        p: String(pageNumber),
        page_size: String(CHANNEL_PAGE_SIZE),
      });
      const { response, responsePayload } = await this.requestJson(
        `/api/channel/search?${queryParameters}`,
        {
          authenticated: true,
          retryOnRateLimit: true,
          operation: "search_channels_by_prefix",
        },
      );
      const successfulPayload = ensureSuccessfulPayload(
        responsePayload,
        `无法查询名称前缀 ${channelNamePrefix} 对应的渠道`,
        response.status,
      );
      const channelItems = Array.isArray(successfulPayload.data?.items)
        ? successfulPayload.data.items
        : [];
      totalChannels = Number(successfulPayload.data?.total ?? channelItems.length);
      matchingChannelNames.push(
        ...channelItems
          .map((channel) => channel?.name)
          .filter(
            (channelName) => typeof channelName === "string"
              && channelName.startsWith(channelNamePrefix),
          ),
      );

      if (channelItems.length < CHANNEL_PAGE_SIZE) {
        break;
      }
      pageNumber += 1;
    }

    if (pageNumber > MAXIMUM_CHANNEL_PAGES && matchingChannelNames.length < totalChannels) {
      throw new NewApiRequestError(
        `名称前缀 ${channelNamePrefix} 对应的渠道数量过多，无法安全计算下一个名称`,
      );
    }
    return matchingChannelNames;
  }

  async searchChannelByName(channelName, channelType = null) {
    const queryParameters = new URLSearchParams({
      keyword: channelName,
      p: "1",
      page_size: "100",
    });
    if (channelType !== null) {
      queryParameters.set("type", String(channelType));
    }
    const { response, responsePayload } = await this.requestJson(
      `/api/channel/search?${queryParameters}`,
      {
        authenticated: true,
        retryOnRateLimit: true,
        operation: "search_channel_by_name",
      },
    );
    const successfulPayload = ensureSuccessfulPayload(
      responsePayload,
      `无法查询渠道 ${channelName}`,
      response.status,
    );
    const channelItems = Array.isArray(successfulPayload.data?.items)
      ? successfulPayload.data.items
      : [];
    const matchingChannel = channelItems.find(
      (channel) => channel?.name === channelName
        && (channelType === null || Number(channel?.type) === Number(channelType)),
    );
    return matchingChannel || null;
  }

  async findChannelByName(channelName, channelType) {
    const matchingChannel = await this.searchChannelByName(channelName, channelType);
    if (!matchingChannel) {
      throw new NewApiRequestError(`渠道 ${channelName} 已创建，但无法读取渠道 ID`);
    }
    return matchingChannel;
  }

  async searchAnthropicChannelByName(channelName) {
    return this.searchChannelByName(channelName, ANTHROPIC_CHANNEL_TYPE);
  }

  async findAnthropicChannelByName(channelName) {
    return this.findChannelByName(channelName, ANTHROPIC_CHANNEL_TYPE);
  }

  async verifyChannelAccess() {
    await this.searchChannelByName("__newapi_key_channel_access_probe__");
  }

  async listAvailableGroups() {
    const { response, responsePayload } = await this.requestJson("/api/group/", {
      authenticated: true,
      retryOnRateLimit: true,
      operation: "list_groups",
    });
    const successfulPayload = ensureSuccessfulPayload(
      responsePayload,
      "无法读取 New API 分组",
      response.status,
    );
    const rawGroups = Array.isArray(successfulPayload.data)
      ? successfulPayload.data
      : [];
    return [...new Set(
      rawGroups
        .map((group) => String(group).trim())
        .filter(Boolean),
    )];
  }

  async createChannel({
    key,
    name,
    group,
    priority,
    weight,
    channelType,
    models,
  }) {
    const requestBody = {
      mode: "single",
      multi_key_mode: "random",
      batch_add_set_key_prefix_2_name: false,
      channel: {
        type: channelType,
        name,
        key,
        models: models.join(","),
        group,
        priority,
        weight,
        status: 1,
        base_url: "",
        other: "",
        auto_ban: 1,
      },
    };
    const { response, responsePayload } = await this.requestJson("/api/channel/", {
      method: "POST",
      body: requestBody,
      authenticated: true,
      operation: "create_channel",
    });
    ensureSuccessfulPayload(responsePayload, `渠道 ${name} 创建失败`, response.status);
  }

  async createAnthropicChannel({ key, name, group, priority, weight }) {
    return this.createChannel({
      key,
      name,
      group,
      priority,
      weight,
      channelType: ANTHROPIC_CHANNEL_TYPE,
      models: CLAUDE_MODELS,
    });
  }
}
