"use client";

import { useEffect, useRef, useState } from "react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const AUTOMATIC_SYNCHRONIZATION_INTERVAL_MILLISECONDS = 30_000;

function createEmptyQuery(pageSize = DEFAULT_PAGE_SIZE) {
  return {
    instanceId: null,
    channelName: "",
    key: "",
    page: 1,
    pageSize,
  };
}

function createEmptyRecordData() {
  return {
    records: [],
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    totalBalanceUsd: 0,
    totalUsedUsd: 0,
  };
}

function formatUsd(usedUsd) {
  const normalizedAmount = Number(usedUsd) || 0;
  return normalizedAmount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: normalizedAmount > 0 && normalizedAmount < 0.01 ? 6 : 4,
  });
}

function formatDateTime(rawDateTime, emptyText) {
  if (!rawDateTime) {
    return emptyText;
  }
  const parsedDate = new Date(rawDateTime);
  return Number.isNaN(parsedDate.getTime())
    ? "未知时间"
    : parsedDate.toLocaleString("zh-CN", { hour12: false });
}

function getStatusText(statusLabel) {
  if (statusLabel === "enabled") {
    return "已启用";
  }
  if (statusLabel === "missing") {
    return "渠道不存在";
  }
  return "已停用";
}

export default function AdminRecordsOverview({ instances, onOpenInstance, refreshToken }) {
  const [instanceFilter, setInstanceFilter] = useState("");
  const [channelNameFilter, setChannelNameFilter] = useState("");
  const [keyFilter, setKeyFilter] = useState("");
  const [activeQuery, setActiveQuery] = useState(createEmptyQuery);
  const [recordData, setRecordData] = useState(createEmptyRecordData);
  const [isLoading, setIsLoading] = useState(true);
  const [revealedKeys, setRevealedKeys] = useState({});
  const [loadingKeyRecordId, setLoadingKeyRecordId] = useState(null);
  const [selectedRecordIds, setSelectedRecordIds] = useState([]);
  const [pendingDeletionRecordIds, setPendingDeletionRecordIds] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSynchronizing, setIsSynchronizing] = useState(false);
  const [isAutomaticSynchronizationEnabled, setIsAutomaticSynchronizationEnabled] = useState(false);
  const [message, setMessage] = useState("正在读取全部 Key 记录...");
  const synchronizationInProgressRef = useRef(false);
  const automaticSynchronizationRef = useRef(null);

  async function loadRecords(nextQuery, {
    preserveSelection = false,
    showLoadingState = true,
  } = {}) {
    if (showLoadingState) {
      setIsLoading(true);
      setMessage("正在读取全部 Key 记录...");
    }
    try {
      const responsePayload = await requestJson("/api/admin/records/query", {
        method: "POST",
        body: JSON.stringify(nextQuery),
      });
      const loadedRecordData = responsePayload.data;
      setActiveQuery({
        ...nextQuery,
        page: loadedRecordData.page,
      });
      setRecordData(loadedRecordData);
      if (!preserveSelection) {
        setSelectedRecordIds([]);
      }
      setMessage(
        `共 ${loadedRecordData.total} 条记录，余额 `
        + formatUsd(loadedRecordData.totalBalanceUsd)
        + "，累计用量 "
        + formatUsd(loadedRecordData.totalUsedUsd),
      );
    } catch (error) {
      const errorMessage = `读取 Key 记录失败：${error?.message || "未知错误"}`;
      setMessage(errorMessage);
      showToast(errorMessage, { type: "error" });
    } finally {
      if (showLoadingState) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    setInstanceFilter("");
    setChannelNameFilter("");
    setKeyFilter("");
    setRevealedKeys({});
    loadRecords(createEmptyQuery());
  }, [refreshToken]);

  async function synchronizeRecords({ automatic = false } = {}) {
    if (synchronizationInProgressRef.current) {
      return;
    }
    synchronizationInProgressRef.current = true;
    setIsSynchronizing(true);
    if (!automatic) {
      setMessage("正在同步全部实例的渠道状态、余额和用量...");
    }
    try {
      const responsePayload = await requestJson("/api/admin/records", {
        method: "POST",
        body: "{}",
      });
      await loadRecords(activeQuery, {
        preserveSelection: true,
        showLoadingState: false,
      });
      const synchronizationData = responsePayload.data;
      const failureMessage = synchronizationData.failedInstanceCount > 0
        ? `，${synchronizationData.failedInstanceCount} 个实例失败`
        : "";
      const missingMessage = synchronizationData.missingCount > 0
        ? `，${synchronizationData.missingCount} 个渠道不存在`
        : "";
      const successMessage = (
        `已同步 ${synchronizationData.instanceCount} 个实例、`
        + `${synchronizationData.synchronizedCount} 个渠道`
        + missingMessage
        + failureMessage
      );
      setMessage(successMessage);
      if (!automatic) {
        showToast(successMessage, {
          type: synchronizationData.failedInstanceCount > 0 ? "error" : "success",
        });
      }
    } catch (error) {
      const errorMessage = `同步失败：${error?.message || "未知错误"}`;
      setMessage(errorMessage);
      if (!automatic) {
        showToast(errorMessage, { type: "error" });
      }
    } finally {
      synchronizationInProgressRef.current = false;
      setIsSynchronizing(false);
    }
  }

  automaticSynchronizationRef.current = () => {
    if (!synchronizationInProgressRef.current) {
      synchronizeRecords({ automatic: true });
    }
  };

  useEffect(() => {
    if (!isAutomaticSynchronizationEnabled) {
      return undefined;
    }
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        automaticSynchronizationRef.current?.();
      }
    }, AUTOMATIC_SYNCHRONIZATION_INTERVAL_MILLISECONDS);
    return () => window.clearInterval(intervalId);
  }, [isAutomaticSynchronizationEnabled]);

  async function loadRecordKey(record) {
    if (revealedKeys[record.id]) {
      return revealedKeys[record.id];
    }
    setLoadingKeyRecordId(record.id);
    try {
      const responsePayload = await requestJson(`/api/admin/records/${record.id}/key`, {
        method: "POST",
        body: "{}",
      });
      const recordKey = responsePayload.data.key;
      setRevealedKeys((currentKeys) => ({
        ...currentKeys,
        [record.id]: recordKey,
      }));
      return recordKey;
    } catch (error) {
      showToast(error?.message || "读取完整 Key 失败", { type: "error" });
      return null;
    } finally {
      setLoadingKeyRecordId(null);
    }
  }

  async function copyRecordKey(record) {
    const recordKey = await loadRecordKey(record);
    if (!recordKey) {
      return;
    }
    try {
      await navigator.clipboard.writeText(recordKey);
      showToast("完整 Key 已复制", { type: "success" });
    } catch {
      showToast("复制 Key 失败，请检查浏览器权限", { type: "error" });
    }
  }

  async function submitFilters(event) {
    event.preventDefault();
    await loadRecords({
      instanceId: instanceFilter ? Number(instanceFilter) : null,
      channelName: channelNameFilter.trim(),
      key: keyFilter.trim(),
      page: 1,
      pageSize: activeQuery.pageSize,
    });
  }

  async function clearFilters() {
    setInstanceFilter("");
    setChannelNameFilter("");
    setKeyFilter("");
    await loadRecords(createEmptyQuery(activeQuery.pageSize));
  }

  async function changePage(nextPage) {
    await loadRecords({ ...activeQuery, page: nextPage });
  }

  async function changePageSize(event) {
    await loadRecords({
      ...activeQuery,
      page: 1,
      pageSize: Number(event.target.value),
    });
  }

  function toggleRecordSelection(recordId) {
    setSelectedRecordIds((currentRecordIds) => (
      currentRecordIds.includes(recordId)
        ? currentRecordIds.filter((currentRecordId) => currentRecordId !== recordId)
        : [...currentRecordIds, recordId]
    ));
  }

  function toggleCurrentPageSelection() {
    const currentPageRecordIds = recordData.records.map((record) => record.id);
    const allCurrentPageRecordsSelected = currentPageRecordIds.length > 0
      && currentPageRecordIds.every((recordId) => selectedRecordIds.includes(recordId));
    setSelectedRecordIds(allCurrentPageRecordsSelected ? [] : currentPageRecordIds);
  }

  function openDeleteConfirmation(recordIds) {
    setPendingDeletionRecordIds(recordIds);
  }

  async function deleteRecords() {
    setIsDeleting(true);
    try {
      const responsePayload = await requestJson("/api/admin/records", {
        method: "DELETE",
        body: JSON.stringify({ recordIds: pendingDeletionRecordIds }),
      });
      const deletedRecordIds = new Set(pendingDeletionRecordIds);
      setRevealedKeys((currentKeys) => Object.fromEntries(
        Object.entries(currentKeys).filter(([recordId]) => (
          !deletedRecordIds.has(Number(recordId))
        )),
      ));
      setPendingDeletionRecordIds([]);
      setSelectedRecordIds([]);
      await loadRecords(activeQuery);
      showToast(
        `已删除 ${responsePayload.data.deletedRecordCount} 条本地记录`,
        { type: "success" },
      );
    } catch (error) {
      showToast(error?.message || "删除本地记录失败", { type: "error" });
    } finally {
      setIsDeleting(false);
    }
  }

  const currentPageRecordIds = recordData.records.map((record) => record.id);
  const allCurrentPageRecordsSelected = currentPageRecordIds.length > 0
    && currentPageRecordIds.every((recordId) => selectedRecordIds.includes(recordId));

  return (
    <section className="panel admin-records-panel" aria-busy={isLoading}>
      <div className="panel-heading">
        <div>
          <h2>全部 Key 记录</h2>
          <p>{message}</p>
        </div>
        <div className="record-sync-actions">
          <label className="automatic-sync-control">
            <input
              type="checkbox"
              checked={isAutomaticSynchronizationEnabled}
              onChange={(event) => setIsAutomaticSynchronizationEnabled(
                event.target.checked,
              )}
            />
            自动同步（30 秒）
          </label>
          <button
            className="button button-secondary"
            type="button"
            disabled={isSynchronizing || isDeleting || instances.length === 0}
            onClick={() => synchronizeRecords()}
          >
            {isSynchronizing ? "正在同步..." : "同步全部实例"}
          </button>
        </div>
      </div>

      <form className="admin-record-filters" onSubmit={submitFilters}>
        <label className="field">
          <span>New API 实例</span>
          <select
            value={instanceFilter}
            onChange={(event) => setInstanceFilter(event.target.value)}
          >
            <option value="">全部实例</option>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>{instance.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>渠道名称</span>
          <input
            placeholder="支持部分名称"
            value={channelNameFilter}
            onChange={(event) => setChannelNameFilter(event.target.value)}
          />
        </label>
        <label className="field">
          <span>完整 Anthropic Key</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="精确查询"
            value={keyFilter}
            onChange={(event) => setKeyFilter(event.target.value)}
          />
        </label>
        <div className="admin-record-filter-actions">
          <button className="button button-primary" disabled={isLoading}>查询</button>
          <button
            className="button button-secondary"
            type="button"
            disabled={isLoading}
            onClick={clearFilters}
          >
            清除
          </button>
        </div>
      </form>

      <div className="admin-record-batch-actions">
        <span>已选择 {selectedRecordIds.length} 条当前页记录</span>
        <button
          className="button button-danger button-compact"
          type="button"
          disabled={selectedRecordIds.length === 0 || isLoading || isDeleting}
          onClick={() => openDeleteConfirmation(selectedRecordIds)}
        >
          批量删除
        </button>
      </div>

      <div className="history-table-shell">
        <table className="history-table admin-record-table">
          <thead>
            <tr>
              <th className="record-selection-column">
                <input
                  className="record-selection-checkbox"
                  type="checkbox"
                  aria-label="全选当前页"
                  checked={allCurrentPageRecordsSelected}
                  disabled={recordData.records.length === 0 || isLoading || isDeleting}
                  onChange={toggleCurrentPageSelection}
                />
              </th>
              <th>New API 实例</th>
              <th>渠道</th>
              <th>Key</th>
              <th>状态</th>
              <th>余额</th>
              <th>累计用量</th>
              <th>导入时间</th>
              <th>最后同步</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {recordData.records.map((record) => (
              <tr key={record.id}>
                <td className="record-selection-column">
                  <input
                    className="record-selection-checkbox"
                    type="checkbox"
                    aria-label={`选择记录 ${record.channelName}`}
                    checked={selectedRecordIds.includes(record.id)}
                    disabled={isLoading || isDeleting}
                    onChange={() => toggleRecordSelection(record.id)}
                  />
                </td>
                <td><strong>{record.instanceName}</strong></td>
                <td>
                  <strong>{record.channelName}</strong>
                  <small>渠道 ID：{record.newApiChannelId}</small>
                </td>
                <td className="history-key record-key-cell">
                  <span className="record-key-value">
                    {revealedKeys[record.id] || record.keyMask}
                  </span>
                  {record.keyAvailable ? (
                    <span className="record-key-actions">
                      <button
                        className="button button-secondary button-compact"
                        type="button"
                        disabled={loadingKeyRecordId === record.id}
                        onClick={() => {
                          if (revealedKeys[record.id]) {
                            setRevealedKeys((currentKeys) => {
                              const nextKeys = { ...currentKeys };
                              delete nextKeys[record.id];
                              return nextKeys;
                            });
                            return;
                          }
                          loadRecordKey(record);
                        }}
                      >
                        {revealedKeys[record.id] ? "隐藏" : "显示"}
                      </button>
                      <button
                        className="button button-secondary button-compact"
                        type="button"
                        disabled={loadingKeyRecordId === record.id}
                        onClick={() => copyRecordKey(record)}
                      >
                        复制
                      </button>
                    </span>
                  ) : (
                    <small className="record-key-unavailable">旧记录不可恢复</small>
                  )}
                </td>
                <td>
                  <span className={`history-status history-status-${record.statusLabel}`}>
                    {getStatusText(record.statusLabel)}
                  </span>
                </td>
                <td className="history-usage">{formatUsd(record.balanceUsd)}</td>
                <td className="history-usage">{formatUsd(record.usedUsd)}</td>
                <td>{formatDateTime(record.importedAt, "未知时间")}</td>
                <td>{formatDateTime(record.lastSyncedAt, "尚未同步")}</td>
                <td>
                  <div className="record-row-actions">
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => onOpenInstance(record.instanceId)}
                    >
                      进入实例
                    </button>
                    <button
                      className="button button-danger"
                      type="button"
                      disabled={isDeleting}
                      onClick={() => openDeleteConfirmation([record.id])}
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && recordData.records.length === 0 ? (
              <tr><td className="history-empty" colSpan="10">没有符合条件的 Key 记录。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="history-pagination">
        <span>第 {recordData.page} / {recordData.totalPages} 页</span>
        <div className="pagination-controls">
          <label className="page-size-control">
            <span>每页</span>
            <select
              value={recordData.pageSize}
              disabled={isLoading}
              onChange={changePageSize}
            >
              {PAGE_SIZE_OPTIONS.map((pageSize) => (
                <option key={pageSize} value={pageSize}>{pageSize} 条</option>
              ))}
            </select>
          </label>
          <button
            className="button button-secondary"
            type="button"
            disabled={isLoading || recordData.page <= 1}
            onClick={() => changePage(recordData.page - 1)}
          >
            上一页
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={isLoading || recordData.page >= recordData.totalPages}
            onClick={() => changePage(recordData.page + 1)}
          >
            下一页
          </button>
        </div>
      </div>

      {pendingDeletionRecordIds.length > 0 ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => {
            if (!isDeleting) {
              setPendingDeletionRecordIds([]);
            }
          }}
        >
          <div
            className="modal-dialog modal-dialog-compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-records-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="delete-records-title">
              {pendingDeletionRecordIds.length === 1 ? "删除这条记录？" : "批量删除记录？"}
            </h2>
            <p>
              将永久删除本系统中的 {pendingDeletionRecordIds.length} 条 Key 记录，
              包括本地用量历史和已加密的完整 Key。
            </p>
            <p className="delete-confirmation-summary">
              New API 上游真实渠道不会被删除；删除后，本系统也不会再同步这些渠道。
            </p>
            <div className="modal-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={isDeleting}
                onClick={() => setPendingDeletionRecordIds([])}
              >
                取消
              </button>
              <button
                className="button button-danger"
                type="button"
                disabled={isDeleting}
                onClick={deleteRecords}
              >
                {isDeleting ? "正在删除..." : `确认删除 ${pendingDeletionRecordIds.length} 条`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
