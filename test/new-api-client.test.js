import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { NewApiClient } from "../lib/new-api-client.js";

const ADMINISTRATOR_USERNAME = "new-api-administrator";
const ADMINISTRATOR_PASSWORD = "new-api-administrator-password";
const SESSION_ID = "mock-session-id";
const AVAILABLE_GROUPS = ["default", "vip"];

function listenOnAvailablePort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readRequestJson(request) {
  const requestChunks = [];
  for await (const requestChunk of request) {
    requestChunks.push(requestChunk);
  }
  return JSON.parse(Buffer.concat(requestChunks).toString("utf8"));
}

function sendJson(response, responsePayload, { status = 200, headers = {} } = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(responsePayload));
}

function createAccessToken(sequenceNumber) {
  const tokenPayload = Buffer.from(JSON.stringify({ sub: "1", sid: SESSION_ID })).toString("base64url");
  return `header.${tokenPayload}.signature-${sequenceNumber}`;
}

function createAccessTokenNewApiServer({ accessTokenLifetimeSeconds = 900 } = {}) {
  const state = {
    loginCount: 0,
    refreshCount: 0,
    tokenSequence: 0,
    validAccessTokens: new Set(),
    currentRefreshToken: "",
    refreshRequests: [],
    authorizedRequests: [],
    rejectRefresh: false,
  };

  function issueSession(response) {
    state.tokenSequence += 1;
    const accessToken = createAccessToken(state.tokenSequence);
    state.validAccessTokens.add(accessToken);
    state.currentRefreshToken = `refresh-${state.tokenSequence}`;
    sendJson(response, {
      success: true,
      data: {
        access_token: accessToken,
        access_expires_at: Math.floor(Date.now() / 1_000) + accessTokenLifetimeSeconds,
        token_type: "Bearer",
        session: { sid: SESSION_ID },
        user: { id: 1, username: ADMINISTRATOR_USERNAME, role: 100 },
      },
    }, {
      headers: {
        "Set-Cookie": [
          `new_api_refresh=${state.currentRefreshToken}; Path=/api/user/auth; HttpOnly`,
          "new_api_has_session=1; Path=/",
        ],
      },
    });
  }

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");

    if (request.method === "POST" && requestUrl.pathname === "/api/user/login") {
      assert.deepEqual(await readRequestJson(request), {
        username: ADMINISTRATOR_USERNAME,
        password: ADMINISTRATOR_PASSWORD,
      });
      state.loginCount += 1;
      issueSession(response);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/user/auth/refresh") {
      state.refreshCount += 1;
      state.refreshRequests.push({
        cookie: request.headers.cookie,
        session: request.headers["x-auth-session"],
      });
      if (
        state.rejectRefresh
        || request.headers.cookie !== `new_api_refresh=${state.currentRefreshToken}`
      ) {
        sendJson(response, { success: false, message: "Unauthorized" }, { status: 401 });
        return;
      }
      issueSession(response);
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/group/") {
      const authorization = request.headers.authorization || "";
      const accessToken = authorization.replace(/^Bearer /, "");
      state.authorizedRequests.push({
        authorization,
        user: request.headers["new-api-user"],
        cookie: request.headers.cookie,
      });
      if (!state.validAccessTokens.has(accessToken)) {
        sendJson(response, {
          success: false,
          code: "AUTH_UNAUTHORIZED",
          message: "Unauthorized, invalid access token",
        }, { status: 401 });
        return;
      }
      sendJson(response, { success: true, data: AVAILABLE_GROUPS });
      return;
    }

    response.writeHead(404);
    response.end();
  });
  return { server, state };
}

async function withAccessTokenServer(options, runTest) {
  const { server, state } = createAccessTokenNewApiServer(options);
  const baseUrl = await listenOnAvailablePort(server);
  try {
    await runTest({ client: new NewApiClient({ baseUrl }), state });
  } finally {
    await closeServer(server);
  }
}

test("access-token login sends bearer authorization instead of a session cookie", async () => {
  await withAccessTokenServer({}, async ({ client, state }) => {
    const authenticatedUser = await client.login(ADMINISTRATOR_USERNAME, ADMINISTRATOR_PASSWORD);
    assert.deepEqual(authenticatedUser, {
      id: 1,
      username: ADMINISTRATOR_USERNAME,
      role: 100,
    });

    assert.deepEqual(await client.listAvailableGroups(), AVAILABLE_GROUPS);
    assert.deepEqual(state.authorizedRequests, [{
      authorization: `Bearer ${createAccessToken(1)}`,
      user: "1",
      cookie: undefined,
    }]);
    assert.equal(state.refreshCount, 0);
  });
});

test("expiring access tokens are refreshed once with the rotated refresh cookie", async () => {
  await withAccessTokenServer({ accessTokenLifetimeSeconds: 30 }, async ({ client, state }) => {
    await client.login(ADMINISTRATOR_USERNAME, ADMINISTRATOR_PASSWORD);

    const concurrentResults = await Promise.all([
      client.listAvailableGroups(),
      client.listAvailableGroups(),
      client.listAvailableGroups(),
    ]);
    assert.deepEqual(concurrentResults, [AVAILABLE_GROUPS, AVAILABLE_GROUPS, AVAILABLE_GROUPS]);
    assert.equal(state.refreshCount, 1);
    assert.deepEqual(state.refreshRequests[0], {
      cookie: "new_api_refresh=refresh-1",
      session: SESSION_ID,
    });

    await client.listAvailableGroups();
    assert.equal(state.refreshCount, 2);
    assert.equal(state.refreshRequests[1].cookie, "new_api_refresh=refresh-2");
    assert.equal(state.loginCount, 1);
  });
});

test("a rejected access token is refreshed and the request is retried once", async () => {
  await withAccessTokenServer({}, async ({ client, state }) => {
    await client.login(ADMINISTRATOR_USERNAME, ADMINISTRATOR_PASSWORD);
    state.validAccessTokens.clear();

    assert.deepEqual(await client.listAvailableGroups(), AVAILABLE_GROUPS);
    assert.equal(state.refreshCount, 1);
    assert.equal(state.authorizedRequests.length, 2);
    assert.equal(state.authorizedRequests[1].authorization, `Bearer ${createAccessToken(2)}`);
  });
});

test("a failed refresh falls back to logging in with the saved credentials", async () => {
  await withAccessTokenServer({ accessTokenLifetimeSeconds: 30 }, async ({ client, state }) => {
    await client.login(ADMINISTRATOR_USERNAME, ADMINISTRATOR_PASSWORD);
    state.rejectRefresh = true;

    assert.deepEqual(await client.listAvailableGroups(), AVAILABLE_GROUPS);
    assert.equal(state.refreshCount, 1);
    assert.equal(state.loginCount, 2);
  });
});
