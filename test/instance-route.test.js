import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { GET as getInstanceGroups } from "../app/api/instances/[instanceId]/groups/route.js";
import { POST as importChannels } from "../app/api/instances/[instanceId]/import/route.js";
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
        id: 107,
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

function createMockAdminHubServer({
  createdChannelRequests,
  observedSiteIds,
  storedChannelTemplates,
  metricState,
}) {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");

    if (requestUrl.pathname.startsWith("/api/channel")) {
      assert.fail(`Admin Hub 实例不应访问 ${requestUrl.pathname}`);
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/status") {
      sendJson(response, {
        success: true,
        data: {
          system_name: "Mock Deepnix Admin Hub",
          version: "test-version",
          quota_per_unit: 500_000,
        },
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/user/login") {
      const requestBody = await readRequestJson(request);
      assert.deepEqual(requestBody, {
        username: "admin-hub-supplier",
        password: NEW_API_PASSWORD,
      });
      sendJson(response, {
        success: true,
        data: { id: 130, username: "admin-hub-supplier", role: 1 },
      }, {
        "Set-Cookie": "session=mock-admin-hub-session; Path=/; HttpOnly",
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/admin-hub/channels/") {
      assert.equal(request.headers.cookie, "session=mock-admin-hub-session");
      assert.equal(request.headers["new-api-user"], "130");
      observedSiteIds.push(requestUrl.searchParams.get("site_id"));
      const searchKeyword = requestUrl.searchParams.get("keyword") || "";
      const matchingTemplates = storedChannelTemplates.filter(
        (channelTemplate) => channelTemplate.name.includes(searchKeyword),
      );
      sendJson(response, {
        success: true,
        data: { items: matchingTemplates, total: matchingTemplates.length },
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin-hub/channels/") {
      assert.equal(request.headers.cookie, "session=mock-admin-hub-session");
      assert.equal(request.headers["new-api-user"], "130");
      const requestBody = await readRequestJson(request);
      createdChannelRequests.push(requestBody);
      storedChannelTemplates.push({
        id: 701,
        name: requestBody.name,
        channel_json: requestBody.channel_json,
      });
      sendJson(response, {
        success: true,
        data: {
          id: 701,
          publish_results: [{ site_id: 13, success: true }],
        },
      });
      return;
    }

    if (
      request.method === "POST"
      && requestUrl.pathname === "/api/admin-hub/channels/status-batch"
    ) {
      const requestBody = await readRequestJson(request);
      assert.deepEqual(requestBody, { ids: [701] });
      sendJson(response, {
        success: true,
        data: { 701: { status: 1 } },
      });
      return;
    }

    if (
      request.method === "POST"
      && requestUrl.pathname === "/api/admin-hub/channels/used-quota"
    ) {
      const requestBody = await readRequestJson(request);
      assert.deepEqual(requestBody, { ids: [701] });
      sendJson(response, {
        success: true,
        data: {
          701: {
            used_quota: 0,
            sites: [{ site_id: 13, used_quota: metricState.usedQuota }],
          },
        },
      });
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
    const generatedAccess = store.regenerateInstanceAccessKey(instance.id);
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
    const generatedAccess = store.regenerateInstanceAccessKey(instance.id);
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
    const generatedAccess = store.regenerateInstanceAccessKey(instance.id);
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

test("Admin Hub import targets AGT site 13 and synchronizes channel metrics", async () => {
  const createdChannelRequests = [];
  const observedSiteIds = [];
  const storedChannelTemplates = [];
  const metricState = { usedQuota: 250_000 };
  const mockAdminHubServer = createMockAdminHubServer({
    createdChannelRequests,
    observedSiteIds,
    storedChannelTemplates,
    metricState,
  });
  const mockAdminHubBaseUrl = await listenOnAvailablePort(mockAdminHubServer);
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 12),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance({
      name: "Mock Admin Hub",
      baseUrl: mockAdminHubBaseUrl,
      username: "admin-hub-supplier",
      password: NEW_API_PASSWORD,
      connectionProtocol: "admin-hub",
      adminHubTargetSiteId: 13,
      group: "anthropic",
      namePrefix: "claude",
      startNumber: 1,
      continueFromExisting: true,
      priority: 5,
      weight: 20,
      dateMode: "0711",
      enabled: true,
    });
    const generatedAccess = store.regenerateInstanceAccessKey(instance.id);
    const session = store.createVisitorSessionForAccessKey(generatedAccess.accessKey);

    const response = await importChannels(
      createImportRequest(instance.id, session.token, [IMPORT_KEYS[0]]),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    assert.equal(response.status, 200);

    const responseText = await response.text();
    const progressEvents = responseText.trim().split("\n").map(JSON.parse);
    assert.deepEqual(progressEvents.at(-1), {
      type: "complete",
      total: 1,
      completed: 1,
      success: 1,
      failure: 0,
    });
    assert.equal(responseText.includes(IMPORT_KEYS[0]), false);

    assert.equal(createdChannelRequests.length, 1);
    const createRequest = createdChannelRequests[0];
    assert.equal(createRequest.last_selected_site_ids_json, "[13]");
    assert.deepEqual(createRequest.site_group_overrides, {
      13: ["anthropic"],
    });
    const createdChannel = JSON.parse(createRequest.channel_json);
    assert.equal(createdChannel.platform_channel_type, "anthropic_claude");
    assert.equal(createdChannel.type, 14);
    assert.equal(createdChannel.name, "claude-0711-001");
    assert.equal(createdChannel.key, IMPORT_KEYS[0]);
    assert.equal(createdChannel.models, CLAUDE_MODELS.join(","));
    assert.equal(createdChannel.group, "anthropic");
    assert.equal(createdChannel.priority, 5);
    assert.equal(createdChannel.weight, 20);
    assert.equal(createdChannel.status, 1);
    assert.equal(createdChannel.model_series, "anthropic.claude");
    assert.equal(createdChannel.test_model, "claude-opus-4-8");
    assert.ok(observedSiteIds.length >= 2);
    assert.equal(observedSiteIds.every((siteId) => siteId === "13"), true);

    let importedRecords = store.listRecords(instance.id);
    assert.equal(importedRecords.length, 1);
    assert.equal(importedRecords[0].newApiChannelId, 701);
    assert.equal(importedRecords[0].usedQuota, 250_000);
    assert.equal(importedRecords[0].usedUsd, 0.5);

    metricState.usedQuota = 500_000;
    const synchronization = await synchronizeInstanceRecords(
      instance.id,
      "admin-hub-sync-test",
    );
    assert.equal(synchronization.synchronizedCount, 1);
    assert.equal(synchronization.missingCount, 0);
    importedRecords = store.listRecords(instance.id);
    assert.equal(importedRecords[0].usedQuota, 500_000);
    assert.equal(importedRecords[0].usedUsd, 1);
  } finally {
    restoreRuntimeContext();
    store.close();
    await closeServer(mockAdminHubServer);
  }
});

test("Admin Hub import creates and synchronizes an official OpenAI channel", async () => {
  const createdChannelRequests = [];
  const observedSiteIds = [];
  const storedChannelTemplates = [];
  const metricState = { usedQuota: 500_000 };
  const mockAdminHubServer = createMockAdminHubServer({
    createdChannelRequests,
    observedSiteIds,
    storedChannelTemplates,
    metricState,
  });
  const mockAdminHubBaseUrl = await listenOnAvailablePort(mockAdminHubServer);
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 22),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance({
      name: "Mock Admin Hub OpenAI",
      baseUrl: mockAdminHubBaseUrl,
      username: "admin-hub-supplier",
      password: NEW_API_PASSWORD,
      connectionProtocol: "admin-hub",
      adminHubTargetSiteId: 13,
      group: "anthropic",
      namePrefix: "channel",
      startNumber: 1,
      continueFromExisting: true,
      priority: 6,
      weight: 25,
      dateMode: "0711",
      enabled: true,
    });
    const generatedAccess = store.regenerateInstanceAccessKey(instance.id);
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
    assert.equal(progressEvents.at(-1).success, 1);
    assert.equal(responseText.includes(OPENAI_IMPORT_KEY), false);

    assert.equal(createdChannelRequests.length, 1);
    const createRequest = createdChannelRequests[0];
    assert.deepEqual(createRequest.site_group_overrides, {
      13: ["openai"],
    });
    const createdChannel = JSON.parse(createRequest.channel_json);
    assert.equal(createdChannel.platform_channel_type, "openai");
    assert.equal(createdChannel.type, 1);
    assert.equal(createdChannel.name, "channel-0711-001");
    assert.equal(createdChannel.key, OPENAI_IMPORT_KEY);
    assert.equal(createdChannel.models, OPENAI_MODELS.join(","));
    assert.equal(createdChannel.group, "openai");
    assert.equal(createdChannel.base_url, "");
    assert.equal(createdChannel.model_series, "openai.gpt");
    assert.equal(createdChannel.test_model, OPENAI_MODELS[0]);
    assert.equal(createdChannel.priority, 6);
    assert.equal(createdChannel.weight, 25);
    assert.equal(observedSiteIds.every((siteId) => siteId === "13"), true);

    const synchronization = await synchronizeInstanceRecords(
      instance.id,
      "admin-hub-openai-sync-test",
    );
    assert.equal(synchronization.synchronizedCount, 1);
    assert.equal(synchronization.missingCount, 0);
    const importedRecords = store.listRecords(instance.id);
    assert.equal(importedRecords.length, 1);
    assert.equal(importedRecords[0].newApiChannelId, 701);
    assert.equal(importedRecords[0].models[0], OPENAI_MODELS[0]);
    assert.equal(importedRecords[0].usedUsd, 1);

    const unsupportedGrokResponse = await importChannels(
      createImportRequest(
        instance.id,
        session.token,
        [GROK_IMPORT_KEY],
        "grok",
      ),
      { params: Promise.resolve({ instanceId: String(instance.id) }) },
    );
    assert.equal(unsupportedGrokResponse.status, 400);
    assert.deepEqual(await unsupportedGrokResponse.json(), {
      success: false,
      message: "Grok 渠道仅支持标准 New API 实例",
    });
    assert.equal(createdChannelRequests.length, 1);
  } finally {
    restoreRuntimeContext();
    store.close();
    await closeServer(mockAdminHubServer);
  }
});
