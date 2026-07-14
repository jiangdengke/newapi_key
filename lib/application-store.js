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

const ADMINISTRATOR_SESSION_LIFETIME_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const VISITOR_SESSION_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1_000;
const CURRENT_SCHEMA_VERSION = 6;

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
  };
}

function mapInstance(databaseRecord) {
  return {
    id: databaseRecord.id,
    name: databaseRecord.name,
    baseUrl: databaseRecord.base_url,
    adminUsername: databaseRecord.admin_username,
    connectionProtocol: databaseRecord.connection_protocol,
    adminHubTargetSiteId: databaseRecord.admin_hub_target_site_id,
    group: databaseRecord.channel_group,
    namePrefix: databaseRecord.name_prefix,
    startNumber: databaseRecord.start_number,
    continueFromExisting: databaseRecord.continue_from_existing === 1,
    priority: databaseRecord.channel_priority,
    weight: databaseRecord.channel_weight,
    dateMode: databaseRecord.date_mode,
    enabled: databaseRecord.enabled === 1,
    channelRecordCount: Number(databaseRecord.channel_record_count ?? 0),
    accessKey: {
      configured: Boolean(databaseRecord.access_key_mask),
      enabled: databaseRecord.access_key_enabled === 1,
      mask: databaseRecord.access_key_mask || null,
      createdAt: databaseRecord.access_key_created_at || null,
    },
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
        connection_protocol TEXT NOT NULL DEFAULT 'new-api',
        admin_hub_target_site_id INTEGER,
        channel_group TEXT NOT NULL,
        name_prefix TEXT NOT NULL,
        start_number INTEGER NOT NULL,
        continue_from_existing INTEGER NOT NULL,
        channel_priority INTEGER NOT NULL DEFAULT 0,
        channel_weight INTEGER NOT NULL DEFAULT 0,
        date_mode TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        access_key_digest TEXT,
        access_key_mask TEXT,
        access_key_enabled INTEGER NOT NULL DEFAULT 0,
        access_key_version INTEGER NOT NULL DEFAULT 0,
        access_key_created_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
        access_key_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (instance_id) REFERENCES new_api_instances(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS channel_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id INTEGER,
        new_api_base_url TEXT NOT NULL,
        new_api_channel_id INTEGER NOT NULL,
        channel_name TEXT NOT NULL,
        key_mask TEXT NOT NULL,
        key_fingerprint TEXT NOT NULL,
        encrypted_key TEXT,
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
    if (!hasColumn(this.database, "channel_records", "balance_usd")) {
      this.database.exec(`
        ALTER TABLE channel_records ADD COLUMN balance_usd REAL NOT NULL DEFAULT 0
      `);
    }
    const accessKeyColumns = [
      ["access_key_digest", "TEXT"],
      ["access_key_mask", "TEXT"],
      ["access_key_enabled", "INTEGER NOT NULL DEFAULT 0"],
      ["access_key_version", "INTEGER NOT NULL DEFAULT 0"],
      ["access_key_created_at", "TEXT"],
    ];
    for (const [columnName, columnDefinition] of accessKeyColumns) {
      if (!hasColumn(this.database, "new_api_instances", columnName)) {
        this.database.exec(`
          ALTER TABLE new_api_instances ADD COLUMN ${columnName} ${columnDefinition}
        `);
      }
    }
    const channelRoutingColumns = [
      ["channel_priority", "INTEGER NOT NULL DEFAULT 0"],
      ["channel_weight", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [columnName, columnDefinition] of channelRoutingColumns) {
      if (!hasColumn(this.database, "new_api_instances", columnName)) {
        this.database.exec(`
          ALTER TABLE new_api_instances ADD COLUMN ${columnName} ${columnDefinition}
        `);
      }
    }
    const connectionProtocolColumns = [
      ["connection_protocol", "TEXT NOT NULL DEFAULT 'new-api'"],
      ["admin_hub_target_site_id", "INTEGER"],
    ];
    for (const [columnName, columnDefinition] of connectionProtocolColumns) {
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
      CREATE UNIQUE INDEX IF NOT EXISTS new_api_instances_access_key_digest_unique
      ON new_api_instances(access_key_digest)
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
        connection_protocol, admin_hub_target_site_id,
        channel_group, name_prefix, start_number,
        continue_from_existing, channel_priority, channel_weight,
        date_mode, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      instanceInput.name,
      instanceInput.baseUrl,
      instanceInput.username,
      encryptCredential(instanceInput.password, this.encryptionKey),
      instanceInput.connectionProtocol ?? "new-api",
      instanceInput.adminHubTargetSiteId ?? null,
      instanceInput.group,
      instanceInput.namePrefix,
      instanceInput.startNumber,
      instanceInput.continueFromExisting ? 1 : 0,
      instanceInput.priority ?? 0,
      instanceInput.weight ?? 0,
      instanceInput.dateMode,
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
             ) AS channel_record_count
      FROM new_api_instances
      ORDER BY created_at ASC, id ASC
    `).all().map(mapInstance);
  }

  getInstance(instanceId) {
    const databaseRecord = this.database.prepare(`
      SELECT * FROM new_api_instances WHERE id = ?
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
            connection_protocol = ?, admin_hub_target_site_id = ?,
            channel_group = ?, name_prefix = ?, start_number = ?,
            continue_from_existing = ?, channel_priority = ?, channel_weight = ?,
            date_mode = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `).run(
        instanceInput.name,
        instanceInput.baseUrl,
        instanceInput.username,
        encryptedPassword,
        instanceInput.connectionProtocol ?? existingRecord.connection_protocol,
        instanceInput.connectionProtocol === "new-api"
          ? null
          : instanceInput.adminHubTargetSiteId
            ?? existingRecord.admin_hub_target_site_id,
        instanceInput.group,
        instanceInput.namePrefix,
        instanceInput.startNumber,
        instanceInput.continueFromExisting ? 1 : 0,
        instanceInput.priority ?? 0,
        instanceInput.weight ?? 0,
        instanceInput.dateMode,
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

  regenerateInstanceAccessKey(instanceId) {
    const accessKey = createInstanceAccessKey();
    const createdAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`
        UPDATE new_api_instances
        SET access_key_digest = ?, access_key_mask = ?, access_key_enabled = 1,
            access_key_version = access_key_version + 1,
            access_key_created_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        hashInstanceAccessKey(accessKey),
        maskInstanceAccessKey(accessKey),
        createdAt,
        createdAt,
        Number(instanceId),
      );
      if (result.changes === 0) {
        this.database.exec("ROLLBACK");
        return null;
      }
      this.database.prepare(`
        DELETE FROM visitor_sessions WHERE instance_id = ?
      `).run(Number(instanceId));
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { instance: this.getInstance(instanceId), accessKey };
  }

  disableInstanceAccessKey(instanceId) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`
        UPDATE new_api_instances
        SET access_key_digest = NULL, access_key_enabled = 0,
            access_key_version = access_key_version + 1, updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), Number(instanceId));
      if (result.changes === 0) {
        this.database.exec("ROLLBACK");
        return null;
      }
      this.database.prepare(`
        DELETE FROM visitor_sessions WHERE instance_id = ?
      `).run(Number(instanceId));
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getInstance(instanceId);
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
      const instanceRecord = this.database.prepare(`
        SELECT * FROM new_api_instances
        WHERE access_key_digest = ? AND access_key_enabled = 1 AND enabled = 1
      `).get(hashInstanceAccessKey(accessKey));
      if (!instanceRecord) {
        this.database.exec("ROLLBACK");
        return null;
      }
      this.database.prepare("DELETE FROM visitor_sessions WHERE expires_at <= ?").run(
        createdAt.toISOString(),
      );
      this.database.prepare(`
        INSERT INTO visitor_sessions (
          token_hash, instance_id, access_key_version, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        hashSessionToken(sessionToken),
        instanceRecord.id,
        instanceRecord.access_key_version,
        createdAt.toISOString(),
        expiresAt.toISOString(),
      );
      this.database.exec("COMMIT");
      return {
        token: sessionToken,
        expiresAt,
        principal: mapVisitor({
          instance_id: instanceRecord.id,
          instance_name: instanceRecord.name,
        }),
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
      SELECT visitor_sessions.instance_id, new_api_instances.name AS instance_name
      FROM visitor_sessions
      INNER JOIN new_api_instances
        ON new_api_instances.id = visitor_sessions.instance_id
      WHERE visitor_sessions.token_hash = ?
        AND visitor_sessions.expires_at > ?
        AND visitor_sessions.access_key_version = new_api_instances.access_key_version
        AND new_api_instances.enabled = 1
        AND new_api_instances.access_key_enabled = 1
        AND new_api_instances.access_key_digest IS NOT NULL
    `).get(tokenHash, currentTimestamp);
    return visitorRecord ? mapVisitor(visitorRecord) : null;
  }

  hasImportedKey(instanceId, key) {
    return this.database.prepare(`
      SELECT 1 FROM channel_records
      WHERE instance_id = ? AND key_fingerprint = ? LIMIT 1
    `).get(Number(instanceId), createKeyFingerprint(key)) !== undefined;
  }

  recordImportedChannel({ instanceId, baseUrl, key, channel, quotaPerUnit }) {
    const importedAt = new Date().toISOString();
    const balanceUsd = Number(channel.balance) || 0;
    const usedQuota = Number(channel.used_quota) || 0;
    const encryptedKey = encryptCredential(key, this.encryptionKey);
    this.database.prepare(`
      INSERT INTO channel_records (
        instance_id, new_api_base_url, new_api_channel_id, channel_name,
        key_mask, key_fingerprint, encrypted_key, group_name, models, status,
        status_label, balance_usd, used_quota, used_usd, imported_at, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (new_api_base_url, new_api_channel_id) DO UPDATE SET
        instance_id = excluded.instance_id,
        channel_name = excluded.channel_name,
        key_mask = excluded.key_mask,
        key_fingerprint = excluded.key_fingerprint,
        encrypted_key = excluded.encrypted_key,
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
      baseUrl,
      Number(channel.id),
      channel.name,
      createKeyMask(key),
      createKeyFingerprint(key),
      encryptedKey,
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

  listRecords(instanceId) {
    return this.database.prepare(`
      SELECT * FROM channel_records
      WHERE instance_id = ? ORDER BY imported_at DESC, id DESC
    `).all(Number(instanceId)).map(mapChannelRecord);
  }

  queryRecords({ instanceId, key = "", page = 1, pageSize = 10 }) {
    const requestedPage = Math.max(1, Number(page));
    const normalizedPageSize = Math.max(1, Number(pageSize));
    const normalizedKey = String(key).trim();
    const queryParameters = normalizedKey
      ? [Number(instanceId), createKeyFingerprint(normalizedKey)]
      : [Number(instanceId)];
    const keyCondition = normalizedKey ? " AND key_fingerprint = ?" : "";
    const summary = this.database.prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(balance_usd), 0) AS total_balance_usd,
             COALESCE(SUM(used_usd), 0) AS total_used_usd
      FROM channel_records WHERE instance_id = ?${keyCondition}
    `).get(...queryParameters);
    const total = Number(summary.total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
    const normalizedPage = Math.min(requestedPage, totalPages);
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const records = this.database.prepare(`
      SELECT * FROM channel_records
      WHERE instance_id = ?${keyCondition}
      ORDER BY imported_at DESC, id DESC LIMIT ? OFFSET ?
    `).all(...queryParameters, normalizedPageSize, offset).map(mapChannelRecord);
    return {
      records,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total,
      totalPages,
      totalBalanceUsd: Number(summary.total_balance_usd) || 0,
      totalUsedUsd: Number(summary.total_used_usd) || 0,
    };
  }

  queryAdministratorRecords({
    instanceId = null,
    channelName = "",
    key = "",
    page = 1,
    pageSize = 10,
  }) {
    const normalizedInstanceId = instanceId ? Number(instanceId) : null;
    const normalizedChannelName = String(channelName).trim();
    const normalizedKey = String(key).trim();
    const requestedPage = Math.max(1, Number(page));
    const normalizedPageSize = Math.max(1, Number(pageSize));
    const conditions = [];
    const queryParameters = [];

    if (normalizedInstanceId) {
      conditions.push("channel_records.instance_id = ?");
      queryParameters.push(normalizedInstanceId);
    }
    if (normalizedChannelName) {
      conditions.push("channel_records.channel_name LIKE ? ESCAPE '\\'");
      queryParameters.push(
        `%${normalizedChannelName.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`,
      );
    }
    if (normalizedKey) {
      conditions.push("channel_records.key_fingerprint = ?");
      queryParameters.push(createKeyFingerprint(normalizedKey));
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";
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
    const records = this.database.prepare(`
      SELECT channel_records.*, new_api_instances.name AS instance_name
      FROM channel_records
      INNER JOIN new_api_instances
        ON new_api_instances.id = channel_records.instance_id
      ${whereClause}
      ORDER BY channel_records.imported_at DESC, channel_records.id DESC
      LIMIT ? OFFSET ?
    `).all(
      ...queryParameters,
      normalizedPageSize,
      offset,
    ).map(mapAdministratorChannelRecord);

    return {
      records,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total,
      totalPages,
      totalBalanceUsd: Number(summary.total_balance_usd) || 0,
      totalUsedUsd: Number(summary.total_used_usd) || 0,
    };
  }

  synchronizeChannels({ instanceId, channels, quotaPerUnit }) {
    const synchronizedAt = new Date().toISOString();
    const channelsById = new Map(channels.map((channel) => [Number(channel.id), channel]));
    const records = this.database.prepare(`
      SELECT id, new_api_channel_id FROM channel_records WHERE instance_id = ?
    `).all(Number(instanceId));
    const updateStatement = this.database.prepare(`
      UPDATE channel_records
      SET channel_name = ?, group_name = ?, models = ?, status = ?,
          status_label = ?, balance_usd = ?, used_quota = ?, used_usd = ?, last_synced_at = ?
      WHERE id = ?
    `);
    const markMissingStatement = this.database.prepare(`
      UPDATE channel_records
      SET status = -1, status_label = 'missing', last_synced_at = ? WHERE id = ?
    `);
    let synchronizedCount = 0;
    let missingCount = 0;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const record of records) {
        const channel = channelsById.get(Number(record.new_api_channel_id));
        if (!channel) {
          markMissingStatement.run(synchronizedAt, record.id);
          missingCount += 1;
          continue;
        }
        const usedQuota = Number(channel.used_quota) || 0;
        updateStatement.run(
          channel.name,
          channel.group || "",
          channel.models || "",
          Number(channel.status) || 0,
          getStatusLabel(channel.status),
          Number(channel.balance) || 0,
          usedQuota,
          convertQuotaToUsd(usedQuota, quotaPerUnit),
          synchronizedAt,
          record.id,
        );
        synchronizedCount += 1;
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { synchronizedCount, missingCount, synchronizedAt };
  }

  close() {
    this.database.close();
  }
}
