const LOG_LEVEL_PRIORITIES = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

const SENSITIVE_FIELD_NAME_PATTERN = /(password|cookie|authorization|fingerprint|secret|token|requestbody|key$)/i;
const KEY_VALUE_PATTERN = /\bsk-[A-Za-z0-9._-]{6,}\b/gi;
const COOKIE_VALUE_PATTERN = /\b(?:session|cookie|token)=[^\s;,]+/gi;
const REDACTED_VALUE = "[REDACTED]";

const EVENT_LABELS = Object.freeze({
  administrator_password_changed: "管理员密码修改成功",
  administrator_record_key_revealed: "完整 Key 已读取",
  administrator_records_deleted: "Key 记录删除完成",
  application_login_failed: "登录失败",
  application_login_succeeded: "登录成功",
  channel_creation_failed: "渠道创建失败",
  channel_import_completed: "导入完成",
  channel_import_failed: "导入失败",
  channel_import_started: "开始导入",
  channel_usage_sync_completed: "用量同步完成",
  http_request_handler_failed: "HTTP 请求处理失败",
  instance_access_failed: "实例访问失败",
  instance_access_key_disabled: "实例访问 Key 已停用",
  instance_access_key_generated: "实例访问 Key 已生成",
  instance_access_succeeded: "实例访问成功",
  new_api_instance_created: "New API 实例已创建",
  new_api_instance_deleted: "New API 实例已删除",
  new_api_instance_updated: "New API 实例已更新",
  new_api_rate_limited: "New API 请求限流",
  new_api_request_completed: "New API 请求完成",
  new_api_request_failed: "New API 请求失败",
});

const FIELD_LABELS = Object.freeze({
  administratorId: "administrator",
  attemptNumber: "attempt",
  channelName: "channel",
  deletedRecordCount: "deleted",
  durationMilliseconds: "duration",
  failedCount: "failures",
  instanceId: "instance",
  missingCount: "missing",
  recordId: "record",
  requestId: "request",
  requestedRecordCount: "requested",
  retryAfterMilliseconds: "retry_after",
  statusCode: "status",
  synchronizedCount: "synced",
  username: "user",
});

function sanitizeText(value) {
  return String(value)
    .replace(KEY_VALUE_PATTERN, REDACTED_VALUE)
    .replace(COOKIE_VALUE_PATTERN, REDACTED_VALUE);
}

function sanitizeLogValue(value, fieldName = "") {
  if (SENSITIVE_FIELD_NAME_PATTERN.test(fieldName)) {
    return REDACTED_VALUE;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeText(value.message),
    };
  }
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([nestedFieldName, nestedValue]) => [
        nestedFieldName,
        sanitizeLogValue(nestedValue, nestedFieldName),
      ]),
    );
  }
  return value;
}

function normalizeLogLevel(rawLogLevel) {
  const normalizedLogLevel = String(rawLogLevel || "info").trim().toLowerCase();
  return Object.hasOwn(LOG_LEVEL_PRIORITIES, normalizedLogLevel)
    ? normalizedLogLevel
    : "info";
}

function formatTimestamp(rawTimestamp) {
  if (rawTimestamp instanceof Date && !Number.isNaN(rawTimestamp.getTime())) {
    const year = rawTimestamp.getFullYear();
    const month = String(rawTimestamp.getMonth() + 1).padStart(2, "0");
    const day = String(rawTimestamp.getDate()).padStart(2, "0");
    const hours = String(rawTimestamp.getHours()).padStart(2, "0");
    const minutes = String(rawTimestamp.getMinutes()).padStart(2, "0");
    const seconds = String(rawTimestamp.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
  return String(rawTimestamp);
}

function formatDuration(milliseconds) {
  const normalizedMilliseconds = Number(milliseconds);
  if (!Number.isFinite(normalizedMilliseconds) || normalizedMilliseconds < 1_000) {
    return `${normalizedMilliseconds}ms`;
  }
  const seconds = normalizedMilliseconds / 1_000;
  return `${Number(seconds.toFixed(1))}s`;
}

function formatFieldValue(fieldName, value) {
  if (fieldName === "durationMilliseconds" || fieldName === "retryAfterMilliseconds") {
    return formatDuration(value);
  }
  if (fieldName === "error" && value?.message) {
    return JSON.stringify(value.message);
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  const normalizedValue = String(value);
  return /^[A-Za-z0-9._:/@+-]+$/.test(normalizedValue)
    ? normalizedValue
    : JSON.stringify(normalizedValue);
}

function formatLogLine(logLevel, event, fields, timestamp) {
  const eventLabel = EVENT_LABELS[event] || event;
  const formattedFields = Object.entries(fields).map(([fieldName, fieldValue]) => {
    const fieldLabel = FIELD_LABELS[fieldName] || fieldName;
    return `${fieldLabel}=${formatFieldValue(fieldName, fieldValue)}`;
  });
  const fieldSuffix = formattedFields.length > 0 ? ` ${formattedFields.join(" ")}` : "";
  return `${formatTimestamp(timestamp)} ${logLevel.toUpperCase().padEnd(5)} ${eventLabel}${fieldSuffix}`;
}

export function createLogger({
  level = process.env.LOG_LEVEL,
  output = process.stdout,
  errorOutput = process.stderr,
  getTimestamp = () => new Date(),
} = {}) {
  const minimumPriority = LOG_LEVEL_PRIORITIES[normalizeLogLevel(level)];

  function writeLog(logLevel, event, fields = {}) {
    if (LOG_LEVEL_PRIORITIES[logLevel] < minimumPriority) {
      return;
    }
    const sanitizedFields = sanitizeLogValue(fields);
    const destination = logLevel === "error" ? errorOutput : output;
    destination.write(`${formatLogLine(
      logLevel,
      event,
      sanitizedFields,
      getTimestamp(),
    )}\n`);
  }

  return {
    debug(event, fields) {
      writeLog("debug", event, fields);
    },
    info(event, fields) {
      writeLog("info", event, fields);
    },
    warn(event, fields) {
      writeLog("warn", event, fields);
    },
    error(event, fields) {
      writeLog("error", event, fields);
    },
  };
}
