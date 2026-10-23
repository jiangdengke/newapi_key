import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  createInstanceAccessKey,
  createSessionToken,
  decryptCredential,
  encryptCredential,
  hashInstanceAccessKey,
  hashPassword,
  hashSessionToken,
  maskInstanceAccessKey,
  verifyPassword,
} from "./security.js";
import {
  ANTHROPIC_CHANNEL_TYPE,
  AWS_CHANNEL_TYPE,
  CHANNEL_KINDS,
  DEFAULT_CHANNEL_MODELS,
  OPENAI_CHANNEL_TYPE,
  XAI_CHANNEL_TYPE,
} from "./validation.js";

const ADMINISTRATOR_SESSION_LIFETIME_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const VISITOR_SESSION_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;
const CURRENT_SCHEMA_VERSION = 10;
const DEFAULT_MEMBER_NAME = "默认成员";
const UNKNOWN_CHANNEL_KIND = "unknown";
const CHANNEL_TYPES_BY_KIND = Object.freeze({
  [CHANNEL_KINDS.CLAUDE]: ANTHROPIC_CHANNEL_TYPE,
  [CHANNEL_KINDS.OPENAI]: OPENAI_CHANNEL_TYPE,
  [CHANNEL_KINDS.GROK]: XAI_CHANNEL_TYPE,
  [CHANNEL_KINDS.AWS]: AWS_CHANNEL_TYPE,
});
const RECORD_SORT_COLUMNS = Object.freeze({
  importedAt: "channel_records.imported_at",
  lastSyncedAt: "channel_records.last_synced_at",
  usedUsd: "channel_records.used_usd",
  balanceUsd: "channel_records.balance_usd",
  channelName: "channel_records.channel_name",
});

function createKeyFingerprint(key) {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function createKeyMask(key) {
  const normalizedKey = String(key);
  const visibleCharacterCount = Math.min(11, Math.max(0, normalizedKey.length - 4));
  const visibleSuffixLength = Math.min(4, Math.floor(visibleCharacterCount / 2));
  const visiblePrefixLength = visibleCharacterCount - visibleSuffixLength;
  const visiblePrefix = normalizedKey.slice(0, visiblePrefixLength);
  const visibleSuffix = visibleSuffixLength > 0
    ? normalizedKey.slice(-visibleSuffixLength)
    : "";
  return `${visiblePrefix}****${visibleSuffix}`;
}

function getChannelKind(channelType) {
  const matchingKind = Object.entries(CHANNEL_TYPES_BY_KIND).find(
    ([, kindChannelType]) => kindChannelType === Number(channelType),
  );
  return matchingKind ? matchingKind[0] : UNKNOWN_CHANNEL_KIND;
}

function normalizeChannelType(channelType) {
  const normalizedChannelType = Number(channelType);
  return Number.isSafeInteger(normalizedChannelType) && normalizedChannelType > 0
    ? normalizedChannelType
    : null;
}

function escapeLikePattern(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function getStatusLabel(status) {
  return Number(status) === 1 ? "enabled" : "disabled";
}

function convertQuotaToUsd(usedQuota, quotaPerUnit) {
  const normalizedQuota = Number(usedQuota) || 0;
  const normalizedQuotaPerUnit = Number(quotaPerUnit);
  if (!Number.isFinite(normalizedQuotaPerUnit) || normalizedQuotaPerUnit <= 0) {
    if (normalizedQuota > 0) {
      throw new Error("New API quota_per_unit 无效，无法换算累计用量");
    }
    return 0;
  }
  return normalizedQuota / normalizedQuotaPerUnit;
}

function mapChannelRecord(databaseRecord) {
  return {
    id: databaseRecord.id,
    newApiChannelId: databaseRecord.new_api_channel_id,
    channelName: databaseRecord.channel_name,
    keyMask: databaseRecord.key_mask,
    keyAvailable: Boolean(databaseRecord.encrypted_key),
    channelKind: getChannelKind(databaseRecord.channel_type),
    group: databaseRecord.group_name,
    models: databaseRecord.models.split(",").filter(Boolean),
    status: databaseRecord.status,
    statusLabel: databaseRecord.status_label,
    balanceUsd: databaseRecord.balance_usd,
    usedQuota: databaseRecord.used_quota,
    usedUsd: databaseRecord.used_usd,
    importedAt: databaseRecord.imported_at,
    lastSyncedAt: databaseRecord.last_synced_at,
  };
}

function mapAdministratorChannelRecord(databaseRecord) {
  return {
    ...mapChannelRecord(databaseRecord),
    instanceId: databaseRecord.instance_id,
    instanceName: databaseRecord.instance_name,
    memberId: databaseRecord.member_id ?? null,
    memberName: databaseRecord.member_name ?? null,
  };
}

function parseStoredChannelModels(rawChannelModels) {
  let storedChannelModels = {};
  try {
    storedChannelModels = JSON.parse(rawChannelModels || "{}") || {};
  } catch {
    storedChannelModels = {};
  }
  return Object.fromEntries(Object.values(CHANNEL_KINDS).map((channelKind) => {
    const storedModels = storedChannelModels[channelKind];
    const isValidList = Array.isArray(storedModels)
      && storedModels.length > 0
      && storedModels.every((model) => typeof model === "string" && model);
    return [channelKind, isValidList ? storedModels : [...DEFAULT_CHANNEL_MODELS[channelKind]]];
  }));
}

function mapInstance(databaseRecord) {
  return {
    id: databaseRecord.id,
    name: databaseRecord.name,
    baseUrl: databaseRecord.base_url,
    adminUsername: databaseRecord.admin_username,
    group: databaseRecord.channel_group,
    namePrefix: databaseRecord.name_prefix,
    startNumber: databaseRecord.start_number,
    continueFromExisting: databaseRecord.continue_from_existing === 1,
    priority: databaseRecord.channel_priority,
    weight: databaseRecord.channel_weight,
    dateMode: databaseRecord.date_mode,
    channelModels: parseStoredChannelModels(databaseRecord.channel_models),
    enabled: databaseRecord.enabled === 1,
    channelRecordCount: Number(databaseRecord.channel_record_count ?? 0),
    memberCount: Number(databaseRecord.member_count ?? 0),
    activeMemberCount: Number(databaseRecord.active_member_count ?? 0),
    createdAt: databaseRecord.created_at,
    updatedAt: databaseRecord.updated_at,
  };
}

function mapAdministrator(databaseRecord) {
  return {
    kind: "admin",
    id: databaseRecord.id,
    username: databaseRecord.username,
    role: "admin",
  };
}

function mapVisitor(databaseRecord) {
  return {
    kind: "visitor",
    instanceId: databaseRecord.instance_id,
    instanceName: databaseRecord.instance_name,
    memberId: databaseRecord.member_id,
    memberName: databaseRecord.member_name,
  };
}

function mapMember(databaseRecord) {
  return {
    id: databaseRecord.id,
    instanceId: databaseRecord.instance_id,
    name: databaseRecord.name,
    namePrefix: databaseRecord.name_prefix,
    dateMode: databaseRecord.date_mode,
    startNumber: databaseRecord.start_number,
    priority: databaseRecord.channel_priority,
    weight: databaseRecord.channel_weight,
    enabled: databaseRecord.enabled === 1,
    channelRecordCount: Number(databaseRecord.channel_record_count ?? 0),
    accessKey: {
      configured: Boolean(databaseRecord.access_key_digest),
      mask: databaseRecord.access_key_mask || null,
      revealable: Boolean(databaseRecord.access_key_ciphertext),
      createdAt: databaseRecord.access_key_created_at || null,
    },
    createdAt: databaseRecord.created_at,
    updatedAt: databaseRecord.updated_at,
  };
}

function hasTable(database, tableName) {
  return database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(tableName) !== undefined;
}

function hasColumn(database, tableName, columnName) {
  return database.prepare(`PRAGMA table_info(${tableName})`).all()
    .some((column) => column.name === columnName);
}

export class ApplicationStore {
  constructor({ databasePath, encryptionKey, initialInstance, bootstrapAdmin }) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    }
    this.encryptionKey = encryptionKey;
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.initializeSchema({ initialInstance, bootstrapAdmin });
  }

  initializeSchema({ initialInstance, bootstrapAdmin }) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.createCoreTables();
      this.addMigrationColumns();
      this.createIndexes();
      this.removeLegacyOrdinaryUsers();
      this.removeLegacyAdminHubConnections();
      this.migrateInstanceAccessKeysToMembers();
      this.bootstrapInitialInstance(initialInstance);
      this.assignLegacyRecordsToPlaceholderInstances();
      this.bootstrapInitialAdmin(bootstrapAdmin);
      this.ensureAllLegacyRecordsAreAssigned();
      this.ensureForeignKeysAreValid();
      this.database.exec(`PRAGMA user_version = ${CURRENT_SCHEMA_VERSION}`);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createCoreTables() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS new_api_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        base_url TEXT NOT NULL UNIQUE,
        admin_username TEXT NOT NULL,
        encrypted_password TEXT NOT NULL,
        channel_group TEXT NOT NULL,
        name_prefix TEXT NOT NULL,
        start_number INTEGER NOT NULL,
        continue_from_existing INTEGER NOT NULL,
        channel_priority INTEGER NOT NULL DEFAULT 0,
        channel_weight INTEGER NOT NULL DEFAULT 0,
        date_mode TEXT NOT NULL,
        channel_models TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS instance_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        name_prefix TEXT NOT NULL,
        date_mode TEXT,
        start_number INTEGER,
        channel_priority INTEGER,
        channel_weight INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        access_key_digest TEXT,
        access_key_mask TEXT,
        access_key_ciphertext TEXT,
        access_key_version INTEGER NOT NULL DEFAULT 0,
        access_key_created_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (instance_id) REFERENCES new_api_instances(id) ON DELETE CASCADE,
        UNIQUE (instance_id, name),
        UNIQUE (instance_id, name_prefix)
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS visitor_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        instance_id INTEGER NOT NULL,
        member_id INTEGER REFERENCES instance_members(id) ON DELETE CASCADE,
        access_key_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (instance_id) REFERENCES new_api_instances(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS channel_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER,
        member_id INTEGER REFERENCES instance_members(id) ON DELETE SET NULL,
        new_api_base_url TEXT NOT NULL,
        new_api_channel_id INTEGER NOT NULL,
        channel_name TEXT NOT NULL,
        key_mask TEXT NOT NULL,
        key_fingerprint TEXT NOT NULL,
        encrypted_key TEXT,
        channel_type INTEGER,
        group_name TEXT NOT NULL,
        models TEXT NOT NULL,
        status INTEGER NOT NULL,
        status_label TEXT NOT NULL,
        balance_usd REAL NOT NULL DEFAULT 0,
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
  }

  addMigrationColumns() {
    if (!hasColumn(this.database, "channel_records", "instance_id")) {
      this.database.exec(`
        ALTER TABLE channel_records
        ADD COLUMN instance_id INTEGER REFERENCES new_api_instances(id)
      `);
    }
    if (!hasColumn(this.database, "channel_records", "encrypted_key")) {
      this.database.exec(`
        ALTER TABLE channel_records ADD COLUMN encrypted_key TEXT
      `);
    }
    if (!hasColumn(this.database, "channel_records", "channel_type")) {
      this.database.exec(`
        ALTER TABLE channel_records ADD COLUMN channel_type INTEGER
      `);
    }
    if (!hasColumn(this.database, "channel_records", "balance_usd")) {
      this.database.exec(`
        ALTER TABLE channel_records ADD COLUMN balance_usd REAL NOT NULL DEFAULT 0
      `);
    }
    if (!hasColumn(this.database, "channel_records", "member_id")) {
      this.database.exec(`
        ALTER TABLE channel_records
        ADD COLUMN member_id INTEGER REFERENCES instance_members(id) ON DELETE SET NULL
      `);
    }
    if (!hasColumn(this.database, "visitor_sessions", "member_id")) {
      this.database.exec(`
        ALTER TABLE visitor_sessions
        ADD COLUMN member_id INTEGER REFERENCES instance_members(id) ON DELETE CASCADE
      `);
    }
    const channelSettingColumns = [
      ["channel_priority", "INTEGER NOT NULL DEFAULT 0"],
      ["channel_weight", "INTEGER NOT NULL DEFAULT 0"],
      ["channel_models", "TEXT"],
    ];
    for (const [columnName, columnDefinition] of channelSettingColumns) {
      if (!hasColumn(this.database, "new_api_instances", columnName)) {
        this.database.exec(`
          ALTER TABLE new_api_instances ADD COLUMN ${columnName} ${columnDefinition}
        `);
      }
    }
  }

  createIndexes() {
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS channel_records_instance_id_index
      ON channel_records(instance_id);
      CREATE INDEX IF NOT EXISTS sessions_expiration_index
      ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS visitor_sessions_expiration_index
      ON visitor_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS visitor_sessions_instance_id_index
      ON visitor_sessions(instance_id);
      CREATE INDEX IF NOT EXISTS visitor_sessions_member_id_index
      ON visitor_sessions(member_id);
      CREATE INDEX IF NOT EXISTS channel_records_member_id_index
      ON channel_records(member_id);
      CREATE UNIQUE INDEX IF NOT EXISTS instance_members_access_key_digest_unique
      ON instance_members(access_key_digest)
      WHERE access_key_digest IS NOT NULL;
    `);
  }

  removeLegacyOrdinaryUsers() {
    if (hasTable(this.database, "user_instance_bindings")) {
      this.database.exec("DELETE FROM user_instance_bindings");
      this.database.exec("DROP TABLE user_instance_bindings");
    }
    this.database.exec(`
      DELETE FROM sessions
      WHERE user_id IN (SELECT id FROM users WHERE role = 'user');
      DELETE FROM users WHERE role = 'user';
    `);
  }

  removeLegacyAdminHubConnections() {
    if (hasColumn(this.database, "new_api_instances", "connection_protocol")) {
      this.database.exec(`
        DELETE FROM visitor_sessions
        WHERE instance_id IN (
          SELECT id FROM new_api_instances WHERE connection_protocol = 'admin-hub'
        );
        UPDATE new_api_instances SET enabled = 0
        WHERE connection_protocol = 'admin-hub';
        ALTER TABLE new_api_instances DROP COLUMN connection_protocol;
      `);
    }
    if (hasColumn(this.database, "new_api_instances", "admin_hub_target_site_id")) {
      this.database.exec(`
        ALTER TABLE new_api_instances DROP COLUMN admin_hub_target_site_id
      `);
    }
  }

  migrateInstanceAccessKeysToMembers() {
    if (!hasColumn(this.database, "new_api_instances", "access_key_mask")) {
      return;
    }
    const legacyInstances = this.database.prepare(`
      SELECT * FROM new_api_instances WHERE access_key_mask IS NOT NULL
    `).all();
    const timestamp = new Date().toISOString();
    for (const legacyInstance of legacyInstances) {
      const keyIsActive = legacyInstance.access_key_enabled === 1
        && Boolean(legacyInstance.access_key_digest);
      const result = this.database.prepare(`
        INSERT INTO instance_members (
          instance_id, name, name_prefix, enabled, access_key_digest, access_key_mask,
          access_key_ciphertext, access_key_version, access_key_created_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        legacyInstance.id,
        DEFAULT_MEMBER_NAME,
        legacyInstance.name_prefix,
        keyIsActive ? 1 : 0,
        keyIsActive ? legacyInstance.access_key_digest : null,
        legacyInstance.access_key_mask,
        keyIsActive ? legacyInstance.access_key_ciphertext : null,
        legacyInstance.access_key_version,
        legacyInstance.access_key_created_at,
        timestamp,
        timestamp,
      );
      const memberId = Number(result.lastInsertRowid);
      this.database.prepare(`
        UPDATE visitor_sessions SET member_id = ?
        WHERE instance_id = ? AND access_key_version = ?
      `).run(memberId, legacyInstance.id, legacyInstance.access_key_version);
      this.database.prepare(`
        UPDATE channel_records SET member_id = ? WHERE instance_id = ? AND member_id IS NULL
      `).run(memberId, legacyInstance.id);
    }
    this.database.exec(`
      DELETE FROM visitor_sessions WHERE member_id IS NULL;
      DROP INDEX IF EXISTS new_api_instances_access_key_digest_unique;
    `);
    for (const columnName of [
      "access_key_digest",
      "access_key_mask",
      "access_key_enabled",
      "access_key_version",
      "access_key_created_at",
      "access_key_ciphertext",
    ]) {
      if (hasColumn(this.database, "new_api_instances", columnName)) {
        this.database.exec(`ALTER TABLE new_api_instances DROP COLUMN ${columnName}`);
      }
    }
  }

  bootstrapInitialInstance(initialInstance) {
    if (!initialInstance) {
      return;
    }
    const matchingInstance = this.database.prepare(`
      SELECT id FROM new_api_instances WHERE base_url = ?
    `).get(initialInstance.baseUrl);
    const instanceId = matchingInstance?.id
      ?? this.insertInstance({ ...initialInstance, enabled: true });
    this.database.prepare(`
      UPDATE channel_records SET instance_id = ?
      WHERE instance_id IS NULL AND new_api_base_url = ?
    `).run(instanceId, initialInstance.baseUrl);
  }

  assignLegacyRecordsToPlaceholderInstances() {
    const legacyGroups = this.database.prepare(`
      SELECT new_api_base_url, MIN(group_name) AS group_name
      FROM channel_records
      WHERE instance_id IS NULL
      GROUP BY new_api_base_url
      ORDER BY new_api_base_url ASC
    `).all();
    for (const legacyGroup of legacyGroups) {
      const matchingInstance = this.database.prepare(`
        SELECT id FROM new_api_instances WHERE base_url = ?
      `).get(legacyGroup.new_api_base_url);
      const instanceId = matchingInstance?.id
        ?? this.createPlaceholderInstance(legacyGroup);
      this.database.prepare(`
        UPDATE channel_records SET instance_id = ?
        WHERE instance_id IS NULL AND new_api_base_url = ?
      `).run(instanceId, legacyGroup.new_api_base_url);
    }
  }

  createPlaceholderInstance(legacyGroup) {
    let sequenceNumber = 1;
    let instanceName = `待配置旧实例 ${sequenceNumber}`;
    while (this.database.prepare("SELECT 1 FROM new_api_instances WHERE name = ?").get(
      instanceName,
    )) {
      sequenceNumber += 1;
      instanceName = `待配置旧实例 ${sequenceNumber}`;
    }
    return this.insertInstance({
      name: instanceName,
      baseUrl: legacyGroup.new_api_base_url,
      username: "",
      password: "",
      group: legacyGroup.group_name || "anthropic",
      namePrefix: "claude",
      startNumber: 1,
      continueFromExisting: true,
      priority: 0,
      weight: 0,
      dateMode: "auto",
      enabled: false,
    });
  }

  insertInstance(instanceInput) {
    const timestamp = new Date().toISOString();
    const result = this.database.prepare(`
      INSERT INTO new_api_instances (
        name, base_url, admin_username, encrypted_password,
        channel_group, name_prefix, start_number,
        continue_from_existing, channel_priority, channel_weight,
        date_mode, channel_models, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      instanceInput.name,
      instanceInput.baseUrl,
      instanceInput.username,
      encryptCredential(instanceInput.password, this.encryptionKey),
      instanceInput.group,
      instanceInput.namePrefix,
      instanceInput.startNumber,
      instanceInput.continueFromExisting ? 1 : 0,
      instanceInput.priority ?? 0,
      instanceInput.weight ?? 0,
      instanceInput.dateMode,
      instanceInput.channelModels ? JSON.stringify(instanceInput.channelModels) : null,
      instanceInput.enabled === false ? 0 : 1,
      timestamp,
      timestamp,
    );
    return Number(result.lastInsertRowid);
  }

  bootstrapInitialAdmin(bootstrapAdmin) {
    const administratorCount = Number(this.database.prepare(`
      SELECT COUNT(*) AS total FROM users WHERE role = 'admin'
    `).get().total);
    if (administratorCount > 0) {
      return;
    }
    if (!bootstrapAdmin?.username || !bootstrapAdmin?.password) {
      throw new Error("首次启动必须配置 BOOTSTRAP_ADMIN_USERNAME 和 BOOTSTRAP_ADMIN_PASSWORD");
    }
    const timestamp = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO users (username, password_hash, role, enabled, created_at, updated_at)
      VALUES (?, ?, 'admin', 1, ?, ?)
    `).run(
      bootstrapAdmin.username,
      hashPassword(bootstrapAdmin.password),
      timestamp,
      timestamp,
    );
  }

  ensureAllLegacyRecordsAreAssigned() {
    const unassignedRecordCount = Number(this.database.prepare(`
      SELECT COUNT(*) AS total FROM channel_records WHERE instance_id IS NULL
    `).get().total);
    if (unassignedRecordCount > 0) {
      throw new Error(`仍有 ${unassignedRecordCount} 条旧渠道记录无法归属实例`);
    }
  }

  ensureForeignKeysAreValid() {
    if (this.database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("SQLite 数据迁移后存在无效外键");
    }
  }

  listInstances() {
    return this.database.prepare(`
      SELECT new_api_instances.*,
             (
               SELECT COUNT(*)
               FROM channel_records
               WHERE channel_records.instance_id = new_api_instances.id
             ) AS channel_record_count,
             (
               SELECT COUNT(*) FROM instance_members
               WHERE instance_members.instance_id = new_api_instances.id
             ) AS member_count,
             (
               SELECT COUNT(*) FROM instance_members
               WHERE instance_members.instance_id = new_api_instances.id
                 AND instance_members.enabled = 1
                 AND instance_members.access_key_digest IS NOT NULL
             ) AS active_member_count
      FROM new_api_instances
      ORDER BY created_at ASC, id ASC
    `).all().map(mapInstance);
  }

  getInstance(instanceId) {
    const databaseRecord = this.database.prepare(`
      SELECT new_api_instances.*,
             (
               SELECT COUNT(*)
               FROM channel_records
               WHERE channel_records.instance_id = new_api_instances.id
             ) AS channel_record_count,
             (
               SELECT COUNT(*) FROM instance_members
               WHERE instance_members.instance_id = new_api_instances.id
             ) AS member_count,
             (
               SELECT COUNT(*) FROM instance_members
               WHERE instance_members.instance_id = new_api_instances.id
                 AND instance_members.enabled = 1
                 AND instance_members.access_key_digest IS NOT NULL
             ) AS active_member_count
      FROM new_api_instances WHERE id = ?
    `).get(Number(instanceId));
    return databaseRecord ? mapInstance(databaseRecord) : null;
  }

  getInstanceConnection(instanceId) {
    const databaseRecord = this.database.prepare(`
      SELECT * FROM new_api_instances WHERE id = ?
    `).get(Number(instanceId));
    if (!databaseRecord) {
      return null;
    }
    return {
      ...mapInstance(databaseRecord),
      password: decryptCredential(databaseRecord.encrypted_password, this.encryptionKey),
    };
  }

  createInstance(instanceInput) {
    return this.getInstance(this.insertInstance({ ...instanceInput, enabled: true }));
  }

  updateInstance(instanceId, instanceInput) {
    const existingRecord = this.database.prepare(`
      SELECT * FROM new_api_instances WHERE id = ?
    `).get(Number(instanceId));
    if (!existingRecord) {
      return null;
    }
    const encryptedPassword = instanceInput.password
      ? encryptCredential(instanceInput.password, this.encryptionKey)
      : existingRecord.encrypted_password;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        UPDATE new_api_instances
        SET name = ?, base_url = ?, admin_username = ?, encrypted_password = ?,
            channel_group = ?, name_prefix = ?, start_number = ?,
            continue_from_existing = ?, channel_priority = ?, channel_weight = ?,
            date_mode = ?, channel_models = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(
        instanceInput.name,
        instanceInput.baseUrl,
        instanceInput.username,
        encryptedPassword,
        instanceInput.group,
        instanceInput.namePrefix,
        instanceInput.startNumber,
        instanceInput.continueFromExisting ? 1 : 0,
        instanceInput.priority ?? 0,
        instanceInput.weight ?? 0,
        instanceInput.dateMode,
        instanceInput.channelModels
          ? JSON.stringify(instanceInput.channelModels)
          : existingRecord.channel_models,
        instanceInput.enabled ? 1 : 0,
        new Date().toISOString(),
        Number(instanceId),
      );
      this.database.prepare(`
        UPDATE channel_records SET new_api_base_url = ? WHERE instance_id = ?
      `).run(instanceInput.baseUrl, Number(instanceId));
      if (existingRecord.enabled === 1 && !instanceInput.enabled) {
        this.database.prepare(`
          DELETE FROM visitor_sessions WHERE instance_id = ?
        `).run(Number(instanceId));
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getInstance(instanceId);
  }

  deleteInstance(instanceId) {
    const normalizedInstanceId = Number(instanceId);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existingRecord = this.database.prepare(`
        SELECT * FROM new_api_instances WHERE id = ?
      `).get(normalizedInstanceId);
      if (!existingRecord) {
        this.database.exec("ROLLBACK");
        return null;
      }

      const channelRecordDeletion = this.database.prepare(`
        DELETE FROM channel_records WHERE instance_id = ?
      `).run(normalizedInstanceId);
      this.database.prepare(`
        DELETE FROM new_api_instances WHERE id = ?
      `).run(normalizedInstanceId);
      this.database.exec("COMMIT");

      return {
        instance: mapInstance(existingRecord),
        deletedChannelRecordCount: Number(channelRecordDeletion.changes),
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listInstanceMembers(instanceId) {
    return this.database.prepare(`
      SELECT instance_members.*,
             (
               SELECT COUNT(*) FROM channel_records
               WHERE channel_records.member_id = instance_members.id
             ) AS channel_record_count
      FROM instance_members
      WHERE instance_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(Number(instanceId)).map(mapMember);
  }

  getInstanceMember(memberId) {
    const databaseRecord = this.database.prepare(`
      SELECT instance_members.*,
             (
               SELECT COUNT(*) FROM channel_records
               WHERE channel_records.member_id = instance_members.id
             ) AS channel_record_count
      FROM instance_members WHERE id = ?
    `).get(Number(memberId));
    return databaseRecord ? mapMember(databaseRecord) : null;
  }

  issueMemberAccessKey(memberId) {
    const accessKey = createInstanceAccessKey();
    const issuedAt = new Date().toISOString();
    this.database.prepare(`
      UPDATE instance_members
      SET access_key_digest = ?, access_key_mask = ?, access_key_ciphertext = ?,
          access_key_version = access_key_version + 1, access_key_created_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      hashInstanceAccessKey(accessKey),
      maskInstanceAccessKey(accessKey),
      encryptCredential(accessKey, this.encryptionKey),
      issuedAt,
      issuedAt,
      Number(memberId),
    );
    this.database.prepare("DELETE FROM visitor_sessions WHERE member_id = ?").run(Number(memberId));
    return accessKey;
  }

  createInstanceMember(instanceId, memberInput) {
    const instanceRecord = this.database.prepare(`
      SELECT id, name_prefix FROM new_api_instances WHERE id = ?
    `).get(Number(instanceId));
    if (!instanceRecord) {
      return null;
    }
    const timestamp = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`
        INSERT INTO instance_members (
          instance_id, name, name_prefix, date_mode, start_number, channel_priority,
          channel_weight, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        instanceRecord.id,
        memberInput.name,
        memberInput.namePrefix ?? instanceRecord.name_prefix,
        memberInput.dateMode ?? null,
        memberInput.startNumber ?? null,
        memberInput.priority ?? null,
        memberInput.weight ?? null,
        memberInput.enabled === false ? 0 : 1,
        timestamp,
        timestamp,
      );
      const memberId = Number(result.lastInsertRowid);
      const accessKey = this.issueMemberAccessKey(memberId);
      this.database.exec("COMMIT");
      return { member: this.getInstanceMember(memberId), accessKey };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  updateInstanceMember(memberId, memberInput) {
    const existingRecord = this.database.prepare(`
      SELECT * FROM instance_members WHERE id = ?
    `).get(Number(memberId));
    if (!existingRecord) {
      return null;
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        UPDATE instance_members
        SET name = ?, name_prefix = ?, date_mode = ?, start_number = ?, channel_priority = ?,
            channel_weight = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(
        memberInput.name,
        memberInput.namePrefix,
        memberInput.dateMode ?? null,
        memberInput.startNumber ?? null,
        memberInput.priority ?? null,
        memberInput.weight ?? null,
        memberInput.enabled === false ? 0 : 1,
        new Date().toISOString(),
        Number(memberId),
      );
      if (existingRecord.enabled === 1 && memberInput.enabled === false) {
        this.database.prepare("DELETE FROM visitor_sessions WHERE member_id = ?").run(Number(memberId));
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getInstanceMember(memberId);
  }

  deleteInstanceMember(memberId) {
    const member = this.getInstanceMember(memberId);
    if (!member) {
      return null;
    }
    this.database.prepare("DELETE FROM instance_members WHERE id = ?").run(Number(memberId));
    return member;
  }

  regenerateMemberAccessKey(memberId) {
    if (!this.getInstanceMember(memberId)) {
      return null;
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const accessKey = this.issueMemberAccessKey(memberId);
      this.database.exec("COMMIT");
      return { member: this.getInstanceMember(memberId), accessKey };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getMemberAccessKey(memberId) {
    const databaseRecord = this.database.prepare(`
      SELECT id, access_key_ciphertext FROM instance_members WHERE id = ?
    `).get(Number(memberId));
    if (!databaseRecord) {
      return null;
    }
    return {
      memberId: databaseRecord.id,
      accessKey: databaseRecord.access_key_ciphertext
        ? decryptCredential(databaseRecord.access_key_ciphertext, this.encryptionKey)
        : null,
    };
  }

  authenticateAdministrator(username, password) {
    const databaseRecord = this.database.prepare(`
      SELECT * FROM users
      WHERE username = ? COLLATE NOCASE AND role = 'admin' AND enabled = 1
    `).get(String(username).trim());
    if (!databaseRecord || !verifyPassword(password, databaseRecord.password_hash)) {
      return null;
    }
    return mapAdministrator(databaseRecord);
  }

  changeAdministratorPassword({
    administratorId,
    currentPassword,
    newPassword,
    currentSessionToken,
  }) {
    const databaseRecord = this.database.prepare(`
      SELECT * FROM users
      WHERE id = ? AND role = 'admin' AND enabled = 1
    `).get(Number(administratorId));
    if (!databaseRecord || !verifyPassword(currentPassword, databaseRecord.password_hash)) {
      return false;
    }

    const timestamp = new Date().toISOString();
    const newPasswordHash = hashPassword(newPassword);
    const currentSessionTokenHash = hashSessionToken(currentSessionToken);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?
      `).run(newPasswordHash, timestamp, Number(administratorId));
      this.database.prepare(`
        DELETE FROM sessions
        WHERE user_id = ? AND token_hash <> ?
      `).run(Number(administratorId), currentSessionTokenHash);
      this.database.exec("COMMIT");
      return true;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createAdministratorSession(administratorId) {
    const sessionToken = createSessionToken();
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + ADMINISTRATOR_SESSION_LIFETIME_MILLISECONDS,
    );
    this.database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(
      createdAt.toISOString(),
    );
    this.database.prepare(`
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(
      hashSessionToken(sessionToken),
      Number(administratorId),
      createdAt.toISOString(),
      expiresAt.toISOString(),
    );
    return { token: sessionToken, expiresAt };
  }

  createVisitorSessionForAccessKey(accessKey) {
    const sessionToken = createSessionToken();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + VISITOR_SESSION_LIFETIME_MILLISECONDS);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const memberRecord = this.database.prepare(`
        SELECT instance_members.id AS member_id, instance_members.name AS member_name,
               instance_members.access_key_version, new_api_instances.id AS instance_id,
               new_api_instances.name AS instance_name
        FROM instance_members
        INNER JOIN new_api_instances ON new_api_instances.id = instance_members.instance_id
        WHERE instance_members.access_key_digest = ?
          AND instance_members.enabled = 1
          AND new_api_instances.enabled = 1
      `).get(hashInstanceAccessKey(accessKey));
      if (!memberRecord) {
        this.database.exec("ROLLBACK");
        return null;
      }
      this.database.prepare("DELETE FROM visitor_sessions WHERE expires_at <= ?").run(
        createdAt.toISOString(),
      );
      this.database.prepare(`
        INSERT INTO visitor_sessions (
          token_hash, instance_id, member_id, access_key_version, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        hashSessionToken(sessionToken),
        memberRecord.instance_id,
        memberRecord.member_id,
        memberRecord.access_key_version,
        createdAt.toISOString(),
        expiresAt.toISOString(),
      );
      this.database.exec("COMMIT");
      return {
        token: sessionToken,
        expiresAt,
        principal: mapVisitor(memberRecord),
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  deleteSession(sessionToken) {
    if (!sessionToken) {
      return;
    }
    const tokenHash = hashSessionToken(sessionToken);
    this.database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    this.database.prepare("DELETE FROM visitor_sessions WHERE token_hash = ?").run(tokenHash);
  }

  getPrincipalBySessionToken(sessionToken) {
    if (!sessionToken) {
      return null;
    }
    const tokenHash = hashSessionToken(sessionToken);
    const currentTimestamp = new Date().toISOString();
    const administratorRecord = this.database.prepare(`
      SELECT users.*
      FROM sessions
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > ?
        AND users.role = 'admin' AND users.enabled = 1
    `).get(tokenHash, currentTimestamp);
    if (administratorRecord) {
      return mapAdministrator(administratorRecord);
    }
    const visitorRecord = this.database.prepare(`
      SELECT visitor_sessions.instance_id, new_api_instances.name AS instance_name,
             instance_members.id AS member_id, instance_members.name AS member_name
      FROM visitor_sessions
      INNER JOIN new_api_instances
        ON new_api_instances.id = visitor_sessions.instance_id
      INNER JOIN instance_members
        ON instance_members.id = visitor_sessions.member_id
      WHERE visitor_sessions.token_hash = ?
        AND visitor_sessions.expires_at > ?
        AND visitor_sessions.access_key_version = instance_members.access_key_version
        AND instance_members.enabled = 1
        AND instance_members.access_key_digest IS NOT NULL
        AND new_api_instances.enabled = 1
    `).get(tokenHash, currentTimestamp);
    return visitorRecord ? mapVisitor(visitorRecord) : null;
  }

  hasImportedKey(instanceId, key) {
    return this.database.prepare(`
      SELECT 1 FROM channel_records
      WHERE instance_id = ? AND key_fingerprint = ? LIMIT 1
    `).get(Number(instanceId), createKeyFingerprint(key)) !== undefined;
  }

  recordImportedChannel({ instanceId, memberId = null, baseUrl, key, channel, quotaPerUnit }) {
    const importedAt = new Date().toISOString();
    const balanceUsd = Number(channel.balance) || 0;
    const usedQuota = Number(channel.used_quota) || 0;
    const encryptedKey = encryptCredential(key, this.encryptionKey);
    this.database.prepare(`
      INSERT INTO channel_records (
        instance_id, member_id, new_api_base_url, new_api_channel_id, channel_name,
        key_mask, key_fingerprint, encrypted_key, channel_type, group_name, models, status,
        status_label, balance_usd, used_quota, used_usd, imported_at, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (new_api_base_url, new_api_channel_id) DO UPDATE SET
        instance_id = excluded.instance_id,
        member_id = COALESCE(excluded.member_id, channel_records.member_id),
        channel_name = excluded.channel_name,
        key_mask = excluded.key_mask,
        key_fingerprint = excluded.key_fingerprint,
        encrypted_key = excluded.encrypted_key,
        channel_type = COALESCE(excluded.channel_type, channel_records.channel_type),
        group_name = excluded.group_name,
        models = excluded.models,
        status = excluded.status,
        status_label = excluded.status_label,
        balance_usd = excluded.balance_usd,
        used_quota = excluded.used_quota,
        used_usd = excluded.used_usd,
        last_synced_at = excluded.last_synced_at
    `).run(
      Number(instanceId),
      memberId ? Number(memberId) : null,
      baseUrl,
      Number(channel.id),
      channel.name,
      createKeyMask(key),
      createKeyFingerprint(key),
      encryptedKey,
      normalizeChannelType(channel.type),
      channel.group || "",
      channel.models || "",
      Number(channel.status) || 0,
      getStatusLabel(channel.status),
      balanceUsd,
      usedQuota,
      convertQuotaToUsd(usedQuota, quotaPerUnit),
      importedAt,
      importedAt,
    );
  }

  getAdministratorRecordKey(recordId) {
    const databaseRecord = this.database.prepare(`
      SELECT id, instance_id, encrypted_key
      FROM channel_records
      WHERE id = ?
    `).get(Number(recordId));
    if (!databaseRecord) {
      return null;
    }
    return {
      recordId: databaseRecord.id,
      instanceId: databaseRecord.instance_id,
      key: databaseRecord.encrypted_key
        ? decryptCredential(databaseRecord.encrypted_key, this.encryptionKey)
        : null,
    };
  }

  deleteAdministratorRecords(recordIds) {
    const normalizedRecordIds = [...new Set(recordIds.map(Number))];
    const placeholders = normalizedRecordIds.map(() => "?").join(", ");
    const deletion = this.database.prepare(`
      DELETE FROM channel_records WHERE id IN (${placeholders})
    `).run(...normalizedRecordIds);
    return Number(deletion.changes);
  }

  listRecords(instanceId, memberId = null) {
    return this.database.prepare(`
      SELECT * FROM channel_records
      WHERE instance_id = ?${memberId ? " AND member_id = ?" : ""}
      ORDER BY imported_at DESC, id DESC
    `).all(...[Number(instanceId), ...(memberId ? [Number(memberId)] : [])]).map(mapChannelRecord);
  }

  queryRecords({ instanceId, memberId = null, ...queryOptions }) {
    return this.queryChannelRecords({
      ...queryOptions,
      instanceId: Number(instanceId),
      scopeMemberId: memberId ? Number(memberId) : null,
      includeInstanceName: false,
    });
  }

  queryAdministratorRecords({ instanceId = null, memberId = null, ...queryOptions }) {
    return this.queryChannelRecords({
      ...queryOptions,
      instanceId: instanceId ? Number(instanceId) : null,
      memberId: memberId ? Number(memberId) : null,
      includeInstanceName: true,
    });
  }

  queryChannelRecords({
    instanceId = null,
    scopeMemberId = null,
    memberId = null,
    includeInstanceName,
    search = "",
    channelName = "",
    key = "",
    model = "",
    statusLabel = "",
    channelKind = "",
    group = "",
    sort = "importedAt",
    order = "desc",
    page = 1,
    pageSize = 10,
  }) {
    const scopeConditions = [];
    const scopeParameters = [];
    if (instanceId) {
      scopeConditions.push("channel_records.instance_id = ?");
      scopeParameters.push(instanceId);
    }
    if (scopeMemberId) {
      scopeConditions.push("channel_records.member_id = ?");
      scopeParameters.push(scopeMemberId);
    }
    const filterConditions = [];
    const filterParameters = [];
    if (memberId) {
      filterConditions.push("channel_records.member_id = ?");
      filterParameters.push(memberId);
    }
    const normalizedSearch = String(search).trim();
    if (normalizedSearch) {
      const searchConditions = [
        "channel_records.channel_name LIKE ? ESCAPE '\\'",
        "channel_records.key_fingerprint = ?",
      ];
      filterParameters.push(`%${escapeLikePattern(normalizedSearch)}%`, createKeyFingerprint(normalizedSearch));
      if (/^\d{1,15}$/.test(normalizedSearch)) {
        searchConditions.push("channel_records.new_api_channel_id = ?");
        filterParameters.push(Number(normalizedSearch));
      }
      filterConditions.push(`(${searchConditions.join(" OR ")})`);
    }
    const normalizedChannelName = String(channelName).trim();
    if (normalizedChannelName) {
      filterConditions.push("channel_records.channel_name LIKE ? ESCAPE '\\'");
      filterParameters.push(`%${escapeLikePattern(normalizedChannelName)}%`);
    }
    const normalizedKey = String(key).trim();
    if (normalizedKey) {
      filterConditions.push("channel_records.key_fingerprint = ?");
      filterParameters.push(createKeyFingerprint(normalizedKey));
    }
    const normalizedModel = String(model).trim();
    if (normalizedModel) {
      filterConditions.push("channel_records.models LIKE ? ESCAPE '\\'");
      filterParameters.push(`%${escapeLikePattern(normalizedModel)}%`);
    }
    if (statusLabel) {
      filterConditions.push("channel_records.status_label = ?");
      filterParameters.push(statusLabel);
    }
    if (channelKind === UNKNOWN_CHANNEL_KIND) {
      filterConditions.push(
        `(channel_records.channel_type IS NULL OR channel_records.channel_type NOT IN (${
          Object.values(CHANNEL_TYPES_BY_KIND).join(", ")
        }))`,
      );
    } else if (channelKind) {
      filterConditions.push("channel_records.channel_type = ?");
      filterParameters.push(CHANNEL_TYPES_BY_KIND[channelKind]);
    }
    if (group) {
      filterConditions.push("channel_records.group_name = ?");
      filterParameters.push(group);
    }

    const allConditions = [...scopeConditions, ...filterConditions];
    const whereClause = allConditions.length > 0 ? `WHERE ${allConditions.join(" AND ")}` : "";
    const queryParameters = [...scopeParameters, ...filterParameters];
    const requestedPage = Math.max(1, Number(page));
    const normalizedPageSize = Math.max(1, Number(pageSize));
    const summary = this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(channel_records.balance_usd), 0) AS total_balance_usd,
        COALESCE(SUM(channel_records.used_usd), 0) AS total_used_usd
      FROM channel_records
      ${whereClause}
    `).get(...queryParameters);
    const total = Number(summary.total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
    const normalizedPage = Math.min(requestedPage, totalPages);
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const sortColumn = RECORD_SORT_COLUMNS[sort] ?? RECORD_SORT_COLUMNS.importedAt;
    const sortDirection = order === "asc" ? "ASC" : "DESC";
    const records = this.database.prepare(`
      SELECT channel_records.*${includeInstanceName
        ? ", new_api_instances.name AS instance_name, instance_members.name AS member_name"
        : ""}
      FROM channel_records
      ${includeInstanceName ? `INNER JOIN new_api_instances
        ON new_api_instances.id = channel_records.instance_id
      LEFT JOIN instance_members
        ON instance_members.id = channel_records.member_id` : ""}
      ${whereClause}
      ORDER BY ${sortColumn} ${sortDirection}, channel_records.id ${sortDirection}
      LIMIT ? OFFSET ?
    `).all(...queryParameters, normalizedPageSize, offset)
      .map(includeInstanceName ? mapAdministratorChannelRecord : mapChannelRecord);

    return {
      records,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total,
      totalPages,
      totalBalanceUsd: Number(summary.total_balance_usd) || 0,
      totalUsedUsd: Number(summary.total_used_usd) || 0,
      facets: this.countRecordFacets({
        scopeConditions,
        scopeParameters,
        includeInstances: includeInstanceName,
      }),
    };
  }

  countRecordFacets({ scopeConditions, scopeParameters, includeInstances }) {
    const scopeClause = scopeConditions.length > 0
      ? `WHERE ${scopeConditions.join(" AND ")}`
      : "";
    const countBy = (columnName) => this.database.prepare(`
      SELECT ${columnName} AS value, COUNT(*) AS count
      FROM channel_records ${scopeClause}
      GROUP BY ${columnName}
    `).all(...scopeParameters);
    const channelKindCounts = {};
    for (const { value, count } of countBy("channel_records.channel_type")) {
      const kind = getChannelKind(value);
      channelKindCounts[kind] = (channelKindCounts[kind] || 0) + Number(count);
    }
    return {
      statuses: countBy("channel_records.status_label")
        .map(({ value, count }) => ({ value, count: Number(count) })),
      channelKinds: Object.entries(channelKindCounts)
        .map(([value, count]) => ({ value, count })),
      groups: countBy("channel_records.group_name")
        .map(({ value, count }) => ({ value, count: Number(count) }))
        .sort((first, second) => second.count - first.count || first.value.localeCompare(second.value)),
      ...(includeInstances ? {
        instances: this.database.prepare(`
          SELECT instance_id AS value, COUNT(*) AS count
          FROM channel_records GROUP BY instance_id
        `).all().map(({ value, count }) => ({ value: Number(value), count: Number(count) })),
        members: this.database.prepare(`
          SELECT instance_members.id AS value, instance_members.instance_id,
                 instance_members.name AS member_name,
                 new_api_instances.name AS instance_name, COUNT(channel_records.id) AS count
          FROM instance_members
          INNER JOIN new_api_instances ON new_api_instances.id = instance_members.instance_id
          LEFT JOIN channel_records ON channel_records.member_id = instance_members.id
          GROUP BY instance_members.id
          ORDER BY new_api_instances.created_at, instance_members.created_at
        `).all().map(({ value, instance_id: memberInstanceId, member_name: memberName, instance_name: instanceName, count }) => ({
          value: Number(value),
          instanceId: Number(memberInstanceId),
          label: `${instanceName} · ${memberName}`,
          count: Number(count),
        })),
      } : {}),
    };
  }

  synchronizeChannels({ instanceId, channels, quotaPerUnit }) {
    const synchronizedAt = new Date().toISOString();
    const channelsById = new Map(channels.map((channel) => [Number(channel.id), channel]));
    const records = this.database.prepare(`
      SELECT id, member_id, new_api_channel_id, channel_name, key_mask, used_usd
      FROM channel_records
      WHERE instance_id = ?
    `).all(Number(instanceId));
    const updateStatement = this.database.prepare(`
      UPDATE channel_records
      SET channel_name = ?, channel_type = COALESCE(?, channel_type), group_name = ?,
          models = ?, status = ?, status_label = ?, balance_usd = ?, used_quota = ?,
          used_usd = ?, last_synced_at = ?
      WHERE id = ?
    `);
    const markMissingStatement = this.database.prepare(`
      UPDATE channel_records
      SET status = -1, status_label = 'missing', last_synced_at = ? WHERE id = ?
    `);
    let synchronizedCount = 0;
    let missingCount = 0;
    const usageStartedRecords = [];
    const memberCounts = new Map();
    const countMemberRecord = (memberId, countName) => {
      const counts = memberCounts.get(memberId) ?? { synchronizedCount: 0, missingCount: 0 };
      counts[countName] += 1;
      memberCounts.set(memberId, counts);
    };
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const record of records) {
        const channel = channelsById.get(Number(record.new_api_channel_id));
        if (!channel) {
          markMissingStatement.run(synchronizedAt, record.id);
          missingCount += 1;
          countMemberRecord(record.member_id, "missingCount");
          continue;
        }
        const usedQuota = Number(channel.used_quota) || 0;
        const usedUsd = convertQuotaToUsd(usedQuota, quotaPerUnit);
        updateStatement.run(
          channel.name,
          normalizeChannelType(channel.type),
          channel.group || "",
          channel.models || "",
          Number(channel.status) || 0,
          getStatusLabel(channel.status),
          Number(channel.balance) || 0,
          usedQuota,
          usedUsd,
          synchronizedAt,
          record.id,
        );
        if ((Number(record.used_usd) || 0) <= 0 && usedUsd > 0) {
          usageStartedRecords.push({
            recordId: record.id,
            memberId: record.member_id,
            channelName: channel.name || record.channel_name,
            keyMask: record.key_mask,
            usedUsd,
          });
        }
        synchronizedCount += 1;
        countMemberRecord(record.member_id, "synchronizedCount");
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      synchronizedCount,
      missingCount,
      synchronizedAt,
      usageStartedRecords,
      memberCounts,
    };
  }

  close() {
    this.database.close();
  }
}
