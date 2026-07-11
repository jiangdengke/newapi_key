import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChannelRecordStore, keySecurity } from "../lib/record-store.js";

const BASE_URL = "http://127.0.0.1:3000";
const MODELS = "claude-opus-4-8,claude-opus-4-7,claude-opus-4-6";

test("ChannelRecordStore masks keys and synchronizes channel usage", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "newapi-key-records-"));
  const databasePath = join(temporaryDirectory, "records.sqlite");
  const completeKey = "sk-ant-secret-value-123456789";
  const recordStore = new ChannelRecordStore(databasePath);

  try {
    recordStore.recordImportedChannel({
      baseUrl: BASE_URL,
      key: completeKey,
      channel: {
        id: 17,
        name: "claude-0711-017",
        group: "anthropic",
        models: MODELS,
        status: 1,
        used_quota: 250_000,
      },
      quotaPerUnit: 500_000,
    });

    assert.equal(recordStore.hasImportedKey(BASE_URL, completeKey), true);
    const importedRecord = recordStore.listRecords(BASE_URL)[0];
    assert.equal(importedRecord.keyMask, keySecurity.createKeyMask(completeKey));
    assert.equal(importedRecord.keyMask.includes(completeKey), false);
    assert.equal(importedRecord.usedUsd, 0.5);
    assert.equal(Object.hasOwn(importedRecord, "keyFingerprint"), false);

    const synchronization = recordStore.synchronizeChannels({
      baseUrl: BASE_URL,
      channels: [{
        id: 17,
        name: "claude-0711-017",
        group: "anthropic",
        models: MODELS,
        status: 2,
        used_quota: 750_000,
      }],
      quotaPerUnit: 500_000,
    });
    assert.equal(synchronization.synchronizedCount, 1);
    assert.equal(synchronization.missingCount, 0);

    const synchronizedRecord = recordStore.listRecords(BASE_URL)[0];
    assert.equal(synchronizedRecord.usedUsd, 1.5);
    assert.equal(synchronizedRecord.statusLabel, "disabled");

    const missingSynchronization = recordStore.synchronizeChannels({
      baseUrl: BASE_URL,
      channels: [],
      quotaPerUnit: 500_000,
    });
    assert.equal(missingSynchronization.synchronizedCount, 0);
    assert.equal(missingSynchronization.missingCount, 1);
    assert.equal(recordStore.listRecords(BASE_URL)[0].statusLabel, "missing");
  } finally {
    recordStore.close();
  }

  try {
    const databaseBytes = readFileSync(databasePath);
    assert.equal(databaseBytes.includes(Buffer.from(completeKey, "utf8")), false);
    assert.equal(keySecurity.createKeyMask("short").includes("short"), false);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("ChannelRecordStore paginates records and finds an exact key fingerprint", () => {
  const recordStore = new ChannelRecordStore(":memory:");
  const completeKeys = [
    "sk-ant-query-first-123456",
    "sk-ant-query-second-123456",
    "sk-ant-query-third-123456",
  ];

  try {
    completeKeys.forEach((completeKey, keyIndex) => {
      const channelNumber = keyIndex + 1;
      recordStore.recordImportedChannel({
        baseUrl: BASE_URL,
        key: completeKey,
        channel: {
          id: channelNumber,
          name: `claude-0711-${String(channelNumber).padStart(3, "0")}`,
          group: "anthropic",
          models: MODELS,
          status: 1,
          used_quota: channelNumber * 500_000,
        },
        quotaPerUnit: 500_000,
      });
    });

    const firstPage = recordStore.queryRecords({
      baseUrl: BASE_URL,
      page: 1,
      pageSize: 2,
    });
    assert.equal(firstPage.total, 3);
    assert.equal(firstPage.totalPages, 2);
    assert.equal(firstPage.records.length, 2);
    assert.equal(firstPage.totalUsedUsd, 6);

    const lastPage = recordStore.queryRecords({
      baseUrl: BASE_URL,
      page: 99,
      pageSize: 2,
    });
    assert.equal(lastPage.page, 2);
    assert.equal(lastPage.records.length, 1);

    const exactMatch = recordStore.queryRecords({
      baseUrl: BASE_URL,
      key: completeKeys[1],
      page: 1,
      pageSize: 10,
    });
    assert.equal(exactMatch.total, 1);
    assert.equal(exactMatch.records[0].newApiChannelId, 2);
    assert.equal(JSON.stringify(exactMatch).includes(completeKeys[1]), false);

    const missingMatch = recordStore.queryRecords({
      baseUrl: BASE_URL,
      key: "sk-ant-query-missing-123456",
      page: 1,
      pageSize: 10,
    });
    assert.equal(missingMatch.total, 0);
    assert.deepEqual(missingMatch.records, []);
  } finally {
    recordStore.close();
  }
});
