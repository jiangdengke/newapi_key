import { isAbsolute, resolve } from "node:path";

import { createLogger } from "./logger.js";
import { NewApiClient } from "./new-api-client.js";
import { parseCredentialEncryptionKey } from "./security.js";
import { ApplicationStore } from "./application-store.js";
import {
  normalizeNewApiBaseUrl,
  validateChannelDefaults,
  validateConnectionInput,
} from "./validation.js";

const SYSTEM_STATUS_CACHE_MILLISECONDS = 5 * 60 * 1_000;
const GLOBAL_CONTEXT_KEY = Symbol.for("newapi-key.runtime-context");

export function resolveDatabasePath(
  rawDatabasePath = process.env.DATABASE_PATH,
  applicationRootPath = process.env.APPLICATION_ROOT_PATH
    || process.env.INIT_CWD
    || process.cwd(),
) {
  const databasePath = String(rawDatabasePath || "data/channel-records.sqlite").trim();
  if (databasePath === ":memory:" || isAbsolute(databasePath)) {
    return databasePath;
  }
  return resolve(applicationRootPath, databasePath);
}

function loadInitialInstance() {
  const hasAnyLegacyConnectionSetting = [
    process.env.NEW_API_BASE_URL,
    process.env.NEW_API_USERNAME,
    process.env.NEW_API_PASSWORD,
  ].some((value) => String(value || "").trim());
  if (!hasAnyLegacyConnectionSetting) {
    return null;
  }

  const connection = validateConnectionInput({
    baseUrl: process.env.NEW_API_BASE_URL,
    username: process.env.NEW_API_USERNAME,
    password: process.env.NEW_API_PASSWORD,
  });
  const channelDefaults = validateChannelDefaults({
    group: process.env.CHANNEL_GROUP,
    namePrefix: process.env.CHANNEL_NAME_PREFIX,
    startNumber: process.env.CHANNEL_START_NUMBER,
    continueFromExisting: process.env.CHANNEL_CONTINUE_FROM_EXISTING,
    priority: process.env.CHANNEL_PRIORITY,
    weight: process.env.CHANNEL_WEIGHT,
    dateMode: process.env.CHANNEL_DATE_MODE,
  });
  return {
    name: String(process.env.NEW_API_INSTANCE_NAME || "初始 New API").trim(),
    baseUrl: normalizeNewApiBaseUrl(connection.baseUrl),
    username: connection.username,
    password: connection.password,
    group: channelDefaults.group,
    namePrefix: channelDefaults.namePrefix,
    startNumber: channelDefaults.startNumber,
    continueFromExisting: channelDefaults.continueFromExisting,
    priority: channelDefaults.priority,
    weight: channelDefaults.weight,
    dateMode: channelDefaults.dateMode,
  };
}

function createRuntimeContext() {
  const logger = createLogger();
  const databasePath = resolveDatabasePath();
  const store = new ApplicationStore({
    databasePath,
    encryptionKey: parseCredentialEncryptionKey(process.env.CREDENTIAL_ENCRYPTION_KEY),
    initialInstance: loadInitialInstance(),
    bootstrapAdmin: {
      username: String(process.env.BOOTSTRAP_ADMIN_USERNAME || "").trim(),
      password: String(process.env.BOOTSTRAP_ADMIN_PASSWORD || ""),
    },
  });

  return {
    store,
    logger,
    instanceRuntimes: new Map(),
    loginAttempts: new Map(),
    accessAttempts: new Map(),
  };
}

export function getRuntimeContext() {
  if (!globalThis[GLOBAL_CONTEXT_KEY]) {
    globalThis[GLOBAL_CONTEXT_KEY] = createRuntimeContext();
  }
  return globalThis[GLOBAL_CONTEXT_KEY];
}

export function clearInstanceRuntime(instanceId) {
  getRuntimeContext().instanceRuntimes.delete(Number(instanceId));
}

export function getInstanceRuntime(instanceId) {
  const context = getRuntimeContext();
  const connection = context.store.getInstanceConnection(instanceId);
  if (!connection) {
    return null;
  }
  const existingRuntime = context.instanceRuntimes.get(Number(instanceId));
  if (existingRuntime?.configurationVersion === connection.updatedAt) {
    return existingRuntime;
  }

  const runtime = {
    connection,
    configurationVersion: connection.updatedAt,
    client: new NewApiClient({
      baseUrl: connection.baseUrl,
      logger: context.logger,
    }),
    authenticatedUser: null,
    authenticationPromise: null,
    systemStatusCache: { value: null, expiresAt: 0 },
  };
  context.instanceRuntimes.set(Number(instanceId), runtime);
  return runtime;
}

export async function getInstanceSystemStatus(instanceRuntime) {
  const currentTime = Date.now();
  if (
    instanceRuntime.systemStatusCache.value
    && instanceRuntime.systemStatusCache.expiresAt > currentTime
  ) {
    return instanceRuntime.systemStatusCache.value;
  }
  const systemStatus = await instanceRuntime.client.getStatus();
  instanceRuntime.systemStatusCache.value = systemStatus;
  instanceRuntime.systemStatusCache.expiresAt = currentTime
    + SYSTEM_STATUS_CACHE_MILLISECONDS;
  return systemStatus;
}

export async function getInstanceAuthenticatedUser(instanceRuntime) {
  if (instanceRuntime.authenticatedUser) {
    return instanceRuntime.authenticatedUser;
  }
  if (!instanceRuntime.authenticationPromise) {
    instanceRuntime.authenticationPromise = instanceRuntime.client.login(
      instanceRuntime.connection.adminUsername,
      instanceRuntime.connection.password,
    );
  }
  try {
    instanceRuntime.authenticatedUser = await instanceRuntime.authenticationPromise;
    return instanceRuntime.authenticatedUser;
  } finally {
    instanceRuntime.authenticationPromise = null;
  }
}
