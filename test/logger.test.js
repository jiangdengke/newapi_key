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

test("logger writes structured JSON and redacts sensitive values", () => {
  const logCapture = createLogCapture();
  const logger = createLogger({
    level: "debug",
    output: logCapture.output,
    errorOutput: logCapture.output,
    getTimestamp: () => "2026-07-11T00:00:00.000Z",
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

  const logEntry = JSON.parse(logCapture.getOutput());
  assert.equal(logEntry.timestamp, "2026-07-11T00:00:00.000Z");
  assert.equal(logEntry.level, "info");
  assert.equal(logEntry.event, "security_test");
  assert.equal(logEntry.requestId, "request-1");
  assert.equal(logEntry.password, "[REDACTED]");
  assert.equal(logEntry.keyFingerprint, "[REDACTED]");
  assert.equal(logEntry.nested.authorization, "[REDACTED]");
  assert.equal(logEntry.nested.message, "upstream rejected [REDACTED]");
  assert.equal(logEntry.error.message, "[REDACTED]; request failed");

  const serializedLogEntry = JSON.stringify(logEntry);
  assert.equal(serializedLogEntry.includes("plain-password"), false);
  assert.equal(serializedLogEntry.includes("fingerprint-value"), false);
  assert.equal(serializedLogEntry.includes("private-token"), false);
  assert.equal(serializedLogEntry.includes("sensitive-example-key"), false);
  assert.equal(serializedLogEntry.includes("private-session"), false);
});
