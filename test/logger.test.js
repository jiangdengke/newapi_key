import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { createLogger } from "../lib/logger.js";

function createLogCapture() {
  let capturedOutput = "";
  const output = new Writable({
    write(chunk, encoding, callback) {
      capturedOutput += chunk.toString();
      callback();
    },
  });
  return {
    output,
    getOutput() {
      return capturedOutput;
    },
  };
}

test("logger writes readable business logs and formats durations", () => {
  const logCapture = createLogCapture();
  const logger = createLogger({
    level: "info",
    output: logCapture.output,
    errorOutput: logCapture.output,
    getTimestamp: () => "2026-07-13 02:15:24",
  });

  logger.info("channel_import_completed", {
    instanceId: 3,
    total: 10,
    success: 8,
    failure: 2,
    durationMilliseconds: 1_600,
  });

  assert.equal(
    logCapture.getOutput(),
    "2026-07-13 02:15:24 INFO  导入完成 instance=3 total=10 "
      + "success=8 failure=2 duration=1.6s\n",
  );
});

test("logger formats login rate limit and channel failure events", () => {
  const logCapture = createLogCapture();
  const logger = createLogger({
    level: "info",
    output: logCapture.output,
    errorOutput: logCapture.output,
    getTimestamp: () => "2026-07-13 02:15:23",
  });

  logger.info("application_login_succeeded", {
    username: "admin",
    durationMilliseconds: 91,
  });
  logger.warn("new_api_rate_limited", {
    operation: "search_channels",
    statusCode: 429,
    retryAfterMilliseconds: 30_000,
  });
  logger.error("channel_creation_failed", {
    instanceId: 3,
    channelName: "claude-0713-009",
    error: new Error("余额不足"),
  });

  assert.equal(
    logCapture.getOutput(),
    "2026-07-13 02:15:23 INFO  登录成功 user=admin duration=91ms\n"
      + "2026-07-13 02:15:23 WARN  New API 请求限流 "
      + "operation=search_channels status=429 retry_after=30s\n"
      + "2026-07-13 02:15:23 ERROR 渠道创建失败 "
      + "instance=3 channel=claude-0713-009 error=\"余额不足\"\n",
  );
});

test("logger redacts sensitive values in readable output", () => {
  const logCapture = createLogCapture();
  const logger = createLogger({
    level: "debug",
    output: logCapture.output,
    errorOutput: logCapture.output,
    getTimestamp: () => "2026-07-13 02:15:23",
  });

  logger.info("security_test", {
    requestId: "request-1",
    password: "plain-password",
    keyFingerprint: "fingerprint-value",
    nested: {
      authorization: "Bearer private-token",
      message: "upstream rejected sk-ant-sensitive-example-key",
    },
    error: new Error("session=private-session; request failed"),
  });

  const logLine = logCapture.getOutput();
  assert.match(logLine, /^2026-07-13 02:15:23 INFO  security_test /);
  assert.match(logLine, /request=request-1/);
  assert.match(logLine, /password="\[REDACTED\]"/);
  assert.match(logLine, /keyFingerprint="\[REDACTED\]"/);
  assert.match(logLine, /upstream rejected \[REDACTED\]/);
  assert.match(logLine, /\[REDACTED\]; request failed/);
  assert.equal(logLine.includes("plain-password"), false);
  assert.equal(logLine.includes("fingerprint-value"), false);
  assert.equal(logLine.includes("private-token"), false);
  assert.equal(logLine.includes("sensitive-example-key"), false);
  assert.equal(logLine.includes("private-session"), false);
});
