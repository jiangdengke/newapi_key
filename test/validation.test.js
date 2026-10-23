import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSequentialChannelNames,
  normalizeKeys,
  redactSensitiveText,
  validateChannelDefaults,
  validateChannelModels,
  validateImportInput,
  validateModelList,
  ValidationError,
  DEFAULT_CHANNEL_MODELS,
  parseAwsCredential,
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

test("validateImportInput accepts OpenAI and Grok channel kinds", () => {
  const openAiImportInput = validateImportInput({
    keys: ["sk-openai-example"],
    channelKind: "openai",
    namePrefix: "channel",
    dateSegment: "0714",
    startNumber: 1,
    group: "openai",
  });
  assert.equal(openAiImportInput.channelKind, "openai");

  const grokImportInput = validateImportInput({
    keys: ["xai-example"],
    channelKind: "grok",
    namePrefix: "channel",
    dateSegment: "0714",
    startNumber: 2,
    group: "高级分组",
  });
  assert.equal(grokImportInput.channelKind, "grok");
  assert.equal(grokImportInput.group, "高级分组");

  assert.throws(
    () => validateImportInput({
      keys: ["xai-example"],
      channelKind: "grok",
      namePrefix: "channel",
      dateSegment: "0714",
      startNumber: 2,
      group: "xai,premium",
    }),
    (error) => error instanceof ValidationError && /只能选择一个分组/.test(error.message),
  );

  assert.throws(
    () => validateImportInput({
      keys: ["sk-example"],
      channelKind: "unsupported",
      namePrefix: "channel",
      dateSegment: "0714",
      startNumber: 1,
      group: "openai",
    }),
    (error) => error instanceof ValidationError && /claude、openai、grok 或 aws/.test(error.message),
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

test("validateModelList trims, removes duplicates and rejects invalid names", () => {
  assert.deepEqual(
    validateModelList([" claude-opus-4-9 ", "", "claude-opus-4-9", "claude-opus-4-8"], "Claude"),
    ["claude-opus-4-9", "claude-opus-4-8"],
  );
  assert.throws(() => validateModelList([], "Claude"), /请至少为 Claude 渠道填写一个模型/);
  assert.throws(() => validateModelList(["a,b"], "Claude"), /不能包含空格或逗号/);
  assert.throws(() => validateModelList(["model name"], "Claude"), /不能包含空格或逗号/);
  assert.throws(() => validateModelList("claude-opus-4-9", "Claude"), /模型列表格式无效/);
  assert.throws(
    () => validateModelList(Array.from({ length: 101 }, (_, index) => `model-${index}`), "Grok"),
    /最多配置 100 个模型/,
  );
});

test("validateChannelModels fills missing channel kinds with defaults", () => {
  assert.deepEqual(validateChannelModels({ claude: ["claude-opus-4-9"] }), {
    claude: ["claude-opus-4-9"],
    openai: [...DEFAULT_CHANNEL_MODELS.openai],
    grok: [...DEFAULT_CHANNEL_MODELS.grok],
    aws: [...DEFAULT_CHANNEL_MODELS.aws],
  });
  assert.throws(() => validateChannelModels(["claude-opus-4-9"]), /渠道模型配置格式无效/);
});

test("validateImportInput uses requested models or the channel kind defaults", () => {
  const baseInput = {
    keys: ["sk-ant-example"],
    group: "anthropic",
    namePrefix: "claude",
    startNumber: 1,
    priority: 0,
    weight: 0,
  };
  assert.deepEqual(validateImportInput(baseInput).models, [...DEFAULT_CHANNEL_MODELS.claude]);
  assert.deepEqual(
    validateImportInput({ ...baseInput, models: ["claude-opus-4-9", "claude-opus-4-9"] }).models,
    ["claude-opus-4-9"],
  );
  assert.throws(() => validateImportInput({ ...baseInput, models: [] }), /请至少为 Claude 渠道填写一个模型/);
});

test("parseAwsCredential detects AK/SK and API key formats", () => {
  assert.deepEqual(
    parseAwsCredential(" AKIAEXAMPLE000000001 | exampleSecretAccessKey000000001 | us-east-1 "),
    {
      keyType: "ak_sk",
      region: "us-east-1",
      secrets: ["AKIAEXAMPLE000000001", "exampleSecretAccessKey000000001"],
      credential: "AKIAEXAMPLE000000001|exampleSecretAccessKey000000001|us-east-1",
    },
  );
  assert.deepEqual(parseAwsCredential("ABSKexampleBedrockApiKey0001|ap-northeast-1"), {
    keyType: "api_key",
    region: "ap-northeast-1",
    secrets: ["ABSKexampleBedrockApiKey0001"],
    credential: "ABSKexampleBedrockApiKey0001|ap-northeast-1",
  });
  assert.equal(parseAwsCredential("AKIAEXAMPLE000000001|exampleSecretAccessKey000000001|useast1"), null);
  assert.equal(parseAwsCredential("AKIAEXAMPLE000000001|short|us-east-1"), null);
  assert.equal(parseAwsCredential("sk-ant-api03-not-aws"), null);
});

test("parseAwsCredential fills in the default region when a line has none", () => {
  assert.equal(
    parseAwsCredential("LLM_000000000000000_ExampleBedrockKey", "us-west-2").credential,
    "LLM_000000000000000_ExampleBedrockKey|us-west-2",
  );
  assert.equal(
    parseAwsCredential("AKIAEXAMPLE000000001|exampleSecretAccessKey000000001", "eu-central-1").keyType,
    "ak_sk",
  );
  assert.equal(
    parseAwsCredential("ABSKexampleBedrockApiKey0001|ap-northeast-1", "us-east-1").region,
    "ap-northeast-1",
  );
  assert.equal(parseAwsCredential("LLM_000000000000000_ExampleBedrockKey"), null);
  assert.equal(parseAwsCredential("LLM_000000000000000_ExampleBedrockKey", "not-a-region"), null);
});

test("validateImportInput validates AWS credentials and interface type", () => {
  const baseInput = {
    keys: ["AKIAEXAMPLE000000001|exampleSecretAccessKey000000001|us-east-1"],
    channelKind: "aws",
    group: "aws",
    namePrefix: "aws",
    startNumber: 1,
    priority: 0,
    weight: 0,
  };
  const importInput = validateImportInput(baseInput);
  assert.equal(importInput.awsApiType, "invoke_model");
  assert.deepEqual(importInput.models, [...DEFAULT_CHANNEL_MODELS.aws]);
  assert.equal(validateImportInput({ ...baseInput, awsApiType: "mantle" }).awsApiType, "mantle");
  assert.equal("awsApiType" in validateImportInput({ ...baseInput, channelKind: "claude" }), false);
  assert.throws(() => validateImportInput({ ...baseInput, awsApiType: "converse" }), /AWS 接口必须是/);
  assert.throws(
    () => validateImportInput({ ...baseInput, keys: [baseInput.keys[0], "not-an-aws-key"] }),
    /第 2 个 AWS 凭证格式无效/,
  );
  assert.deepEqual(
    validateImportInput({ ...baseInput, keys: ["ABSKexampleBedrockApiKey0001"], awsRegion: "us-west-2" }).keys,
    ["ABSKexampleBedrockApiKey0001|us-west-2"],
  );
  assert.throws(
    () => validateImportInput({
      ...baseInput,
      keys: ["ABSKexampleBedrockApiKey0001", "ABSKexampleBedrockApiKey0001|us-west-2"],
      awsRegion: "us-west-2",
    }),
    /第 2 个 AWS 凭证补全区域后与第 1 个重复/,
  );
  assert.throws(() => validateImportInput({ ...baseInput, awsRegion: "mars-1" }), /AWS 默认区域格式无效/);
});
