import { NewApiClient, NewApiRequestError } from "./new-api-client.js";
import { ANTHROPIC_CHANNEL_TYPE, CLAUDE_MODELS } from "./validation.js";

const CHANNEL_PAGE_SIZE = 100;
const MAXIMUM_CHANNEL_PAGES = 100;

function ensureSuccessfulPayload(responsePayload, fallbackMessage, statusCode) {
  if (!responsePayload || responsePayload.success !== true) {
    throw new NewApiRequestError(
      responsePayload?.message || fallbackMessage,
      statusCode,
    );
  }
  return responsePayload;
}

function parseStoredChannel(channelTemplate) {
  if (!channelTemplate?.channel_json) {
    return {};
  }
  try {
    return JSON.parse(channelTemplate.channel_json);
  } catch {
    throw new NewApiRequestError(
      `Admin Hub 渠道 ${channelTemplate.name || channelTemplate.id || "未知"} 配置无效`,
    );
  }
}

function normalizeModels(rawModels) {
  if (Array.isArray(rawModels)) {
    return rawModels.join(",");
  }
  return typeof rawModels === "string" ? rawModels : "";
}

function normalizeChannel(channelTemplate, additionalValues = {}) {
  const storedChannel = parseStoredChannel(channelTemplate);
  return {
    ...storedChannel,
    id: channelTemplate.id,
    type: Number(storedChannel.type ?? channelTemplate.type),
    name: channelTemplate.name || storedChannel.name,
    group: storedChannel.group || channelTemplate.group || "",
    models: normalizeModels(storedChannel.models ?? channelTemplate.models),
    status: Number(
      additionalValues.status
      ?? channelTemplate.status
      ?? storedChannel.status
      ?? 0,
    ),
    balance: Number(channelTemplate.balance ?? storedChannel.balance ?? 0),
    used_quota: Number(
      additionalValues.usedQuota
      ?? channelTemplate.used_quota
      ?? storedChannel.used_quota
      ?? 0,
    ),
  };
}

function getChannelItems(successfulPayload) {
  if (Array.isArray(successfulPayload.data?.items)) {
    return successfulPayload.data.items;
  }
  return Array.isArray(successfulPayload.data) ? successfulPayload.data : [];
}

function getResourceItems(successfulPayload) {
  if (Array.isArray(successfulPayload.data?.items)) {
    return successfulPayload.data.items;
  }
  if (Array.isArray(successfulPayload.data?.list)) {
    return successfulPayload.data.list;
  }
  return Array.isArray(successfulPayload.data) ? successfulPayload.data : [];
}

function normalizeSite(site) {
  const siteId = Number(site?.id ?? site?.site_id ?? site?.siteId);
  const siteName = String(site?.name ?? site?.site_name ?? site?.siteName ?? "").trim();
  if (!Number.isSafeInteger(siteId) || siteId <= 0 || !siteName) {
    return null;
  }
  return { id: siteId, name: siteName };
}

function getBatchResult(responseData, channelId) {
  const resultItems = Array.isArray(responseData)
    ? responseData
    : Array.isArray(responseData?.items)
      ? responseData.items
      : null;
  if (resultItems) {
    return resultItems.find((item) => Number(
      item?.id ?? item?.channel_id ?? item?.channelId,
    ) === Number(channelId));
  }
  if (responseData && typeof responseData === "object") {
    return responseData[channelId] ?? responseData[String(channelId)] ?? responseData;
  }
  return responseData;
}

function getMetricValue(batchResult, fieldNames) {
  if (typeof batchResult === "number") {
    return batchResult;
  }
  for (const fieldName of fieldNames) {
    if (batchResult?.[fieldName] !== undefined) {
      return Number(batchResult[fieldName]);
    }
  }
  return undefined;
}

export class AdminHubClient extends NewApiClient {
  constructor({ baseUrl, targetSiteId, signal, logger } = {}) {
    super({ baseUrl, signal, logger });
    if (
      targetSiteId !== undefined
      && targetSiteId !== null
      && (!Number.isSafeInteger(targetSiteId) || targetSiteId <= 0)
    ) {
      throw new NewApiRequestError("Admin Hub 目标站点 ID 无效");
    }
    this.targetSiteId = targetSiteId ?? null;
  }

  requireTargetSiteId() {
    if (!Number.isSafeInteger(this.targetSiteId) || this.targetSiteId <= 0) {
      throw new NewApiRequestError("请先选择 Admin Hub 目标站点");
    }
    return this.targetSiteId;
  }

  async listAvailableSites() {
    const queryParameters = new URLSearchParams({
      p: "1",
      page_size: "1000",
    });
    const { response, responsePayload } = await this.requestJson(
      `/api/admin-hub/resources/sites/?${queryParameters}`,
      {
        authenticated: true,
        retryOnRateLimit: true,
        operation: "admin_hub_list_sites",
      },
    );
    const successfulPayload = ensureSuccessfulPayload(
      responsePayload,
      "无法读取 Admin Hub 可见站点",
      response.status,
    );
    return getResourceItems(successfulPayload)
      .map(normalizeSite)
      .filter(Boolean);
  }

  async requestChannelPage({ keyword = "", pageNumber = 1, pageSize = CHANNEL_PAGE_SIZE }) {
    const targetSiteId = this.requireTargetSiteId();
    const queryParameters = new URLSearchParams({
      p: String(pageNumber),
      page_size: String(pageSize),
      site_id: String(targetSiteId),
    });
    if (keyword) {
      queryParameters.set("keyword", keyword);
    }
    const { response, responsePayload } = await this.requestJson(
      `/api/admin-hub/channels/?${queryParameters}`,
      {
        authenticated: true,
        retryOnRateLimit: true,
        operation: "admin_hub_list_channels",
      },
    );
    return ensureSuccessfulPayload(
      responsePayload,
      "无法读取 Admin Hub 渠道",
      response.status,
    );
  }

  async verifyChannelAccess() {
    await this.requestChannelPage({ pageSize: 1 });
  }

  async listChannelNamesByPrefix(channelNamePrefix) {
    const matchingChannelNames = [];
    let pageNumber = 1;
    let totalChannels = Number.POSITIVE_INFINITY;

    while (
      matchingChannelNames.length < totalChannels
      && pageNumber <= MAXIMUM_CHANNEL_PAGES
    ) {
      const successfulPayload = await this.requestChannelPage({
        keyword: channelNamePrefix,
        pageNumber,
      });
      const channelItems = getChannelItems(successfulPayload);
      totalChannels = Number(successfulPayload.data?.total ?? channelItems.length);
      matchingChannelNames.push(
        ...channelItems
          .map((channelTemplate) => normalizeChannel(channelTemplate))
          .filter((channel) => (
            channel.type === ANTHROPIC_CHANNEL_TYPE
            && typeof channel.name === "string"
            && channel.name.startsWith(channelNamePrefix)
          ))
          .map((channel) => channel.name),
      );

      if (channelItems.length < CHANNEL_PAGE_SIZE) {
        break;
      }
      pageNumber += 1;
    }

    if (pageNumber > MAXIMUM_CHANNEL_PAGES && matchingChannelNames.length < totalChannels) {
      throw new NewApiRequestError(
        `名称前缀 ${channelNamePrefix} 对应的 Admin Hub 渠道数量过多`,
      );
    }
    return matchingChannelNames;
  }

  async getChannelMetrics(channelId) {
    const [statusResult, usedQuotaResult] = await Promise.all([
      this.requestBatchMetric(
        "/api/admin-hub/channels/status-batch",
        channelId,
        "admin_hub_get_channel_status",
      ),
      this.requestBatchMetric(
        "/api/admin-hub/channels/used-quota",
        channelId,
        "admin_hub_get_channel_used_quota",
      ),
    ]);
    return {
      status: getMetricValue(statusResult, ["status", "channel_status"]),
      usedQuota: getMetricValue(usedQuotaResult, [
        "used_quota",
        "usedQuota",
        "total_used_quota",
      ]),
    };
  }

  async requestBatchMetric(pathname, channelId, operation) {
    const { response, responsePayload } = await this.requestJson(pathname, {
      method: "POST",
      body: { ids: [channelId] },
      authenticated: true,
      retryOnRateLimit: true,
      operation,
    });
    const successfulPayload = ensureSuccessfulPayload(
      responsePayload,
      "无法读取 Admin Hub 渠道状态",
      response.status,
    );
    return getBatchResult(successfulPayload.data, channelId);
  }

  async searchAnthropicChannelByName(channelName) {
    const successfulPayload = await this.requestChannelPage({ keyword: channelName });
    const matchingTemplate = getChannelItems(successfulPayload).find((channelTemplate) => {
      const channel = normalizeChannel(channelTemplate);
      return channel.name === channelName && channel.type === ANTHROPIC_CHANNEL_TYPE;
    });
    if (!matchingTemplate) {
      return null;
    }
    const channelMetrics = await this.getChannelMetrics(matchingTemplate.id);
    return normalizeChannel(matchingTemplate, channelMetrics);
  }

  async findAnthropicChannelByName(channelName) {
    const matchingChannel = await this.searchAnthropicChannelByName(channelName);
    if (!matchingChannel) {
      throw new NewApiRequestError(
        `Admin Hub 渠道 ${channelName} 已创建，但无法读取渠道 ID`,
      );
    }
    return matchingChannel;
  }

  async createAnthropicChannel({ key, name, group, priority, weight }) {
    const targetSiteId = this.requireTargetSiteId();
    const channel = {
      platform_channel_type: "anthropic_claude",
      type: ANTHROPIC_CHANNEL_TYPE,
      key,
      name,
      models: CLAUDE_MODELS.join(","),
      group,
      status: 1,
      priority,
      weight,
      auto_ban: 1,
      base_url: "",
      other: "",
      model_mapping: "",
      status_code_mapping: "",
      tag: "",
      setting: "{}",
      settings: "{}",
      param_override: "",
      header_override: "",
      remark: "",
      model_weights: "",
      other_info: "",
      channel_info: {},
      openai_organization: "",
      model_series: "anthropic.claude",
      test_model: CLAUDE_MODELS[0],
    };
    const requestBody = {
      name,
      description: "",
      channel_json: JSON.stringify(channel, null, 2),
      last_selected_site_ids_json: JSON.stringify([targetSiteId]),
      owner_user_id: null,
      site_group_overrides: {
        [targetSiteId]: [group],
      },
      site_publish_settings: {},
    };
    const { response, responsePayload } = await this.requestJson(
      "/api/admin-hub/channels/",
      {
        method: "POST",
        body: requestBody,
        authenticated: true,
        operation: "admin_hub_create_channel",
      },
    );
    ensureSuccessfulPayload(
      responsePayload,
      `无法创建 Admin Hub 渠道 ${name}`,
      response.status,
    );
  }
}
