"use client";

import { X } from "lucide-react";

import { getStatusText } from "../lib/format.js";
import { CHANNEL_KIND_LABELS } from "../lib/validation.js";
import { FacetFilter, SearchInput, SortControl } from "./ui.js";

export const EMPTY_RECORD_FILTERS = Object.freeze({
  search: "",
  model: "",
  instanceId: "",
  statusLabel: "",
  channelKind: "",
  group: "",
});

export const DEFAULT_RECORD_SORT = Object.freeze({ field: "importedAt", order: "desc" });

export const CHANNEL_KIND_FILTER_LABELS = Object.freeze({
  ...CHANNEL_KIND_LABELS,
  unknown: "未知类型",
});

const RECORD_STATUS_VALUES = ["enabled", "disabled", "missing"];
const RECORD_SORT_OPTIONS = [
  { value: "importedAt", label: "导入时间" },
  { value: "lastSyncedAt", label: "最后同步" },
  { value: "usedUsd", label: "累计用量" },
  { value: "balanceUsd", label: "余额" },
  { value: "channelName", label: "渠道名称" },
];

export function hasActiveRecordFilters(filters, sort) {
  return Object.values(filters).some(Boolean)
    || sort.field !== DEFAULT_RECORD_SORT.field
    || sort.order !== DEFAULT_RECORD_SORT.order;
}

export function createRecordQuery(filters, sort, { page, pageSize }) {
  return {
    search: filters.search.trim(),
    model: filters.model.trim(),
    instanceId: filters.instanceId ? Number(filters.instanceId) : null,
    statusLabel: filters.statusLabel,
    channelKind: filters.channelKind,
    group: filters.group,
    sort: sort.field,
    order: sort.order,
    page,
    pageSize,
  };
}

function countFacetValue(facetCounts, value) {
  return facetCounts?.find((facetCount) => facetCount.value === value)?.count ?? 0;
}

export default function RecordFilterBar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  onReset,
  facets,
  instances = null,
}) {
  function updateFilter(filterName, value) {
    onFiltersChange({ ...filters, [filterName]: value });
  }

  const statusOptions = RECORD_STATUS_VALUES.map((statusLabel) => ({
    value: statusLabel,
    label: getStatusText(statusLabel),
    count: countFacetValue(facets?.statuses, statusLabel),
  }));
  const channelKindOptions = Object.entries(CHANNEL_KIND_FILTER_LABELS)
    .map(([channelKind, label]) => ({
      value: channelKind,
      label,
      count: countFacetValue(facets?.channelKinds, channelKind),
    }))
    .filter((option) => option.value !== "unknown" || option.count > 0 || filters.channelKind === "unknown");
  const groupOptions = (facets?.groups ?? [])
    .filter((groupCount) => groupCount.value)
    .map((groupCount) => ({ value: groupCount.value, label: groupCount.value, count: groupCount.count }));
  const instanceOptions = instances?.map((instance) => ({
    value: String(instance.id),
    label: instance.name,
    count: countFacetValue(facets?.instances, instance.id),
  }));

  return (
    <div className="toolbar record-filter-bar">
      <SearchInput
        className="toolbar-input-wide"
        aria-label="渠道名称、ID 或完整 Key"
        placeholder="按名称、ID 或 Key 筛选..."
        value={filters.search}
        onChange={(value) => updateFilter("search", value)}
      />
      <SearchInput
        className="toolbar-input"
        aria-label="模型"
        placeholder="按模型筛选..."
        value={filters.model}
        onChange={(value) => updateFilter("model", value)}
      />
      {instanceOptions ? (
        <FacetFilter
          label="实例"
          allLabel="所有实例"
          value={filters.instanceId}
          options={instanceOptions}
          onChange={(value) => updateFilter("instanceId", value)}
        />
      ) : null}
      <FacetFilter
        label="状态"
        allLabel="所有状态"
        value={filters.statusLabel}
        options={statusOptions}
        onChange={(value) => updateFilter("statusLabel", value)}
      />
      <FacetFilter
        label="类型"
        allLabel="所有类型"
        value={filters.channelKind}
        options={channelKindOptions}
        onChange={(value) => updateFilter("channelKind", value)}
      />
      <FacetFilter
        label="分组"
        allLabel="所有分组"
        value={filters.group}
        options={groupOptions}
        onChange={(value) => updateFilter("group", value)}
      />
      {hasActiveRecordFilters(filters, sort) ? (
        <button className="btn btn-ghost" type="button" onClick={onReset}>
          重置
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
      <SortControl
        field={sort.field}
        order={sort.order}
        options={RECORD_SORT_OPTIONS}
        onChange={onSortChange}
      />
    </div>
  );
}
