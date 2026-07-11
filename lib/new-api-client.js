import { ANTHROPIC_CHANNEL_TYPE, CLAUDE_MODELS } from "./validation.js";

const REQUEST_TIMEOUT_MILLISECONDS = 20_000;
const CHANNEL_PAGE_SIZE = 100;
const MAXIMUM_CHANNEL_PAGES = 100;
const MAXIMUM_RATE_LIMIT_RETRY_DELAY_MILLISECONDS = 5_000;

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

function extractSessionCookie(response) {
  const setCookieHeaders = response.headers.getSetCookie();
  const cookiePairs = setCookieHeaders
    .map((setCookieHeader) => setCookieHeader.split(";", 1)[0])
    .filter(Boolean);

  if (cookiePairs.length === 0) {
    throw new NewApiRequestError("登录成功，但 New API 没有返回会话 Cookie");
  }
  return cookiePairs.join("; ");
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
    this.sessionCookie = "";
    this.userId = null;
  }

  async requestJson(
    pathname,
    {
      method = "GET",
      body,
      authenticated = false,
      retryOnRateLimit = false,
      operation = "request",
    } = {},
  ) {
    const requestHeaders = {
      Accept: "application/json",
    };
    if (body !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
    }
    if (authenticated) {
      if (!this.sessionCookie || this.userId === null) {
        throw new NewApiRequestError("尚未建立管理员会话");
      }
      requestHeaders.Cookie = this.sessionCookie;
      requestHeaders["New-Api-User"] = String(this.userId);
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
        this.logger?.warn("new_api_rate_limited", {
          operation,
          method,
          statusCode: response.status,
          attemptNumber,
          willRetry: attemptNumber < maximumAttempts,
          durationMilliseconds: Date.now() - requestStartedAt,
        });
        if (attemptNumber < maximumAttempts) {
          const retryDelay = getRateLimitRetryDelay(response);
          await response.body?.cancel();
          await wait(retryDelay);
          continue;
        }
        throw new NewApiRequestError(
          getRateLimitMessage(response),
          response.status,
        );
      }

      this.logger?.info("new_api_request_completed", {
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
    return ensureSuccessfulPayload(
      responsePayload,
      "无法读取 New API 状态",
      response.status,
    ).data;
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
    if (responsePayload.data?.id === undefined || responsePayload.data?.id === null) {
      throw new NewApiRequestError("登录响应中缺少管理员用户 ID");
    }

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
        type: String(ANTHROPIC_CHANNEL_TYPE),
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
          .filter((channel) => channel?.type === ANTHROPIC_CHANNEL_TYPE)
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

  async searchAnthropicChannelByName(channelName) {
    const queryParameters = new URLSearchParams({
      keyword: channelName,
      type: String(ANTHROPIC_CHANNEL_TYPE),
      p: "1",
      page_size: "100",
    });
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
      (channel) => channel?.name === channelName && channel?.type === ANTHROPIC_CHANNEL_TYPE,
    );
    return matchingChannel || null;
  }

  async findAnthropicChannelByName(channelName) {
    const matchingChannel = await this.searchAnthropicChannelByName(channelName);
    if (!matchingChannel) {
      throw new NewApiRequestError(`渠道 ${channelName} 已创建，但无法读取渠道 ID`);
    }
    return matchingChannel;
  }

  async createAnthropicChannel({ key, name, group, priority, weight }) {
    const requestBody = {
      mode: "single",
      multi_key_mode: "random",
      batch_add_set_key_prefix_2_name: false,
      channel: {
        type: ANTHROPIC_CHANNEL_TYPE,
        name,
        key,
        models: CLAUDE_MODELS.join(","),
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
}
