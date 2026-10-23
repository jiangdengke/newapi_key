"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  FileInput,
  History,
  Inbox,
  KeyRound,
  ListChecks,
  RefreshCw,
  Rocket,
  Search,
  Wallet,
} from "lucide-react";

import { readJsonResponse, requestJson } from "../lib/client-api.js";
import { formatDateTime, formatUsd } from "../lib/format.js";
import { showToast } from "../lib/toast.js";
import {
  EmptyState,
  Field,
  PageHeader,
  Pagination,
  PasswordInput,
  Segmented,
  Select,
  Spinner,
  StatCard,
  StatusText,
  Switch,
} from "./ui.js";

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
const AUTOMATIC_SYNCHRONIZATION_INTERVAL_MILLISECONDS = 30_000;
const CLAUDE_CHANNEL_KIND = "claude";
const OPENAI_CHANNEL_KIND = "openai";
const GROK_CHANNEL_KIND = "grok";
const CHANNEL_KIND_OPTIONS = [
  { value: "claude", label: "Claude" },
  { value: "openai", label: "OpenAI" },
  { value: "grok", label: "Grok" },
];
const WORKSPACE_VIEW_OPTIONS = [
  { value: "import", label: "渠道导入", icon: FileInput },
  { value: "records", label: "导入记录", icon: History },
];
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

export default function InstanceWorkspace({
  instanceId,
  view,
  onViewChange,
  isAdministrator,
  onBack,
}) {
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

  const configuredInstanceId = configuration?.instance.id;

  useEffect(() => {
    if (configuredInstanceId) {
      loadAvailableGroups();
    }
  }, [instanceId, configuredInstanceId]);

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
    const selectedGroup = selectedGroups[channelKind] ?? "";
    if (!availableGroups.includes(selectedGroup)) {
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
          group: selectedGroup,
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

  async function changeHistoryPageSize(nextPageSize) {
    try {
      await loadHistory({
        ...historyQuery,
        page: 1,
        pageSize: nextPageSize,
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

  const backButton = isAdministrator ? (
    <button className="btn btn-ghost btn-sm back-button" type="button" onClick={onBack}>
      <ArrowLeft size={14} aria-hidden="true" />
      返回实例列表
    </button>
  ) : null;

  if (!configuration) {
    return (
      <div className="page">
        {backButton}
        <div className="page-loading">
          {pageError ? null : <Spinner size={20} />}
          <p>{pageError || "正在读取实例配置..."}</p>
        </div>
      </div>
    );
  }

  const instance = configuration.instance;
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
  const selectedGroup = selectedGroups[selectedChannelKind] ?? "";
  const selectedAvailableGroup = availableGroups.includes(selectedGroup)
    ? selectedGroup
    : "";
  const isGroupSelectionUnavailable = isLoadingGroups || !selectedAvailableGroup;
  const selectedChannelDescription = (
    `${selectedChannelDetails.description}，分组从当前 New API 已有分组中选择。`
  );
  const progressPercentage = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0;

  return (
    <div className="page">
      {backButton}
      <PageHeader
        title={instance.name}
        description={`New API：${instance.baseUrl}`}
        actions={(
          <>
            <StatusText status={instance.enabled ? "enabled" : "disabled"}>
              {instance.enabled ? "实例已启用" : "实例已停用"}
            </StatusText>
            {isAdministrator ? (
              <Segmented
                options={WORKSPACE_VIEW_OPTIONS}
                value={view}
                onChange={onViewChange}
                ariaLabel="切换工作区页面"
              />
            ) : null}
          </>
        )}
      />

      {pageError ? <p className="callout callout-error">{pageError}</p> : null}

      {view === "import" ? (
        <div className="workspace-grid">
          <form
            className="card"
            onSubmit={(event) => importChannels(event, selectedChannelKind)}
            autoComplete="off"
          >
            <div className="card-header">
              <div>
                <h2>导入 {selectedChannelDetails.label} 渠道</h2>
                <p>{selectedChannelDescription}</p>
              </div>
            </div>
            <Segmented
              options={CHANNEL_KIND_OPTIONS}
              value={selectedChannelKind}
              onChange={setSelectedChannelKind}
              disabled={isImporting}
              ariaLabel="选择导入渠道类型"
            />
            <Field
              label="分组"
              error={groupError}
              extra={(
                <button
                  className="btn btn-ghost btn-xs"
                  type="button"
                  disabled={!instance.enabled || isImporting || isLoadingGroups}
                  onClick={() => loadAvailableGroups({ showSuccess: true })}
                >
                  <RefreshCw size={13} className={isLoadingGroups ? "spin" : ""} aria-hidden="true" />
                  {isLoadingGroups ? "加载中..." : "刷新分组"}
                </button>
              )}
            >
              <Select
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
              </Select>
            </Field>
            <Field
              label={selectedChannelDetails.keyLabel}
              extra={(
                <span className="field-counter">
                  共 {selectedInput.uniqueKeys.length} 个有效 Key
                </span>
              )}
            >
              <textarea
                className="textarea textarea-mono"
                rows="10"
                placeholder={selectedChannelDetails.keyPlaceholder}
                spellCheck="false"
                value={selectedInput.keysText}
                onChange={(event) => selectedInput.setKeysText(event.target.value)}
                disabled={!instance.enabled || isImporting}
                required
              />
            </Field>
            {!instance.enabled ? (
              <p className="callout callout-warning">该实例已停用，暂时无法导入渠道。</p>
            ) : null}
            <div className="card-actions">
              <button
                className="btn btn-primary"
                disabled={!instance.enabled || isImporting || isGroupSelectionUnavailable}
              >
                {isImporting ? <Spinner /> : <Rocket size={15} aria-hidden="true" />}
                {isImporting ? "正在创建..." : `开始创建 ${selectedChannelDetails.label} 渠道`}
              </button>
            </div>
          </form>

          <section className={`card result-card ${progress.fatal ? "has-fatal-error" : ""}`} aria-live="polite">
            <div className="card-header">
              <div>
                <h2>执行反馈</h2>
                <p>{progress.summary}</p>
              </div>
            </div>
            <div className="result-counters">
              <span className="counter">总数 <strong>{progress.total}</strong></span>
              <span className="counter counter-success">成功 <strong>{progress.success}</strong></span>
              <span className="counter counter-failure">失败 <strong>{progress.failure}</strong></span>
            </div>
            <div className="progress-track" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${progressPercentage}%` }} />
            </div>
            {progress.results.length === 0 ? (
              <EmptyState
                icon={ListChecks}
                title="等待提交"
                description="提交后将在这里逐条显示每个渠道的创建结果。"
              />
            ) : (
              <ul className="result-list">
                {progress.results.map((result) => (
                  <li className={`result-item result-${result.status}`} key={result.index}>
                    <span className="result-icon" aria-hidden="true">
                      {result.status === "success" ? <CircleCheck size={16} />
                        : result.status === "failure" ? <CircleX size={16} />
                          : <Spinner size={16} />}
                    </span>
                    <div>
                      <strong>{result.name}</strong>
                      <span>{result.message}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard icon={ListChecks} label="已导入渠道" value={historyData.total} hint={historyQuery.key ? "按当前 Key 查询统计" : "通过本工具导入的渠道"} />
            <StatCard icon={Wallet} label="余额合计" value={formatUsd(historyData.totalBalanceUsd)} hint="来自 New API 渠道余额" tone="success" />
            <StatCard icon={KeyRound} label="累计用量" value={formatUsd(historyData.totalUsedUsd)} hint="used_quota 换算为美元" tone="info" />
          </div>

          <div className="toolbar-row">
            <form className="toolbar" autoComplete="off" onSubmit={submitHistorySearch}>
              <PasswordInput
                className="toolbar-input toolbar-input-wide"
                aria-label="完整 Key"
                placeholder="粘贴完整 Key 精确查询..."
                spellCheck="false"
                value={historySearchInput}
                onChange={(event) => setHistorySearchInput(event.target.value)}
              />
              <button className="btn btn-outline">
                <Search size={15} aria-hidden="true" />
                查询
              </button>
              <button className="btn btn-ghost" type="button" onClick={clearHistorySearch}>清除</button>
            </form>
            <div className="toolbar-actions">
              <Switch
                checked={isAutomaticSynchronizationEnabled}
                onChange={setIsAutomaticSynchronizationEnabled}
                disabled={!instance.enabled || isImporting}
                label="自动同步（30 秒）"
              />
              <button
                className="btn btn-primary"
                type="button"
                disabled={!instance.enabled || isImporting || isSynchronizing}
                onClick={() => synchronizeHistory()}
              >
                <RefreshCw size={15} className={isSynchronizing ? "spin" : ""} aria-hidden="true" />
                {isSynchronizing ? "正在同步..." : "刷新余额和用量"}
              </button>
            </div>
          </div>

          <div className="table-meta" aria-live="polite"><span>{historyMessage}</span></div>

          <div className="table-card">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>渠道</th>
                    <th>Key</th>
                    <th>状态</th>
                    <th className="align-right">余额</th>
                    <th className="align-right">累计用量</th>
                    <th>导入时间</th>
                    <th>最后同步</th>
                  </tr>
                </thead>
                <tbody>
                  {historyData.records.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <div className="cell-stack">
                          <strong>{record.channelName}</strong>
                          <span className="cell-muted">ID {record.newApiChannelId} · {record.group}</span>
                        </div>
                      </td>
                      <td><span className="cell-mono">{record.keyMask}</span></td>
                      <td><StatusText status={record.statusLabel} /></td>
                      <td className="align-right cell-number">{formatUsd(record.balanceUsd)}</td>
                      <td className="align-right cell-number">{formatUsd(record.usedUsd)}</td>
                      <td className="cell-muted">{formatDateTime(record.importedAt)}</td>
                      <td className="cell-muted">{formatDateTime(record.lastSyncedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {historyData.records.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={historyQuery.key ? "没有找到该 Key 对应的渠道" : "暂时没有导入记录"}
                description={historyQuery.key ? "请确认粘贴的是完整 Key。" : "在“渠道导入”中提交 Key 后，渠道会出现在这里。"}
                action={!historyQuery.key ? (
                  <button className="btn btn-outline" type="button" onClick={() => onViewChange("import")}>
                    <FileInput size={15} aria-hidden="true" />
                    去导入渠道
                  </button>
                ) : null}
              />
            ) : null}
            <Pagination
              page={historyData.page}
              totalPages={historyData.totalPages}
              total={historyData.total}
              pageSize={historyData.pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageChange={changeHistoryPage}
              onPageSizeChange={changeHistoryPageSize}
            />
          </div>
        </>
      )}
    </div>
  );
}
