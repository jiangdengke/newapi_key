import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ApplicationStore } from "../lib/application-store.js";
import {
  encryptCredential,
  hashPassword,
  hashSessionToken,
} from "../lib/security.js";

const ENCRYPTION_KEY = Buffer.alloc(32, 5);
const ADMINISTRATOR_PASSWORD = "bootstrap-system-password";
const ADMINISTRATOR_SESSION_TOKEN = "existing-administrator-session-token";
const EXISTING_BASE_URL = "https://configured.example.com";
const LEGACY_BASE_URL = "http://127.0.0.1:3000";

function createVersionOneDatabase(databasePath) {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE new_api_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      base_url TEXT NOT NULL UNIQUE,
      admin_username TEXT NOT NULL,
      encrypted_password TEXT NOT NULL,
      channel_group TEXT NOT NULL,
      name_prefix TEXT NOT NULL,
      start_number INTEGER NOT NULL,
      continue_from_existing INTEGER NOT NULL,
      date_mode TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE user_instance_bindings (
      user_id INTEGER PRIMARY KEY,
      instance_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (instance_id) REFERENCES new_api_instances(id) ON DELETE RESTRICT
    );

    CREATE TABLE channel_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER,
      new_api_base_url TEXT NOT NULL,
      new_api_channel_id INTEGER NOT NULL,
      channel_name TEXT NOT NULL,
      key_mask TEXT NOT NULL,
      key_fingerprint TEXT NOT NULL,
      group_name TEXT NOT NULL,
      models TEXT NOT NULL,
      status INTEGER NOT NULL,
      status_label TEXT NOT NULL,
      used_quota INTEGER NOT NULL DEFAULT 0,
      used_usd REAL NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL,
      last_synced_at TEXT,
      FOREIGN KEY (instance_id) REFERENCES new_api_instances(id) ON DELETE RESTRICT,
      UNIQUE (new_api_base_url, new_api_channel_id),
      UNIQUE (new_api_base_url, channel_name),
      UNIQUE (new_api_base_url, key_fingerprint)
    );
  `);

  const timestamp = "2026-07-11T00:00:00.000Z";
  const futureTimestamp = "2099-07-11T00:00:00.000Z";
  const instanceResult = database.prepare(`
    INSERT INTO new_api_instances (
      name, base_url, admin_username, encrypted_password, channel_group,
      name_prefix, start_number, continue_from_existing, date_mode,
      enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "已配置实例",
    EXISTING_BASE_URL,
    "new-api-admin",
    encryptCredential("existing-new-api-password", ENCRYPTION_KEY),
    "anthropic",
    "claude",
    1,
    1,
    "auto",
    1,
    timestamp,
    timestamp,
  );
  const administratorResult = database.prepare(`
    INSERT INTO users (
      username, password_hash, role, enabled, created_at, updated_at
    ) VALUES (?, ?, 'admin', 1, ?, ?)
  `).run(
    "system-administrator",
    hashPassword(ADMINISTRATOR_PASSWORD),
    timestamp,
    timestamp,
  );
  const ordinaryUserResult = database.prepare(`
    INSERT INTO users (
      username, password_hash, role, enabled, created_at, updated_at
    ) VALUES (?, ?, 'user', 1, ?, ?)
  `).run(
    "legacy-user",
    hashPassword("legacy-user-password"),
    timestamp,
    timestamp,
  );
  database.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?), (?, ?, ?, ?)
  `).run(
    hashSessionToken(ADMINISTRATOR_SESSION_TOKEN),
    Number(administratorResult.lastInsertRowid),
    timestamp,
    futureTimestamp,
    hashSessionToken("legacy-user-session-token"),
    Number(ordinaryUserResult.lastInsertRowid),
    timestamp,
    futureTimestamp,
  );
  database.prepare(`
    INSERT INTO user_instance_bindings (user_id, instance_id, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(
    Number(ordinaryUserResult.lastInsertRowid),
    Number(instanceResult.lastInsertRowid),
    timestamp,
    timestamp,
  );
  database.prepare(`
    INSERT INTO channel_records (
      instance_id, new_api_base_url, new_api_channel_id, channel_name,
      key_mask, key_fingerprint, group_name, models, status, status_label,
      used_quota, used_usd, imported_at, last_synced_at
    ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    LEGACY_BASE_URL,
    17,
    "claude-0711-017",
    "sk-ant-****6789",
    "legacy-fingerprint",
    "anthropic",
    "claude-opus-4-8",
    1,
    "enabled",
    250_000,
    0.5,
    timestamp,
    timestamp,
  );
  database.close();
}

test("ApplicationStore migrates v1 data and revokes visitor sessions with access keys", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "newapi-application-store-"));
  const databasePath = join(temporaryDirectory, "records.sqlite");
  createVersionOneDatabase(databasePath);
  const store = new ApplicationStore({
    databasePath,
    encryptionKey: ENCRYPTION_KEY,
    initialInstance: null,
    bootstrapAdmin: null,
  });
  let firstAccessKey;
  let secondAccessKey;

  try {
    const instances = store.listInstances();
    assert.equal(instances.length, 2);
    const configuredInstance = instances.find(
      (instance) => instance.baseUrl === EXISTING_BASE_URL,
    );
    const placeholderInstance = instances.find(
      (instance) => instance.baseUrl === LEGACY_BASE_URL,
    );
    assert.equal(configuredInstance.accessKey.configured, false);
    assert.equal(configuredInstance.priority, 0);
    assert.equal(configuredInstance.weight, 0);
    assert.equal(placeholderInstance.enabled, false);
    assert.equal(placeholderInstance.priority, 0);
    assert.equal(placeholderInstance.weight, 0);
    assert.match(placeholderInstance.name, /^待配置旧实例 /);
    assert.equal(store.listRecords(placeholderInstance.id).length, 1);
    assert.equal(store.getInstanceConnection(placeholderInstance.id).password, "");

    const updatedConfiguredInstance = store.updateInstance(configuredInstance.id, {
      name: configuredInstance.name,
      baseUrl: configuredInstance.baseUrl,
      username: configuredInstance.adminUsername,
      password: "",
      group: configuredInstance.group,
      namePrefix: configuredInstance.namePrefix,
      startNumber: configuredInstance.startNumber,
      continueFromExisting: configuredInstance.continueFromExisting,
      priority: -5,
      weight: 40,
      dateMode: configuredInstance.dateMode,
      enabled: true,
    });
    assert.equal(updatedConfiguredInstance.priority, -5);
    assert.equal(updatedConfiguredInstance.weight, 40);
    assert.equal(
      store.getInstanceConnection(configuredInstance.id).password,
      "existing-new-api-password",
    );

    const administrator = store.authenticateAdministrator(
      "SYSTEM-ADMINISTRATOR",
      ADMINISTRATOR_PASSWORD,
    );
    assert.equal(administrator.kind, "admin");
    assert.equal(
      store.getPrincipalBySessionToken(ADMINISTRATOR_SESSION_TOKEN).id,
      administrator.id,
    );

    const generatedAccess = store.regenerateInstanceAccessKey(configuredInstance.id);
    firstAccessKey = generatedAccess.accessKey;
    assert.match(firstAccessKey, /^nai_[A-Za-z0-9_-]{43}$/);
    assert.equal(generatedAccess.instance.accessKey.enabled, true);
    const firstVisitorSession = store.createVisitorSessionForAccessKey(firstAccessKey);
    assert.equal(firstVisitorSession.principal.instanceId, configuredInstance.id);

    const regeneratedAccess = store.regenerateInstanceAccessKey(configuredInstance.id);
    secondAccessKey = regeneratedAccess.accessKey;
    assert.equal(store.getPrincipalBySessionToken(firstVisitorSession.token), null);
    assert.equal(store.createVisitorSessionForAccessKey(firstAccessKey), null);
    const secondVisitorSession = store.createVisitorSessionForAccessKey(secondAccessKey);
    assert.equal(secondVisitorSession.principal.kind, "visitor");

    const disabledInstance = store.disableInstanceAccessKey(configuredInstance.id);
    assert.equal(disabledInstance.accessKey.configured, true);
    assert.equal(disabledInstance.accessKey.enabled, false);
    assert.equal(store.getPrincipalBySessionToken(secondVisitorSession.token), null);
    assert.equal(store.createVisitorSessionForAccessKey(secondAccessKey), null);

    const deletionAccess = store.regenerateInstanceAccessKey(configuredInstance.id);
    const deletionVisitorSession = store.createVisitorSessionForAccessKey(
      deletionAccess.accessKey,
    );
    store.recordImportedChannel({
      instanceId: configuredInstance.id,
      baseUrl: configuredInstance.baseUrl,
      key: "sk-ant-deletion-test-record",
      channel: {
        id: 81,
        name: "claude-0711-081",
        group: "anthropic",
        models: "claude-opus-4-8",
        status: 1,
        used_quota: 0,
      },
      quotaPerUnit: 500_000,
    });
    const instanceBeforeDeletion = store.listInstances().find(
      (instance) => instance.id === configuredInstance.id,
    );
    assert.equal(instanceBeforeDeletion.channelRecordCount, 1);

    const deletion = store.deleteInstance(configuredInstance.id);
    assert.equal(deletion.instance.id, configuredInstance.id);
    assert.equal(deletion.deletedChannelRecordCount, 1);
    assert.equal(store.getInstance(configuredInstance.id), null);
    assert.equal(store.getPrincipalBySessionToken(deletionVisitorSession.token), null);
    assert.equal(store.getInstance(placeholderInstance.id).id, placeholderInstance.id);
    assert.equal(store.deleteInstance(configuredInstance.id), null);

    assert.equal(store.database.prepare("PRAGMA user_version").get().user_version, 3);
    assert.deepEqual(store.database.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(store.database.prepare(`
      SELECT COUNT(*) AS total FROM users WHERE role = 'user'
    `).get().total, 0);
    assert.equal(store.database.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'user_instance_bindings'
    `).get(), undefined);
  } finally {
    store.close();
  }

  try {
    const databaseBytes = readFileSync(databasePath);
    assert.equal(databaseBytes.includes(Buffer.from(firstAccessKey)), false);
    assert.equal(databaseBytes.includes(Buffer.from(secondAccessKey)), false);
    assert.equal(databaseBytes.includes(Buffer.from(ADMINISTRATOR_PASSWORD)), false);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
