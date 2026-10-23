"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Copy,
  Eye,
  EyeOff,
  Inbox,
  KeyRound,
  ListChecks,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { formatDateTime, formatUsd } from "../lib/format.js";
import { showToast } from "../lib/toast.js";
import RecordFilterBar, {
  CHANNEL_KIND_FILTER_LABELS,
  createRecordQuery,
  DEFAULT_RECORD_SORT,
  EMPTY_RECORD_FILTERS,
} from "./record-filters.js";
import {
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Pagination,
  StatCard,
  StatusText,
  Switch,
  useDebouncedValue,
} from "./ui.js";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const AUTOMATIC_SYNCHRONIZATION_INTERVAL_MILLISECONDS = 30_000;

function createEmptyRecordData() {
  return {
    records: [],
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    totalBalanceUsd: 0,
    totalUsedUsd: 0,
    facets: null,
  };
}

function showUsageStartedNotifications(usageStartedRecords) {
  for (const usageStartedRecord of usageStartedRecords || []) {
    showToast(
      `${usageStartedRecord.instanceName}：Key ${usageStartedRecord.keyMask} `
      + `对应渠道 ${usageStartedRecord.channelName} 已开始产生用量，当前累计 `
      + formatUsd(usageStartedRecord.usedUsd),
      { type: "info" },
    );
  }
}

export default function AdminRecordsOverview({ instances, onOpenInstance }) {
  const [filters, setFilters] = useState(EMPTY_RECORD_FILTERS);
  const [sort, setSort] = useState(DEFAULT_RECORD_SORT);
  const [activeQuery, setActiveQuery] = useState(() => createRecordQuery(
    EMPTY_RECORD_FILTERS,
    DEFAULT_RECORD_SORT,
    { page: 1, pageSize: DEFAULT_PAGE_SIZE },
  ));
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
  const recordRequestVersionRef = useRef(0);
  const debouncedSearch = useDebouncedValue(filters.search);
  const debouncedModel = useDebouncedValue(filters.model);

  async function loadRecords(nextQuery, {
    preserveSelection = false,
    showLoadingState = true,
  } = {}) {
    const requestVersion = recordRequestVersionRef.current + 1;
    recordRequestVersionRef.current = requestVersion;
    if (showLoadingState) {
      setIsLoading(true);
      setMessage("正在读取全部 Key 记录...");
    }
    try {
      const responsePayload = await requestJson("/api/admin/records/query", {
        method: "POST",
        body: JSON.stringify(nextQuery),
      });
      if (recordRequestVersionRef.current !== requestVersion) {
        return;
      }
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
      if (recordRequestVersionRef.current !== requestVersion) {
        return;
      }
      const errorMessage = `读取 Key 记录失败：${error?.message || "未知错误"}`;
      setMessage(errorMessage);
      showToast(errorMessage, { type: "error" });
    } finally {
      if (showLoadingState && recordRequestVersionRef.current === requestVersion) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    loadRecords(createRecordQuery(
      { ...filters, search: debouncedSearch, model: debouncedModel },
      sort,
      { page: 1, pageSize: activeQuery.pageSize },
    ));
  }, [
    debouncedSearch,
    debouncedModel,
    filters.instanceId,
    filters.memberId,
    filters.statusLabel,
    filters.channelKind,
    filters.group,
    sort.field,
    sort.order,
  ]);

  function resetFilters() {
    setFilters(EMPTY_RECORD_FILTERS);
    setSort(DEFAULT_RECORD_SORT);
  }

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
      showUsageStartedNotifications(synchronizationData.usageStartedRecords);
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

  function toggleRecordKeyVisibility(record) {
    if (revealedKeys[record.id]) {
      setRevealedKeys((currentKeys) => {
        const nextKeys = { ...currentKeys };
        delete nextKeys[record.id];
        return nextKeys;
      });
      return;
    }
    loadRecordKey(record);
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

  async function changePage(nextPage) {
    await loadRecords({ ...activeQuery, page: nextPage });
  }

  async function changePageSize(nextPageSize) {
    await loadRecords({
      ...activeQuery,
      page: 1,
      pageSize: nextPageSize,
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

  const hasActiveFilters = Object.values(filters).some(Boolean);
  const currentPageRecordIds = recordData.records.map((record) => record.id);
  const allCurrentPageRecordsSelected = currentPageRecordIds.length > 0
    && currentPageRecordIds.every((recordId) => selectedRecordIds.includes(recordId));

  return (
    <div className="page">
      <PageHeader
        title="Key 记录"
        description="跨实例查看通过本工具导入的渠道，可按实例、渠道名称或完整 Key 筛选。"
        actions={(
          <>
            <Switch
              checked={isAutomaticSynchronizationEnabled}
              onChange={setIsAutomaticSynchronizationEnabled}
              label="自动同步（30 秒）"
            />
            <button
              className="btn btn-primary"
              type="button"
              disabled={isSynchronizing || isDeleting || instances.length === 0}
              onClick={() => synchronizeRecords()}
            >
              <RefreshCw size={15} className={isSynchronizing ? "spin" : ""} aria-hidden="true" />
              {isSynchronizing ? "正在同步..." : "同步全部实例"}
            </button>
          </>
        )}
      />

      <div className="stat-grid">
        <StatCard icon={ListChecks} label="记录数" value={recordData.total} hint={hasActiveFilters ? "按当前筛选条件统计" : "全部实例"} />
        <StatCard icon={Wallet} label="余额合计" value={formatUsd(recordData.totalBalanceUsd)} hint="来自 New API 渠道余额" tone="success" />
        <StatCard icon={KeyRound} label="累计用量" value={formatUsd(recordData.totalUsedUsd)} hint="used_quota 换算为美元" tone="info" />
      </div>

      <RecordFilterBar
        filters={filters}
        onFiltersChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        onReset={resetFilters}
        facets={recordData.facets}
        instances={instances}
      />

      <div className="table-meta">
        <span>{message}</span>
        {selectedRecordIds.length > 0 ? (
          <span className="table-meta-actions">
            已选择 {selectedRecordIds.length} 条
            <button
              className="btn btn-danger-outline btn-sm"
              type="button"
              disabled={isLoading || isDeleting}
              onClick={() => openDeleteConfirmation(selectedRecordIds)}
            >
              <Trash2 size={14} aria-hidden="true" />
              批量删除
            </button>
          </span>
        ) : null}
      </div>

      <div className="table-card" aria-busy={isLoading}>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="selection-column">
                  <input
                    className="checkbox"
                    type="checkbox"
                    aria-label="全选当前页"
                    checked={allCurrentPageRecordsSelected}
                    disabled={recordData.records.length === 0 || isLoading || isDeleting}
                    onChange={toggleCurrentPageSelection}
                  />
                </th>
                <th>实例 / 成员</th>
                <th>渠道</th>
                <th>Key</th>
                <th>状态</th>
                <th className="align-right">余额</th>
                <th className="align-right">累计用量</th>
                <th>导入时间</th>
                <th>最后同步</th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {recordData.records.map((record) => (
                <tr key={record.id} className={selectedRecordIds.includes(record.id) ? "is-selected" : ""}>
                  <td className="selection-column">
                    <input
                      className="checkbox"
                      type="checkbox"
                      aria-label={`选择记录 ${record.channelName}`}
                      checked={selectedRecordIds.includes(record.id)}
                      disabled={isLoading || isDeleting}
                      onChange={() => toggleRecordSelection(record.id)}
                    />
                  </td>
                  <td>
                    <div className="cell-stack">
                      <strong>{record.instanceName}</strong>
                      <span className="cell-muted">{record.memberName || "未归属成员"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack">
                      <strong>{record.channelName}</strong>
                      <span className="cell-muted">
                        {CHANNEL_KIND_FILTER_LABELS[record.channelKind]} · ID {record.newApiChannelId} · {record.group}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="key-cell">
                      <span className="cell-mono key-value">{revealedKeys[record.id] || record.keyMask}</span>
                      {record.keyAvailable ? (
                        <>
                          <button
                            className="btn btn-ghost btn-icon btn-xs"
                            type="button"
                            title={revealedKeys[record.id] ? "隐藏完整 Key" : "显示完整 Key"}
                            aria-label={revealedKeys[record.id] ? "隐藏完整 Key" : "显示完整 Key"}
                            disabled={loadingKeyRecordId === record.id}
                            onClick={() => toggleRecordKeyVisibility(record)}
                          >
                            {revealedKeys[record.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          <button
                            className="btn btn-ghost btn-icon btn-xs"
                            type="button"
                            title="复制完整 Key"
                            aria-label="复制完整 Key"
                            disabled={loadingKeyRecordId === record.id}
                            onClick={() => copyRecordKey(record)}
                          >
                            <Copy size={14} />
                          </button>
                        </>
                      ) : (
                        <span className="tag tag-muted">旧记录不可恢复</span>
                      )}
                    </div>
                  </td>
                  <td><StatusText status={record.statusLabel} /></td>
                  <td className="align-right cell-number">{formatUsd(record.balanceUsd)}</td>
                  <td className="align-right cell-number">{formatUsd(record.usedUsd)}</td>
                  <td className="cell-muted">{formatDateTime(record.importedAt, "未知时间")}</td>
                  <td className="cell-muted">{formatDateTime(record.lastSyncedAt, "尚未同步")}</td>
                  <td className="align-right">
                    <div className="row-actions">
                      <button
                        className="btn btn-outline btn-sm"
                        type="button"
                        onClick={() => onOpenInstance(record.instanceId)}
                      >
                        进入
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                      <button
                        className="btn btn-ghost btn-icon btn-sm is-danger"
                        type="button"
                        title="删除记录"
                        aria-label={`删除记录 ${record.channelName}`}
                        disabled={isDeleting}
                        onClick={() => openDeleteConfirmation([record.id])}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!isLoading && recordData.records.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="没有符合条件的 Key 记录"
            description={hasActiveFilters
              ? "试试调整或重置筛选条件。"
              : "通过实例工作区导入渠道后，记录会出现在这里。"}
            action={hasActiveFilters ? (
              <button className="btn btn-outline" type="button" onClick={resetFilters}>重置筛选</button>
            ) : null}
          />
        ) : null}
        <Pagination
          page={recordData.page}
          totalPages={recordData.totalPages}
          total={recordData.total}
          pageSize={recordData.pageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          disabled={isLoading}
          onPageChange={changePage}
          onPageSizeChange={changePageSize}
        />
      </div>

      <ConfirmDialog
        open={pendingDeletionRecordIds.length > 0}
        title={pendingDeletionRecordIds.length === 1 ? "删除这条记录？" : "批量删除记录？"}
        confirmLabel={`确认删除 ${pendingDeletionRecordIds.length} 条`}
        busyLabel="正在删除..."
        isBusy={isDeleting}
        onConfirm={deleteRecords}
        onCancel={() => setPendingDeletionRecordIds([])}
      >
        <p>
          将永久删除本系统中的 {pendingDeletionRecordIds.length} 条 Key 记录，
          包括本地用量历史和已加密的完整 Key。
        </p>
        <p className="callout callout-warning">
          New API 上游真实渠道不会被删除；删除后，本系统也不会再同步这些渠道。
        </p>
      </ConfirmDialog>
    </div>
  );
}
