import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadEnvFile } from "node:process";

import { NewApiClient } from "./lib/new-api-client.js";
import { createLogger } from "./lib/logger.js";
import { ChannelRecordStore } from "./lib/record-store.js";
import {
  buildSequentialChannelNames,
  CLAUDE_MODELS,
  redactSensitiveText,
  validateChannelDefaults,
  validateConnectionInput,
  validateImportInput,
  ValidationError,
} from "./lib/validation.js";

const DEFAULT_SERVER_HOST = "127.0.0.1";
const DEFAULT_SERVER_PORT = 4173;
const APPLICATION_VERSION = "1.0.0";
const MAXIMUM_REQUEST_BODY_BYTES = 9 * 1024 * 1024;
const MAXIMUM_RECORD_QUERY_KEY_LENGTH = 16_384;
const MAXIMUM_RECORD_PAGE_SIZE = 100;
const SYSTEM_STATUS_CACHE_MILLISECONDS = 5 * 60 * 1_000;
const CURRENT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIRECTORY = join(CURRENT_DIRECTORY, "public");

const STATIC_FILES = new Map([
  ["/", { path: join(PUBLIC_DIRECTORY, "index.html"), contentType: "text/html; charset=utf-8" }],
  ["/app.js", { path: join(PUBLIC_DIRECTORY, "app.js"), contentType: "text/javascript; charset=utf-8" }],
  ["/styles.css", { path: join(PUBLIC_DIRECTORY, "styles.css"), contentType: "text/css; charset=utf-8" }],
]);

class RequestBodyError extends Error {}

function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}

function sendJson(response, statusCode, responseBody) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(responseBody));
}

function writeProgressEvent(response, event) {
  response.write(`${JSON.stringify(event)}\n`);
}

async function readJsonBody(request) {
  const bodyChunks = [];
  let totalBodyBytes = 0;

  for await (const bodyChunk of request) {
    totalBodyBytes += bodyChunk.length;
    if (totalBodyBytes > MAXIMUM_REQUEST_BODY_BYTES) {
      throw new RequestBodyError("请求内容过大");
    }
    bodyChunks.push(bodyChunk);
  }

  if (bodyChunks.length === 0) {
    throw new RequestBodyError("请求内容不能为空");
  }

  try {
    return JSON.parse(Buffer.concat(bodyChunks).toString("utf8"));
  } catch {
    throw new RequestBodyError("请求内容不是有效的 JSON");
  }
}

async function getSystemStatus(applicationContext) {
  const currentTime = applicationContext.getCurrentTime();
  const cachedSystemStatus = applicationContext.systemStatusCache;
  if (cachedSystemStatus.value && cachedSystemStatus.expiresAt > currentTime) {
    return cachedSystemStatus.value;
  }

  const systemStatus = await applicationContext.newApiClient.getStatus();
  cachedSystemStatus.value = systemStatus;
  cachedSystemStatus.expiresAt = currentTime + SYSTEM_STATUS_CACHE_MILLISECONDS;
  return systemStatus;
}

async function getAuthenticatedUser(applicationContext) {
  if (applicationContext.authenticatedUser) {
    return applicationContext.authenticatedUser;
  }

  if (!applicationContext.authenticationPromise) {
    const { connectionInput, newApiClient } = applicationContext;
    applicationContext.authenticationPromise = newApiClient.login(
      connectionInput.username,
      connectionInput.password,
    );
  }

  try {
    applicationContext.authenticatedUser = await applicationContext.authenticationPromise;
    return applicationContext.authenticatedUser;
  } finally {
    applicationContext.authenticationPromise = null;
  }
}

async function handleConnectionTest(request, response, applicationContext) {
  await readJsonBody(request);
  const { connectionInput, newApiClient } = applicationContext;
  try {
    const systemStatus = await getSystemStatus(applicationContext);
    const loggedInUser = await getAuthenticatedUser(applicationContext);
    const channelNames = await newApiClient.listAllChannelNames();

    sendJson(response, 200, {
      success: true,
      data: {
        systemName: systemStatus?.system_name || "New API",
        version: systemStatus?.version || "未知版本",
        username: loggedInUser.username,
        anthropicChannelCount: channelNames.length,
      },
    });
  } catch (error) {
    throw new Error(
      redactSensitiveText(error?.message, [connectionInput.password]),
    );
  }
}

async function handleImport(request, response, applicationContext) {
  const startedAt = Date.now();
  const requestBody = await readJsonBody(request);
  const { channelDefaults, connectionInput, recordStore } = applicationContext;
  const importInput = validateImportInput({
    keys: requestBody?.keys,
    group: channelDefaults.group,
    namePrefix: channelDefaults.namePrefix,
    dateSegment: channelDefaults.dateSegment,
    startNumber: channelDefaults.startNumber,
    continueFromExisting: channelDefaults.continueFromExisting,
  });

  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Transfer-Encoding": "chunked",
  });

  const sensitiveValues = [connectionInput.password, ...importInput.keys];
  let completedCount = 0;
  let successCount = 0;
  let failureCount = 0;
  let fatalFailure = false;

  applicationContext.logger.info("channel_import_started", {
    requestId: request.requestId,
    total: importInput.keys.length,
  });

  try {
    const { newApiClient } = applicationContext;
    const systemStatus = await getSystemStatus(applicationContext);
    const loggedInUser = await getAuthenticatedUser(applicationContext);
    const channelNamePrefix = `${importInput.namePrefix}-${importInput.dateSegment}-`;
    const existingChannelNames = await newApiClient.listChannelNamesByPrefix(
      channelNamePrefix,
    );
    const channelNames = buildSequentialChannelNames({
      existingNames: existingChannelNames,
      keyCount: importInput.keys.length,
      namePrefix: importInput.namePrefix,
      dateSegment: importInput.dateSegment,
      startNumber: importInput.startNumber,
      continueFromExisting: importInput.continueFromExisting,
    });

    writeProgressEvent(response, {
      type: "ready",
      systemName: systemStatus?.system_name || "New API",
      version: systemStatus?.version || "未知版本",
      username: loggedInUser.username,
      total: importInput.keys.length,
    });

    for (let keyIndex = 0; keyIndex < importInput.keys.length; keyIndex += 1) {
      const channelName = channelNames[keyIndex];
      let channelCreated = false;
      writeProgressEvent(response, {
        type: "item-start",
        index: keyIndex,
        name: channelName,
      });

      try {
        if (recordStore.hasImportedKey(connectionInput.baseUrl, importInput.keys[keyIndex])) {
          throw new ValidationError("该 Key 已通过本工具导入，请勿重复提交");
        }
        await newApiClient.createAnthropicChannel({
          key: importInput.keys[keyIndex],
          name: channelName,
          group: importInput.group,
        });
        channelCreated = true;
        const createdChannel = await newApiClient.findAnthropicChannelByName(channelName);
        recordStore.recordImportedChannel({
          baseUrl: connectionInput.baseUrl,
          key: importInput.keys[keyIndex],
          channel: createdChannel,
          quotaPerUnit: systemStatus?.quota_per_unit,
        });
        successCount += 1;
        writeProgressEvent(response, {
          type: "item-result",
          index: keyIndex,
          name: channelName,
          success: true,
          message: "渠道创建成功",
        });
      } catch (error) {
        const redactedMessage = redactSensitiveText(error?.message, sensitiveValues);
        if (channelCreated) {
          successCount += 1;
          writeProgressEvent(response, {
            type: "item-result",
            index: keyIndex,
            name: channelName,
            success: true,
            warning: true,
            message: `渠道已创建，但历史记录保存失败：${redactedMessage}`,
          });
        } else {
          failureCount += 1;
          writeProgressEvent(response, {
            type: "item-result",
            index: keyIndex,
            name: channelName,
            success: false,
            message: redactedMessage,
          });
        }
      }
      completedCount += 1;
    }

    writeProgressEvent(response, {
      type: "complete",
      total: importInput.keys.length,
      completed: completedCount,
      success: successCount,
      failure: failureCount,
    });
  } catch (error) {
    fatalFailure = true;
    const redactedMessage = redactSensitiveText(error?.message, sensitiveValues);
    applicationContext.logger.error("channel_import_failed", {
      requestId: request.requestId,
      error: new Error(redactedMessage),
    });
    writeProgressEvent(response, {
      type: "fatal",
      message: redactedMessage,
      completed: completedCount,
      success: successCount,
      failure: failureCount,
    });
  } finally {
    applicationContext.logger.info("channel_import_completed", {
      requestId: request.requestId,
      total: importInput.keys.length,
      completed: completedCount,
      success: successCount,
      failure: failureCount,
      fatalFailure,
      durationMilliseconds: Date.now() - startedAt,
    });
    response.end();
  }
}

function handleListRecords(response, applicationContext) {
  const { connectionInput, recordStore } = applicationContext;
  sendJson(response, 200, {
    success: true,
    data: {
      records: recordStore.listRecords(connectionInput.baseUrl),
    },
  });
}

async function handleQueryRecords(request, response, applicationContext) {
  const requestBody = await readJsonBody(request);
  const page = Number(requestBody?.page ?? 1);
  const pageSize = Number(requestBody?.pageSize ?? 10);
  const key = String(requestBody?.key ?? "").trim();

  if (!Number.isSafeInteger(page) || page < 1) {
    throw new ValidationError("页码必须是大于 0 的整数");
  }
  if (
    !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > MAXIMUM_RECORD_PAGE_SIZE
  ) {
    throw new ValidationError(`每页数量必须是 1 到 ${MAXIMUM_RECORD_PAGE_SIZE} 之间的整数`);
  }
  if (key.length > MAXIMUM_RECORD_QUERY_KEY_LENGTH) {
    throw new ValidationError("查询 Key 长度超过限制");
  }

  const { connectionInput, recordStore } = applicationContext;
  sendJson(response, 200, {
    success: true,
    data: recordStore.queryRecords({
      baseUrl: connectionInput.baseUrl,
      key,
      page,
      pageSize,
    }),
  });
}

async function handleSynchronizeRecords(request, response, applicationContext) {
  const startedAt = Date.now();
  await readJsonBody(request);
  const { connectionInput, newApiClient, recordStore } = applicationContext;
  const importedRecords = recordStore.listRecords(connectionInput.baseUrl);
  if (importedRecords.length === 0) {
    const synchronization = recordStore.synchronizeChannels({
      baseUrl: connectionInput.baseUrl,
      channels: [],
      quotaPerUnit: 0,
    });
    sendJson(response, 200, {
      success: true,
      data: {
        ...synchronization,
        records: [],
      },
    });
    applicationContext.logger.info("channel_usage_sync_completed", {
      requestId: request.requestId,
      trackedCount: 0,
      synchronizedCount: synchronization.synchronizedCount,
      missingCount: synchronization.missingCount,
      durationMilliseconds: Date.now() - startedAt,
    });
    return;
  }

  const systemStatus = await getSystemStatus(applicationContext);
  await getAuthenticatedUser(applicationContext);
  const channels = [];
  for (const importedRecord of importedRecords) {
    const matchingChannel = await newApiClient.searchAnthropicChannelByName(
      importedRecord.channelName,
    );
    const matchesRecordedChannelId = matchingChannel
      && Number(matchingChannel.id) === Number(importedRecord.newApiChannelId);
    if (matchesRecordedChannelId) {
      channels.push(matchingChannel);
    }
  }
  const synchronization = recordStore.synchronizeChannels({
    baseUrl: connectionInput.baseUrl,
    channels,
    quotaPerUnit: systemStatus?.quota_per_unit,
  });

  sendJson(response, 200, {
    success: true,
    data: {
      ...synchronization,
      records: recordStore.listRecords(connectionInput.baseUrl),
    },
  });
  applicationContext.logger.info("channel_usage_sync_completed", {
    requestId: request.requestId,
    trackedCount: importedRecords.length,
    synchronizedCount: synchronization.synchronizedCount,
    missingCount: synchronization.missingCount,
    durationMilliseconds: Date.now() - startedAt,
  });
}

function serveStaticFile(response, staticFile) {
  response.writeHead(200, { "Content-Type": staticFile.contentType });
  const fileStream = createReadStream(staticFile.path);
  fileStream.on("error", () => {
    if (!response.headersSent) {
      sendJson(response, 500, { success: false, message: "页面文件读取失败" });
      return;
    }
    response.destroy();
  });
  fileStream.pipe(response);
}

async function handleRequest(request, response, applicationContext) {
  setSecurityHeaders(response);
  const { connectionInput, channelDefaults, logger } = applicationContext;
  const requestUrl = new URL(
    request.url || "/",
    `http://${request.headers.host || DEFAULT_SERVER_HOST}`,
  );

  try {
    if (request.method === "POST" && requestUrl.pathname === "/api/test-connection") {
      await handleConnectionTest(request, response, applicationContext);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/import") {
      await handleImport(request, response, applicationContext);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/records") {
      handleListRecords(response, applicationContext);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/records/query") {
      await handleQueryRecords(request, response, applicationContext);
      return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/records/sync") {
      await handleSynchronizeRecords(request, response, applicationContext);
      return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/config") {
      sendJson(response, 200, {
        success: true,
        data: {
          baseUrl: connectionInput.baseUrl,
          username: connectionInput.username,
          models: CLAUDE_MODELS,
          channelDefaults,
        },
      });
      return;
    }

    const staticFile = request.method === "GET" ? STATIC_FILES.get(requestUrl.pathname) : null;
    if (staticFile) {
      serveStaticFile(response, staticFile);
      return;
    }
    sendJson(response, 404, { success: false, message: "页面不存在" });
  } catch (error) {
    const statusCode = error instanceof ValidationError || error instanceof RequestBodyError
      ? 400
      : 502;
    const redactedMessage = redactSensitiveText(
      error?.message,
      [connectionInput.password],
    );
    sendJson(response, statusCode, {
      success: false,
      message: redactedMessage,
    });
    logger.error("http_request_handler_failed", {
      requestId: request.requestId,
      method: request.method,
      path: requestUrl.pathname,
      statusCode,
      error: new Error(redactedMessage),
    });
  }
}

export function createApplicationServer({
  newApiConnection,
  channelDefaults,
  databasePath = ":memory:",
  getCurrentTime = Date.now,
  logger = createLogger(),
} = {}) {
  const connectionInput = validateConnectionInput(newApiConnection);
  const normalizedChannelDefaults = validateChannelDefaults(channelDefaults);
  const recordStore = new ChannelRecordStore(databasePath);
  const applicationContext = {
    connectionInput,
    channelDefaults: normalizedChannelDefaults,
    recordStore,
    logger,
    newApiClient: new NewApiClient({
      baseUrl: connectionInput.baseUrl,
      logger,
    }),
    authenticatedUser: null,
    authenticationPromise: null,
    systemStatusCache: {
      value: null,
      expiresAt: 0,
    },
    getCurrentTime,
  };
  const server = createServer((request, response) => {
    const requestId = randomUUID();
    const requestStartedAt = Date.now();
    request.requestId = requestId;
    response.setHeader("X-Request-Id", requestId);
    response.once("finish", () => {
      logger.info("http_request_completed", {
        requestId,
        method: request.method,
        path: new URL(request.url || "/", "http://localhost").pathname,
        statusCode: response.statusCode,
        durationMilliseconds: Date.now() - requestStartedAt,
      });
    });

    handleRequest(request, response, applicationContext).catch((error) => {
      const redactedMessage = redactSensitiveText(
        error?.message,
        [connectionInput.password],
      );
      logger.error("http_request_unhandled_error", {
        requestId,
        method: request.method,
        path: new URL(request.url || "/", "http://localhost").pathname,
        error: new Error(redactedMessage),
      });
      if (!response.headersSent) {
        sendJson(response, 500, { success: false, message: "服务处理请求失败" });
      } else {
        response.end();
      }
    });
  });
  server.once("close", () => recordStore.close());
  return server;
}

function loadApplicationConfigurationFromEnvironment() {
  try {
    loadEnvFile(join(CURRENT_DIRECTORY, ".env"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  return {
    newApiConnection: {
      baseUrl: process.env.NEW_API_BASE_URL,
      username: process.env.NEW_API_USERNAME,
      password: process.env.NEW_API_PASSWORD,
    },
    channelDefaults: {
      group: process.env.CHANNEL_GROUP,
      namePrefix: process.env.CHANNEL_NAME_PREFIX,
      startNumber: process.env.CHANNEL_START_NUMBER,
      continueFromExisting: process.env.CHANNEL_CONTINUE_FROM_EXISTING,
      dateMode: process.env.CHANNEL_DATE_MODE,
    },
    databasePath: resolve(
      CURRENT_DIRECTORY,
      process.env.DATABASE_PATH || "data/channel-records.sqlite",
    ),
  };
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const applicationConfiguration = loadApplicationConfigurationFromEnvironment();
  const configuredPort = Number(process.env.PORT || DEFAULT_SERVER_PORT);
  const configuredHost = process.env.HOST || DEFAULT_SERVER_HOST;
  const logger = createLogger();
  const server = createApplicationServer({
    ...applicationConfiguration,
    logger,
  });
  server.listen(configuredPort, configuredHost, () => {
    logger.info("application_started", {
      version: APPLICATION_VERSION,
      host: configuredHost,
      port: configuredPort,
      newApiBaseUrl: applicationConfiguration.newApiConnection.baseUrl,
    });
  });

  let shutdownStarted = false;
  function shutDown(signal) {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    logger.info("application_shutdown_started", { signal });
    server.close((error) => {
      if (error) {
        logger.error("application_shutdown_failed", { signal, error });
        process.exitCode = 1;
      } else {
        logger.info("application_stopped", { signal });
      }
    });
  }

  process.once("SIGTERM", () => shutDown("SIGTERM"));
  process.once("SIGINT", () => shutDown("SIGINT"));
}
