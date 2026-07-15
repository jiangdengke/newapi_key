import { requireAdministrator } from "../../../../lib/auth.js";
import {
  createRequestId,
  errorResponse,
  HttpError,
  jsonResponse,
  readJsonBody,
  requireSameOrigin,
} from "../../../../lib/http.js";
import { synchronizeInstanceRecords } from "../../../../lib/instance-service.js";
import { getRuntimeContext } from "../../../../lib/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_RECORD_DELETION_COUNT = 100;

export async function POST(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    requireAdministrator(request);
    await readJsonBody(request);

    const instancesToSynchronize = context.store.listInstances().filter(
      (instance) => instance.enabled && instance.channelRecordCount > 0,
    );
    let synchronizedCount = 0;
    let missingCount = 0;
    let failedInstanceCount = 0;
    const usageStartedRecords = [];
    for (const instance of instancesToSynchronize) {
      try {
        const synchronization = await synchronizeInstanceRecords(instance.id, requestId);
        synchronizedCount += synchronization.synchronizedCount;
        missingCount += synchronization.missingCount;
        usageStartedRecords.push(
          ...synchronization.usageStartedRecords.map((record) => ({
            ...record,
            instanceId: instance.id,
            instanceName: instance.name,
          })),
        );
      } catch (error) {
        failedInstanceCount += 1;
        context.logger.error("administrator_instance_sync_failed", {
          requestId,
          instanceId: instance.id,
          error,
        });
      }
    }

    return jsonResponse({
      success: true,
      data: {
        instanceCount: instancesToSynchronize.length,
        synchronizedCount,
        missingCount,
        failedInstanceCount,
        usageStartedRecords,
      },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "POST",
      path: "/api/admin/records",
    });
  }
}

export async function DELETE(request) {
  const requestId = createRequestId(request);
  const context = getRuntimeContext();
  try {
    requireSameOrigin(request);
    requireAdministrator(request);

    const requestBody = await readJsonBody(request);
    if (!Array.isArray(requestBody?.recordIds)) {
      throw new HttpError(400, "需要提供待删除的 Key 记录 ID");
    }
    const recordIds = [...new Set(requestBody.recordIds.map(Number))];
    if (recordIds.length < 1 || recordIds.length > MAXIMUM_RECORD_DELETION_COUNT) {
      throw new HttpError(
        400,
        `每次只能删除 1 到 ${MAXIMUM_RECORD_DELETION_COUNT} 条 Key 记录`,
      );
    }
    if (recordIds.some((recordId) => !Number.isSafeInteger(recordId) || recordId < 1)) {
      throw new HttpError(400, "待删除的 Key 记录 ID 无效");
    }

    const deletedRecordCount = context.store.deleteAdministratorRecords(recordIds);
    if (deletedRecordCount === 0) {
      throw new HttpError(404, "待删除的 Key 记录不存在");
    }

    context.logger.info("administrator_records_deleted", {
      requestId,
      requestedRecordCount: recordIds.length,
      deletedRecordCount,
    });
    return jsonResponse({
      success: true,
      data: { deletedRecordCount },
    }, { requestId });
  } catch (error) {
    return errorResponse(error, requestId, context.logger, {
      method: "DELETE",
      path: "/api/admin/records",
    });
  }
}
