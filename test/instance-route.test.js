import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { GET as getInstanceConfiguration } from "../app/api/instances/[instanceId]/config/route.js";
import { GET as getInstanceGroups } from "../app/api/instances/[instanceId]/groups/route.js";
import { POST as importChannels } from "../app/api/instances/[instanceId]/import/route.js";
import { POST as synchronizeVisitorRecords } from "../app/api/instances/[instanceId]/records/sync/route.js";
import { ApplicationStore } from "../lib/application-store.js";
import { SESSION_COOKIE_NAME } from "../lib/http.js";
import { synchronizeInstanceRecords } from "../lib/instance-service.js";

const RUNTIME_CONTEXT_KEY = Symbol.for("newapi-key.runtime-context");
const ADMINISTRATOR_PASSWORD = "administrator-password";
const NEW_API_PASSWORD = "new-api-administrator-password";
const IMPORT_KEYS = ["sk-ant-success-example", "sk-ant-failure-example"];
const OPENAI_IMPORT_KEY = "sk-openai-success-example";
const GROK_IMPORT_KEY = "xai-success-example";
const AVAILABLE_GROUPS = ["anthropic", "openai", "xai", "premium"];
const CLAUDE_MODELS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
];
const OPENAI_MODELS = ["gpt-5.6-sol"];
const GROK_MODELS = [
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-0309-reasoning",
  "grok-4.20-multi-agent-0309",
  "grok-4.3",
  "grok-4.5",
  "grok-build-0.1",
  "grok-imagine-image",
  "grok-imagine-image-quality",
  "grok-imagine-video",
  "grok-imagine-video-1.5",
];

function createSilentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function listenOnAvailablePort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function readRequestJson(request) {
  const requestChunks = [];
  for await (const requestChunk of request) {
    requestChunks.push(requestChunk);
  }
  return JSON.parse(Buffer.concat(requestChunks).toString("utf8"));
}

function sendJson(response, responsePayload, headers = {}) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(responsePayload));
}

function createMockNewApiServer(createdChannelRequests, storedChannels) {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");

    if (request.method === "GET" && requestUrl.pathname === "/api/status") {
      sendJson(response, {
        success: true,
        data: {
          system_name: "Mock New API",
          version: "test-version",
        },
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/user/login") {
      const requestBody = await readRequestJson(request);
      assert.deepEqual(requestBody, {
        username: "new-api-administrator",
        password: NEW_API_PASSWORD,
      });
      sendJson(response, {
        success: true,
        data: { id: 1, username: "new-api-administrator", role: 100 },
      }, {
        "Set-Cookie": "session=mock-session; Path=/; HttpOnly",
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/channel/search") {
      assert.equal(request.headers.cookie, "session=mock-session");
      assert.equal(request.headers["new-api-user"], "1");
      const searchKeyword = requestUrl.searchParams.get("keyword") || "";
      const matchingChannels = storedChannels.filter(
        (channel) => channel.name.includes(searchKeyword),
      );
      sendJson(response, {
        success: true,
        data: { items: matchingChannels, total: matchingChannels.length },
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/group/") {
      assert.equal(request.headers.cookie, "session=mock-session");
      assert.equal(request.headers["new-api-user"], "1");
      sendJson(response, {
        success: true,
        data: AVAILABLE_GROUPS,
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/channel/") {
      assert.equal(request.headers.cookie, "session=mock-session");
      assert.equal(request.headers["new-api-user"], "1");
      const requestBody = await readRequestJson(request);
      createdChannelRequests.push(requestBody);
      if (requestBody.channel.key === IMPORT_KEYS[1]) {
        sendJson(response, {
          success: false,
          message: `上游拒绝了 ${requestBody.channel.key}`,
        });
        return;
      }
      storedChannels.push({
        id: 107 + storedChannels.length,
        type: requestBody.channel.type,
        name: requestBody.channel.name,
        group: requestBody.channel.group,
        models: requestBody.channel.models,
        status: 1,
        used_quota: 250_000,
      });
      sendJson(response, { success: true, message: "" });
      return;
    }

    response.writeHead(404);
    response.end();
  });
}

function installTestRuntimeContext(store) {
  const previousRuntimeContext = globalThis[RUNTIME_CONTEXT_KEY];
  globalThis[RUNTIME_CONTEXT_KEY] = {
    store,
    logger: createSilentLogger(),
    instanceRuntimes: new Map(),
    loginAttempts: new Map(),
    accessAttempts: new Map(),
  };
  return () => {
    if (previousRuntimeContext === undefined) {
      delete globalThis[RUNTIME_CONTEXT_KEY];
    } else {
      globalThis[RUNTIME_CONTEXT_KEY] = previousRuntimeContext;
    }
  };
}

function createImportRequest(
  instanceId,
  sessionToken,
  keys = IMPORT_KEYS,
  channelKind = undefined,
  group = undefined,
  models = undefined,
) {
  return new Request(`http://localhost/api/instances/${instanceId}/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
      Host: "localhost",
    },
    body: JSON.stringify({
      keys,
      ...(channelKind ? { channelKind } : {}),
      ...(group ? { group } : {}),
      ...(models ? { models } : {}),
    }),
  });
}

function createInstanceGetRequest(instanceId, sessionToken, pathname) {
  return new Request(`http://localhost/api/instances/${instanceId}/${pathname}`, {
    headers: {
      Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
      Host: "localhost",
    },
  });
}

test("instance import route streams safe per-key results", async () => {
  const createdChannelRequests = [];
  const storedChannels = [{
    id: 106,
    type: 14,
    name: "claude-0711-106",
    group: "anthropic",
    models: CLAUDE_MODELS.join(","),
    status: 1,
    used_quota: 0,
  }];
  const mockNewApiServer = createMockNewApiServer(
    createdChannelRequests,
    storedChannels,
  );
  const mockNewApiBaseUrl = await listenOnAvailablePort(mockNewApiServer);
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 11),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance({
      name: "Mock instance",
      baseUrl: mockNewApiBaseUrl,
      username: "new-api-administrator",
      password: NEW_API_PASSWORD,
      group: "legacy-custom-group",
      namePrefix: "claude",
      startNumber: 1,
      continueFromExisting: true,
      priority: 12,
      weight: 30,
      dateMode: "0711",
      enabled: true,
    });
    const generatedAccess = store.createInstanceMember(instance.id, { name: "测试成员" });
    const session = store.createVisitorSessionForAccessKey(generatedAccess.accessKey);

    const anonymousResponse = await importChannels(
      new Request(`http://localhost/api/instances/${instance.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Host: "localhost" },
        body: JSON.stringify({ keys: IMPORT_KEYS }),
      }),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    assert.equal(anonymousResponse.status, 401);

    const response = await importChannels(
      createImportRequest(instance.id, session.token),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type"),
      /^application\/x-ndjson/,
    );

    const responseText = await response.text();
    const progressEvents = responseText.trim().split("\n").map(JSON.parse);
    assert.equal(progressEvents[0].type, "ready");
    assert.deepEqual(progressEvents.at(-1), {
      type: "complete",
      total: 2,
      completed: 2,
      success: 1,
      failure: 1,
    });
    assert.equal(responseText.includes(IMPORT_KEYS[0]), false);
    assert.equal(responseText.includes(IMPORT_KEYS[1]), false);

    assert.deepEqual(
      createdChannelRequests.map((requestBody) => requestBody.channel.name),
      ["claude-0711-107", "claude-0711-108"],
    );
    assert.equal(createdChannelRequests[0].channel.type, 14);
    assert.equal(createdChannelRequests[0].channel.group, "anthropic");
    assert.equal(createdChannelRequests[0].channel.models, CLAUDE_MODELS.join(","));
    assert.equal(createdChannelRequests[0].channel.priority, 12);
    assert.equal(createdChannelRequests[0].channel.weight, 30);
    assert.equal(createdChannelRequests[1].channel.priority, 12);
    assert.equal(createdChannelRequests[1].channel.weight, 30);

    const importedRecords = store.listRecords(instance.id);
    assert.equal(importedRecords.length, 1);
    assert.equal(importedRecords[0].channelName, "claude-0711-107");
    assert.equal(importedRecords[0].keyMask.includes(IMPORT_KEYS[0]), false);
    assert.equal(importedRecords[0].usedQuota, 250_000);
    assert.equal(importedRecords[0].usedUsd, 0.5);
  } finally {
    restoreRuntimeContext();
    store.close();
    await closeServer(mockNewApiServer);
  }
});

test("standard New API import creates an official OpenAI channel", async () => {
  const createdChannelRequests = [];
  const storedChannels = [{
    id: 106,
    type: 14,
    name: "channel-0711-106",
    group: "anthropic",
    models: CLAUDE_MODELS.join(","),
    status: 1,
    used_quota: 0,
  }];
  const mockNewApiServer = createMockNewApiServer(
    createdChannelRequests,
    storedChannels,
  );
  const mockNewApiBaseUrl = await listenOnAvailablePort(mockNewApiServer);
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 21),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance({
      name: "Mock OpenAI instance",
      baseUrl: mockNewApiBaseUrl,
      username: "new-api-administrator",
      password: NEW_API_PASSWORD,
      group: "anthropic",
      namePrefix: "channel",
      startNumber: 1,
      continueFromExisting: true,
      priority: 9,
      weight: 15,
      dateMode: "0711",
      enabled: true,
    });
    const generatedAccess = store.createInstanceMember(instance.id, { name: "测试成员" });
    const session = store.createVisitorSessionForAccessKey(generatedAccess.accessKey);
    const response = await importChannels(
      createImportRequest(
        instance.id,
        session.token,
        [OPENAI_IMPORT_KEY],
        "openai",
      ),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );

    assert.equal(response.status, 200);
    const responseText = await response.text();
    const progressEvents = responseText.trim().split("\n").map(JSON.parse);
    assert.equal(progressEvents[0].channelKind, "openai");
    assert.deepEqual(progressEvents.at(-1), {
      type: "complete",
      total: 1,
      completed: 1,
      success: 1,
      failure: 0,
    });
    assert.equal(responseText.includes(OPENAI_IMPORT_KEY), false);

    assert.equal(createdChannelRequests.length, 1);
    const createdChannel = createdChannelRequests[0].channel;
    assert.equal(createdChannel.type, 1);
    assert.equal(createdChannel.name, "channel-0711-107");
    assert.equal(createdChannel.key, OPENAI_IMPORT_KEY);
    assert.equal(createdChannel.models, OPENAI_MODELS.join(","));
    assert.equal(createdChannel.group, "openai");
    assert.equal(createdChannel.base_url, "");
    assert.equal(createdChannel.priority, 9);
    assert.equal(createdChannel.weight, 15);

    const synchronization = await synchronizeInstanceRecords(
      instance.id,
      "standard-openai-sync-test",
    );
    assert.equal(synchronization.synchronizedCount, 1);
    assert.equal(synchronization.missingCount, 0);
    const importedRecords = store.listRecords(instance.id);
    assert.equal(importedRecords.length, 1);
    assert.equal(importedRecords[0].models[0], OPENAI_MODELS[0]);
  } finally {
    restoreRuntimeContext();
    store.close();
    await closeServer(mockNewApiServer);
  }
});

test("standard New API import creates an official xAI Grok channel", async () => {
  const createdChannelRequests = [];
  const storedChannels = [{
    id: 106,
    type: 1,
    name: "channel-0711-106",
    group: "openai",
    models: OPENAI_MODELS.join(","),
    status: 1,
    used_quota: 0,
  }];
  const mockNewApiServer = createMockNewApiServer(
    createdChannelRequests,
    storedChannels,
  );
  const mockNewApiBaseUrl = await listenOnAvailablePort(mockNewApiServer);
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 23),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance({
      name: "Mock Grok instance",
      baseUrl: mockNewApiBaseUrl,
      username: "new-api-administrator",
      password: NEW_API_PASSWORD,
      group: "anthropic",
      namePrefix: "channel",
      startNumber: 1,
      continueFromExisting: true,
      priority: 8,
      weight: 18,
      dateMode: "0711",
      enabled: true,
    });
    const generatedAccess = store.createInstanceMember(instance.id, { name: "测试成员" });
    const session = store.createVisitorSessionForAccessKey(generatedAccess.accessKey);

    const groupsResponse = await getInstanceGroups(
      createInstanceGetRequest(instance.id, session.token, "groups"),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    assert.equal(groupsResponse.status, 200);
    assert.deepEqual(await groupsResponse.json(), {
      success: true,
      data: { groups: AVAILABLE_GROUPS },
    });

    const response = await importChannels(
      createImportRequest(
        instance.id,
        session.token,
        [GROK_IMPORT_KEY],
        "grok",
        "premium",
      ),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );

    assert.equal(response.status, 200);
    const responseText = await response.text();
    const progressEvents = responseText.trim().split("\n").map(JSON.parse);
    assert.equal(progressEvents[0].channelKind, "grok");
    assert.deepEqual(progressEvents.at(-1), {
      type: "complete",
      total: 1,
      completed: 1,
      success: 1,
      failure: 0,
    });
    assert.equal(responseText.includes(GROK_IMPORT_KEY), false);

    assert.equal(createdChannelRequests.length, 1);
    const createdChannel = createdChannelRequests[0].channel;
    assert.equal(createdChannel.type, 48);
    assert.equal(createdChannel.name, "channel-0711-107");
    assert.equal(createdChannel.key, GROK_IMPORT_KEY);
    assert.equal(createdChannel.models, GROK_MODELS.join(","));
    assert.equal(createdChannel.group, "premium");
    assert.equal(createdChannel.base_url, "");
    assert.equal(createdChannel.priority, 8);
    assert.equal(createdChannel.weight, 18);

    const synchronization = await synchronizeInstanceRecords(
      instance.id,
      "standard-grok-sync-test",
    );
    assert.equal(synchronization.synchronizedCount, 1);
    assert.equal(synchronization.missingCount, 0);
    const importedRecords = store.listRecords(instance.id);
    assert.equal(importedRecords.length, 1);
    assert.deepEqual(importedRecords[0].models, GROK_MODELS);

    const invalidGroupKey = "xai-invalid-group-example";
    const invalidGroupResponse = await importChannels(
      createImportRequest(
        instance.id,
        session.token,
        [invalidGroupKey],
        "grok",
        "removed-group",
      ),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    assert.equal(invalidGroupResponse.status, 200);
    const invalidGroupResponseText = await invalidGroupResponse.text();
    const invalidGroupEvents = invalidGroupResponseText.trim().split("\n").map(JSON.parse);
    assert.deepEqual(invalidGroupEvents.at(-1), {
      type: "fatal",
      message: "所选分组 removed-group 已不存在，请刷新分组后重新选择",
      completed: 0,
      success: 0,
      failure: 0,
    });
    assert.equal(invalidGroupResponseText.includes(invalidGroupKey), false);
    assert.equal(createdChannelRequests.length, 1);
  } finally {
    restoreRuntimeContext();
    store.close();
    await closeServer(mockNewApiServer);
  }
});

test("import uses instance channel models and per-import model overrides", async () => {
  const createdChannelRequests = [];
  const storedChannels = [];
  const mockNewApiServer = createMockNewApiServer(createdChannelRequests, storedChannels);
  const mockNewApiBaseUrl = await listenOnAvailablePort(mockNewApiServer);
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 23),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance({
      name: "Custom model instance",
      baseUrl: mockNewApiBaseUrl,
      username: "new-api-administrator",
      password: NEW_API_PASSWORD,
      group: "anthropic",
      namePrefix: "channel",
      startNumber: 1,
      continueFromExisting: true,
      priority: 0,
      weight: 0,
      dateMode: "",
      channelModels: {
        claude: ["claude-opus-4-9", "claude-sonnet-4-9"],
        openai: ["gpt-5.7"],
        grok: ["grok-5"],
      },
      enabled: true,
    });
    const generatedAccess = store.createInstanceMember(instance.id, { name: "测试成员" });
    const session = store.createVisitorSessionForAccessKey(generatedAccess.accessKey);

    const configurationResponse = await getInstanceConfiguration(
      createInstanceGetRequest(instance.id, session.token, "config"),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    const configurationPayload = await configurationResponse.json();
    assert.deepEqual(configurationPayload.data.modelsByChannelKind.claude, [
      "claude-opus-4-9",
      "claude-sonnet-4-9",
    ]);

    const defaultModelResponse = await importChannels(
      createImportRequest(instance.id, session.token, ["sk-ant-default-models"], "claude", "anthropic"),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    assert.equal((await defaultModelResponse.text()).includes("\"failure\":0"), true);
    assert.equal(createdChannelRequests[0].channel.models, "claude-opus-4-9,claude-sonnet-4-9");

    const overrideResponse = await importChannels(
      createImportRequest(
        instance.id,
        session.token,
        ["sk-ant-override-models"],
        "claude",
        "anthropic",
        [" claude-haiku-4-9 ", "claude-haiku-4-9"],
      ),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    assert.equal((await overrideResponse.text()).includes("\"failure\":0"), true);
    assert.equal(createdChannelRequests[1].channel.models, "claude-haiku-4-9");

    const invalidResponse = await importChannels(
      createImportRequest(instance.id, session.token, ["sk-ant-invalid-models"], "claude", "anthropic", ["bad,model"]),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    assert.equal(invalidResponse.status, 400);
    assert.match((await invalidResponse.json()).message, /不能包含空格或逗号/);
    assert.equal(createdChannelRequests.length, 2);
  } finally {
    restoreRuntimeContext();
    store.close();
    await closeServer(mockNewApiServer);
  }
});

test("each member imports with its own name prefix and channel defaults", async () => {
  const createdChannelRequests = [];
  const storedChannels = [];
  const mockNewApiServer = createMockNewApiServer(createdChannelRequests, storedChannels);
  const mockNewApiBaseUrl = await listenOnAvailablePort(mockNewApiServer);
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 25),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance({
      name: "Shared instance",
      baseUrl: mockNewApiBaseUrl,
      username: "new-api-administrator",
      password: NEW_API_PASSWORD,
      group: "anthropic",
      namePrefix: "claude",
      startNumber: 1,
      continueFromExisting: true,
      priority: 1,
      weight: 2,
      dateMode: "0101",
      enabled: true,
    });
    const overridingMember = store.createInstanceMember(instance.id, {
      name: "张三",
      namePrefix: "zhangsan",
      dateMode: "",
      startNumber: 5,
      priority: 9,
      weight: 4,
    });
    const inheritingMember = store.createInstanceMember(instance.id, { name: "李四", namePrefix: "lisi" });
    const overridingSession = store.createVisitorSessionForAccessKey(overridingMember.accessKey);
    const inheritingSession = store.createVisitorSessionForAccessKey(inheritingMember.accessKey);
    const routeContext = { params: Promise.resolve({ instanceId: String(instance.id) }) };

    const configurationPayload = await (await getInstanceConfiguration(
      createInstanceGetRequest(instance.id, overridingSession.token, "config"),
      routeContext,
    )).json();
    assert.equal(configurationPayload.data.member.name, "张三");
    assert.equal(configurationPayload.data.channelDefaults.namePrefix, "zhangsan");
    assert.equal(configurationPayload.data.channelDefaults.dateSegment, "");
    assert.equal(configurationPayload.data.instance.memberCount, undefined);

    const overridingResponse = await importChannels(
      createImportRequest(instance.id, overridingSession.token, ["sk-ant-zhangsan-key"], "claude", "anthropic"),
      routeContext,
    );
    assert.equal((await overridingResponse.text()).includes("\"failure\":0"), true);
    const inheritingResponse = await importChannels(
      createImportRequest(instance.id, inheritingSession.token, ["sk-ant-lisi-key"], "claude", "anthropic"),
      routeContext,
    );
    assert.equal((await inheritingResponse.text()).includes("\"failure\":0"), true);

    assert.deepEqual(
      createdChannelRequests.map(({ channel }) => [channel.name, channel.priority, channel.weight]),
      [["zhangsan-005", 9, 4], ["lisi-0101-001", 1, 2]],
    );
    assert.deepEqual(
      store.listRecords(instance.id, overridingMember.member.id).map((record) => record.channelName),
      ["zhangsan-005"],
    );
    assert.deepEqual(
      store.listRecords(instance.id, inheritingMember.member.id).map((record) => record.channelName),
      ["lisi-0101-001"],
    );

    const synchronizationResponse = await synchronizeVisitorRecords(
      new Request(`http://localhost/api/instances/${instance.id}/records/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(overridingSession.token)}`,
          Host: "localhost",
        },
        body: "{}",
      }),
      routeContext,
    );
    const synchronizationData = (await synchronizationResponse.json()).data;
    assert.equal(synchronizationData.synchronizedCount, 1);
    assert.equal(synchronizationData.memberCounts, undefined);
    assert.deepEqual(synchronizationData.records.map((record) => record.channelName), ["zhangsan-005"]);
  } finally {
    restoreRuntimeContext();
    store.close();
    await closeServer(mockNewApiServer);
  }
});

test("AWS import creates type 33 channels with key type and interface settings", async () => {
  const createdChannelRequests = [];
  const storedChannels = [];
  const mockNewApiServer = createMockNewApiServer(createdChannelRequests, storedChannels);
  const mockNewApiBaseUrl = await listenOnAvailablePort(mockNewApiServer);
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 24),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);
  const accessKeyCredential = "AKIAEXAMPLE000000001|exampleSecretAccessKey000000001|us-east-1";
  const apiKeyCredential = "ABSKexampleBedrockApiKey0001|us-west-2";

  try {
    const instance = store.createInstance({
      name: "AWS instance",
      baseUrl: mockNewApiBaseUrl,
      username: "new-api-administrator",
      password: NEW_API_PASSWORD,
      group: "anthropic",
      namePrefix: "aws",
      startNumber: 1,
      continueFromExisting: true,
      priority: 0,
      weight: 0,
      dateMode: "",
      enabled: true,
    });
    const generatedAccess = store.createInstanceMember(instance.id, { name: "测试成员" });
    const session = store.createVisitorSessionForAccessKey(generatedAccess.accessKey);
    const request = createImportRequest(
      instance.id,
      session.token,
      [accessKeyCredential, apiKeyCredential],
      "aws",
      "premium",
    );
    const requestBody = JSON.parse(await request.text());
    const response = await importChannels(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({ ...requestBody, awsApiType: "mantle" }),
      }),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    const responseText = await response.text();
    assert.equal(responseText.includes("\"success\":2"), true);
    assert.equal(responseText.includes("exampleSecretAccessKey000000001"), false);

    assert.equal(createdChannelRequests.length, 2);
    const [accessKeyChannel, apiKeyChannel] = createdChannelRequests.map((createdRequest) => createdRequest.channel);
    assert.equal(accessKeyChannel.type, 33);
    assert.equal(accessKeyChannel.key, accessKeyCredential);
    assert.equal(accessKeyChannel.models, CLAUDE_MODELS.join(","));
    assert.deepEqual(JSON.parse(accessKeyChannel.settings), {
      aws_key_type: "ak_sk",
      aws_api_type: "mantle",
    });
    assert.deepEqual(JSON.parse(apiKeyChannel.settings), {
      aws_key_type: "api_key",
      aws_api_type: "mantle",
    });

    const invalidResponse = await importChannels(
      createImportRequest(instance.id, session.token, ["AKIAEXAMPLE000000001|missing-region"], "aws", "premium"),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    assert.equal(invalidResponse.status, 400);
    assert.match((await invalidResponse.json()).message, /第 1 个 AWS 凭证的最后一段不是有效区域/);
  } finally {
    restoreRuntimeContext();
    store.close();
    await closeServer(mockNewApiServer);
  }
});
