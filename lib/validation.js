export const ANTHROPIC_CHANNEL_TYPE = 14;

export const CLAUDE_MODELS = Object.freeze([
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
]);

const MAXIMUM_KEY_COUNT = 500;
const MAXIMUM_KEY_LENGTH = 16_384;

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

export function validateImportInput(rawInput) {
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
  if (!/^[A-Za-z0-9_.-]+$/.test(group)) {
    throw new ValidationError("分组仅支持字母、数字、点、下划线和短横线");
  }

  return {
    keys: normalizeKeys(rawInput?.keys),
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
