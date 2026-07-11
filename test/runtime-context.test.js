import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { resolveDatabasePath } from "../lib/runtime-context.js";

test("resolveDatabasePath keeps SQLite outside standalone build output", () => {
  const applicationRootPath = resolve("/srv/newapi-key");

  assert.equal(
    resolveDatabasePath("data/channel-records.sqlite", applicationRootPath),
    resolve(applicationRootPath, "data/channel-records.sqlite"),
  );
  assert.equal(resolveDatabasePath(":memory:", applicationRootPath), ":memory:");
  assert.equal(
    resolveDatabasePath("/var/lib/newapi-key/records.sqlite", applicationRootPath),
    "/var/lib/newapi-key/records.sqlite",
  );
});
