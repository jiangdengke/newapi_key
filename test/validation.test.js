import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSequentialChannelNames,
  normalizeKeys,
  redactSensitiveText,
  validateChannelDefaults,
  validateImportInput,
  ValidationError,
} from "../lib/validation.js";

test("normalizeKeys removes blank and duplicate entries", () => {
  assert.deepEqual(
    normalizeKeys("sk-first\n\nsk-second\nsk-first\n"),
    ["sk-first", "sk-second"],
  );
});

test("buildSequentialChannelNames continues after the highest existing sequence", () => {
  const generatedNames = buildSequentialChannelNames({
    existingNames: ["claude-0711-003", "claude-0711-106", "other-0711-999"],
    keyCount: 3,
    namePrefix: "claude",
    dateSegment: "0711",
    startNumber: 1,
    continueFromExisting: true,
  });

  assert.deepEqual(generatedNames, [
    "claude-0711-107",
    "claude-0711-108",
    "claude-0711-109",
  ]);
});

test("buildSequentialChannelNames supports names without a date segment", () => {
  const generatedNames = buildSequentialChannelNames({
    existingNames: ["claude-003", "claude-106", "claude-0711-999"],
    keyCount: 3,
    namePrefix: "claude",
    dateSegment: "",
    startNumber: 1,
    continueFromExisting: true,
  });

  assert.deepEqual(generatedNames, [
    "claude-107",
    "claude-108",
    "claude-109",
  ]);
});

test("validateImportInput rejects an invalid date segment", () => {
  assert.throws(
    () => validateImportInput({
      keys: ["sk-example"],
      namePrefix: "claude",
      dateSegment: "711",
      startNumber: 1,
      group: "anthropic",
    }),
    (error) => error instanceof ValidationError && /4 位数字/.test(error.message),
  );
});

test("validateImportInput accepts OpenAI and rejects unsupported channel kinds", () => {
  const openAiImportInput = validateImportInput({
    keys: ["sk-openai-example"],
    channelKind: "openai",
    namePrefix: "channel",
    dateSegment: "0714",
    startNumber: 1,
    group: "openai",
  });
  assert.equal(openAiImportInput.channelKind, "openai");

  assert.throws(
    () => validateImportInput({
      keys: ["sk-example"],
      channelKind: "unsupported",
      namePrefix: "channel",
      dateSegment: "0714",
      startNumber: 1,
      group: "openai",
    }),
    (error) => error instanceof ValidationError && /claude 或 openai/.test(error.message),
  );
});

test("validateChannelDefaults accepts fixed, automatic, and empty date modes", () => {
  assert.deepEqual(
    validateChannelDefaults({
      group: "anthropic",
      namePrefix: "claude",
      startNumber: "12",
      continueFromExisting: "false",
      dateMode: "0711",
    }),
    {
      group: "anthropic",
      namePrefix: "claude",
      startNumber: 12,
      continueFromExisting: false,
      priority: 0,
      weight: 0,
      dateMode: "0711",
      dateSegment: "0711",
    },
  );

  const automaticDefaults = validateChannelDefaults({ dateMode: "auto" });
  assert.equal(automaticDefaults.dateMode, "auto");
  assert.match(automaticDefaults.dateSegment, /^\d{4}$/);

  const noDateDefaults = validateChannelDefaults({ dateMode: "" });
  assert.equal(noDateDefaults.dateMode, "");
  assert.equal(noDateDefaults.dateSegment, "");
});

test("channel priority and weight accept safe integer values", () => {
  const channelDefaults = validateChannelDefaults({
    priority: "-10",
    weight: "25",
  });
  assert.equal(channelDefaults.priority, -10);
  assert.equal(channelDefaults.weight, 25);

  const importInput = validateImportInput({
    keys: ["sk-example"],
    namePrefix: "claude",
    dateSegment: "0711",
    startNumber: 1,
    group: "anthropic",
    priority: 12,
    weight: 30,
  });
  assert.equal(importInput.priority, 12);
  assert.equal(importInput.weight, 30);
});

test("validateChannelDefaults rejects invalid environment values", () => {
  assert.throws(
    () => validateChannelDefaults({ continueFromExisting: "sometimes" }),
    (error) => error instanceof ValidationError && /true 或 false/.test(error.message),
  );
  assert.throws(
    () => validateChannelDefaults({ dateMode: "today" }),
    (error) => error instanceof ValidationError && /留空、填写 auto/.test(error.message),
  );
  assert.throws(
    () => validateChannelDefaults({ priority: "1.5" }),
    (error) => error instanceof ValidationError && /优先级必须是安全整数/.test(error.message),
  );
  assert.throws(
    () => validateChannelDefaults({ weight: "-1" }),
    (error) => error instanceof ValidationError && /权重必须是非负安全整数/.test(error.message),
  );
});

test("redactSensitiveText removes explicit secrets and key-shaped values", () => {
  const redactedText = redactSensitiveText(
    "password-value rejected sk-ant-example12345678",
    ["password-value"],
  );

  assert.equal(redactedText.includes("password-value"), false);
  assert.equal(redactedText.includes("sk-ant-example12345678"), false);
  assert.match(redactedText, /\[已隐藏\]/);
  assert.match(redactedText, /sk-\*\*\*/);
});
