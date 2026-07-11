const pageElements = {
  targetNewApi: document.querySelector("#target-new-api"),
  importForm: document.querySelector("#import-form"),
  keys: document.querySelector("#keys"),
  keyCount: document.querySelector("#key-count"),
  importButton: document.querySelector("#import-button"),
  resultPanel: document.querySelector("#result-panel"),
  resultSummary: document.querySelector("#result-summary"),
  totalCount: document.querySelector("#total-count"),
  successCount: document.querySelector("#success-count"),
  failureCount: document.querySelector("#failure-count"),
  progressFill: document.querySelector("#progress-fill"),
  resultList: document.querySelector("#result-list"),
  syncRecordsButton: document.querySelector("#sync-records-button"),
  historySummary: document.querySelector("#history-summary"),
  historyTableBody: document.querySelector("#history-table-body"),
  historySearchForm: document.querySelector("#history-search-form"),
  historyKeySearch: document.querySelector("#history-key-search"),
  clearHistorySearch: document.querySelector("#clear-history-search"),
  historyPageSummary: document.querySelector("#history-page-summary"),
  previousHistoryPage: document.querySelector("#previous-history-page"),
  nextHistoryPage: document.querySelector("#next-history-page"),
};

const historyState = {
  key: "",
  page: 1,
  pageSize: 10,
  totalPages: 1,
};

function getUniqueKeys() {
  const uniqueKeys = [];
  const seenKeys = new Set();

  for (const rawKey of pageElements.keys.value.split(/\r?\n/)) {
    const normalizedKey = rawKey.trim();
    if (!normalizedKey || seenKeys.has(normalizedKey)) {
      continue;
    }
    seenKeys.add(normalizedKey);
    uniqueKeys.push(normalizedKey);
  }

  return uniqueKeys;
}

function updateKeyCount() {
  const keyCount = getUniqueKeys().length;
  pageElements.keyCount.textContent = `共 ${keyCount} 个有效 Key`;
}

function collectImportInput(keys) {
  return { keys };
}

function setControlsBusy(isBusy) {
  pageElements.importButton.disabled = isBusy;
  pageElements.syncRecordsButton.disabled = isBusy;
  pageElements.importButton.textContent = isBusy ? "正在创建..." : "开始创建渠道";
}

async function readJsonResponse(response) {
  let responsePayload;
  try {
    responsePayload = await response.json();
  } catch {
    throw new Error(`服务返回了无法识别的响应（HTTP ${response.status}）`);
  }

  if (!response.ok || responsePayload.success !== true) {
    throw new Error(responsePayload.message || `请求失败（HTTP ${response.status}）`);
  }
  return responsePayload;
}

async function loadTargetConfiguration() {
  try {
    const response = await fetch("/api/config");
    const responsePayload = await readJsonResponse(response);
    pageElements.targetNewApi.textContent = `当前 New API：${responsePayload.data.baseUrl}`;
  } catch (error) {
    pageElements.targetNewApi.textContent =
      `当前 New API：读取失败（${error?.message || "未知错误"}）`;
  }
}

function resetResults(totalCount) {
  pageElements.totalCount.textContent = String(totalCount);
  pageElements.successCount.textContent = "0";
  pageElements.failureCount.textContent = "0";
  pageElements.progressFill.style.width = "0%";
  pageElements.resultSummary.textContent = "正在登录并查询同前缀渠道...";
  pageElements.resultList.replaceChildren();
}

function createResultRow(event) {
  const resultRow = document.createElement("div");
  resultRow.className = "result-item result-pending";
  resultRow.dataset.index = String(event.index);

  const statusIndicator = document.createElement("span");
  statusIndicator.className = "result-status";
  statusIndicator.textContent = "...";

  const resultContent = document.createElement("div");
  const channelName = document.createElement("strong");
  channelName.textContent = event.name;
  const resultMessage = document.createElement("span");
  resultMessage.className = "result-message";
  resultMessage.textContent = "正在创建渠道";
  resultContent.append(channelName, resultMessage);

  resultRow.append(statusIndicator, resultContent);
  pageElements.resultList.append(resultRow);
  return resultRow;
}

function updateResultRow(event) {
  const resultRow = pageElements.resultList.querySelector(
    `[data-index="${event.index}"]`,
  ) || createResultRow(event);
  resultRow.className = event.success
    ? "result-item result-success"
    : "result-item result-failure";
  resultRow.querySelector(".result-status").textContent = event.success ? "\u2713" : "!";
  resultRow.querySelector(".result-message").textContent = event.message;
}

function updateProgress(completedCount, totalCount) {
  const progressPercentage = totalCount > 0
    ? Math.round((completedCount / totalCount) * 100)
    : 0;
  pageElements.progressFill.style.width = `${progressPercentage}%`;
}

function handleProgressEvent(event, importState) {
  if (event.type === "ready") {
    pageElements.resultSummary.textContent =
      `已连接 ${event.systemName} ${event.version}，开始创建 ${event.total} 个渠道`;
    return;
  }

  if (event.type === "item-start") {
    createResultRow(event);
    return;
  }

  if (event.type === "item-result") {
    updateResultRow(event);
    importState.completedCount += 1;
    if (event.success) {
      importState.successCount += 1;
      importState.successfulKeyIndexes.add(event.index);
    } else {
      importState.failureCount += 1;
      importState.failedKeyIndexes.add(event.index);
    }
    pageElements.successCount.textContent = String(importState.successCount);
    pageElements.failureCount.textContent = String(importState.failureCount);
    updateProgress(importState.completedCount, importState.totalCount);
    return;
  }

  if (event.type === "complete") {
    pageElements.resultSummary.textContent = event.failure === 0
      ? `创建完成，${event.success} 个渠道全部成功`
      : `创建完成：成功 ${event.success} 个，失败 ${event.failure} 个`;
    return;
  }

  if (event.type === "fatal") {
    importState.fatalError = true;
    pageElements.resultSummary.textContent = `导入中止：${event.message}`;
    pageElements.resultPanel.classList.add("has-fatal-error");
  }
}

function formatUsd(usedUsd) {
  const normalizedAmount = Number(usedUsd) || 0;
  const maximumFractionDigits = normalizedAmount > 0 && normalizedAmount < 0.01 ? 6 : 4;
  return normalizedAmount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  });
}

function formatDateTime(rawDateTime) {
  if (!rawDateTime) {
    return "尚未同步";
  }
  const parsedDate = new Date(rawDateTime);
  if (Number.isNaN(parsedDate.getTime())) {
    return "未知时间";
  }
  return parsedDate.toLocaleString("zh-CN", { hour12: false });
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

function updateHistoryPagination(pagination) {
  historyState.page = pagination.page;
  historyState.totalPages = pagination.totalPages;
  pageElements.historyPageSummary.textContent =
    `第 ${pagination.page} / ${pagination.totalPages} 页`;
  pageElements.previousHistoryPage.disabled = pagination.page <= 1;
  pageElements.nextHistoryPage.disabled = pagination.page >= pagination.totalPages;
}

function renderHistoryRecords(records, pagination) {
  pageElements.historyTableBody.replaceChildren();
  if (!Array.isArray(records) || records.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.className = "history-empty";
    emptyCell.colSpan = 6;
    emptyCell.textContent = historyState.key
      ? "没有找到该 Key 对应的渠道。"
      : "暂时没有通过本工具导入的渠道。";
    emptyRow.append(emptyCell);
    pageElements.historyTableBody.append(emptyRow);
    pageElements.historySummary.textContent = "共 0 条本地记录";
    updateHistoryPagination(pagination);
    return;
  }

  for (const record of records) {
    const tableRow = document.createElement("tr");

    const channelCell = document.createElement("td");
    const channelName = document.createElement("strong");
    channelName.textContent = record.channelName;
    const channelMetadata = document.createElement("small");
    channelMetadata.textContent = `ID ${record.newApiChannelId} · ${record.group}`;
    channelCell.append(channelName, channelMetadata);

    const keyCell = document.createElement("td");
    keyCell.className = "history-key";
    keyCell.textContent = record.keyMask;

    const statusCell = document.createElement("td");
    const statusBadge = document.createElement("span");
    statusBadge.className = `history-status history-status-${record.statusLabel}`;
    statusBadge.textContent = getStatusText(record.statusLabel);
    statusCell.append(statusBadge);

    const usageCell = document.createElement("td");
    usageCell.className = "history-usage";
    usageCell.textContent = formatUsd(record.usedUsd);

    const importedAtCell = document.createElement("td");
    importedAtCell.textContent = formatDateTime(record.importedAt);

    const synchronizedAtCell = document.createElement("td");
    synchronizedAtCell.textContent = formatDateTime(record.lastSyncedAt);

    tableRow.append(
      channelCell,
      keyCell,
      statusCell,
      usageCell,
      importedAtCell,
      synchronizedAtCell,
    );
    pageElements.historyTableBody.append(tableRow);
  }

  pageElements.historySummary.textContent =
    `共 ${pagination.total} 条本地记录，累计用量 ${formatUsd(pagination.totalUsedUsd)}`;
  updateHistoryPagination(pagination);
}

async function loadHistoryRecords() {
  try {
    const response = await fetch("/api/records/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: historyState.key,
        page: historyState.page,
        pageSize: historyState.pageSize,
      }),
    });
    const responsePayload = await readJsonResponse(response);
    renderHistoryRecords(responsePayload.data.records, responsePayload.data);
  } catch (error) {
    pageElements.historySummary.textContent = `读取历史记录失败：${error?.message || "未知错误"}`;
  }
}

async function searchHistoryRecords(event) {
  event.preventDefault();
  historyState.key = pageElements.historyKeySearch.value.trim();
  historyState.page = 1;
  await loadHistoryRecords();
}

async function clearHistorySearch() {
  pageElements.historyKeySearch.value = "";
  historyState.key = "";
  historyState.page = 1;
  await loadHistoryRecords();
}

async function showPreviousHistoryPage() {
  if (historyState.page <= 1) {
    return;
  }
  historyState.page -= 1;
  await loadHistoryRecords();
}

async function showNextHistoryPage() {
  if (historyState.page >= historyState.totalPages) {
    return;
  }
  historyState.page += 1;
  await loadHistoryRecords();
}

async function synchronizeHistoryRecords() {
  pageElements.syncRecordsButton.disabled = true;
  pageElements.syncRecordsButton.textContent = "正在同步...";
  pageElements.historySummary.textContent = "正在从 New API 同步渠道状态和用量...";

  try {
    const response = await fetch("/api/records/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const responsePayload = await readJsonResponse(response);
    await loadHistoryRecords();
    const missingMessage = responsePayload.data.missingCount > 0
      ? `，${responsePayload.data.missingCount} 个渠道在 New API 中不存在`
      : "";
    pageElements.historySummary.textContent =
      `已同步 ${responsePayload.data.synchronizedCount} 个渠道${missingMessage}`;
  } catch (error) {
    pageElements.historySummary.textContent = `同步失败：${error?.message || "未知错误"}`;
  } finally {
    pageElements.syncRecordsButton.disabled = false;
    pageElements.syncRecordsButton.textContent = "刷新渠道用量";
  }
}

async function readProgressStream(response, importState) {
  if (!response.ok || !response.body) {
    const responsePayload = await readJsonResponse(response);
    throw new Error(responsePayload.message || "无法读取导入结果");
  }

  const streamReader = response.body.getReader();
  const textDecoder = new TextDecoder();
  let bufferedText = "";

  while (true) {
    const { value, done } = await streamReader.read();
    bufferedText += textDecoder.decode(value, { stream: !done });
    const completeLines = bufferedText.split("\n");
    bufferedText = completeLines.pop() || "";

    for (const responseLine of completeLines) {
      if (responseLine.trim()) {
        handleProgressEvent(JSON.parse(responseLine), importState);
      }
    }

    if (done) {
      if (bufferedText.trim()) {
        handleProgressEvent(JSON.parse(bufferedText), importState);
      }
      break;
    }
  }
}

async function importChannels(event) {
  event.preventDefault();
  if (!pageElements.importForm.reportValidity()) {
    return;
  }

  const submittedKeys = getUniqueKeys();
  const importState = {
    totalCount: submittedKeys.length,
    completedCount: 0,
    successCount: 0,
    failureCount: 0,
    successfulKeyIndexes: new Set(),
    failedKeyIndexes: new Set(),
    fatalError: false,
  };

  resetResults(submittedKeys.length);
  pageElements.resultPanel.classList.remove("has-fatal-error");
  pageElements.resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  setControlsBusy(true);

  try {
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collectImportInput(submittedKeys)),
    });
    await readProgressStream(response, importState);

    if (!importState.fatalError) {
      const failedKeys = submittedKeys.filter((_, keyIndex) =>
        importState.failedKeyIndexes.has(keyIndex));
      pageElements.keys.value = failedKeys.join("\n");
      updateKeyCount();
      await loadHistoryRecords();
    }
  } catch (error) {
    const keysNotCreated = submittedKeys.filter((_, keyIndex) =>
      !importState.successfulKeyIndexes.has(keyIndex));
    pageElements.keys.value = keysNotCreated.join("\n");
    updateKeyCount();
    pageElements.resultSummary.textContent = `导入中止：${error?.message || "未知错误"}`;
    pageElements.resultPanel.classList.add("has-fatal-error");
  } finally {
    setControlsBusy(false);
  }
}

updateKeyCount();
loadTargetConfiguration();
loadHistoryRecords();

pageElements.keys.addEventListener("input", updateKeyCount);
pageElements.syncRecordsButton.addEventListener("click", synchronizeHistoryRecords);
pageElements.historySearchForm.addEventListener("submit", searchHistoryRecords);
pageElements.clearHistorySearch.addEventListener("click", clearHistorySearch);
pageElements.previousHistoryPage.addEventListener("click", showPreviousHistoryPage);
pageElements.nextHistoryPage.addEventListener("click", showNextHistoryPage);
pageElements.importForm.addEventListener("submit", importChannels);
