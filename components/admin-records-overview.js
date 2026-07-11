"use client";

import { useEffect, useState } from "react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";

const DEFAULT_PAGE_SIZE = 10;

function createEmptyQuery() {
  return {
    instanceId: null,
    channelName: "",
    key: "",
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

function createEmptyRecordData() {
  return {
    records: [],
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 1,
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
  const [message, setMessage] = useState("正在读取全部 Key 记录...");

  async function loadRecords(nextQuery) {
    setIsLoading(true);
    setMessage("正在读取全部 Key 记录...");
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
      setMessage(
        `共 ${loadedRecordData.total} 条记录，累计用量 `
        + formatUsd(loadedRecordData.totalUsedUsd),
      );
    } catch (error) {
      const errorMessage = `读取 Key 记录失败：${error?.message || "未知错误"}`;
      setMessage(errorMessage);
      showToast(errorMessage, { type: "error" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    setInstanceFilter("");
    setChannelNameFilter("");
    setKeyFilter("");
    loadRecords(createEmptyQuery());
  }, [refreshToken]);

  async function submitFilters(event) {
    event.preventDefault();
    await loadRecords({
      instanceId: instanceFilter ? Number(instanceFilter) : null,
      channelName: channelNameFilter.trim(),
      key: keyFilter.trim(),
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  }

  async function clearFilters() {
    setInstanceFilter("");
    setChannelNameFilter("");
    setKeyFilter("");
    await loadRecords(createEmptyQuery());
  }

  async function changePage(nextPage) {
    await loadRecords({ ...activeQuery, page: nextPage });
  }

  return (
    <section className="panel admin-records-panel" aria-busy={isLoading}>
      <div className="panel-heading">
        <div>
          <h2>全部 Key 记录</h2>
          <p>{message}</p>
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

      <div className="history-table-shell">
        <table className="history-table admin-record-table">
          <thead>
            <tr>
              <th>New API 实例</th>
              <th>渠道</th>
              <th>Key</th>
              <th>状态</th>
              <th>累计用量</th>
              <th>导入时间</th>
              <th>最后同步</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {recordData.records.map((record) => (
              <tr key={record.id}>
                <td><strong>{record.instanceName}</strong></td>
                <td>
                  <strong>{record.channelName}</strong>
                  <small>渠道 ID：{record.newApiChannelId}</small>
                </td>
                <td className="history-key">{record.keyMask}</td>
                <td>
                  <span className={`history-status history-status-${record.statusLabel}`}>
                    {getStatusText(record.statusLabel)}
                  </span>
                </td>
                <td className="history-usage">{formatUsd(record.usedUsd)}</td>
                <td>{formatDateTime(record.importedAt, "未知时间")}</td>
                <td>{formatDateTime(record.lastSyncedAt, "尚未同步")}</td>
                <td>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => onOpenInstance(record.instanceId)}
                  >
                    进入实例
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && recordData.records.length === 0 ? (
              <tr><td className="history-empty" colSpan="8">没有符合条件的 Key 记录。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="history-pagination">
        <span>第 {recordData.page} / {recordData.totalPages} 页</span>
        <div>
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
    </section>
  );
}
