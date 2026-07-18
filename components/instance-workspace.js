"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { readJsonResponse, requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const AUTOMATIC_SYNCHRONIZATION_INTERVAL_MILLISECONDS = 30_000;
const CLAUDE_CHANNEL_KIND = "claude";
const OPENAI_CHANNEL_KIND = "openai";
const GROK_CHANNEL_KIND = "grok";
const CHANNEL_KIND_DETAILS = Object.freeze({
  [CLAUDE_CHANNEL_KIND]: Object.freeze({
    label: "Claude",
    keyLabel: "Anthropic Key",
    keyPlaceholder: "每行粘贴一个 Anthropic Key",
    description: "使用 Anthropic Key，固定创建现有三个 Claude Opus 模型",
    defaultGroup: "anthropic",
  }),
  [OPENAI_CHANNEL_KIND]: Object.freeze({
    label: "OpenAI",
    keyLabel: "OpenAI Key",
    keyPlaceholder: "每行粘贴一个官方 OpenAI Key",
    description: "使用官方 OpenAI Key，固定模型为 gpt-5.6-sol",
    defaultGroup: "openai",
  }),
  [GROK_CHANNEL_KIND]: Object.freeze({
    label: "Grok",
    keyLabel: "xAI Key",
    keyPlaceholder: "每行粘贴一个官方 xAI Key",
    description: "使用官方 xAI Key，固定创建 10 个 Grok 模型",
    defaultGroup: "xai",
  }),
});

function createDefaultSelectedGroups() {
  return Object.fromEntries(
    Object.entries(CHANNEL_KIND_DETAILS).map(([channelKind, channelDetails]) => (
      [channelKind, channelDetails.defaultGroup]
    )),
  );
}

function getChannelKindDetails(channelKind) {
  return CHANNEL_KIND_DETAILS[channelKind] ?? CHANNEL_KIND_DETAILS[CLAUDE_CHANNEL_KIND];
}

function getChannelKindLabel(channelKind) {
  return getChannelKindDetails(channelKind).label;
}

function chooseAvailableGroup(availableGroups, currentGroup, defaultGroup) {
  if (availableGroups.includes(currentGroup)) {
    return currentGroup;
  }
  if (availableGroups.includes(defaultGroup)) {
    return defaultGroup;
  }
  return availableGroups[0] ?? "";
}

function createInitialProgress() {
  return {
    summary: "等待提交",
    total: 0,
    completed: 0,
    success: 0,
    failure: 0,
    results: [],
    fatal: false,
  };
}

function normalizeKeyLines(rawKeys) {
  const uniqueKeys = [];
  const seenKeys = new Set();
  for (const keyLine of String(rawKeys).split(/\r?\n/)) {
    const normalizedKey = keyLine.trim();
    if (!normalizedKey || seenKeys.has(normalizedKey)) {
      continue;
    }
    seenKeys.add(normalizedKey);
    uniqueKeys.push(normalizedKey);
  }
  return uniqueKeys;
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

function formatDateTime(rawDateTime) {
  if (!rawDateTime) {
    return "尚未同步";
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

function showUsageStartedNotifications(usageStartedRecords) {
  for (const usageStartedRecord of usageStartedRecords || []) {
    showToast(
      `Key ${usageStartedRecord.keyMask} 对应渠道 `
      + `${usageStartedRecord.channelName} 已开始产生用量，当前累计 `
      + formatUsd(usageStartedRecord.usedUsd),
      { type: "info" },
    );
  }
}

export default function InstanceWorkspace({ instanceId, canGoBack, onGoBack }) {
  const [configuration, setConfiguration] = useState(null);
  const [claudeKeysText, setClaudeKeysText] = useState("");
  const [openAiKeysText, setOpenAiKeysText] = useState("");
  const [grokKeysText, setGrokKeysText] = useState("");
  const [selectedChannelKind, setSelectedChannelKind] = useState(CLAUDE_CHANNEL_KIND);
  const [availableGroups, setAvailableGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState(createDefaultSelectedGroups);
  const [isLoadingGroups, setIsLoadingGroups] = useState(false);
  const [groupError, setGroupError] = useState("");
  const [progress, setProgress] = useState(createInitialProgress);
  const [isImporting, setIsImporting] = useState(false);
  const [isSynchronizing, setIsSynchronizing] = useState(false);
  const [isAutomaticSynchronizationEnabled, setIsAutomaticSynchronizationEnabled] = useState(false);
  const [historySearchInput, setHistorySearchInput] = useState("");
  const [historyQuery, setHistoryQuery] = useState({
    key: "",
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const [historyData, setHistoryData] = useState({
    records: [],
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    totalBalanceUsd: 0,
    totalUsedUsd: 0,
  });
  const [historyMessage, setHistoryMessage] = useState("正在读取本地记录...");
  const [pageError, setPageError] = useState("");
  const synchronizationInProgressRef = useRef(false);
  const automaticSynchronizationRef = useRef(null);
  const groupRequestVersionRef = useRef(0);
  const uniqueClaudeKeys = useMemo(
    () => normalizeKeyLines(claudeKeysText),
    [claudeKeysText],
  );
  const uniqueOpenAiKeys = useMemo(
    () => normalizeKeyLines(openAiKeysText),
    [openAiKeysText],
  );
  const uniqueGrokKeys = useMemo(
    () => normalizeKeyLines(grokKeysText),
    [grokKeysText],
  );

  async function loadConfiguration() {
    const responsePayload = await requestJson(`/api/instances/${instanceId}/config`);
    setConfiguration(responsePayload.data);
  }

  async function loadAvailableGroups({ showSuccess = false } = {}) {
    const requestVersion = groupRequestVersionRef.current + 1;
    groupRequestVersionRef.current = requestVersion;
    setIsLoadingGroups(true);
    setGroupError("");
    try {
      const responsePayload = await requestJson(`/api/instances/${instanceId}/groups`);
      if (groupRequestVersionRef.current !== requestVersion) {
        return;
      }
      const loadedGroups = responsePayload.data.groups;
      setAvailableGroups(loadedGroups);
      setSelectedGroups((currentSelectedGroups) => Object.fromEntries(
        Object.entries(CHANNEL_KIND_DETAILS).map(([channelKind, channelDetails]) => [
          channelKind,
          chooseAvailableGroup(
            loadedGroups,
            currentSelectedGroups[channelKind],
            channelDetails.defaultGroup,
          ),
        ]),
      ));
      if (loadedGroups.length === 0) {
        setGroupError("当前 New API 没有可选分组");
      } else if (showSuccess) {
        showToast(`已刷新 ${loadedGroups.length} 个可用分组`, { type: "success" });
      }
    } catch (error) {
      if (groupRequestVersionRef.current !== requestVersion) {
        return;
      }
      const errorMessage = error?.message || "读取 New API 分组失败";
      setAvailableGroups([]);
      setGroupError(errorMessage);
      showToast(errorMessage, { type: "error" });
    } finally {
      if (groupRequestVersionRef.current === requestVersion) {
        setIsLoadingGroups(false);
      }
    }
  }

  async function loadHistory(nextQuery = historyQuery) {
    const responsePayload = await requestJson(
      `/api/instances/${instanceId}/records/query`,
      {
        method: "POST",
        body: JSON.stringify(nextQuery),
      },
    );
    setHistoryQuery({
      key: nextQuery.key,
      page: responsePayload.data.page,
      pageSize: responsePayload.data.pageSize,
    });
    setHistoryData(responsePayload.data);
    setHistoryMessage(
      `共 ${responsePayload.data.total} 条本地记录，余额 `
      + formatUsd(responsePayload.data.totalBalanceUsd)
      + "，累计用量 "
      + formatUsd(responsePayload.data.totalUsedUsd),
    );
    return responsePayload.data;
  }

  useEffect(() => {
    let isActive = true;
    groupRequestVersionRef.current += 1;
    setConfiguration(null);
    setPageError("");
    setAvailableGroups([]);
    setSelectedGroups(createDefaultSelectedGroups());
    setIsLoadingGroups(false);
    setGroupError("");
    setHistoryQuery({ key: "", page: 1, pageSize: DEFAULT_PAGE_SIZE });
    setHistorySearchInput("");
    Promise.all([
      requestJson(`/api/instances/${instanceId}/config`),
      requestJson(`/api/instances/${instanceId}/records/query`, {
        method: "POST",
        body: JSON.stringify({ key: "", page: 1, pageSize: DEFAULT_PAGE_SIZE }),
      }),
    ]).then(([configurationPayload, historyPayload]) => {
      if (!isActive) {
        return;
      }
      setConfiguration(configurationPayload.data);
      setHistoryData(historyPayload.data);
      setHistoryMessage(
        `共 ${historyPayload.data.total} 条本地记录，余额 `
        + formatUsd(historyPayload.data.totalBalanceUsd)
        + "，累计用量 "
        + formatUsd(historyPayload.data.totalUsedUsd),
      );
    }).catch((error) => {
      if (isActive) {
        const errorMessage = error?.message || "读取实例失败";
        setPageError(errorMessage);
        showToast(errorMessage, { type: "error" });
      }
    });
    return () => {
      isActive = false;
    };
  }, [instanceId]);

  useEffect(() => {
    if (configuration?.instance.connectionProtocol === "new-api") {
      loadAvailableGroups();
    }
  }, [instanceId, configuration?.instance.connectionProtocol]);

  useEffect(() => {
    if (
      configuration?.instance.connectionProtocol !== "new-api"
      && selectedChannelKind === GROK_CHANNEL_KIND
    ) {
      setSelectedChannelKind(CLAUDE_CHANNEL_KIND);
    }
  }, [configuration, selectedChannelKind]);

  function processProgressEvent(event, successfulKeyIndexes) {
    if (event.type === "ready") {
      const channelKindLabel = getChannelKindLabel(event.channelKind);
      setProgress((current) => ({
        ...current,
        summary: (
          `已连接 ${event.systemName} ${event.version}，`
          + `开始创建 ${event.total} 个 ${channelKindLabel} 渠道`
        ),
      }));
      return;
    }
    if (event.type === "item-start") {
      setProgress((current) => ({
        ...current,
        results: [
          ...current.results,
          { index: event.index, name: event.name, status: "pending", message: "正在创建渠道" },
        ],
      }));
      return;
    }
    if (event.type === "item-result") {
      if (event.success) {
        successfulKeyIndexes.add(event.index);
      }
      setProgress((current) => ({
        ...current,
        completed: current.completed + 1,
        success: current.success + (event.success ? 1 : 0),
        failure: current.failure + (event.success ? 0 : 1),
        results: current.results.map((result) => (
          result.index === event.index
            ? {
              ...result,
              name: event.name,
              status: event.success ? "success" : "failure",
              message: event.message,
            }
            : result
        )),
      }));
      return;
    }
    if (event.type === "complete") {
      const completionMessage = event.failure === 0
        ? `创建完成，${event.success} 个渠道全部成功`
        : `创建完成：成功 ${event.success} 个，失败 ${event.failure} 个`;
      setProgress((current) => ({
        ...current,
        summary: completionMessage,
      }));
      showToast(completionMessage, {
        type: event.failure === 0 ? "success" : "error",
      });
      return;
    }
    if (event.type === "fatal") {
      const fatalMessage = `导入中止：${event.message}`;
      setProgress((current) => ({
        ...current,
        fatal: true,
        summary: fatalMessage,
      }));
      showToast(fatalMessage, { type: "error" });
    }
  }

  async function importChannels(event, channelKind) {
    event.preventDefault();
    const importInputByChannelKind = {
      [CLAUDE_CHANNEL_KIND]: {
        uniqueKeys: uniqueClaudeKeys,
        setKeysText: setClaudeKeysText,
      },
      [OPENAI_CHANNEL_KIND]: {
        uniqueKeys: uniqueOpenAiKeys,
        setKeysText: setOpenAiKeysText,
      },
      [GROK_CHANNEL_KIND]: {
        uniqueKeys: uniqueGrokKeys,
        setKeysText: setGrokKeysText,
      },
    };
    const selectedImportInput = importInputByChannelKind[channelKind]
      ?? importInputByChannelKind[CLAUDE_CHANNEL_KIND];
    const { uniqueKeys, setKeysText } = selectedImportInput;
    const channelKindLabel = getChannelKindLabel(channelKind);
    const requiresGroupSelection = (
      configuration?.instance.connectionProtocol === "new-api"
    );
    const selectedGroup = selectedGroups[channelKind] ?? "";
    if (requiresGroupSelection && !availableGroups.includes(selectedGroup)) {
      const errorMessage = groupError || "请先选择一个当前可用的分组";
      setPageError(errorMessage);
      showToast(errorMessage, { type: "error" });
      return;
    }
    if (uniqueKeys.length === 0) {
      const errorMessage = `请至少填写一个 ${channelKindLabel} Key`;
      setPageError(errorMessage);
      showToast(errorMessage, { type: "error" });
      return;
    }
    setPageError("");
    setIsImporting(true);
    setProgress({
      ...createInitialProgress(),
      summary: `正在为 ${channelKindLabel} 导入查询同前缀渠道...`,
      total: uniqueKeys.length,
    });
    const successfulKeyIndexes = new Set();
    try {
      const response = await fetch(`/api/instances/${instanceId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: uniqueKeys,
          channelKind,
          ...(requiresGroupSelection ? { group: selectedGroup } : {}),
        }),
      });
      if (!response.ok || !response.body) {
        await readJsonResponse(response);
        throw new Error("无法读取导入结果");
      }
      const streamReader = response.body.getReader();
      const textDecoder = new TextDecoder();
      let remainingText = "";
      while (true) {
        const { done, value } = await streamReader.read();
        remainingText += textDecoder.decode(value || new Uint8Array(), { stream: !done });
        const responseLines = remainingText.split("\n");
        remainingText = responseLines.pop() || "";
        for (const responseLine of responseLines) {
          if (responseLine.trim()) {
            processProgressEvent(JSON.parse(responseLine), successfulKeyIndexes);
          }
        }
        if (done) {
          break;
        }
      }
      if (remainingText.trim()) {
        processProgressEvent(JSON.parse(remainingText), successfulKeyIndexes);
      }
    } catch (error) {
      const errorMessage = error?.message || "导入请求中断";
      setPageError(errorMessage);
      showToast(errorMessage, { type: "error" });
    } finally {
      setKeysText(
        uniqueKeys.filter((key, keyIndex) => !successfulKeyIndexes.has(keyIndex)).join("\n"),
      );
      setIsImporting(false);
      try {
        await loadHistory({ ...historyQuery, page: 1 });
      } catch (error) {
        const errorMessage = `读取历史记录失败：${error?.message || "未知错误"}`;
        setHistoryMessage(errorMessage);
        showToast(errorMessage, { type: "error" });
      }
    }
  }

  async function submitHistorySearch(event) {
    event.preventDefault();
    try {
      const loadedHistoryData = await loadHistory({
        key: historySearchInput.trim(),
        page: 1,
        pageSize: historyQuery.pageSize,
      });
      showToast(`查询完成，共找到 ${loadedHistoryData.total} 条记录`, { type: "success" });
    } catch (error) {
      const errorMessage = `查询失败：${error?.message || "未知错误"}`;
      setHistoryMessage(errorMessage);
      showToast(errorMessage, { type: "error" });
    }
  }

  async function clearHistorySearch() {
    setHistorySearchInput("");
    try {
      await loadHistory({
        key: "",
        page: 1,
        pageSize: historyQuery.pageSize,
      });
      showToast("已清除 Key 查询条件", { type: "info" });
    } catch (error) {
      const errorMessage = `读取历史记录失败：${error?.message || "未知错误"}`;
      setHistoryMessage(errorMessage);
      showToast(errorMessage, { type: "error" });
    }
  }

  async function changeHistoryPage(nextPage) {
    try {
      await loadHistory({ ...historyQuery, page: nextPage });
    } catch (error) {
      const errorMessage = `翻页失败：${error?.message || "未知错误"}`;
      setHistoryMessage(errorMessage);
      showToast(errorMessage, { type: "error" });
    }
  }

  async function changeHistoryPageSize(event) {
    try {
      await loadHistory({
        ...historyQuery,
        page: 1,
        pageSize: Number(event.target.value),
      });
    } catch (error) {
      const errorMessage = `调整每页数量失败：${error?.message || "未知错误"}`;
      setHistoryMessage(errorMessage);
      showToast(errorMessage, { type: "error" });
    }
  }

  async function synchronizeHistory({ automatic = false } = {}) {
    if (synchronizationInProgressRef.current) {
      return;
    }
    synchronizationInProgressRef.current = true;
    setIsSynchronizing(true);
    if (!automatic) {
      setHistoryMessage("正在从 New API 同步渠道状态、余额和用量...");
    }
    try {
      const responsePayload = await requestJson(
        `/api/instances/${instanceId}/records/sync`,
        { method: "POST", body: "{}" },
      );
      await loadHistory(historyQuery);
      showUsageStartedNotifications(responsePayload.data.usageStartedRecords);
      const missingMessage = responsePayload.data.missingCount > 0
        ? `，${responsePayload.data.missingCount} 个渠道不存在`
        : "";
      const successMessage = (
        `已同步 ${responsePayload.data.synchronizedCount} 个渠道${missingMessage}`
      );
      setHistoryMessage(successMessage);
      if (!automatic) {
        showToast(successMessage, { type: "success" });
      }
    } catch (error) {
      const errorMessage = `同步失败：${error?.message || "未知错误"}`;
      setHistoryMessage(errorMessage);
      if (!automatic) {
        showToast(errorMessage, { type: "error" });
      }
    } finally {
      synchronizationInProgressRef.current = false;
      setIsSynchronizing(false);
    }
  }

  automaticSynchronizationRef.current = () => {
    if (!isImporting && !synchronizationInProgressRef.current) {
      synchronizeHistory({ automatic: true });
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

  if (!configuration) {
    return (
      <main className="loading-page compact-loading">
        <div className="loading-indicator" />
        <p>{pageError || "正在读取实例配置..."}</p>
        {canGoBack ? <button className="button button-secondary" type="button" onClick={onGoBack}>返回管理端</button> : null}
      </main>
    );
  }

  const instance = configuration.instance;
  const supportsGrokImport = instance.connectionProtocol === "new-api";
  const isClaudeSelected = selectedChannelKind === CLAUDE_CHANNEL_KIND;
  const isOpenAiSelected = selectedChannelKind === OPENAI_CHANNEL_KIND;
  const isGrokSelected = selectedChannelKind === GROK_CHANNEL_KIND;
  const selectedChannelDetails = getChannelKindDetails(selectedChannelKind);
  const selectedInputByChannelKind = {
    [CLAUDE_CHANNEL_KIND]: {
      keysText: claudeKeysText,
      uniqueKeys: uniqueClaudeKeys,
      setKeysText: setClaudeKeysText,
    },
    [OPENAI_CHANNEL_KIND]: {
      keysText: openAiKeysText,
      uniqueKeys: uniqueOpenAiKeys,
      setKeysText: setOpenAiKeysText,
    },
    [GROK_CHANNEL_KIND]: {
      keysText: grokKeysText,
      uniqueKeys: uniqueGrokKeys,
      setKeysText: setGrokKeysText,
    },
  };
  const selectedInput = selectedInputByChannelKind[selectedChannelKind]
    ?? selectedInputByChannelKind[CLAUDE_CHANNEL_KIND];
  const supportsGroupSelection = instance.connectionProtocol === "new-api";
  const selectedGroup = selectedGroups[selectedChannelKind] ?? "";
  const selectedAvailableGroup = availableGroups.includes(selectedGroup)
    ? selectedGroup
    : "";
  const isGroupSelectionUnavailable = (
    supportsGroupSelection
    && (isLoadingGroups || !selectedAvailableGroup)
  );
  const selectedChannelDescription = supportsGroupSelection
    ? `${selectedChannelDetails.description}，分组从当前 New API 已有分组中选择。`
    : `${selectedChannelDetails.description}，分组固定为 ${selectedChannelDetails.defaultGroup}。`;
  const progressPercentage = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <main className="page-shell workspace-page">
      <div className="page-title-row">
        <div>
          {canGoBack ? <button className="back-link" type="button" onClick={onGoBack}>← 返回管理端</button> : null}
          <p className="eyebrow">INSTANCE WORKSPACE</p>
          <h1>{instance.name}</h1>
          <p className="page-description instance-url">当前 New API：{instance.baseUrl}</p>
        </div>
        <span className={`instance-state ${instance.enabled ? "enabled" : "disabled"}`}>
          {instance.enabled ? "实例已启用" : "实例已停用"}
        </span>
      </div>

      {pageError ? <p className="form-error panel-message">{pageError}</p> : null}

      <form
        onSubmit={(event) => importChannels(event, selectedChannelKind)}
        autoComplete="off"
      >
        <section className="panel">
          <div
            className={`channel-kind-switch ${supportsGrokImport ? "three-options" : ""}`}
            aria-label="选择导入渠道类型"
          >
            <button
              className={`channel-kind-option ${isClaudeSelected ? "active" : ""}`}
              type="button"
              aria-pressed={isClaudeSelected}
              disabled={isImporting}
              onClick={() => setSelectedChannelKind(CLAUDE_CHANNEL_KIND)}
            >
              Claude 渠道
            </button>
            <button
              className={`channel-kind-option ${isOpenAiSelected ? "active" : ""}`}
              type="button"
              aria-pressed={isOpenAiSelected}
              disabled={isImporting}
              onClick={() => setSelectedChannelKind(OPENAI_CHANNEL_KIND)}
            >
              OpenAI 渠道
            </button>
            {supportsGrokImport ? (
              <button
                className={`channel-kind-option ${isGrokSelected ? "active" : ""}`}
                type="button"
                aria-pressed={isGrokSelected}
                disabled={isImporting}
                onClick={() => setSelectedChannelKind(GROK_CHANNEL_KIND)}
              >
                Grok 渠道
              </button>
            ) : null}
          </div>
          <div className="panel-heading">
            <div>
              <h2>导入 {selectedChannelDetails.label} 渠道</h2>
              <p>{selectedChannelDescription}</p>
            </div>
          </div>
          {supportsGroupSelection ? (
            <label className="field channel-group-field">
              <span>分组</span>
              <div className="channel-group-picker">
                <select
                  value={selectedAvailableGroup}
                  disabled={!instance.enabled || isImporting || isLoadingGroups}
                  onChange={(event) => setSelectedGroups((currentSelectedGroups) => ({
                    ...currentSelectedGroups,
                    [selectedChannelKind]: event.target.value,
                  }))}
                  required
                >
                  {availableGroups.length === 0 ? (
                    <option value="">
                      {isLoadingGroups ? "正在加载分组..." : "没有可用分组"}
                    </option>
                  ) : availableGroups.map((group) => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={!instance.enabled || isImporting || isLoadingGroups}
                  onClick={() => loadAvailableGroups({ showSuccess: true })}
                >
                  {isLoadingGroups ? "加载中..." : "刷新分组"}
                </button>
              </div>
              {groupError ? <small className="channel-group-message">{groupError}</small> : null}
            </label>
          ) : null}
          <label className="field">
            <span>{selectedChannelDetails.keyLabel}</span>
            <textarea
              rows="7"
              placeholder={selectedChannelDetails.keyPlaceholder}
              spellCheck="false"
              value={selectedInput.keysText}
              onChange={(event) => selectedInput.setKeysText(event.target.value)}
              disabled={!instance.enabled || isImporting}
              required
            />
          </label>
          <div className="key-summary">
            <span>
              共 {selectedInput.uniqueKeys.length} 个有效 {selectedChannelDetails.label} Key
            </span>
          </div>
          <div className="submit-row">
            <button
              className="button button-primary"
              disabled={!instance.enabled || isImporting || isGroupSelectionUnavailable}
            >
              {isImporting ? "正在创建..." : `开始创建 ${selectedChannelDetails.label} 渠道`}
            </button>
          </div>
        </section>
      </form>

      <section className={`panel result-panel ${progress.fatal ? "has-fatal-error" : ""}`} aria-live="polite">
        <div className="result-header">
          <div><h2>执行反馈</h2><p>{progress.summary}</p></div>
          <div className="result-counters">
            <span className="counter counter-total">总数 <strong>{progress.total}</strong></span>
            <span className="counter counter-success">成功 <strong>{progress.success}</strong></span>
            <span className="counter counter-failure">失败 <strong>{progress.failure}</strong></span>
          </div>
        </div>
        <div className="progress-track" aria-hidden="true"><div className="progress-fill" style={{ width: `${progressPercentage}%` }} /></div>
        <div className="result-list">
          {progress.results.length === 0 ? <div className="empty-state">提交后将在这里逐条显示创建结果。</div> : null}
          {progress.results.map((result) => (
            <div className={`result-item result-${result.status}`} key={result.index}>
              <span className="result-status">{result.status === "success" ? "✓" : result.status === "failure" ? "!" : "..."}</span>
              <div><strong>{result.name}</strong><span className="result-message">{result.message}</span></div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel history-panel" aria-live="polite">
        <div className="history-header">
          <div><h2>已导入渠道</h2><p>{historyMessage}</p></div>
          <div className="record-sync-actions">
            <label className="automatic-sync-control">
              <input
                type="checkbox"
                checked={isAutomaticSynchronizationEnabled}
                disabled={!instance.enabled || isImporting}
                onChange={(event) => setIsAutomaticSynchronizationEnabled(
                  event.target.checked,
                )}
              />
              自动同步（30 秒）
            </label>
            <button
              className="button button-secondary"
              type="button"
              disabled={!instance.enabled || isImporting || isSynchronizing}
              onClick={() => synchronizeHistory()}
            >
              {isSynchronizing ? "正在同步..." : "刷新余额和用量"}
            </button>
          </div>
        </div>
        <form className="history-search-form" autoComplete="off" onSubmit={submitHistorySearch}>
          <input type="password" placeholder="粘贴完整 Key 精确查询" spellCheck="false" value={historySearchInput} onChange={(event) => setHistorySearchInput(event.target.value)} />
          <button className="button button-secondary">查询</button>
          <button className="button button-secondary" type="button" onClick={clearHistorySearch}>清除</button>
        </form>
        <div className="history-table-shell">
          <table className="history-table">
            <thead><tr><th>渠道</th><th>Key</th><th>状态</th><th>余额</th><th>累计用量</th><th>导入时间</th><th>最后同步</th></tr></thead>
            <tbody>
              {historyData.records.map((record) => (
                <tr key={record.id}>
                  <td><strong>{record.channelName}</strong><small>ID {record.newApiChannelId} · {record.group}</small></td>
                  <td className="history-key">{record.keyMask}</td>
                  <td><span className={`history-status history-status-${record.statusLabel}`}>{getStatusText(record.statusLabel)}</span></td>
                  <td className="history-usage">{formatUsd(record.balanceUsd)}</td>
                  <td className="history-usage">{formatUsd(record.usedUsd)}</td>
                  <td>{formatDateTime(record.importedAt)}</td>
                  <td>{formatDateTime(record.lastSyncedAt)}</td>
                </tr>
              ))}
              {historyData.records.length === 0 ? <tr><td className="history-empty" colSpan="7">{historyQuery.key ? "没有找到该 Key 对应的渠道。" : "暂时没有通过本工具导入的渠道。"}</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="history-pagination">
          <span>第 {historyData.page} / {historyData.totalPages} 页</span>
          <div className="pagination-controls">
            <label className="page-size-control">
              <span>每页</span>
              <select value={historyData.pageSize} onChange={changeHistoryPageSize}>
                {PAGE_SIZE_OPTIONS.map((pageSize) => (
                  <option key={pageSize} value={pageSize}>{pageSize} 条</option>
                ))}
              </select>
            </label>
            <button className="button button-secondary" type="button" disabled={historyData.page <= 1} onClick={() => changeHistoryPage(historyData.page - 1)}>上一页</button>
            <button className="button button-secondary" type="button" disabled={historyData.page >= historyData.totalPages} onClick={() => changeHistoryPage(historyData.page + 1)}>下一页</button>
          </div>
        </div>
      </section>
    </main>
  );
}
