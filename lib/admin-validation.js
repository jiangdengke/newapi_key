import {
  normalizeNewApiBaseUrl,
  validateChannelDefaults,
  validateChannelModels,
  validateConnectionInput,
  ValidationError,
} from "./validation.js";

function requireText(rawValue, fieldName, maximumLength) {
  const normalizedValue = String(rawValue ?? "").trim();
  if (!normalizedValue) {
    throw new ValidationError(`请填写${fieldName}`);
  }
  if (normalizedValue.length > maximumLength || /\p{Cc}/u.test(normalizedValue)) {
    throw new ValidationError(`${fieldName}格式无效`);
  }
  return normalizedValue;
}

export function validateLoginInput(rawInput) {
  return {
    username: requireText(rawInput?.username, "用户名", 128),
    password: requireText(rawInput?.password, "密码", 4_096),
  };
}

export function validateAdministratorPasswordChangeInput(rawInput) {
  const currentPassword = requireText(rawInput?.currentPassword, "当前密码", 4_096);
  const newPassword = requireText(rawInput?.newPassword, "新密码", 4_096);
  const confirmPassword = requireText(rawInput?.confirmPassword, "确认密码", 4_096);

  if (newPassword.length < 10) {
    throw new ValidationError("新密码至少需要 10 个字符");
  }
  if (newPassword !== confirmPassword) {
    throw new ValidationError("两次输入的新密码不一致");
  }

  return { currentPassword, newPassword };
}

export function validateAccessKeyInput(rawInput) {
  const accessKey = requireText(rawInput?.accessKey, "实例访问 Key", 256);
  if (!/^nai_[A-Za-z0-9_-]{43}$/.test(accessKey)) {
    throw new ValidationError("实例访问 Key 格式无效");
  }
  return { accessKey };
}

export function validateInstanceInput(rawInput, { passwordRequired = true } = {}) {
  const connectionInput = validateConnectionInput({
    baseUrl: normalizeNewApiBaseUrl(rawInput?.baseUrl),
    username: rawInput?.username,
    password: passwordRequired ? rawInput?.password : rawInput?.password || "unchanged-password",
  });
  const channelDefaults = validateChannelDefaults({
    group: rawInput?.group,
    namePrefix: rawInput?.namePrefix,
    startNumber: rawInput?.startNumber,
    continueFromExisting: rawInput?.continueFromExisting,
    priority: rawInput?.priority,
    weight: rawInput?.weight,
    dateMode: rawInput?.dateMode,
  });
  return {
    name: requireText(rawInput?.name, "实例名称", 128),
    baseUrl: connectionInput.baseUrl,
    username: connectionInput.username,
    password: passwordRequired ? connectionInput.password : String(rawInput?.password || ""),
    group: channelDefaults.group,
    namePrefix: channelDefaults.namePrefix,
    startNumber: channelDefaults.startNumber,
    continueFromExisting: channelDefaults.continueFromExisting,
    priority: channelDefaults.priority,
    weight: channelDefaults.weight,
    dateMode: channelDefaults.dateMode,
    channelModels: rawInput?.channelModels === undefined
      ? undefined
      : validateChannelModels(rawInput.channelModels),
    enabled: rawInput?.enabled !== false,
  };
}

function readOptionalInteger(rawValue, fieldName, { minimumValue, maximumValue, rangeText }) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === "") {
    return null;
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimumValue || value > maximumValue) {
    throw new ValidationError(`${fieldName}必须留空或填写${rangeText}`);
  }
  return value;
}

export function validateMemberInput(rawInput) {
  const rawDateMode = rawInput?.dateMode;
  const dateMode = rawDateMode === undefined || rawDateMode === null
    ? null
    : String(rawDateMode).trim().toLowerCase();
  if (dateMode && dateMode !== "auto" && !/^\d{4}$/.test(dateMode)) {
    throw new ValidationError("日期模式必须沿用实例、不加日期、auto 或 4 位日期段");
  }
  return {
    name: requireText(rawInput?.name, "成员名称", 64),
    namePrefix: requireText(rawInput?.namePrefix, "名称前缀", 64),
    dateMode,
    startNumber: readOptionalInteger(rawInput?.startNumber, "起始序号", {
      minimumValue: 1,
      maximumValue: 999_999,
      rangeText: " 1 到 999999 之间的整数",
    }),
    priority: readOptionalInteger(rawInput?.priority, "渠道优先级", {
      minimumValue: Number.MIN_SAFE_INTEGER,
      maximumValue: Number.MAX_SAFE_INTEGER,
      rangeText: "整数",
    }),
    weight: readOptionalInteger(rawInput?.weight, "渠道权重", {
      minimumValue: 0,
      maximumValue: Number.MAX_SAFE_INTEGER,
      rangeText: "非负整数",
    }),
    enabled: rawInput?.enabled !== false,
  };
}
