import assert from "node:assert/strict";
import test from "node:test";

import { POST as changeAdministratorPassword } from "../app/api/admin/password/route.js";
import { ApplicationStore } from "../lib/application-store.js";
import { SESSION_COOKIE_NAME } from "../lib/http.js";

const RUNTIME_CONTEXT_KEY = Symbol.for("newapi-key.runtime-context");
const INITIAL_ADMINISTRATOR_PASSWORD = "administrator-password";
const UPDATED_ADMINISTRATOR_PASSWORD = "updated-administrator-password";

function createSilentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

function createTestStore() {
  return new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 17),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: INITIAL_ADMINISTRATOR_PASSWORD,
    },
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

function createPasswordChangeRequest(sessionToken, requestBody) {
  const headers = {
    "Content-Type": "application/json",
    Host: "localhost",
    Origin: "http://localhost",
  };
  if (sessionToken) {
    headers.Cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`;
  }
  return new Request("http://localhost/api/admin/password", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
}

function createValidPasswordChangeBody(overrides = {}) {
  return {
    currentPassword: INITIAL_ADMINISTRATOR_PASSWORD,
    newPassword: UPDATED_ADMINISTRATOR_PASSWORD,
    confirmPassword: UPDATED_ADMINISTRATOR_PASSWORD,
    ...overrides,
  };
}

test("administrator password route rejects anonymous and visitor requests", async () => {
  const store = createTestStore();
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const anonymousResponse = await changeAdministratorPassword(
      createPasswordChangeRequest(null, createValidPasswordChangeBody()),
    );
    assert.equal(anonymousResponse.status, 401);

    const instance = store.createInstance({
      name: "visitor-instance",
      baseUrl: "https://visitor.example.com",
      username: "upstream-administrator",
      password: "upstream-password",
      group: "anthropic",
      namePrefix: "claude",
      startNumber: 1,
      continueFromExisting: true,
      priority: 0,
      weight: 0,
      dateMode: "auto",
      enabled: true,
    });
    const generatedAccess = store.regenerateInstanceAccessKey(instance.id);
    const visitorSession = store.createVisitorSessionForAccessKey(generatedAccess.accessKey);
    const visitorResponse = await changeAdministratorPassword(
      createPasswordChangeRequest(
        visitorSession.token,
        createValidPasswordChangeBody(),
      ),
    );
    assert.equal(visitorResponse.status, 403);
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});

test("administrator password route requires the current password", async () => {
  const store = createTestStore();
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const administrator = store.authenticateAdministrator(
      "system-administrator",
      INITIAL_ADMINISTRATOR_PASSWORD,
    );
    const currentSession = store.createAdministratorSession(administrator.id);
    const response = await changeAdministratorPassword(
      createPasswordChangeRequest(currentSession.token, createValidPasswordChangeBody({
        currentPassword: "incorrect-administrator-password",
      })),
    );

    assert.equal(response.status, 400);
    assert.equal(
      store.authenticateAdministrator(
        "system-administrator",
        INITIAL_ADMINISTRATOR_PASSWORD,
      ).id,
      administrator.id,
    );
    assert.equal(
      store.getPrincipalBySessionToken(currentSession.token).id,
      administrator.id,
    );
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});

test("administrator password change preserves the current session and revokes others", async () => {
  const store = createTestStore();
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const administrator = store.authenticateAdministrator(
      "system-administrator",
      INITIAL_ADMINISTRATOR_PASSWORD,
    );
    const currentSession = store.createAdministratorSession(administrator.id);
    const otherSession = store.createAdministratorSession(administrator.id);
    const response = await changeAdministratorPassword(
      createPasswordChangeRequest(currentSession.token, createValidPasswordChangeBody()),
    );

    assert.equal(response.status, 200);
    const responsePayload = await response.json();
    assert.equal(responsePayload.data.otherSessionsRevoked, true);
    assert.equal(
      store.authenticateAdministrator(
        "system-administrator",
        INITIAL_ADMINISTRATOR_PASSWORD,
      ),
      null,
    );
    assert.equal(
      store.authenticateAdministrator(
        "system-administrator",
        UPDATED_ADMINISTRATOR_PASSWORD,
      ).id,
      administrator.id,
    );
    assert.equal(
      store.getPrincipalBySessionToken(currentSession.token).id,
      administrator.id,
    );
    assert.equal(store.getPrincipalBySessionToken(otherSession.token), null);
  } finally {
    restoreRuntimeContext();
    store.close();
  }
});
