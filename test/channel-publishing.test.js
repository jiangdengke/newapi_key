import assert from "node:assert/strict";
import test from "node:test";

import { publishChannelsToInstances } from "../lib/channel-publishing.js";

const channel = { channelKind: "claude", keys: ["synthetic-first", "synthetic-second"], models: ["claude-example"] };

function createImportResponse(events) {
  const encodedEvents = new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join("\n"));
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encodedEvents.slice(0, 17));
      controller.enqueue(encodedEvents.slice(17));
      controller.close();
    },
  }), { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

test("one submission uses each selected target's group and reports results independently", async (testContext) => {
  const requests = [];
  testContext.mock.method(globalThis, "fetch", async (path, options) => {
    requests.push({ path, body: JSON.parse(options.body) });
    if (path === "/api/instances/6/import") {
      return createImportResponse([{ type: "fatal", message: "所选分组已不存在" }]);
    }
    return createImportResponse([
      { type: "item-result", index: 0, success: true },
      { type: "item-result", index: 1, success: false, message: `上游拒绝 ${channel.keys[1]}` },
      { type: "complete", total: 2, completed: 2, success: 1, failure: 1 },
    ]);
  });
  const results = await Array.fromAsync(publishChannelsToInstances(channel, [
    { instanceId: 6, group: "team-a" }, { instanceId: 8, group: "team-b" },
  ]));

  assert.deepEqual(requests, [
    { path: "/api/instances/6/import", body: { ...channel, group: "team-a" } },
    { path: "/api/instances/8/import", body: { ...channel, group: "team-b" } },
  ]);
  assert.deepEqual(results.map(({ instanceId, status, success, failure }) => [instanceId, status, success, failure]), [
    [6, "stopped", 0, 0], [8, "complete", 1, 1],
  ]);
  assert.match(results[0].message, /分组已不存在/);
  assert.equal(results[1].details[0].index, 1);
  assert.equal(JSON.stringify(results).includes(channel.keys[1]), false);
});

test("a dropped stream preserves confirmed results and session expiry stops the remaining submissions", async (testContext) => {
  const requests = [];
  testContext.mock.method(globalThis, "fetch", async (path) => {
    requests.push(path);
    return requests.length === 1
      ? createImportResponse([{ type: "item-result", index: 0, success: true }])
      : Response.json({ success: false, message: "请重新登录" }, { status: 401 });
  });

  const results = await Array.fromAsync(publishChannelsToInstances(channel, [
    { instanceId: 2, group: "primary" }, { instanceId: 3, group: "secondary" }, { instanceId: 4, group: "backup" },
  ]));

  assert.deepEqual(requests, ["/api/instances/2/import", "/api/instances/3/import"]);
  assert.deepEqual(results.map(({ status, success, failure }) => [status, success, failure]), [
    ["unknown", 1, 0], ["rejected", 0, 0],
  ]);
});

test("leaving the page stops the requests for remaining targets", async (testContext) => {
  const controller = new AbortController();
  const mockFetch = testContext.mock.method(globalThis, "fetch", async () => createImportResponse([
    { type: "complete", total: 2, completed: 2, success: 2, failure: 0 },
  ]));
  const results = publishChannelsToInstances(channel, [
    { instanceId: 2, group: "primary" }, { instanceId: 3, group: "secondary" },
  ], controller.signal);
  await results.next();
  controller.abort();

  assert.equal((await results.next()).done, true);
  assert.equal(mockFetch.mock.callCount(), 1);
});
