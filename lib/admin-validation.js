import {
  normalizeNewApiBaseUrl,
  validateChannelDefaults,
  validateConnectionInput,
  ValidationError,
} from "./validation.js";

const INSTANCE_CONNECTION_PROTOCOLS = new Set(["new-api", "admin-hub"]);

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

export function validateAccessKeyInput(rawInput) {
  const accessKey = requireText(rawInput?.accessKey, "实例访问 Key", 256);
  if (!/^nai_[A-Za-z0-9_-]{43}$/.test(accessKey)) {
    throw new ValidationError("实例访问 Key 格式无效");
  }
  return { accessKey };
}

export function validateInstanceInput(rawInput, { passwordRequired = true } = {}) {
  const connectionProtocol = String(rawInput?.connectionProtocol || "new-api").trim();
  if (!INSTANCE_CONNECTION_PROTOCOLS.has(connectionProtocol)) {
    throw new ValidationError("连接协议无效");
  }
  const rawAdminHubTargetSiteId = rawInput?.adminHubTargetSiteId;
  const adminHubTargetSiteId = Number(rawAdminHubTargetSiteId);
  if (
    connectionProtocol === "admin-hub"
    && (
      rawAdminHubTargetSiteId === undefined
      || rawAdminHubTargetSiteId === null
      || String(rawAdminHubTargetSiteId).trim() === ""
      || !Number.isSafeInteger(adminHubTargetSiteId)
      || adminHubTargetSiteId <= 0
    )
  ) {
    throw new ValidationError("Admin Hub 目标站点 ID 必须是正整数");
  }
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
    connectionProtocol,
    adminHubTargetSiteId: connectionProtocol === "admin-hub"
      ? adminHubTargetSiteId
      : null,
    group: channelDefaults.group,
    namePrefix: channelDefaults.namePrefix,
    startNumber: channelDefaults.startNumber,
    continueFromExisting: channelDefaults.continueFromExisting,
    priority: channelDefaults.priority,
    weight: channelDefaults.weight,
    dateMode: channelDefaults.dateMode,
    enabled: rawInput?.enabled !== false,
  };
}
