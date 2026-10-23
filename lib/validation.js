export const ANTHROPIC_CHANNEL_TYPE = 14;
export const OPENAI_CHANNEL_TYPE = 1;
export const XAI_CHANNEL_TYPE = 48;
export const AWS_CHANNEL_TYPE = 33;

export const CHANNEL_KINDS = Object.freeze({
  CLAUDE: "claude",
  OPENAI: "openai",
  GROK: "grok",
  AWS: "aws",
});

export const AWS_API_TYPES = Object.freeze({
  INVOKE_MODEL: "invoke_model",
  MANTLE: "mantle",
});

export const CLAUDE_MODELS = Object.freeze([
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
]);

export const OPENAI_MODELS = Object.freeze([
  "gpt-5.6-sol",
]);

export const GROK_MODELS = Object.freeze([
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-0309-reasoning",
  "grok-4.20-multi-agent-0309",
  "grok-4.3",
  "grok-4.5",
  "grok-build-0.1",
  "grok-imagine-image",
  "grok-imagine-image-quality",
  "grok-imagine-video",
  "grok-imagine-video-1.5",
]);

export const DEFAULT_CHANNEL_MODELS = Object.freeze({
  [CHANNEL_KINDS.CLAUDE]: CLAUDE_MODELS,
  [CHANNEL_KINDS.OPENAI]: OPENAI_MODELS,
  [CHANNEL_KINDS.GROK]: GROK_MODELS,
  [CHANNEL_KINDS.AWS]: CLAUDE_MODELS,
});

export const CHANNEL_KIND_LABELS = Object.freeze({
  [CHANNEL_KINDS.CLAUDE]: "Claude",
  [CHANNEL_KINDS.OPENAI]: "OpenAI",
  [CHANNEL_KINDS.GROK]: "Grok",
  [CHANNEL_KINDS.AWS]: "AWS",
});

const AWS_REGION_PATTERN = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;
const AWS_ACCESS_KEY_PATTERN = /^[A-Za-z0-9]{16,128}$/;
const AWS_SECRET_PATTERN = /^\S{16,1024}$/;

export const MODEL_NAME_SEPARATOR_PATTERN = /[\s,，]+/;

const MAXIMUM_KEY_COUNT = 500;
const MAXIMUM_KEY_LENGTH = 16_384;
const MAXIMUM_CHANNEL_MODEL_COUNT = 100;
const MAXIMUM_MODEL_NAME_LENGTH = 128;
const MAXIMUM_RECORD_PAGE_SIZE = 100;
const MAXIMUM_RECORD_QUERY_KEY_LENGTH = 16_384;
const MAXIMUM_RECORD_QUERY_TEXT_LENGTH = 128;
const RECORD_STATUS_FILTERS = new Set(["enabled", "disabled", "missing"]);
const RECORD_CHANNEL_KIND_FILTERS = new Set([...Object.values(CHANNEL_KINDS), "unknown"]);
const RECORD_SORT_FIELDS = new Set([
  "importedAt",
  "lastSyncedAt",
  "usedUsd",
  "balanceUsd",
  "channelName",
]);

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export function normalizeNewApiBaseUrl(rawBaseUrl) {
  const trimmedBaseUrl = String(rawBaseUrl ?? "").trim();
  if (!trimmedBaseUrl) {
    throw new ValidationError("请填写 New API 地址");
  }

  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(trimmedBaseUrl);
  } catch {
    throw new ValidationError("New API 地址格式无效");
  }

  if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) {
    throw new ValidationError("New API 地址仅支持 http 或 https");
  }
  if (parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new ValidationError("New API 地址中不能包含账号或密码");
  }
  if (parsedBaseUrl.search || parsedBaseUrl.hash) {
    throw new ValidationError("New API 地址中不能包含查询参数或锚点");
  }

  parsedBaseUrl.pathname = parsedBaseUrl.pathname.replace(/\/+$/, "");
  return parsedBaseUrl.toString().replace(/\/$/, "");
}

export function normalizeKeys(rawKeys) {
  const keyCandidates = Array.isArray(rawKeys)
    ? rawKeys
    : String(rawKeys ?? "").split(/\r?\n/);
  const normalizedKeys = [];
  const seenKeys = new Set();

  for (const keyCandidate of keyCandidates) {
    const normalizedKey = String(keyCandidate).trim();
    if (!normalizedKey || seenKeys.has(normalizedKey)) {
      continue;
    }
    if (normalizedKey.length > MAXIMUM_KEY_LENGTH) {
      throw new ValidationError("单个 Key 长度超过限制");
    }
    seenKeys.add(normalizedKey);
    normalizedKeys.push(normalizedKey);
  }

  if (normalizedKeys.length === 0) {
    throw new ValidationError("请至少填写一个 Key");
  }
  if (normalizedKeys.length > MAXIMUM_KEY_COUNT) {
    throw new ValidationError(`一次最多导入 ${MAXIMUM_KEY_COUNT} 个 Key`);
  }
  return normalizedKeys;
}

function validateRequiredText(rawValue, fieldName, maximumLength) {
  const normalizedValue = String(rawValue ?? "").trim();
  if (!normalizedValue) {
    throw new ValidationError(`请填写${fieldName}`);
  }
  if (normalizedValue.length > maximumLength) {
    throw new ValidationError(`${fieldName}长度不能超过 ${maximumLength} 个字符`);
  }
  if (/\p{Cc}/u.test(normalizedValue)) {
    throw new ValidationError(`${fieldName}不能包含控制字符`);
  }
  return normalizedValue;
}

export function validateConnectionInput(rawInput) {
  return {
    baseUrl: normalizeNewApiBaseUrl(rawInput?.baseUrl),
    username: validateRequiredText(rawInput?.username, "管理员用户名", 128),
    password: validateRequiredText(rawInput?.password, "管理员密码", 4_096),
  };
}

function parseBooleanSetting(rawValue, fieldName, defaultValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return defaultValue;
  }
  const normalizedValue = String(rawValue).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalizedValue)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalizedValue)) {
    return false;
  }
  throw new ValidationError(`${fieldName}必须是 true 或 false`);
}

function parseSafeIntegerSetting(
  rawValue,
  fieldName,
  { defaultValue = 0, minimumValue = Number.MIN_SAFE_INTEGER } = {},
) {
  const normalizedValue = rawValue === undefined || rawValue === null || rawValue === ""
    ? defaultValue
    : Number(rawValue);
  if (!Number.isSafeInteger(normalizedValue) || normalizedValue < minimumValue) {
    const rangeDescription = minimumValue === 0 ? "非负安全整数" : "安全整数";
    throw new ValidationError(`${fieldName}必须是${rangeDescription}`);
  }
  return normalizedValue;
}

function getCurrentDateSegment() {
  const currentDate = new Date();
  const month = String(currentDate.getMonth() + 1).padStart(2, "0");
  const day = String(currentDate.getDate()).padStart(2, "0");
  return `${month}${day}`;
}

export function validateChannelDefaults(rawInput = {}) {
  const group = validateRequiredText(rawInput.group ?? "anthropic", "默认分组", 64);
  const namePrefix = validateRequiredText(
    rawInput.namePrefix ?? "claude",
    "默认名称前缀",
    64,
  );
  const startNumber = Number(rawInput.startNumber ?? 1);
  const priority = parseSafeIntegerSetting(rawInput.priority, "渠道优先级");
  const weight = parseSafeIntegerSetting(rawInput.weight, "渠道权重", {
    minimumValue: 0,
  });
  const dateMode = String(rawInput.dateMode ?? "auto").trim().toLowerCase();

  if (!Number.isSafeInteger(startNumber) || startNumber < 1 || startNumber > 999_999) {
    throw new ValidationError("默认起始序号必须是 1 到 999999 之间的整数");
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(group)) {
    throw new ValidationError("默认分组仅支持字母、数字、点、下划线和短横线");
  }
  if (dateMode && dateMode !== "auto" && !/^\d{4}$/.test(dateMode)) {
    throw new ValidationError("CHANNEL_DATE_MODE 必须留空、填写 auto 或 4 位日期段");
  }

  return {
    group,
    namePrefix,
    startNumber,
    continueFromExisting: parseBooleanSetting(
      rawInput.continueFromExisting,
      "CHANNEL_CONTINUE_FROM_EXISTING",
      true,
    ),
    priority,
    weight,
    dateMode,
    dateSegment: dateMode === "auto" ? getCurrentDateSegment() : dateMode,
  };
}

export function validateModelList(rawModels, channelLabel) {
  if (!Array.isArray(rawModels)) {
    throw new ValidationError(`${channelLabel} 模型列表格式无效`);
  }
  const models = [];
  for (const rawModel of rawModels) {
    const model = String(rawModel ?? "").trim();
    if (!model) {
      continue;
    }
    if (
      model.length > MAXIMUM_MODEL_NAME_LENGTH
      || /[\s,，]/.test(model)
      || /\p{Cc}/u.test(model)
    ) {
      throw new ValidationError(`模型名称 ${model.slice(0, 40)} 无效，不能包含空格或逗号`);
    }
    if (!models.includes(model)) {
      models.push(model);
    }
  }
  if (models.length === 0) {
    throw new ValidationError(`请至少为 ${channelLabel} 渠道填写一个模型`);
  }
  if (models.length > MAXIMUM_CHANNEL_MODEL_COUNT) {
    throw new ValidationError(
      `${channelLabel} 渠道最多配置 ${MAXIMUM_CHANNEL_MODEL_COUNT} 个模型`,
    );
  }
  return models;
}

export function validateChannelModels(rawChannelModels) {
  if (
    rawChannelModels === null
    || typeof rawChannelModels !== "object"
    || Array.isArray(rawChannelModels)
  ) {
    throw new ValidationError("渠道模型配置格式无效");
  }
  return Object.fromEntries(Object.values(CHANNEL_KINDS).map((channelKind) => [
    channelKind,
    validateModelList(
      rawChannelModels[channelKind] ?? DEFAULT_CHANNEL_MODELS[channelKind],
      CHANNEL_KIND_LABELS[channelKind],
    ),
  ]));
}

function readQueryText(rawValue, fieldName, maximumLength) {
  const value = String(rawValue ?? "").trim();
  if (value.length > maximumLength) {
    throw new ValidationError(`${fieldName}长度超过限制`);
  }
  return value;
}

export function diagnoseAwsCredential(rawCredential) {
  const parts = String(rawCredential ?? "").split("|").map((part) => part.trim());
  if (parts.some((part) => !part)) {
    return "有空的分段，检查是否多写了 |";
  }
  if (parts.length > 3) {
    return "分段太多，只能是 APIKey|Region 或 AccessKey|SecretAccessKey|Region";
  }
  if (!AWS_REGION_PATTERN.test(parts.at(-1))) {
    if (parts.length === 1) {
      return "缺少区域，请在末尾加上 |区域，例如 |us-east-1";
    }
    if (
      parts.length === 2
      && AWS_ACCESS_KEY_PATTERN.test(parts[0])
      && AWS_SECRET_PATTERN.test(parts[1])
    ) {
      return "像是 AK/SK 但缺少区域，请在末尾加上 |区域，例如 |us-east-1";
    }
    return "的最后一段不是有效区域，区域应类似 us-east-1";
  }
  if (parts.length === 3) {
    if (!AWS_ACCESS_KEY_PATTERN.test(parts[0])) {
      return "的 AccessKey 格式不对，应为至少 16 位字母或数字";
    }
    if (!AWS_SECRET_PATTERN.test(parts[1])) {
      return "的 SecretAccessKey 太短或包含空格";
    }
    return null;
  }
  if (!AWS_SECRET_PATTERN.test(parts[0])) {
    return "的 API Key 太短或包含空格";
  }
  return null;
}

export function parseAwsCredential(rawCredential) {
  if (diagnoseAwsCredential(rawCredential)) {
    return null;
  }
  const parts = String(rawCredential).split("|").map((part) => part.trim());
  const region = parts.at(-1);
  return parts.length === 3
    ? { keyType: "ak_sk", region, secrets: [parts[0], parts[1]] }
    : { keyType: "api_key", region, secrets: [parts[0]] };
}

export function validateRecordQueryInput(rawInput) {
  const page = Number(rawInput?.page ?? 1);
  const pageSize = Number(rawInput?.pageSize ?? 10);
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new ValidationError("页码必须是大于 0 的整数");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAXIMUM_RECORD_PAGE_SIZE) {
    throw new ValidationError(`每页数量必须是 1 到 ${MAXIMUM_RECORD_PAGE_SIZE} 之间的整数`);
  }
  const statusLabel = String(rawInput?.statusLabel ?? "").trim();
  if (statusLabel && !RECORD_STATUS_FILTERS.has(statusLabel)) {
    throw new ValidationError("状态筛选条件无效");
  }
  const channelKind = String(rawInput?.channelKind ?? "").trim();
  if (channelKind && !RECORD_CHANNEL_KIND_FILTERS.has(channelKind)) {
    throw new ValidationError("类型筛选条件无效");
  }
  const sort = String(rawInput?.sort ?? "importedAt").trim();
  if (!RECORD_SORT_FIELDS.has(sort)) {
    throw new ValidationError("排序字段无效");
  }
  const order = String(rawInput?.order ?? "desc").trim();
  if (order !== "asc" && order !== "desc") {
    throw new ValidationError("排序方向无效");
  }
  return {
    page,
    pageSize,
    search: readQueryText(rawInput?.search, "搜索内容", MAXIMUM_RECORD_QUERY_KEY_LENGTH),
    channelName: readQueryText(rawInput?.channelName, "渠道名称查询", MAXIMUM_RECORD_QUERY_TEXT_LENGTH),
    key: readQueryText(rawInput?.key, "查询 Key ", MAXIMUM_RECORD_QUERY_KEY_LENGTH),
    model: readQueryText(rawInput?.model, "模型筛选", MAXIMUM_RECORD_QUERY_TEXT_LENGTH),
    statusLabel,
    channelKind,
    group: readQueryText(rawInput?.group, "分组筛选", MAXIMUM_RECORD_QUERY_TEXT_LENGTH),
    sort,
    order,
  };
}

export function validateImportInput(rawInput) {
  const channelKind = String(
    rawInput?.channelKind ?? CHANNEL_KINDS.CLAUDE,
  ).trim().toLowerCase();
  const namePrefix = validateRequiredText(rawInput?.namePrefix, "名称前缀", 64);
  const dateSegment = String(rawInput?.dateSegment ?? "").trim();
  const group = validateRequiredText(rawInput?.group, "分组", 64);
  const startNumber = Number(rawInput?.startNumber);
  const priority = parseSafeIntegerSetting(rawInput?.priority, "渠道优先级");
  const weight = parseSafeIntegerSetting(rawInput?.weight, "渠道权重", {
    minimumValue: 0,
  });

  if (dateSegment && !/^\d{4}$/.test(dateSegment)) {
    throw new ValidationError("日期段必须留空或填写 4 位数字，例如 0711");
  }
  if (!Number.isSafeInteger(startNumber) || startNumber < 1 || startNumber > 999_999) {
    throw new ValidationError("起始序号必须是 1 到 999999 之间的整数");
  }
  if (group.includes(",")) {
    throw new ValidationError("每个渠道只能选择一个分组");
  }
  if (!Object.values(CHANNEL_KINDS).includes(channelKind)) {
    throw new ValidationError("渠道类型必须是 claude、openai、grok 或 aws");
  }
  const models = validateModelList(
    rawInput?.models ?? DEFAULT_CHANNEL_MODELS[channelKind],
    CHANNEL_KIND_LABELS[channelKind],
  );
  const keys = normalizeKeys(rawInput?.keys);
  const awsApiType = String(rawInput?.awsApiType || AWS_API_TYPES.INVOKE_MODEL).trim();
  if (channelKind === CHANNEL_KINDS.AWS) {
    if (!Object.values(AWS_API_TYPES).includes(awsApiType)) {
      throw new ValidationError("AWS 接口必须是 invoke_model 或 mantle");
    }
    for (const [keyIndex, key] of keys.entries()) {
      const problem = diagnoseAwsCredential(key);
      if (problem) {
        throw new ValidationError(`第 ${keyIndex + 1} 个 AWS 凭证${problem}`);
      }
    }
  }

  return {
    keys,
    channelKind,
    models,
    ...(channelKind === CHANNEL_KINDS.AWS ? { awsApiType } : {}),
    namePrefix,
    dateSegment,
    group,
    startNumber,
    continueFromExisting: rawInput?.continueFromExisting !== false,
    priority,
    weight,
  };
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSequentialChannelNames({
  existingNames,
  keyCount,
  namePrefix,
  dateSegment,
  startNumber,
  continueFromExisting,
}) {
  const normalizedExistingNames = new Set(
    [...existingNames].map((existingName) => String(existingName)),
  );
  const channelNameBase = dateSegment
    ? `${namePrefix}-${dateSegment}`
    : namePrefix;
  const matchingNameExpression = new RegExp(
    `^${escapeRegularExpression(channelNameBase)}-(\\d+)$`,
  );
  let nextSequenceNumber = startNumber;

  if (continueFromExisting) {
    for (const existingName of normalizedExistingNames) {
      const matchingParts = existingName.match(matchingNameExpression);
      if (matchingParts) {
        nextSequenceNumber = Math.max(nextSequenceNumber, Number(matchingParts[1]) + 1);
      }
    }
  }

  const generatedNames = [];
  while (generatedNames.length < keyCount) {
    const sequenceText = String(nextSequenceNumber).padStart(3, "0");
    const proposedName = `${channelNameBase}-${sequenceText}`;
    nextSequenceNumber += 1;
    if (normalizedExistingNames.has(proposedName)) {
      continue;
    }
    normalizedExistingNames.add(proposedName);
    generatedNames.push(proposedName);
  }

  return generatedNames;
}

export function redactSensitiveText(rawText, sensitiveValues = []) {
  let redactedText = String(rawText ?? "未知错误");
  for (const sensitiveValue of sensitiveValues) {
    const normalizedSensitiveValue = String(sensitiveValue ?? "");
    if (normalizedSensitiveValue) {
      redactedText = redactedText.split(normalizedSensitiveValue).join("[已隐藏]");
    }
  }
  return redactedText.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***");
}
