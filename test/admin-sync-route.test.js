import assert from "node:assert/strict";
import test from "node:test";

import { POST as synchronizeAdministratorRecords } from "../app/api/admin/records/route.js";
import { ApplicationStore } from "../lib/application-store.js";
import { SESSION_COOKIE_NAME } from "../lib/http.js";

const RUNTIME_CONTEXT_KEY = Symbol.for("newapi-key.runtime-context");
const ADMINISTRATOR_PASSWORD = "administrator-password";

function createSilentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function createSynchronizationRequest(sessionToken = null) {
  const headers = {
    "Content-Type": "application/json",
    Host: "localhost",
    Origin: "http://localhost",
  };
  if (sessionToken) {
    headers.Cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`;
  }
  return new Request("http://localhost/api/admin/records", {
    method: "POST",
    headers,
    body: "{}",
  });
}

function createInstanceInput(name, enabled) {
  return {
    name,
    baseUrl: `https://${name}.example.com`,
    username: `${name}-administrator`,
    password: `${name}-password`,
    group: "anthropic",
    namePrefix: "claude",
    startNumber: 1,
    continueFromExisting: true,
    priority: 0,
    weight: 0,
    dateMode: "auto",
    enabled,
  };
}

function recordTrackedChannel(store, instance, channelId) {
  store.recordImportedChannel({
    instanceId: instance.id,
    baseUrl: instance.baseUrl,
    key: `sk-ant-administrator-sync-${channelId}`,
    channel: {
      id: channelId,
      name: `claude-0711-${String(channelId).padStart(3, "0")}`,
      group: "anthropic",
      models: "claude-opus-4-8",
      status: 1,
      balance: 0,
      used_quota: 0,
    },
    quotaPerUnit: 500_000,
  });
}

test("administrator sync route authorizes callers and skips ineligible instances", async () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 23),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const previousRuntimeContext = globalThis[RUNTIME_CONTEXT_KEY];

  try {
    const enabledInstance = store.createInstance(
      createInstanceInput("enabled-instance", true),
    );
    const disabledInstance = store.createInstance(
      createInstanceInput("disabled-instance", false),
    );
    store.updateInstance(disabledInstance.id, {
      ...disabledInstance,
      username: disabledInstance.adminUsername,
      password: "",
      enabled: false,
    });
    store.createInstance(createInstanceInput("empty-instance", true));
    recordTrackedChannel(store, disabledInstance, 102);

    let synchronizedSearchCount = 0;
    const enabledConnection = store.getInstanceConnection(enabledInstance.id);
    globalThis[RUNTIME_CONTEXT_KEY] = {
      store,
      logger: createSilentLogger(),
      instanceRuntimes: new Map([[
        enabledInstance.id,
        {
          connection: enabledConnection,
          configurationVersion: enabledConnection.updatedAt,
          client: {
            async getStatus() {
              return { quota_per_unit: 500_000 };
            },
            async login() {
              return { id: 1, username: "enabled-instance-administrator" };
            },
            async searchChannelByName(channelName) {
              synchronizedSearchCount += 1;
              return {
                id: 101,
                name: channelName,
                group: "anthropic",
                models: "claude-opus-4-8",
                status: 1,
                balance: 8,
                used_quota: 1_000_000,
              };
            },
          },
          authenticatedUser: null,
          authenticationPromise: null,
          systemStatusCache: { value: null, expiresAt: 0 },
        },
      ]]),
      loginAttempts: new Map(),
      accessAttempts: new Map(),
    };

    const anonymousResponse = await synchronizeAdministratorRecords(
      createSynchronizationRequest(),
    );
    assert.equal(anonymousResponse.status, 401);

    const visitorAccess = store.regenerateInstanceAccessKey(enabledInstance.id);
    const visitorSession = store.createVisitorSessionForAccessKey(visitorAccess.accessKey);
    const visitorResponse = await synchronizeAdministratorRecords(
      createSynchronizationRequest(visitorSession.token),
    );
    assert.equal(visitorResponse.status, 403);

    const administrator = store.authenticateAdministrator(
      "system-administrator",
      ADMINISTRATOR_PASSWORD,
    );
    const administratorSession = store.createAdministratorSession(administrator.id);
    const administratorResponse = await synchronizeAdministratorRecords(
      createSynchronizationRequest(administratorSession.token),
    );
    assert.equal(administratorResponse.status, 200);
    const responsePayload = await administratorResponse.json();
    assert.deepEqual(responsePayload.data, {
      instanceCount: 0,
      synchronizedCount: 0,
      missingCount: 0,
      failedInstanceCount: 0,
    });
    assert.equal(synchronizedSearchCount, 0);
  } finally {
    if (previousRuntimeContext === undefined) {
      delete globalThis[RUNTIME_CONTEXT_KEY];
    } else {
      globalThis[RUNTIME_CONTEXT_KEY] = previousRuntimeContext;
    }
    store.close();
  }
});
