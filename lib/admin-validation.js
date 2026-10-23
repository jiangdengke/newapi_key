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
