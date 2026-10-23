export function formatUsd(usedUsd) {
  const normalizedAmount = Number(usedUsd) || 0;
  return normalizedAmount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: normalizedAmount > 0 && normalizedAmount < 0.01 ? 6 : 4,
  });
}

export function formatDateTime(rawDateTime, emptyText = "尚未同步") {
  if (!rawDateTime) {
    return emptyText;
  }
  const parsedDate = new Date(rawDateTime);
  return Number.isNaN(parsedDate.getTime())
    ? "未知时间"
    : parsedDate.toLocaleString("zh-CN", { hour12: false });
}

export function getStatusText(statusLabel) {
  if (statusLabel === "enabled") {
    return "已启用";
  }
  if (statusLabel === "missing") {
    return "渠道不存在";
  }
  return "已停用";
}
