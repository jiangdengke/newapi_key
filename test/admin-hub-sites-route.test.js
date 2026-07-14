import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { POST as listAdminHubSites } from "../app/api/admin/admin-hub/sites/route.js";
import { ApplicationStore } from "../lib/application-store.js";
import { SESSION_COOKIE_NAME } from "../lib/http.js";

const RUNTIME_CONTEXT_KEY = Symbol.for("newapi-key.runtime-context");
const APPLICATION_ADMINISTRATOR_PASSWORD = "application-administrator-password";
const ADMIN_HUB_PASSWORD = "stored-admin-hub-password";

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

function createMockAdminHubServer() {
  return createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");

    if (request.method === "POST" && requestUrl.pathname === "/api/user/login") {
      assert.deepEqual(await readRequestJson(request), {
        username: "supplier-user",
        password: ADMIN_HUB_PASSWORD,
      });
      sendJson(response, {
        success: true,
        data: { id: 130, username: "supplier-user", role: 1 },
      }, {
        "Set-Cookie": "session=admin-hub-site-session; Path=/; HttpOnly",
      });
      return;
    }

    if (
      request.method === "GET"
      && requestUrl.pathname === "/api/admin-hub/resources/sites/"
    ) {
      assert.equal(request.headers.cookie, "session=admin-hub-site-session");
      assert.equal(request.headers["new-api-user"], "130");
      assert.equal(requestUrl.searchParams.get("p"), "1");
      assert.equal(requestUrl.searchParams.get("page_size"), "1000");
      sendJson(response, {
        success: true,
        data: {
          items: [
            { id: 6, name: "AC站" },
            { site_id: 13, site_name: "AGT站" },
            { siteId: 21, siteName: "61 站" },
            { id: null, name: "无效站点" },
          ],
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

function createSiteRequest(sessionToken, requestBody) {
  const headers = {
    "Content-Type": "application/json",
    Host: "localhost",
    Origin: "http://localhost",
  };
  if (sessionToken) {
    headers.Cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`;
  }
  return new Request("http://localhost/api/admin/admin-hub/sites", {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });
}

test("administrator dynamically loads visible Admin Hub sites with stored password", async () => {
  const mockAdminHubServer = createMockAdminHubServer();
  const mockAdminHubBaseUrl = await listenOnAvailablePort(mockAdminHubServer);
  const store = new ApplicationStore({
    databasePath: ":memory:",
    encryptionKey: Buffer.alloc(32, 15),
    initialInstance: null,
    bootstrapAdmin: {
      username: "system-administrator",
      password: APPLICATION_ADMINISTRATOR_PASSWORD,
    },
  });
  const restoreRuntimeContext = installTestRuntimeContext(store);

  try {
    const instance = store.createInstance({
      name: "Deepnix Admin Hub",
      baseUrl: mockAdminHubBaseUrl,
      username: "supplier-user",
      password: ADMIN_HUB_PASSWORD,
      connectionProtocol: "admin-hub",
      adminHubTargetSiteId: 13,
      group: "anthropic",
      namePrefix: "claude",
      startNumber: 1,
      continueFromExisting: true,
      priority: 0,
      weight: 0,
      dateMode: "auto",
      enabled: true,
    });
    const administrator = store.authenticateAdministrator(
      "system-administrator",
      APPLICATION_ADMINISTRATOR_PASSWORD,
    );
    const administratorSession = store.createAdministratorSession(administrator.id);
    const requestBody = {
      instanceId: instance.id,
      baseUrl: instance.baseUrl,
      username: instance.adminUsername,
      password: "",
    };

    const anonymousResponse = await listAdminHubSites(
      createSiteRequest(null, requestBody),
    );
    assert.equal(anonymousResponse.status, 401);

    const response = await listAdminHubSites(
      createSiteRequest(administratorSession.token, requestBody),
    );
    assert.equal(response.status, 200);
    const responseText = await response.text();
    assert.equal(responseText.includes(ADMIN_HUB_PASSWORD), false);
    const responsePayload = JSON.parse(responseText);
    assert.deepEqual(responsePayload.data.sites, [
      { id: 6, name: "AC站" },
      { id: 13, name: "AGT站" },
      { id: 21, name: "61 站" },
    ]);
    assert.equal(responsePayload.data.username, "supplier-user");

    const createModeResponse = await listAdminHubSites(
      createSiteRequest(administratorSession.token, {
        instanceId: null,
        baseUrl: mockAdminHubBaseUrl,
        username: "supplier-user",
        password: ADMIN_HUB_PASSWORD,
      }),
    );
    assert.equal(createModeResponse.status, 200);
    const createModePayload = await createModeResponse.json();
    assert.equal(createModePayload.data.sites[1].name, "AGT站");
  } finally {
    restoreRuntimeContext();
    store.close();
    await closeServer(mockAdminHubServer);
  }
});
