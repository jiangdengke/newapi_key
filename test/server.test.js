import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApplicationServer } from "../server.js";

const MOCK_ADMIN_PASSWORD = "mock-admin-password";
const MOCK_KEYS = ["sk-mock-success-key", "sk-mock-failure-key"];
const MOCK_MODELS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
];

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

function sendMockJson(response, responseBody, headers = {}) {
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(responseBody));
}

function createMockNewApiServer(createdChannelRequests, mockChannels, requestMetrics) {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");

    if (request.method === "GET" && requestUrl.pathname === "/api/status") {
      requestMetrics.statusRequests += 1;
      sendMockJson(response, {
        success: true,
        data: {
          system_name: "Mock New API",
          version: "test-version",
          quota_per_unit: 500_000,
        },
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/user/login") {
      requestMetrics.loginRequests += 1;
      const loginRequest = await readRequestJson(request);
      assert.deepEqual(loginRequest, {
        username: "mock-admin",
        password: MOCK_ADMIN_PASSWORD,
      });
      sendMockJson(
        response,
        {
          success: true,
          data: { id: 1, username: "mock-admin", role: 100 },
        },
        { "Set-Cookie": "session=mock-session; Path=/; HttpOnly" },
      );
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/channel/") {
      requestMetrics.channelListRequests += 1;
      if (requestMetrics.rateLimitedChannelListRequests > 0) {
        requestMetrics.rateLimitedChannelListRequests -= 1;
        response.writeHead(429, {
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": requestMetrics.rateLimitRetryAfter,
        });
        response.end(JSON.stringify({ success: false, message: "请求过于频繁" }));
        return;
      }
      assert.equal(request.headers.cookie, "session=mock-session");
      assert.equal(request.headers["new-api-user"], "1");
      assert.equal(requestUrl.searchParams.get("type"), "14");
      sendMockJson(response, {
        success: true,
        data: {
          items: mockChannels,
          total: requestMetrics.reportLargeChannelTotal
            ? 10_001
            : mockChannels.length,
        },
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/channel/search") {
      requestMetrics.channelSearchRequests += 1;
      if (requestMetrics.rateLimitedChannelSearchRequests > 0) {
        requestMetrics.rateLimitedChannelSearchRequests -= 1;
        response.writeHead(429, {
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": requestMetrics.rateLimitRetryAfter,
        });
        response.end(JSON.stringify({ success: false, message: "请求过于频繁" }));
        return;
      }
      assert.equal(request.headers.cookie, "session=mock-session");
      assert.equal(request.headers["new-api-user"], "1");
      const channelName = requestUrl.searchParams.get("keyword");
      requestMetrics.channelSearchKeywords.push(channelName);
      const matchingChannels = mockChannels.filter(
        (channel) => channel.name.includes(channelName),
      );
      const pageNumber = Number(requestUrl.searchParams.get("p") || 1);
      const pageSize = Number(requestUrl.searchParams.get("page_size") || 100);
      const pageStartIndex = (pageNumber - 1) * pageSize;
      sendMockJson(response, {
        success: true,
        data: {
          items: matchingChannels.slice(pageStartIndex, pageStartIndex + pageSize),
          total: matchingChannels.length,
        },
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/channel/") {
      assert.equal(request.headers.cookie, "session=mock-session");
      assert.equal(request.headers["new-api-user"], "1");
      const channelRequest = await readRequestJson(request);
      createdChannelRequests.push(channelRequest);

      if (channelRequest.channel.key === MOCK_KEYS[1]) {
        sendMockJson(response, {
          success: false,
          message: `上游拒绝了 ${channelRequest.channel.key}`,
        });
        return;
      }

      mockChannels.push({
        id: 107,
        type: 14,
        name: channelRequest.channel.name,
        group: channelRequest.channel.group,
        models: channelRequest.channel.models,
        status: 1,
        used_quota: 250_000,
      });
      sendMockJson(response, { success: true, message: "" });
      return;
    }

    response.writeHead(404);
    response.end();
  });
}

test("application imports channels with sequential names and safe feedback", async () => {
  const createdChannelRequests = [];
  const requestMetrics = {
    statusRequests: 0,
    loginRequests: 0,
    channelListRequests: 0,
    channelSearchRequests: 0,
    rateLimitedChannelListRequests: 1,
    rateLimitedChannelSearchRequests: 0,
    rateLimitRetryAfter: "0",
    channelSearchKeywords: [],
    reportLargeChannelTotal: false,
  };
  let currentTime = Date.parse("2026-07-11T04:00:00.000Z");
  const mockChannels = [{
    id: 106,
    type: 14,
    name: "claude-0711-106",
    group: "anthropic",
    models: MOCK_MODELS.join(","),
    status: 1,
    used_quota: 0,
  }];
  const mockNewApiServer = createMockNewApiServer(
    createdChannelRequests,
    mockChannels,
    requestMetrics,
  );
  const mockNewApiBaseUrl = await listenOnAvailablePort(mockNewApiServer);
  const applicationServer = createApplicationServer({
    newApiConnection: {
      baseUrl: mockNewApiBaseUrl,
      username: "mock-admin",
      password: MOCK_ADMIN_PASSWORD,
    },
    channelDefaults: {
      group: "anthropic",
      namePrefix: "claude",
      startNumber: 1,
      continueFromExisting: true,
      dateMode: "0711",
    },
    getCurrentTime: () => currentTime,
  });
  const applicationBaseUrl = await listenOnAvailablePort(applicationServer);

  try {
    const pageResponse = await fetch(applicationBaseUrl);
    const pageHtml = await pageResponse.text();
    assert.equal(pageResponse.status, 200);
    assert.match(pageHtml, /id="keys"/);
    assert.match(pageHtml, /id="target-new-api"/);
    assert.match(pageHtml, /当前 New API/);
    assert.equal(pageHtml.includes("id=\"confirm-import\""), false);
    assert.equal(pageHtml.includes("security-note"), false);
    assert.equal(pageHtml.includes("渠道连接、命名和模型配置"), false);
    assert.equal(pageHtml.includes("id=\"target-base-url\""), false);
    assert.equal(pageHtml.includes("id=\"test-connection-button\""), false);
    assert.equal(pageHtml.includes("id=\"name-prefix\""), false);
    assert.match(pageHtml, /id="history-key-search"/);
    assert.match(pageHtml, /id="previous-history-page"/);
    assert.match(pageHtml, /id="next-history-page"/);

    const configurationResponse = await fetch(`${applicationBaseUrl}/api/config`);
    const configurationPayload = await configurationResponse.json();
    assert.deepEqual(configurationPayload, {
      success: true,
      data: {
        baseUrl: mockNewApiBaseUrl,
        username: "mock-admin",
        models: MOCK_MODELS,
        channelDefaults: {
          group: "anthropic",
          namePrefix: "claude",
          startNumber: 1,
          continueFromExisting: true,
          dateMode: "0711",
          dateSegment: "0711",
        },
      },
    });
    assert.equal(JSON.stringify(configurationPayload).includes(MOCK_ADMIN_PASSWORD), false);

    const connectionResponse = await fetch(`${applicationBaseUrl}/api/test-connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "browser-supplied-password-is-ignored" }),
    });
    const connectionPayload = await connectionResponse.json();
    assert.equal(connectionResponse.status, 200);
    assert.equal(connectionPayload.success, true);
    assert.equal(connectionPayload.data.anthropicChannelCount, 1);

    const channelListRequestsBeforeImport = requestMetrics.channelListRequests;
    requestMetrics.reportLargeChannelTotal = true;
    const importResponse = await fetch(`${applicationBaseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "browser-supplied-password-is-ignored",
        keys: MOCK_KEYS,
        namePrefix: "browser-prefix",
        dateSegment: "0101",
        startNumber: 999,
        group: "browser-group",
        continueFromExisting: false,
      }),
    });
    const progressEvents = (await importResponse.text())
      .trim()
      .split("\n")
      .map((responseLine) => JSON.parse(responseLine));

    assert.equal(importResponse.status, 200);
    assert.deepEqual(
      createdChannelRequests.map((requestBody) => requestBody.channel.name),
      ["claude-0711-107", "claude-0711-108"],
    );
    assert.equal(createdChannelRequests[0].channel.type, 14);
    assert.equal(createdChannelRequests[0].channel.group, "anthropic");
    assert.equal(
      createdChannelRequests[0].channel.models,
      "claude-opus-4-8,claude-opus-4-7,claude-opus-4-6",
    );
    assert.equal(requestMetrics.channelListRequests, channelListRequestsBeforeImport);
    assert.equal(requestMetrics.channelSearchKeywords[0], "claude-0711-");
    requestMetrics.reportLargeChannelTotal = false;

    const completionEvent = progressEvents.at(-1);
    assert.deepEqual(completionEvent, {
      type: "complete",
      total: 2,
      completed: 2,
      success: 1,
      failure: 1,
    });
    const serializedProgress = JSON.stringify(progressEvents);
    assert.equal(serializedProgress.includes(MOCK_KEYS[0]), false);
    assert.equal(serializedProgress.includes(MOCK_KEYS[1]), false);
    assert.match(serializedProgress, /\[已隐藏\]/);

    const recordsResponse = await fetch(`${applicationBaseUrl}/api/records`);
    const recordsPayload = await recordsResponse.json();
    assert.equal(recordsPayload.success, true);
    assert.equal(recordsPayload.data.records.length, 1);
    const importedRecord = recordsPayload.data.records[0];
    assert.equal(importedRecord.newApiChannelId, 107);
    assert.equal(importedRecord.channelName, "claude-0711-107");
    assert.equal(importedRecord.usedQuota, 250_000);
    assert.equal(importedRecord.usedUsd, 0.5);
    assert.match(importedRecord.keyMask, /\*{4}/);
    assert.equal(JSON.stringify(importedRecord).includes(MOCK_KEYS[0]), false);
    assert.equal(Object.hasOwn(importedRecord, "keyFingerprint"), false);

    const paginatedRecordsResponse = await fetch(
      `${applicationBaseUrl}/api/records/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: 1, pageSize: 1 }),
      },
    );
    const paginatedRecordsPayload = await paginatedRecordsResponse.json();
    assert.equal(paginatedRecordsPayload.success, true);
    assert.equal(paginatedRecordsPayload.data.total, 1);
    assert.equal(paginatedRecordsPayload.data.page, 1);
    assert.equal(paginatedRecordsPayload.data.pageSize, 1);
    assert.equal(paginatedRecordsPayload.data.totalPages, 1);

    const exactKeyResponse = await fetch(`${applicationBaseUrl}/api/records/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: MOCK_KEYS[0], page: 1, pageSize: 10 }),
    });
    const exactKeyPayload = await exactKeyResponse.json();
    assert.equal(exactKeyPayload.success, true);
    assert.equal(exactKeyPayload.data.total, 1);
    assert.equal(exactKeyPayload.data.records[0].newApiChannelId, 107);
    assert.equal(JSON.stringify(exactKeyPayload).includes(MOCK_KEYS[0]), false);
    assert.equal(exactKeyResponse.headers.get("cache-control"), "no-store");

    const missingKeyResponse = await fetch(`${applicationBaseUrl}/api/records/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "sk-ant-not-imported-key", page: 1, pageSize: 10 }),
    });
    const missingKeyPayload = await missingKeyResponse.json();
    assert.equal(missingKeyPayload.success, true);
    assert.equal(missingKeyPayload.data.total, 0);
    assert.deepEqual(missingKeyPayload.data.records, []);

    const invalidPageResponse = await fetch(`${applicationBaseUrl}/api/records/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: 0, pageSize: 10 }),
    });
    const invalidPagePayload = await invalidPageResponse.json();
    assert.equal(invalidPageResponse.status, 400);
    assert.equal(invalidPagePayload.success, false);
    assert.match(invalidPagePayload.message, /页码/);

    const invalidPageSizeResponse = await fetch(
      `${applicationBaseUrl}/api/records/query`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: 1, pageSize: 101 }),
      },
    );
    const invalidPageSizePayload = await invalidPageSizeResponse.json();
    assert.equal(invalidPageSizeResponse.status, 400);
    assert.equal(invalidPageSizePayload.success, false);
    assert.match(invalidPageSizePayload.message, /每页数量/);

    const duplicateImportResponse = await fetch(`${applicationBaseUrl}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keys: [MOCK_KEYS[0]],
      }),
    });
    const duplicateProgress = await duplicateImportResponse.text();
    assert.equal(createdChannelRequests.length, 2);
    assert.match(duplicateProgress, /请勿重复提交/);
    assert.equal(duplicateProgress.includes(MOCK_KEYS[0]), false);

    const createdMockChannel = mockChannels.find((channel) => channel.id === 107);
    createdMockChannel.used_quota = 750_000;
    createdMockChannel.status = 2;
    const channelListRequestsBeforeSynchronization = requestMetrics.channelListRequests;
    const channelSearchRequestsBeforeSynchronization = requestMetrics.channelSearchRequests;
    const synchronizationResponse = await fetch(
      `${applicationBaseUrl}/api/records/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const synchronizationPayload = await synchronizationResponse.json();
    assert.equal(synchronizationPayload.success, true);
    assert.equal(synchronizationPayload.data.synchronizedCount, 1);
    assert.equal(synchronizationPayload.data.missingCount, 0);
    assert.equal(synchronizationPayload.data.records[0].usedQuota, 750_000);
    assert.equal(synchronizationPayload.data.records[0].usedUsd, 1.5);
    assert.equal(synchronizationPayload.data.records[0].statusLabel, "disabled");
    assert.equal(
      requestMetrics.channelListRequests,
      channelListRequestsBeforeSynchronization,
    );
    assert.equal(
      requestMetrics.channelSearchRequests,
      channelSearchRequestsBeforeSynchronization + 1,
    );

    const repeatedSynchronizationResponse = await fetch(
      `${applicationBaseUrl}/api/records/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const repeatedSynchronizationPayload = await repeatedSynchronizationResponse.json();
    assert.equal(repeatedSynchronizationPayload.success, true);
    assert.equal(repeatedSynchronizationPayload.data.synchronizedCount, 1);
    assert.equal(repeatedSynchronizationPayload.data.records[0].usedUsd, 1.5);
    assert.equal(
      requestMetrics.channelSearchRequests,
      channelSearchRequestsBeforeSynchronization + 2,
    );

    const createdMockChannelIndex = mockChannels.findIndex((channel) => channel.id === 107);
    const [removedMockChannel] = mockChannels.splice(createdMockChannelIndex, 1);
    const missingChannelSynchronizationResponse = await fetch(
      `${applicationBaseUrl}/api/records/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const missingChannelSynchronizationPayload =
      await missingChannelSynchronizationResponse.json();
    assert.equal(missingChannelSynchronizationPayload.success, true);
    assert.equal(missingChannelSynchronizationPayload.data.synchronizedCount, 0);
    assert.equal(missingChannelSynchronizationPayload.data.missingCount, 1);
    assert.equal(
      missingChannelSynchronizationPayload.data.records[0].statusLabel,
      "missing",
    );
    mockChannels.push(removedMockChannel);

    requestMetrics.rateLimitedChannelSearchRequests = 2;
    requestMetrics.rateLimitRetryAfter = "0.001";
    const rateLimitedSynchronizationResponse = await fetch(
      `${applicationBaseUrl}/api/records/sync`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const rateLimitedSynchronizationPayload = await rateLimitedSynchronizationResponse.json();
    assert.equal(rateLimitedSynchronizationResponse.status, 502);
    assert.equal(rateLimitedSynchronizationPayload.success, false);
    assert.match(rateLimitedSynchronizationPayload.message, /请在 1 秒后再试/);
    assert.equal(requestMetrics.statusRequests, 1);
    assert.equal(requestMetrics.loginRequests, 1);
    assert.equal(requestMetrics.channelListRequests, channelListRequestsBeforeSynchronization);
    assert.equal(requestMetrics.rateLimitedChannelListRequests, 0);
    assert.equal(requestMetrics.rateLimitedChannelSearchRequests, 0);
  } finally {
    await Promise.all([
      closeServer(applicationServer),
      closeServer(mockNewApiServer),
    ]);
  }
});
