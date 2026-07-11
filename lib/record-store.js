import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
    return 0;
  }
  return normalizedQuota / normalizedQuotaPerUnit;
}

function mapRecord(databaseRecord) {
  return {
    id: databaseRecord.id,
    newApiChannelId: databaseRecord.new_api_channel_id,
    channelName: databaseRecord.channel_name,
    keyMask: databaseRecord.key_mask,
    group: databaseRecord.group_name,
    models: databaseRecord.models.split(",").filter(Boolean),
    status: databaseRecord.status,
    statusLabel: databaseRecord.status_label,
    usedQuota: databaseRecord.used_quota,
    usedUsd: databaseRecord.used_usd,
    importedAt: databaseRecord.imported_at,
    lastSyncedAt: databaseRecord.last_synced_at,
  };
}

export class ChannelRecordStore {
  constructor(databasePath) {
    if (databasePath !== ":memory:") {
      mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS channel_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        UNIQUE (new_api_base_url, new_api_channel_id),
        UNIQUE (new_api_base_url, channel_name),
        UNIQUE (new_api_base_url, key_fingerprint)
      )
    `);
  }

  hasImportedKey(baseUrl, key) {
    const matchingRecord = this.database.prepare(`
      SELECT 1
      FROM channel_records
      WHERE new_api_base_url = ? AND key_fingerprint = ?
      LIMIT 1
    `).get(baseUrl, createKeyFingerprint(key));
    return matchingRecord !== undefined;
  }

  recordImportedChannel({ baseUrl, key, channel, quotaPerUnit }) {
    const importedAt = new Date().toISOString();
    const usedQuota = Number(channel.used_quota) || 0;
    this.database.prepare(`
      INSERT INTO channel_records (
        new_api_base_url,
        new_api_channel_id,
        channel_name,
        key_mask,
        key_fingerprint,
        group_name,
        models,
        status,
        status_label,
        used_quota,
        used_usd,
        imported_at,
        last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (new_api_base_url, new_api_channel_id) DO UPDATE SET
        channel_name = excluded.channel_name,
        key_mask = excluded.key_mask,
        key_fingerprint = excluded.key_fingerprint,
        group_name = excluded.group_name,
        models = excluded.models,
        status = excluded.status,
        status_label = excluded.status_label,
        used_quota = excluded.used_quota,
        used_usd = excluded.used_usd,
        last_synced_at = excluded.last_synced_at
    `).run(
      baseUrl,
      Number(channel.id),
      channel.name,
      createKeyMask(key),
      createKeyFingerprint(key),
      channel.group || "",
      channel.models || "",
      Number(channel.status) || 0,
      getStatusLabel(channel.status),
      usedQuota,
      convertQuotaToUsd(usedQuota, quotaPerUnit),
      importedAt,
      importedAt,
    );
  }

  synchronizeChannels({ baseUrl, channels, quotaPerUnit }) {
    const synchronizedAt = new Date().toISOString();
    const channelsById = new Map(
      channels.map((channel) => [Number(channel.id), channel]),
    );
    const records = this.database.prepare(`
      SELECT id, new_api_channel_id
      FROM channel_records
      WHERE new_api_base_url = ?
    `).all(baseUrl);
    const updateStatement = this.database.prepare(`
      UPDATE channel_records
      SET channel_name = ?,
          group_name = ?,
          models = ?,
          status = ?,
          status_label = ?,
          used_quota = ?,
          used_usd = ?,
          last_synced_at = ?
      WHERE id = ?
    `);
    const markMissingStatement = this.database.prepare(`
      UPDATE channel_records
      SET status = -1,
          status_label = 'missing',
          last_synced_at = ?
      WHERE id = ?
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

  listRecords(baseUrl) {
    return this.database.prepare(`
      SELECT *
      FROM channel_records
      WHERE new_api_base_url = ?
      ORDER BY imported_at DESC, id DESC
    `).all(baseUrl).map(mapRecord);
  }

  queryRecords({ baseUrl, key = "", page = 1, pageSize = 10 }) {
    const requestedPage = Math.max(1, Number(page));
    const normalizedPageSize = Math.max(1, Number(pageSize));
    const normalizedKey = String(key).trim();
    const queryParameters = normalizedKey
      ? [baseUrl, createKeyFingerprint(normalizedKey)]
      : [baseUrl];
    const keyCondition = normalizedKey ? " AND key_fingerprint = ?" : "";
    const summary = this.database.prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(used_usd), 0) AS total_used_usd
      FROM channel_records
      WHERE new_api_base_url = ?${keyCondition}
    `).get(...queryParameters);
    const total = Number(summary.total) || 0;
    const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize));
    const normalizedPage = Math.min(requestedPage, totalPages);
    const offset = (normalizedPage - 1) * normalizedPageSize;
    const records = this.database.prepare(`
      SELECT *
      FROM channel_records
      WHERE new_api_base_url = ?${keyCondition}
      ORDER BY imported_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...queryParameters, normalizedPageSize, offset).map(mapRecord);

    return {
      records,
      page: normalizedPage,
      pageSize: normalizedPageSize,
      total,
      totalPages,
      totalUsedUsd: Number(summary.total_used_usd) || 0,
    };
  }

  close() {
    this.database.close();
  }
}

export const keySecurity = Object.freeze({
  createKeyFingerprint,
  createKeyMask,
});
