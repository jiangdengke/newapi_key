import {
  getInstanceAuthenticatedUser,
  getInstanceRuntime,
  getInstanceSystemStatus,
  getRuntimeContext,
} from "./runtime-context.js";
import {
  buildSequentialChannelNames,
  redactSensitiveText,
  validateChannelDefaults,
  validateImportInput,
  ValidationError,
} from "./validation.js";

function getValidatedInstanceDefaults(instance) {
  return validateChannelDefaults({
    group: instance.group,
    namePrefix: instance.namePrefix,
    startNumber: instance.startNumber,
    continueFromExisting: instance.continueFromExisting,
    priority: instance.priority,
    weight: instance.weight,
    dateMode: instance.dateMode,
  });
}

export function prepareChannelImport(instanceId, rawKeys, requestId) {
  const context = getRuntimeContext();
  const instanceRuntime = getInstanceRuntime(instanceId);
  if (!instanceRuntime) {
    throw new ValidationError("New API 实例不存在");
  }
  if (instanceRuntime.importInProgress) {
    throw new ValidationError("该 New API 实例正在执行另一批导入，请稍后再试");
  }

  const channelDefaults = getValidatedInstanceDefaults(instanceRuntime.connection);
  const importInput = validateImportInput({
    keys: rawKeys,
    group: channelDefaults.group,
    namePrefix: channelDefaults.namePrefix,
    dateSegment: channelDefaults.dateSegment,
    startNumber: channelDefaults.startNumber,
    continueFromExisting: channelDefaults.continueFromExisting,
    priority: channelDefaults.priority,
    weight: channelDefaults.weight,
  });
  instanceRuntime.importInProgress = true;

  return {
    importInput,
    async *events() {
      const startedAt = Date.now();
      const sensitiveValues = [
        instanceRuntime.connection.password,
        ...importInput.keys,
      ];
      let completedCount = 0;
      let successCount = 0;
      let failureCount = 0;
      context.logger.info("channel_import_started", {
        requestId,
        instanceId: Number(instanceId),
        total: importInput.keys.length,
      });

      try {
        const systemStatus = await getInstanceSystemStatus(instanceRuntime);
        const loggedInUser = await getInstanceAuthenticatedUser(instanceRuntime);
        const channelNamePrefix = `${importInput.namePrefix}-${importInput.dateSegment}-`;
        const existingChannelNames = await instanceRuntime.client.listChannelNamesByPrefix(
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

        yield {
          type: "ready",
          systemName: systemStatus?.system_name || "New API",
          version: systemStatus?.version || "未知版本",
          username: loggedInUser.username,
          total: importInput.keys.length,
        };

        for (let keyIndex = 0; keyIndex < importInput.keys.length; keyIndex += 1) {
          const channelName = channelNames[keyIndex];
          let channelCreated = false;
          yield { type: "item-start", index: keyIndex, name: channelName };

          try {
            if (context.store.hasImportedKey(instanceId, importInput.keys[keyIndex])) {
              throw new ValidationError("该 Key 已通过本工具导入，请勿重复提交");
            }
            await instanceRuntime.client.createAnthropicChannel({
              key: importInput.keys[keyIndex],
              name: channelName,
              group: importInput.group,
              priority: importInput.priority,
              weight: importInput.weight,
            });
            channelCreated = true;
            const createdChannel = await instanceRuntime.client.findAnthropicChannelByName(
              channelName,
            );
            context.store.recordImportedChannel({
              instanceId,
              baseUrl: instanceRuntime.connection.baseUrl,
              key: importInput.keys[keyIndex],
              channel: createdChannel,
              quotaPerUnit: systemStatus?.quota_per_unit,
            });
            successCount += 1;
            yield {
              type: "item-result",
              index: keyIndex,
              name: channelName,
              success: true,
              message: "渠道创建成功",
            };
          } catch (error) {
            const redactedMessage = redactSensitiveText(error?.message, sensitiveValues);
            if (channelCreated) {
              successCount += 1;
              yield {
                type: "item-result",
                index: keyIndex,
                name: channelName,
                success: true,
                warning: true,
                message: `渠道已创建，但历史记录保存失败：${redactedMessage}`,
              };
            } else {
              failureCount += 1;
              context.logger.error("channel_creation_failed", {
                instanceId: Number(instanceId),
                channelName,
                error: new Error(redactedMessage),
                requestId,
              });
              yield {
                type: "item-result",
                index: keyIndex,
                name: channelName,
                success: false,
                message: redactedMessage,
              };
            }
          }
          completedCount += 1;
        }

        yield {
          type: "complete",
          total: importInput.keys.length,
          completed: completedCount,
          success: successCount,
          failure: failureCount,
        };
      } catch (error) {
        const redactedMessage = redactSensitiveText(error?.message, sensitiveValues);
        context.logger.error("channel_import_failed", {
          requestId,
          instanceId: Number(instanceId),
          error: new Error(redactedMessage),
        });
        yield {
          type: "fatal",
          message: redactedMessage,
          completed: completedCount,
          success: successCount,
          failure: failureCount,
        };
      } finally {
        instanceRuntime.importInProgress = false;
        context.logger.info("channel_import_completed", {
          instanceId: Number(instanceId),
          total: importInput.keys.length,
          success: successCount,
          failure: failureCount,
          durationMilliseconds: Date.now() - startedAt,
          requestId,
        });
      }
    },
  };
}

export async function synchronizeInstanceRecords(instanceId, requestId) {
  const startedAt = Date.now();
  const context = getRuntimeContext();
  const instanceRuntime = getInstanceRuntime(instanceId);
  if (!instanceRuntime) {
    throw new ValidationError("New API 实例不存在");
  }
  const importedRecords = context.store.listRecords(instanceId);
  if (importedRecords.length === 0) {
    const synchronization = context.store.synchronizeChannels({
      instanceId,
      channels: [],
      quotaPerUnit: 0,
    });
    context.logger.info("channel_usage_sync_completed", {
      instanceId: Number(instanceId),
      synchronizedCount: synchronization.synchronizedCount,
      missingCount: synchronization.missingCount,
      durationMilliseconds: Date.now() - startedAt,
      trackedCount: 0,
      requestId,
    });
    return synchronization;
  }

  const systemStatus = await getInstanceSystemStatus(instanceRuntime);
  await getInstanceAuthenticatedUser(instanceRuntime);
  const channels = [];
  for (const importedRecord of importedRecords) {
    const matchingChannel = await instanceRuntime.client.searchAnthropicChannelByName(
      importedRecord.channelName,
    );
    if (
      matchingChannel
      && Number(matchingChannel.id) === Number(importedRecord.newApiChannelId)
    ) {
      channels.push(matchingChannel);
    }
  }
  const synchronization = context.store.synchronizeChannels({
    instanceId,
    channels,
    quotaPerUnit: systemStatus?.quota_per_unit,
  });
  context.logger.info("channel_usage_sync_completed", {
    instanceId: Number(instanceId),
    synchronizedCount: synchronization.synchronizedCount,
    missingCount: synchronization.missingCount,
    durationMilliseconds: Date.now() - startedAt,
    trackedCount: importedRecords.length,
    requestId,
  });
  return synchronization;
}
