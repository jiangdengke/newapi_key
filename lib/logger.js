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

export function createLogger({
  level = process.env.LOG_LEVEL,
  output = process.stdout,
  errorOutput = process.stderr,
  getTimestamp = () => new Date().toISOString(),
} = {}) {
  const minimumPriority = LOG_LEVEL_PRIORITIES[normalizeLogLevel(level)];

  function writeLog(logLevel, event, fields = {}) {
    if (LOG_LEVEL_PRIORITIES[logLevel] < minimumPriority) {
      return;
    }
    const logEntry = sanitizeLogValue({
      timestamp: getTimestamp(),
      level: logLevel,
      event,
      ...fields,
    });
    const destination = logLevel === "error" ? errorOutput : output;
    destination.write(`${JSON.stringify(logEntry)}\n`);
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
