import assert from "node:assert/strict";
import test from "node:test";

import { DELETE as deleteAdminInstance } from "../app/api/admin/instances/[instanceId]/route.js";
import { GET as getAdminInstances } from "../app/api/admin/instances/route.js";
import { GET as listMembers, POST as createMember } from "../app/api/admin/instances/[instanceId]/members/route.js";
import { DELETE as deleteMember, PATCH as updateMember } from "../app/api/admin/instances/[instanceId]/members/[memberId]/route.js";
import { DELETE as deleteAdministratorRecords } from "../app/api/admin/records/route.js";
import { POST as queryAdministratorRecords } from "../app/api/admin/records/query/route.js";
import { POST as revealAdministratorRecordKey } from "../app/api/admin/records/[recordId]/key/route.js";
import { GET as listUsers, PATCH as updateUser, POST as createUser } from "../app/api/admin/users/route.js";
import { POST as loginWithPassword } from "../app/api/auth/login/route.js";
import { GET as getInstanceConfiguration } from "../app/api/instances/[instanceId]/config/route.js";
import { POST as queryInstanceRecords } from "../app/api/instances/[instanceId]/records/query/route.js";
import { GET as listAccessibleInstances } from "../app/api/instances/route.js";
import { ApplicationStore } from "../lib/application-store.js";
import { SESSION_COOKIE_NAME } from "../lib/http.js";
import { createMemberAccountSession } from "./account-fixtures.js";

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

function createDeleteJsonRequest(pathname, sessionToken, body) {
  const headers = {
    "Content-Type": "application/json",
    Host: "localhost",
    Origin: "http://localhost",
  };
  if (sessionToken) {
    headers.Cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`;
  }
  return new Request(`http://localhost${pathname}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify(body),
  });
}

function createRouteContext(instanceId) {
  return { params: Promise.resolve({ instanceId: String(instanceId) }) };
}

function createRecordRouteContext(recordId) {
  return { params: Promise.resolve({ recordId: String(recordId) }) };
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

test("route handlers isolate ordinary users and preserve administrator access", async () => {
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
    const generatedAccess = store.createInstanceMember(firstInstance.id, { name: "测试成员" });
    const visitorSession = createMemberAccountSession(store, [generatedAccess.member.id]);

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
    assert.equal("memberCount" in ownInstancePayload.data.instance, false);

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
    assert.equal(disabledInstanceResponse.status, 403);

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

test("administrator provisions a multi-instance account and can revoke its sessions", async () => {
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
    const instances = ["first", "second", "third"].map((name) => (
      store.createInstance(createInstanceInput(name, `https://${name}.example.com`))
    ));
    const administrator = store.authenticateAdministrator("system-administrator", ADMINISTRATOR_PASSWORD);
    const administratorToken = store.createAdministratorSession(administrator.id).token;
    const usersPath = "/api/admin/users";
    const userInput = {
      username: "ordinary-user",
      password: "ordinary-password",
      enabled: true,
      instanceIds: [instances[0].id, instances[1].id],
      role: "admin",
    };
    const saveRequest = (sessionToken, body, method = "PATCH") => new Request(`http://localhost${usersPath}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`, Host: "localhost", Origin: "http://localhost" },
      body: JSON.stringify(body),
    });
    const login = (password) => loginWithPassword(createAuthenticatedPostRequest("/api/auth/login", "", { username: userInput.username, password }));
    assert.equal((await listUsers(createAuthenticatedRequest(usersPath, ""))).status, 401);
    assert.equal((await createUser(saveRequest(administratorToken, userInput, "POST"))).status, 201);
    assert.equal(store.getInstance(instances[0].id).activeMemberCount, 1);
    const administratorUserList = await listUsers(createAuthenticatedRequest(usersPath, administratorToken));
    const administratorUserPayload = await administratorUserList.json();
    assert.deepEqual(administratorUserPayload.data.instances.map(({ id }) => id), instances.map(({ id }) => id));
    assert.deepEqual(administratorUserPayload.data.users[0].instanceIds, userInput.instanceIds);
    assert.equal((await createUser(saveRequest(administratorToken, { ...userInput, username: "other-account", instanceIds: [instances[0].id] }, "POST"))).status, 201);
    assert.equal(store.getInstance(instances[0].id).activeMemberCount, 2);
    assert.equal((await createUser(saveRequest(administratorToken, {
      ...userInput,
      username: "duplicate-instance",
      instanceIds: [instances[0].id, instances[0].id],
    }, "POST"))).status, 400);
    const assignedUser = store.listOrdinaryUsers().find((user) => user.username === userInput.username);
    const assignedMembers = instances.slice(0, 2).map((instance) => (
      store.listInstanceMembers(instance.id).find((member) => member.userId === assignedUser.id)
    ));
    assert.ok(assignedMembers.every(Boolean));

    const response = await login(userInput.password);
    assert.equal(response.status, 200);
    const { data: { principal } } = await response.json();
    assert.equal(principal.kind, "user");
    assert.equal(principal.username, userInput.username);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    const loginToken = (loginResponse) => loginResponse.headers.get("set-cookie").split(";")[0].slice(SESSION_COOKIE_NAME.length + 1);
    const token = loginToken(response);
    assert.equal((await listUsers(createAuthenticatedRequest(usersPath, token))).status, 403);
    assert.equal((await updateUser(saveRequest(token, { ...userInput, id: principal.id }))).status, 403);
    assert.equal((await updateUser(saveRequest(administratorToken, { ...userInput, id: administrator.id }))).status, 404);
    const instancesResponse = await listAccessibleInstances(createAuthenticatedRequest("/api/instances", token));
    assert.deepEqual((await instancesResponse.json()).data.instances.map(({ id }) => id), [instances[0].id, instances[1].id]);
    const getConfig = (instanceId, sessionToken = token) => getInstanceConfiguration(
      createAuthenticatedRequest(`/api/instances/${instanceId}/config`, sessionToken), createRouteContext(instanceId),
    );
    assert.equal((await getConfig(instances[0].id)).status, 200);
    assert.equal((await getConfig(instances[1].id)).status, 200);
    assert.equal((await getConfig(instances[2].id)).status, 403);

    const adjustedUser = { ...userInput, id: principal.id, password: "", instanceIds: [instances[1].id] };
    assert.equal((await updateUser(saveRequest(administratorToken, adjustedUser))).status, 200);
    assert.equal((await getConfig(instances[0].id)).status, 403);
    assert.equal((await getConfig(instances[1].id)).status, 200);
    const newPassword = "replacement-password";
    assert.equal((await updateUser(saveRequest(administratorToken, { ...adjustedUser, password: newPassword }))).status, 200);
    assert.equal((await getConfig(instances[1].id)).status, 401);
    assert.equal((await login(userInput.password)).status, 401);
    const newLogin = await login(newPassword);
    assert.equal(newLogin.status, 200);
    const newToken = loginToken(newLogin);
    assert.equal((await updateUser(saveRequest(administratorToken, { ...adjustedUser, enabled: false }))).status, 200);
    assert.equal((await getConfig(instances[1].id, newToken)).status, 401);
    assert.equal((await login(newPassword)).status, 401);
    const userList = (await (await listUsers(createAuthenticatedRequest(usersPath, administratorToken))).json()).data.users;
    const savedUser = userList.find(({ id }) => id === principal.id);
    assert.deepEqual(savedUser.instanceIds, [instances[1].id]);
    assert.equal(savedUser.memberIds.length, 2);
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
    const visitorAccess = store.createInstanceMember(firstInstance.id, { name: "测试成员" });
    const visitorSession = createMemberAccountSession(store, [visitorAccess.member.id]);
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
    assert.equal(store.getPrincipalBySessionToken(visitorSession.token).kind, "user");
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
    const visitorAccess = store.createInstanceMember(firstInstance.id, { name: "测试成员" });
    const visitorSession = createMemberAccountSession(store, [visitorAccess.member.id]);

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

test("only administrators can delete selected local records", async () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 14),
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
    for (const channelNumber of [201, 202, 203]) {
      store.recordImportedChannel({
        instanceId: instance.id,
        baseUrl: instance.baseUrl,
        key: `sk-ant-delete-record-${channelNumber}`,
        channel: {
          id: channelNumber,
          name: `claude-0711-${channelNumber}`,
          group: "anthropic",
          models: "claude-opus-4-8",
          status: 1,
          used_quota: 0,
        },
        quotaPerUnit: 500_000,
      });
    }
    const records = store.listRecords(instance.id);
    const selectedRecordIds = records
      .filter((record) => record.newApiChannelId !== 203)
      .map((record) => record.id);
    const remainingRecord = records.find((record) => record.newApiChannelId === 203);
    const administrator = store.authenticateAdministrator(
      "system-administrator",
      ADMINISTRATOR_PASSWORD,
    );
    const administratorSession = store.createAdministratorSession(administrator.id);
    const visitorAccess = store.createInstanceMember(instance.id, { name: "测试成员" });
    const visitorSession = createMemberAccountSession(store, [visitorAccess.member.id]);

    const anonymousResponse = await deleteAdministratorRecords(
      createDeleteJsonRequest("/api/admin/records", null, {
        recordIds: selectedRecordIds,
      }),
    );
    assert.equal(anonymousResponse.status, 401);

    const visitorResponse = await deleteAdministratorRecords(
      createDeleteJsonRequest("/api/admin/records", visitorSession.token, {
        recordIds: selectedRecordIds,
      }),
    );
    assert.equal(visitorResponse.status, 403);

    const invalidResponse = await deleteAdministratorRecords(
      createDeleteJsonRequest("/api/admin/records", administratorSession.token, {
        recordIds: [],
      }),
    );
    assert.equal(invalidResponse.status, 400);

    const administratorResponse = await deleteAdministratorRecords(
      createDeleteJsonRequest("/api/admin/records", administratorSession.token, {
        recordIds: selectedRecordIds,
      }),
    );
    assert.equal(administratorResponse.status, 200);
    const administratorPayload = await administratorResponse.json();
    assert.equal(administratorPayload.data.deletedRecordCount, 2);
    assert.deepEqual(
      store.listRecords(instance.id).map((record) => record.id),
      [remainingRecord.id],
    );
    assert.equal(store.getInstance(instance.id).id, instance.id);

    const repeatedResponse = await deleteAdministratorRecords(
      createDeleteJsonRequest("/api/admin/records", administratorSession.token, {
        recordIds: selectedRecordIds,
      }),
    );
    assert.equal(repeatedResponse.status, 404);
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});

test("only administrators can reveal complete imported keys", async () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 15),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);
  const importedKey = "sk-ant-reveal-administrator-record";

  try {
    const instance = store.createInstance(
      createInstanceInput("first", "https://first.example.com"),
    );
    store.recordImportedChannel({
      instanceId: instance.id,
      baseUrl: instance.baseUrl,
      key: importedKey,
      channel: {
        id: 111,
        name: "claude-0711-111",
        group: "anthropic",
        models: "claude-opus-4-8",
        status: 1,
        used_quota: 0,
      },
      quotaPerUnit: 500_000,
    });
    const record = store.listRecords(instance.id)[0];
    const administrator = store.authenticateAdministrator(
      "system-administrator",
      ADMINISTRATOR_PASSWORD,
    );
    const administratorSession = store.createAdministratorSession(administrator.id);
    const visitorAccess = store.createInstanceMember(instance.id, { name: "测试成员" });
    const visitorSession = createMemberAccountSession(store, [visitorAccess.member.id]);
    const routeContext = createRecordRouteContext(record.id);

    const anonymousResponse = await revealAdministratorRecordKey(
      createAuthenticatedPostRequest(
        `/api/admin/records/${record.id}/key`,
        "invalid-session",
        {},
      ),
      routeContext,
    );
    assert.equal(anonymousResponse.status, 401);

    const visitorResponse = await revealAdministratorRecordKey(
      createAuthenticatedPostRequest(
        `/api/admin/records/${record.id}/key`,
        visitorSession.token,
        {},
      ),
      routeContext,
    );
    assert.equal(visitorResponse.status, 403);

    const administratorResponse = await revealAdministratorRecordKey(
      createAuthenticatedPostRequest(
        `/api/admin/records/${record.id}/key`,
        administratorSession.token,
        {},
      ),
      routeContext,
    );
    assert.equal(administratorResponse.status, 200);
    const administratorPayload = await administratorResponse.json();
    assert.equal(administratorPayload.data.key, importedKey);
    assert.equal(administratorPayload.data.recordId, record.id);
    assert.equal(administratorResponse.headers.get("cache-control"), "no-store");

    const missingResponse = await revealAdministratorRecordKey(
      createAuthenticatedPostRequest(
        "/api/admin/records/9999/key",
        administratorSession.token,
        {},
      ),
      createRecordRouteContext(9999),
    );
    assert.equal(missingResponse.status, 404);

    store.database.prepare(
      "UPDATE channel_records SET encrypted_key = NULL WHERE id = ?",
    ).run(record.id);
    const legacyResponse = await revealAdministratorRecordKey(
      createAuthenticatedPostRequest(
        `/api/admin/records/${record.id}/key`,
        administratorSession.token,
        {},
      ),
      routeContext,
    );
    assert.equal(legacyResponse.status, 409);
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});

function recordChannel(store, instanceId, baseUrl, channel, key, memberId = null) {
  store.recordImportedChannel({
    instanceId,
    memberId,
    baseUrl,
    key,
    quotaPerUnit: 500_000,
    channel: { status: 1, used_quota: 0, models: "claude-opus-4-8", group: "anthropic", ...channel },
  });
}

test("record queries filter, sort and count facets within the caller's scope", async () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 9),
    initialInstance: null,
    bootstrapAdmin: { username: "system-administrator", password: ADMINISTRATOR_PASSWORD },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const firstInstance = store.createInstance(createInstanceInput("first", "https://first.example.com"));
    const secondInstance = store.createInstance(createInstanceInput("second", "https://second.example.com"));
    const firstMember = store.createInstanceMember(firstInstance.id, { name: "测试成员" });
    const memberId = firstMember.member.id;
    recordChannel(store, firstInstance.id, firstInstance.baseUrl, { id: 11, name: "claude-001", type: 14, used_quota: 500_000 }, "sk-ant-first-0001", memberId);
    recordChannel(store, firstInstance.id, firstInstance.baseUrl, { id: 12, name: "claude-002", type: 14, status: 2, group: "vip", used_quota: 2_000_000 }, "sk-ant-first-0002", memberId);
    recordChannel(store, firstInstance.id, firstInstance.baseUrl, { id: 13, name: "openai-001", type: 1, models: "gpt-5.6-sol" }, "sk-proj-first-0003", memberId);
    recordChannel(store, firstInstance.id, firstInstance.baseUrl, { id: 14, name: "legacy-001" }, "sk-legacy-first-0004", memberId);
    recordChannel(store, secondInstance.id, secondInstance.baseUrl, { id: 21, name: "claude-001", type: 14 }, "sk-ant-second-0001");

    const query = (options) => store.queryRecords({ instanceId: firstInstance.id, ...options });
    const names = (result) => result.records.map((record) => record.channelName);
    assert.deepEqual(names(query({ search: "claude" })).sort(), ["claude-001", "claude-002"]);
    assert.deepEqual(names(query({ search: "13" })), ["openai-001"]);
    assert.deepEqual(names(query({ search: "sk-ant-first-0002" })), ["claude-002"]);
    assert.deepEqual(names(query({ search: "sk-ant-first" })), []);
    assert.deepEqual(names(query({ model: "gpt-5" })), ["openai-001"]);
    assert.deepEqual(names(query({ statusLabel: "disabled" })), ["claude-002"]);
    assert.deepEqual(names(query({ channelKind: "openai" })), ["openai-001"]);
    assert.deepEqual(names(query({ channelKind: "unknown" })), ["legacy-001"]);
    assert.deepEqual(names(query({ group: "vip" })), ["claude-002"]);
    assert.deepEqual(names(query({ sort: "usedUsd", order: "desc" })).slice(0, 2), ["claude-002", "claude-001"]);
    assert.deepEqual(names(query({ sort: "channelName", order: "asc" })), ["claude-001", "claude-002", "legacy-001", "openai-001"]);

    const facets = query({ statusLabel: "disabled" }).facets;
    assert.deepEqual(
      Object.fromEntries(facets.channelKinds.map(({ value, count }) => [value, count])),
      { claude: 2, openai: 1, unknown: 1 },
    );
    assert.deepEqual(facets.groups, [{ value: "anthropic", count: 3 }, { value: "vip", count: 1 }]);
    assert.equal(facets.instances, undefined);
    const administratorFacets = store.queryAdministratorRecords({}).facets;
    assert.deepEqual(administratorFacets.instances.sort((first, second) => first.value - second.value), [
      { value: firstInstance.id, count: 4 },
      { value: secondInstance.id, count: 1 },
    ]);

    const visitorSession = createMemberAccountSession(store, [firstMember.member.id]);
    const visitorResponse = await queryInstanceRecords(
      createAuthenticatedPostRequest(`/api/instances/${firstInstance.id}/records/query`, visitorSession.token, {
        search: "claude-001",
      }),
      createRouteContext(firstInstance.id),
    );
    const visitorPayload = await visitorResponse.json();
    assert.equal(visitorResponse.status, 200);
    assert.deepEqual(visitorPayload.data.records.map((record) => record.newApiChannelId), [11]);
    assert.equal(visitorPayload.data.records[0].channelKind, "claude");

    const invalidResponse = await queryInstanceRecords(
      createAuthenticatedPostRequest(`/api/instances/${firstInstance.id}/records/query`, visitorSession.token, {
        statusLabel: "deleted",
      }),
      createRouteContext(firstInstance.id),
    );
    assert.equal(invalidResponse.status, 400);
    assert.equal((await invalidResponse.json()).message, "状态筛选条件无效");
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});

test("administrators manage instance members without issuing legacy access keys", async () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 10),
    initialInstance: null,
    bootstrapAdmin: { username: "system-administrator", password: ADMINISTRATOR_PASSWORD },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance(createInstanceInput("first", "https://first.example.com"));
    const otherInstance = store.createInstance(createInstanceInput("second", "https://second.example.com"));
    store.saveOrdinaryUser(null, {
      username: "instance-member-user",
      password: "instance-member-password",
      enabled: true,
      instanceIds: [],
    });
    const account = store.authenticateAccount("instance-member-user", "instance-member-password");
    const administrator = store.authenticateAdministrator("system-administrator", ADMINISTRATOR_PASSWORD);
    const administratorToken = store.createAdministratorSession(administrator.id).token;
    const membersPath = `/api/admin/instances/${instance.id}/members`;
    const routeContext = (memberId, instanceId = instance.id) => ({
      params: Promise.resolve({ instanceId: String(instanceId), memberId: String(memberId) }),
    });

    const createdResponse = await createMember(
      createAuthenticatedPostRequest(membersPath, administratorToken, {
        name: "张三",
        namePrefix: "zhangsan",
        userId: account.id,
        dateMode: "",
        priority: 7,
      }),
      createRouteContext(instance.id),
    );
    assert.equal(createdResponse.status, 201);
    const { member, accessKey } = (await createdResponse.json()).data;
    assert.equal(member.namePrefix, "zhangsan");
    assert.equal(member.dateMode, "");
    assert.equal(member.priority, 7);
    assert.equal(member.weight, null);
    assert.equal(accessKey, undefined);

    const duplicatePrefixResponse = await createMember(
      createAuthenticatedPostRequest(membersPath, administratorToken, { name: "李四", namePrefix: "zhangsan" }),
      createRouteContext(instance.id),
    );
    assert.equal(duplicatePrefixResponse.status, 409);
    assert.equal((await duplicatePrefixResponse.json()).message, "该实例已有成员使用这个名称前缀");
    const invalidResponse = await createMember(
      createAuthenticatedPostRequest(membersPath, administratorToken, { name: "李四", namePrefix: "lisi", dateMode: "tomorrow" }),
      createRouteContext(instance.id),
    );
    assert.equal(invalidResponse.status, 400);

    const visitorMember = store.createInstanceMember(instance.id, {
      name: "访客成员",
      namePrefix: "visitor-member",
    }).member;
    const visitorToken = createMemberAccountSession(store, [visitorMember.id]).token;
    assert.equal((await listMembers(createAuthenticatedRequest(membersPath, visitorToken), createRouteContext(instance.id))).status, 403);
    const crossInstanceResponse = await deleteMember(
      createDeleteRequest(`/api/admin/instances/${otherInstance.id}/members/${member.id}`, administratorToken),
      routeContext(member.id, otherInstance.id),
    );
    assert.equal(crossInstanceResponse.status, 404);

    const listResponse = await listMembers(createAuthenticatedRequest(membersPath, administratorToken), createRouteContext(instance.id));
    assert.deepEqual((await listResponse.json()).data.members.map((listedMember) => listedMember.name), ["张三", "访客成员"]);

    const accountToken = store.createAccountSession(account.id).token;
    assert.equal((await getInstanceConfiguration(
      createAuthenticatedRequest(`/api/instances/${instance.id}/config`, accountToken), createRouteContext(instance.id),
    )).status, 200);
    assert.equal((await getInstanceConfiguration(
      createAuthenticatedRequest(`/api/instances/${otherInstance.id}/config`, accountToken), createRouteContext(otherInstance.id),
    )).status, 403);

    const patchResponse = await updateMember(
      new Request(`http://localhost${membersPath}/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(administratorToken)}`, Host: "localhost" },
        body: JSON.stringify({ name: "张三", namePrefix: "zs", userId: null, dateMode: null, weight: 3, enabled: false }),
      }),
      routeContext(member.id),
    );
    const patchedMember = (await patchResponse.json()).data.member;
    assert.equal(patchedMember.namePrefix, "zs");
    assert.equal(patchedMember.dateMode, null);
    assert.equal(patchedMember.priority, null);
    assert.equal(patchedMember.enabled, false);
    assert.equal((await getInstanceConfiguration(
      createAuthenticatedRequest(`/api/instances/${instance.id}/config`, accountToken), createRouteContext(instance.id),
    )).status, 403);

    const deleteResponse = await deleteMember(
      createDeleteRequest(`${membersPath}/${member.id}`, administratorToken),
      routeContext(member.id),
    );
    assert.equal(deleteResponse.status, 200);
    assert.equal(store.getInstanceMember(member.id), null);
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});

test("members only see records they imported; administrators can filter by member", async () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 12),
    initialInstance: null,
    bootstrapAdmin: { username: "system-administrator", password: ADMINISTRATOR_PASSWORD },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance(createInstanceInput("first", "https://first.example.com"));
    const firstMember = store.createInstanceMember(instance.id, { name: "张三", namePrefix: "zhangsan" });
    const secondMember = store.createInstanceMember(instance.id, { name: "李四", namePrefix: "lisi" });
    store.recordImportedChannel({
      instanceId: instance.id, memberId: firstMember.member.id, baseUrl: instance.baseUrl, key: "sk-zhangsan-000001",
      quotaPerUnit: 500_000, channel: { id: 1, name: "zhangsan-001", type: 14, status: 1, used_quota: 0, models: "m", group: "g" },
    });
    store.recordImportedChannel({
      instanceId: instance.id, memberId: secondMember.member.id, baseUrl: instance.baseUrl, key: "sk-lisi-0000000001",
      quotaPerUnit: 500_000, channel: { id: 2, name: "lisi-001", type: 14, status: 1, used_quota: 0, models: "m", group: "g" },
    });
    const visitorToken = createMemberAccountSession(store, [firstMember.member.id]).token;
    const visitorResponse = await queryInstanceRecords(
      createAuthenticatedPostRequest(`/api/instances/${instance.id}/records/query`, visitorToken, {}),
      createRouteContext(instance.id),
    );
    const visitorData = (await visitorResponse.json()).data;
    assert.deepEqual(visitorData.records.map((record) => record.channelName), ["zhangsan-001"]);
    assert.equal(visitorData.total, 1);

    const administrator = store.authenticateAdministrator("system-administrator", ADMINISTRATOR_PASSWORD);
    const administratorToken = store.createAdministratorSession(administrator.id).token;
    const administratorResponse = await queryAdministratorRecords(
      createAuthenticatedPostRequest("/api/admin/records/query", administratorToken, { memberId: secondMember.member.id }),
    );
    const administratorData = (await administratorResponse.json()).data;
    assert.deepEqual(administratorData.records.map((record) => `${record.channelName}/${record.memberName}`), ["lisi-001/李四"]);
    assert.deepEqual(administratorData.facets.members.map((facet) => facet.label), ["first · 张三", "first · 李四"]);
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});

test("synchronization fills in the channel type of older records", () => {
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 11),
    initialInstance: null,
    bootstrapAdmin: { username: "system-administrator", password: ADMINISTRATOR_PASSWORD },
  });

  try {
    const instance = store.createInstance(createInstanceInput("first", "https://first.example.com"));
    recordChannel(store, instance.id, instance.baseUrl, { id: 31, name: "legacy-001" }, "sk-legacy-0001");
    assert.equal(store.listRecords(instance.id)[0].channelKind, "unknown");

    store.synchronizeChannels({
      instanceId: instance.id,
      channels: [{ id: 31, name: "legacy-001", type: 48, status: 1, used_quota: 0, models: "grok-4.5", group: "xai" }],
      quotaPerUnit: 500_000,
    });
    assert.equal(store.listRecords(instance.id)[0].channelKind, "grok");

    store.synchronizeChannels({
      instanceId: instance.id,
      channels: [{ id: 31, name: "legacy-001", status: 1, used_quota: 0, models: "grok-4.5", group: "xai" }],
      quotaPerUnit: 500_000,
    });
    assert.equal(store.listRecords(instance.id)[0].channelKind, "grok");
  } finally {
    store.close();
  }
});
