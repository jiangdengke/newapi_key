import assert from "node:assert/strict";
import test from "node:test";

import { ApplicationStore } from "../lib/application-store.js";
import { synchronizeInstanceRecords } from "../lib/instance-service.js";

const RUNTIME_CONTEXT_KEY = Symbol.for("newapi-key.runtime-context");

function createSilentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

test("record synchronization limits searches and coalesces overlapping requests", async () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 19),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: "administrator-password",
    },
  });
  const previousRuntimeContext = globalThis[RUNTIME_CONTEXT_KEY];

  try {
    const instance = store.createInstance({
      name: "synchronization-test",
      baseUrl: "https://new-api.example.com",
      username: "new-api-administrator",
      password: "new-api-password",
      group: "anthropic",
      namePrefix: "claude",
      startNumber: 1,
      continueFromExisting: true,
      priority: 0,
      weight: 0,
      dateMode: "auto",
      enabled: true,
    });
    const trackedChannelCount = 12;
    for (let channelIndex = 1; channelIndex <= trackedChannelCount; channelIndex += 1) {
      store.recordImportedChannel({
        instanceId: instance.id,
        baseUrl: instance.baseUrl,
        key: `sk-ant-synchronization-${channelIndex}`,
        channel: {
          id: channelIndex,
          name: `claude-0711-${String(channelIndex).padStart(3, "0")}`,
          group: "anthropic",
          models: "claude-opus-4-8",
          status: 1,
          balance: channelIndex,
          used_quota: channelIndex * 500_000,
        },
        quotaPerUnit: 500_000,
      });
    }

    let activeSearchCount = 0;
    let maximumActiveSearchCount = 0;
    let totalSearchCount = 0;
    const connection = store.getInstanceConnection(instance.id);
    const instanceRuntime = {
      connection,
      configurationVersion: connection.updatedAt,
      client: {
        async getStatus() {
          return { quota_per_unit: 500_000 };
        },
        async login() {
          return { id: 1, username: "new-api-administrator" };
        },
        async searchAnthropicChannelByName(channelName) {
          totalSearchCount += 1;
          activeSearchCount += 1;
          maximumActiveSearchCount = Math.max(
            maximumActiveSearchCount,
            activeSearchCount,
          );
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
          activeSearchCount -= 1;
          const matchingRecord = store.listRecords(instance.id).find(
            (record) => record.channelName === channelName,
          );
          return {
            id: matchingRecord.newApiChannelId,
            name: matchingRecord.channelName,
            group: "anthropic",
            models: "claude-opus-4-8",
            status: 1,
            balance: 10,
            used_quota: 1_000_000,
          };
        },
      },
      authenticatedUser: null,
      authenticationPromise: null,
      systemStatusCache: { value: null, expiresAt: 0 },
    };
    globalThis[RUNTIME_CONTEXT_KEY] = {
      store,
      logger: createSilentLogger(),
      instanceRuntimes: new Map([[instance.id, instanceRuntime]]),
      loginAttempts: new Map(),
      accessAttempts: new Map(),
    };

    const [firstSynchronization, secondSynchronization] = await Promise.all([
      synchronizeInstanceRecords(instance.id, "first-request"),
      synchronizeInstanceRecords(instance.id, "second-request"),
    ]);

    assert.deepEqual(secondSynchronization, firstSynchronization);
    assert.equal(firstSynchronization.synchronizedCount, trackedChannelCount);
    assert.equal(firstSynchronization.missingCount, 0);
    assert.equal(totalSearchCount, trackedChannelCount);
    assert.equal(maximumActiveSearchCount, 5);
  } finally {
    if (previousRuntimeContext === undefined) {
      delete globalThis[RUNTIME_CONTEXT_KEY];
    } else {
      globalThis[RUNTIME_CONTEXT_KEY] = previousRuntimeContext;
    }
    store.close();
  }
});
