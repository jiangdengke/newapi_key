import assert from "node:assert/strict";
import test from "node:test";

import { DELETE as deleteAdminInstance } from "../app/api/admin/instances/[instanceId]/route.js";
import { GET as getAdminInstances } from "../app/api/admin/instances/route.js";
import { POST as queryAdministratorRecords } from "../app/api/admin/records/query/route.js";
import { POST as loginWithAccessKey } from "../app/api/access/login/route.js";
import { GET as getInstanceConfiguration } from "../app/api/instances/[instanceId]/config/route.js";
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

function createInstanceInput(name, baseUrl) {
  return {
    name,
    baseUrl,
    username: `${name}-administrator`,
    password: `${name}-new-api-password`,
    group: "anthropic",
    namePrefix: "claude",
    startNumber: 1,
    continueFromExisting: true,
    dateMode: "auto",
    enabled: true,
  };
}

function createAuthenticatedRequest(pathname, sessionToken) {
  return new Request(`http://localhost${pathname}`, {
    headers: {
      Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
      Host: "localhost",
    },
  });
}

function createAuthenticatedPostRequest(pathname, sessionToken, body) {
  return new Request(`http://localhost${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
      Host: "localhost",
    },
    body: JSON.stringify(body),
  });
}

function createDeleteRequest(pathname, sessionToken = null) {
  const headers = {
    Host: "localhost",
    Origin: "http://localhost",
  };
  if (sessionToken) {
    headers.Cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`;
  }
  return new Request(`http://localhost${pathname}`, {
    method: "DELETE",
    headers,
  });
}

function createRouteContext(instanceId) {
  return { params: Promise.resolve({ instanceId: String(instanceId) }) };
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

test("route handlers isolate visitor instances and preserve administrator access", async () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 7),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const firstInstance = store.createInstance(
      createInstanceInput("first", "https://first.example.com"),
    );
    const secondInstance = store.createInstance(
      createInstanceInput("second", "https://second.example.com"),
    );
    const administrator = store.authenticateAdministrator(
      "system-administrator",
      ADMINISTRATOR_PASSWORD,
    );
    const administratorSession = store.createAdministratorSession(administrator.id);
    const generatedAccess = store.regenerateInstanceAccessKey(firstInstance.id);
    const visitorSession = store.createVisitorSessionForAccessKey(
      generatedAccess.accessKey,
    );

    const anonymousResponse = await getInstanceConfiguration(
      new Request(`http://localhost/api/instances/${firstInstance.id}/config`),
      createRouteContext(firstInstance.id),
    );
    assert.equal(anonymousResponse.status, 401);

    const ownInstanceResponse = await getInstanceConfiguration(
      createAuthenticatedRequest(
        `/api/instances/${firstInstance.id}/config`,
        visitorSession.token,
      ),
      createRouteContext(firstInstance.id),
    );
    assert.equal(ownInstanceResponse.status, 200);
    const ownInstancePayload = await ownInstanceResponse.json();
    assert.equal(ownInstancePayload.data.instance.id, firstInstance.id);
    assert.equal("adminUsername" in ownInstancePayload.data.instance, false);
    assert.equal("accessKey" in ownInstancePayload.data.instance, false);

    const otherInstanceResponse = await getInstanceConfiguration(
      createAuthenticatedRequest(
        `/api/instances/${secondInstance.id}/config`,
        visitorSession.token,
      ),
      createRouteContext(secondInstance.id),
    );
    assert.equal(otherInstanceResponse.status, 403);

    const visitorAdminResponse = await getAdminInstances(
      createAuthenticatedRequest("/api/admin/instances", visitorSession.token),
    );
    assert.equal(visitorAdminResponse.status, 403);

    const administratorResponse = await getAdminInstances(
      createAuthenticatedRequest("/api/admin/instances", administratorSession.token),
    );
    assert.equal(administratorResponse.status, 200);
    const administratorPayload = await administratorResponse.json();
    assert.equal(administratorPayload.data.instances.length, 2);

    store.updateInstance(firstInstance.id, {
      ...firstInstance,
      username: firstInstance.adminUsername,
      password: "",
      enabled: false,
    });
    const disabledInstanceResponse = await getInstanceConfiguration(
      createAuthenticatedRequest(
        `/api/instances/${firstInstance.id}/config`,
        visitorSession.token,
      ),
      createRouteContext(firstInstance.id),
    );
    assert.equal(disabledInstanceResponse.status, 401);

    const administratorDisabledInstanceResponse = await getInstanceConfiguration(
      createAuthenticatedRequest(
        `/api/instances/${firstInstance.id}/config`,
        administratorSession.token,
      ),
      createRouteContext(firstInstance.id),
    );
    assert.equal(administratorDisabledInstanceResponse.status, 200);
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});

test("access key login creates an instance-bound visitor session", async () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 9),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance(
      createInstanceInput("first", "https://first.example.com"),
    );
    const generatedAccess = store.regenerateInstanceAccessKey(instance.id);
    const response = await loginWithAccessKey(new Request(
      "http://localhost/api/access/login",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: "localhost",
        },
        body: JSON.stringify({ accessKey: generatedAccess.accessKey }),
      },
    ));

    assert.equal(response.status, 200);
    const responsePayload = await response.json();
    assert.deepEqual(responsePayload.data.principal, {
      kind: "visitor",
      instanceId: instance.id,
      instanceName: instance.name,
    });
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    assert.equal(response.headers.get("set-cookie").includes(generatedAccess.accessKey), false);
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});

test("only administrators can delete local instance data", async () => {
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
    const firstInstance = store.createInstance(
      createInstanceInput("first", "https://first.example.com"),
    );
    const secondInstance = store.createInstance(
      createInstanceInput("second", "https://second.example.com"),
    );
    store.recordImportedChannel({
      instanceId: firstInstance.id,
      baseUrl: firstInstance.baseUrl,
      key: "sk-ant-delete-route-record",
      channel: {
        id: 91,
        name: "claude-0711-091",
        group: "anthropic",
        models: "claude-opus-4-8",
        status: 1,
        used_quota: 0,
      },
      quotaPerUnit: 500_000,
    });
    const administrator = store.authenticateAdministrator(
      "system-administrator",
      ADMINISTRATOR_PASSWORD,
    );
    const administratorSession = store.createAdministratorSession(administrator.id);
    const visitorAccess = store.regenerateInstanceAccessKey(firstInstance.id);
    const visitorSession = store.createVisitorSessionForAccessKey(visitorAccess.accessKey);
    const routeContext = createRouteContext(firstInstance.id);

    const anonymousResponse = await deleteAdminInstance(
      createDeleteRequest(`/api/admin/instances/${firstInstance.id}`),
      routeContext,
    );
    assert.equal(anonymousResponse.status, 401);

    const visitorResponse = await deleteAdminInstance(
      createDeleteRequest(
        `/api/admin/instances/${firstInstance.id}`,
        visitorSession.token,
      ),
      routeContext,
    );
    assert.equal(visitorResponse.status, 403);

    const administratorResponse = await deleteAdminInstance(
      createDeleteRequest(
        `/api/admin/instances/${firstInstance.id}`,
        administratorSession.token,
      ),
      routeContext,
    );
    assert.equal(administratorResponse.status, 200);
    const responsePayload = await administratorResponse.json();
    assert.equal(responsePayload.data.instanceId, firstInstance.id);
    assert.equal(responsePayload.data.deletedChannelRecordCount, 1);
    assert.equal(store.getInstance(firstInstance.id), null);
    assert.equal(store.getPrincipalBySessionToken(visitorSession.token), null);
    assert.equal(store.getInstance(secondInstance.id).id, secondInstance.id);

    const repeatedResponse = await deleteAdminInstance(
      createDeleteRequest(
        `/api/admin/instances/${firstInstance.id}`,
        administratorSession.token,
      ),
      routeContext,
    );
    assert.equal(repeatedResponse.status, 404);
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});

test("administrator can query masked records across instances", async () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 13),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);
  const firstKey = "sk-ant-first-administrator-record";
  const secondKey = "sk-ant-second-administrator-record";

  try {
    const firstInstance = store.createInstance(
      createInstanceInput("first", "https://first.example.com"),
    );
    const secondInstance = store.createInstance(
      createInstanceInput("second", "https://second.example.com"),
    );
    store.recordImportedChannel({
      instanceId: firstInstance.id,
      baseUrl: firstInstance.baseUrl,
      key: firstKey,
      channel: {
        id: 101,
        name: "claude-0711-101",
        group: "anthropic",
        models: "claude-opus-4-8",
        status: 1,
        used_quota: 250_000,
      },
      quotaPerUnit: 500_000,
    });
    store.recordImportedChannel({
      instanceId: secondInstance.id,
      baseUrl: secondInstance.baseUrl,
      key: secondKey,
      channel: {
        id: 102,
        name: "claude-0711-102",
        group: "anthropic",
        models: "claude-opus-4-8",
        status: 1,
        used_quota: 500_000,
      },
      quotaPerUnit: 500_000,
    });
    const administrator = store.authenticateAdministrator(
      "system-administrator",
      ADMINISTRATOR_PASSWORD,
    );
    const administratorSession = store.createAdministratorSession(administrator.id);
    const visitorAccess = store.regenerateInstanceAccessKey(firstInstance.id);
    const visitorSession = store.createVisitorSessionForAccessKey(visitorAccess.accessKey);

    const response = await queryAdministratorRecords(
      createAuthenticatedPostRequest(
        "/api/admin/records/query",
        administratorSession.token,
        { page: 1, pageSize: 10 },
      ),
    );
    assert.equal(response.status, 200);
    const responseText = await response.text();
    assert.equal(responseText.includes(firstKey), false);
    assert.equal(responseText.includes(secondKey), false);
    const responsePayload = JSON.parse(responseText);
    assert.equal(responsePayload.data.total, 2);
    assert.deepEqual(
      responsePayload.data.records.map((record) => record.instanceName),
      [secondInstance.name, firstInstance.name],
    );

    const filteredResponse = await queryAdministratorRecords(
      createAuthenticatedPostRequest(
        "/api/admin/records/query",
        administratorSession.token,
        {
          instanceId: firstInstance.id,
          channelName: "0711-101",
          key: firstKey,
          page: 1,
          pageSize: 10,
        },
      ),
    );
    const filteredPayload = await filteredResponse.json();
    assert.equal(filteredPayload.data.total, 1);
    assert.equal(filteredPayload.data.records[0].instanceId, firstInstance.id);
    assert.equal(filteredPayload.data.records[0].channelName, "claude-0711-101");

    const visitorResponse = await queryAdministratorRecords(
      createAuthenticatedPostRequest(
        "/api/admin/records/query",
        visitorSession.token,
        { page: 1, pageSize: 10 },
      ),
    );
    assert.equal(visitorResponse.status, 403);
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});
