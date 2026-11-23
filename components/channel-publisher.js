"use client";

import { useEffect, useRef, useState } from "react";
import { Rocket, Server } from "lucide-react";

import { publishChannelsToInstances } from "../lib/channel-publishing.js";
import { requestJson } from "../lib/client-api.js";
import {
  AWS_API_TYPES, CHANNEL_KIND_LABELS, DEFAULT_CHANNEL_MODELS,
  diagnoseAwsCredential, normalizeKeys, validateModelList,
} from "../lib/validation.js";
import { EmptyState, Field, PageHeader, Select, TagInput } from "./ui.js";

function ModelPicker({ channelKind, models, onChange }) {
  const [searchText, setSearchText] = useState("");
  const channelLabel = CHANNEL_KIND_LABELS[channelKind];
  const matchingCandidates = DEFAULT_CHANNEL_MODELS[channelKind].filter((model) =>
    model.toLowerCase().includes(searchText.trim().toLowerCase()));

  function toggleCandidate(model, isSelected) {
    if (isSelected) {
      onChange(models.filter((selectedModel) => selectedModel !== model));
      return;
    }
    if (!models.includes(model)) {
      onChange([...models, model]);
    }
  }

  return (
    <div className="model-picker">
      <TagInput values={models} onChange={onChange} aria-label="已选模型"
        placeholder="输入自定义模型名并按 Enter 添加" />
      <p className="form-note">内置候选仅供快速选择，不代表供应商的完整或实时模型目录；也可手动添加自定义模型。</p>
      <label className="model-candidate-search">
        <span>筛选{channelLabel}候选模型</span>
        <input className="input" type="search" value={searchText}
          onChange={(event) => setSearchText(event.target.value)} placeholder="搜索候选模型" />
      </label>
      <div className="model-candidate-list" role="group" aria-label={`${channelLabel}内置模型候选`}>
        {matchingCandidates.length ? matchingCandidates.map((model) => (
          <label className="model-candidate" key={model}>
            <input className="checkbox" type="checkbox" checked={models.includes(model)}
              onChange={(event) => toggleCandidate(model, event.target.checked)} />
            <span>{model}</span>
          </label>
        )) : <p className="form-note">没有匹配的候选模型，可在上方手动添加。</p>}
      </div>
    </div>
  );
}

function TargetGroup({ instance, group, onChange }) {
  const [groupState, setGroupState] = useState(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    requestJson(`/api/instances/${instance.id}/groups`, { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setGroupState({ groups: data.groups }); })
      .catch((error) => { if (!controller.signal.aborted) setGroupState({ error: error.message }); });
    return () => controller.abort();
  }, [instance.id, reloadCount]);

  if (!groupState) return <p role="status">正在读取分组…</p>;
  if (groupState.error || groupState.groups.length === 0) {
    return (
      <div className="member-card-head">
        <p className="field-error">{groupState.error || "该实例没有可选分组"}</p>
        <button className="btn btn-outline btn-sm" type="button" onClick={() => {
          setGroupState(null);
          setReloadCount((count) => count + 1);
        }}>重新读取</button>
      </div>
    );
  }
  return (
    <Field label={`${instance.name}的分组`}>
      <Select value={group} onChange={(event) => onChange(event.target.value)} required>
        <option value="">请选择分组</option>
        {groupState.groups.map((name) => <option key={name} value={name}>{name}</option>)}
      </Select>
    </Field>
  );
}

function TargetResult({ target, result, keyCount, pending }) {
  const status = result ? {
    complete: "处理完成",
    stopped: "推送中止",
    rejected: "请求未通过",
    unknown: "结果未确认",
  }[result.status] : pending;
  const remainingCount = result ? keyCount - result.success - result.failure : 0;
  return (
    <article className="member-card">
      <div className="member-card-head"><strong>{target.name}</strong><span>{status}</span></div>
      <p className="form-note">分组：{target.group}{result ? ` · 成功 ${result.success} · 失败 ${result.failure}` : ""}
        {remainingCount > 0 ? ` · ${result.status === "unknown" ? "未确认" : "未处理"} ${remainingCount}` : ""}
      </p>
      {result?.message ? <p className="field-error">{result.message}</p> : null}
      {result?.details.length ? (
        <ul>
          {result.details.map(({ index, message, warning }) => (
            <li key={index}>第 {index + 1} 项{warning ? "（已创建）" : ""}：{message}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export default function ChannelPublisher({ instances, isLoadingInstances }) {
  const [channelKind, setChannelKind] = useState("claude");
  const [keysText, setKeysText] = useState("");
  const [selectedModels, setSelectedModels] = useState(DEFAULT_CHANNEL_MODELS.claude);
  const [awsApiType, setAwsApiType] = useState(AWS_API_TYPES.INVOKE_MODEL);
  const [channel, setChannel] = useState(null);
  const [selectedGroups, setSelectedGroups] = useState({});
  const [formError, setFormError] = useState("");
  const [batch, setBatch] = useState(null);
  const publishController = useRef(null);
  useEffect(() => () => publishController.current?.abort(), []);

  const enabledInstances = instances.filter((instance) => instance.enabled);
  const selectedTargets = enabledInstances.filter(({ id }) => Object.hasOwn(selectedGroups, id));
  const isAwsChannel = channelKind === "aws";

  function selectTargets(event) {
    event.preventDefault();
    try {
      const keys = normalizeKeys(keysText);
      const models = validateModelList(selectedModels, CHANNEL_KIND_LABELS[channelKind]);
      if (isAwsChannel) {
        for (const [index, key] of keys.entries()) {
          const problem = diagnoseAwsCredential(key);
          if (problem) throw new Error(`第 ${index + 1} 个 AWS 凭证${problem}`);
        }
      }
      setFormError("");
      setChannel({ channelKind, keys, models, ...(isAwsChannel ? { awsApiType } : {}) });
    } catch (error) {
      setFormError(error.message);
    }
  }

  function toggleTarget(instanceId, checked) {
    setSelectedGroups((current) => {
      const nextGroups = { ...current };
      if (checked) nextGroups[instanceId] = "";
      else delete nextGroups[instanceId];
      return nextGroups;
    });
  }

  async function publish(event) {
    event.preventDefault();
    if (publishController.current || !selectedTargets.length || selectedTargets.some(({ id }) => !selectedGroups[id])) return;

    const targets = selectedTargets.map(({ id, name }) => ({ instanceId: id, name, group: selectedGroups[id] }));
    const controller = new AbortController();
    publishController.current = controller;
    setBatch({ targets, keyCount: channel.keys.length, results: [], running: true });
    setKeysText("");
    setChannel(null);
    setSelectedGroups({});
    try {
      for await (const result of publishChannelsToInstances(channel, targets, controller.signal)) {
        setBatch((current) => ({ ...current, results: [...current.results, result] }));
      }
    } finally {
      publishController.current = null;
      if (!controller.signal.aborted) setBatch((current) => ({ ...current, running: false }));
    }
  }

  return (
    <div className="page">
      <PageHeader title="新建渠道" description="先填写渠道，再选择要推送的 New API 实例。" />
      {batch ? (
        <section className="form-section" aria-label="推送结果" aria-live="polite">
          <h2>{batch.running ? `正在推送：${batch.results.length} / ${batch.targets.length} 台已返回结果` : "推送结果"}</h2>
          <div className="member-list">
            {batch.targets.map((target, targetIndex) => (
              <TargetResult key={target.instanceId} target={target} result={batch.results[targetIndex]}
                keyCount={batch.keyCount} pending={batch.running ? (targetIndex === batch.results.length ? "推送中" : "等待推送") : "未推送"} />
            ))}
          </div>
          {batch.running ? <p className="form-note">请保持页面打开，未开始的目标不会在后台继续。</p> : (
            <>
              <p className="form-note">不会自动重试。结果未确认时，请先到目标实例核对渠道，再决定是否重提。</p>
              <button className="btn btn-outline" type="button" onClick={() => setBatch(null)}>新一批渠道</button>
            </>
          )}
        </section>
      ) : channel ? (
        <form className="form-section" onSubmit={publish}>
          <h2>2. 选择实例和分组</h2>
          <p className="form-note">{CHANNEL_KIND_LABELS[channelKind]} · {channel.keys.length} 个 Key · {channel.models.length} 个模型</p>
          {isLoadingInstances ? <p role="status">正在读取实例…</p> : !enabledInstances.length ? (
            <EmptyState icon={Server} title="暂无可推送的实例" description="请联系管理员启用实例并授予访问权限。" />
          ) : (
            <div className="member-list">
              {enabledInstances.map((instance) => (
                <div className="member-card" key={instance.id}>
                  <label>
                    <input className="checkbox" type="checkbox" checked={Object.hasOwn(selectedGroups, instance.id)}
                      onChange={(event) => toggleTarget(instance.id, event.target.checked)} /> {instance.name}
                  </label>
                  {Object.hasOwn(selectedGroups, instance.id) ? (
                    <TargetGroup instance={instance} group={selectedGroups[instance.id]}
                      onChange={(group) => setSelectedGroups((current) => ({ ...current, [instance.id]: group }))} />
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <div className="member-card-head">
            <button className="btn btn-outline" type="button" onClick={() => {
              setChannel(null);
              setSelectedGroups({});
            }}>返回修改渠道</button>
            <button className="btn btn-primary" type="submit"
              disabled={!selectedTargets.length || selectedTargets.some(({ id }) => !selectedGroups[id])}>
              <Rocket size={15} aria-hidden="true" /> 确认推送到 {selectedTargets.length} 台
            </button>
          </div>
        </form>
      ) : (
        <form className="form-section" onSubmit={selectTargets} autoComplete="off">
          <h2>1. 填写渠道</h2>
          <div className="form-grid">
            <Field label="渠道类型" wide>
              <Select value={channelKind} onChange={(event) => {
                const selectedKind = event.target.value;
                setChannelKind(selectedKind);
                setKeysText("");
                setSelectedModels(DEFAULT_CHANNEL_MODELS[selectedKind]);
                setFormError("");
              }}>
                {Object.entries(CHANNEL_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
              </Select>
            </Field>
            <Field label={isAwsChannel ? "AWS 凭证" : `${CHANNEL_KIND_LABELS[channelKind]} Key`} wide
              hint={isAwsChannel ? "每行填 APIKey|Region 或 AccessKey|SecretAccessKey|Region。" : "每行填一个 Key；仅发送到你确认的目标实例。"}>
              <textarea className="textarea" rows={4} value={keysText} required spellCheck={false}
                onChange={(event) => setKeysText(event.target.value)} />
            </Field>
            <Field label="模型" hint="已选模型会用于本批次的所有目标实例。" wide>
              <ModelPicker key={channelKind} channelKind={channelKind} models={selectedModels}
                onChange={setSelectedModels} />
            </Field>
            {isAwsChannel ? (
              <Field label="AWS 接口" wide>
                <Select value={awsApiType} onChange={(event) => setAwsApiType(event.target.value)}>
                  <option value={AWS_API_TYPES.INVOKE_MODEL}>InvokeModel</option>
                  <option value={AWS_API_TYPES.MANTLE}>Mantle（Messages API）</option>
                </Select>
              </Field>
            ) : null}
          </div>
          {formError ? <p className="field-error" role="alert">{formError}</p> : null}
          <button className="btn btn-primary" type="submit">下一步：选择实例</button>
        </form>
      )}
    </div>
  );
}
