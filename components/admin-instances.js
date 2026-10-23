"use client";

import { useState } from "react";
import {
  ArrowRight,
  Ban,
  Boxes,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  ListChecks,
  Pencil,
  PlugZap,
  Plus,
  Power,
  RefreshCw,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import { CHANNEL_KIND_LABELS, DEFAULT_CHANNEL_MODELS } from "../lib/validation.js";
import {
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  PasswordInput,
  SectionHeading,
  Sheet,
  Spinner,
  StatCard,
  StatusText,
  Switch,
  TagInput,
} from "./ui.js";

const EMPTY_INSTANCE_FORM = Object.freeze({
  name: "",
  baseUrl: "",
  username: "",
  password: "",
  namePrefix: "claude",
  startNumber: "1",
  continueFromExisting: true,
  priority: "0",
  weight: "0",
  dateMode: "auto",
  channelModels: DEFAULT_CHANNEL_MODELS,
  enabled: true,
});

function hasSameModels(firstModels, secondModels) {
  return firstModels.length === secondModels.length
    && firstModels.every((model, modelIndex) => model === secondModels[modelIndex]);
}

function createInstanceFormFromInstance(instance) {
  return {
    name: instance.name,
    baseUrl: instance.baseUrl,
    username: instance.adminUsername,
    password: "",
    namePrefix: instance.namePrefix,
    startNumber: String(instance.startNumber),
    continueFromExisting: instance.continueFromExisting,
    priority: String(instance.priority),
    weight: String(instance.weight),
    dateMode: instance.dateMode,
    channelModels: instance.channelModels,
    enabled: instance.enabled,
  };
}

function createInstanceRequestBody(instanceForm) {
  return {
    ...instanceForm,
    group: "anthropic",
    startNumber: Number(instanceForm.startNumber),
    priority: Number(instanceForm.priority),
    weight: Number(instanceForm.weight),
  };
}

function formatChannelNamePattern(instance) {
  const dateSegment = instance.dateMode === "auto"
    ? "-MMDD"
    : instance.dateMode ? `-${instance.dateMode}` : "";
  return `${instance.namePrefix}${dateSegment}-${String(instance.startNumber).padStart(3, "0")}`;
}

function InstanceFormFields({ instanceForm, onChange, isEditing }) {
  return (
    <>
      <section className="form-section">
        <SectionHeading
          icon={Link2}
          title="连接信息"
          description="用于登录 New API 管理员账号并创建渠道。"
        />
        <div className="form-grid">
          <Field label="实例名称">
            <input className="input" placeholder="例如 主站 New API" value={instanceForm.name} onChange={(event) => onChange("name", event.target.value)} required />
          </Field>
          <Field label="管理员用户名">
            <input className="input" autoComplete="off" value={instanceForm.username} onChange={(event) => onChange("username", event.target.value)} required />
          </Field>
          <Field label="服务地址" hint="New API 的访问地址，例如 https://api.example.com。" wide>
            <input className="input" type="url" placeholder="https://" value={instanceForm.baseUrl} onChange={(event) => onChange("baseUrl", event.target.value)} required />
          </Field>
          {isEditing ? (
            <p className="form-note field-wide">管理员密码已加密保存，编辑时沿用原密码。</p>
          ) : (
            <Field label="New API 管理员密码" hint="使用 AES-256-GCM 加密保存，访问者看不到连接凭据。" wide>
              <PasswordInput autoComplete="new-password" value={instanceForm.password} onChange={(event) => onChange("password", event.target.value)} required />
            </Field>
          )}
        </div>
      </section>

      <section className="form-section">
        <SectionHeading
          icon={Settings2}
          title="渠道默认值"
          description="应用到之后通过该实例新建的每个渠道。"
          tone="success"
        />
        <div className="form-grid">
          <Field label="名称前缀">
            <input className="input" value={instanceForm.namePrefix} onChange={(event) => onChange("namePrefix", event.target.value)} required />
          </Field>
          <Field label="起始序号">
            <input className="input" type="number" min="1" max="999999" value={instanceForm.startNumber} onChange={(event) => onChange("startNumber", event.target.value)} required />
          </Field>
          <Field label="日期模式" hint="留空表示不加日期；auto 使用当天 MMDD；也可填写固定四位，如 0711。" wide>
            <input className="input" value={instanceForm.dateMode} onChange={(event) => onChange("dateMode", event.target.value)} placeholder="留空、auto 或 0711" />
          </Field>
          <Field label="渠道优先级" hint="允许负整数。">
            <input className="input" type="number" step="1" value={instanceForm.priority} onChange={(event) => onChange("priority", event.target.value)} required />
          </Field>
          <Field label="渠道权重" hint="非负整数。">
            <input className="input" type="number" min="0" step="1" value={instanceForm.weight} onChange={(event) => onChange("weight", event.target.value)} required />
          </Field>
        </div>
        <Switch
          checked={instanceForm.continueFromExisting}
          onChange={(checked) => onChange("continueFromExisting", checked)}
          label="接续现有同前缀序号"
          description="从上游已有同前缀渠道的最大序号之后继续编号。"
        />
      </section>

      <section className="form-section">
        <SectionHeading
          icon={Boxes}
          title="渠道模型"
          description="导入渠道时默认使用的模型，访问者导入时可临时增删。"
          tone="info"
        />
        {Object.entries(CHANNEL_KIND_LABELS).map(([channelKind, channelLabel]) => {
          const channelModels = instanceForm.channelModels[channelKind];
          const defaultModels = DEFAULT_CHANNEL_MODELS[channelKind];
          return (
            <Field
              key={channelKind}
              label={`${channelLabel} 模型`}
              extra={(
                <span className="field-actions">
                  <span className="field-counter">{channelModels.length} 个</span>
                  {hasSameModels(channelModels, defaultModels) ? null : (
                    <button
                      className="btn btn-ghost btn-xs"
                      type="button"
                      onClick={() => onChange("channelModels", {
                        ...instanceForm.channelModels,
                        [channelKind]: [...defaultModels],
                      })}
                    >
                      恢复默认
                    </button>
                  )}
                </span>
              )}
            >
              <TagInput
                values={channelModels}
                placeholder="输入模型名后回车，可一次粘贴多个"
                onChange={(nextModels) => onChange("channelModels", {
                  ...instanceForm.channelModels,
                  [channelKind]: nextModels,
                })}
              />
            </Field>
          );
        })}
      </section>

      {isEditing ? (
        <section className="form-section">
          <SectionHeading
            icon={Power}
            title="实例状态"
            description="停用后访问者无法进入，现有访客会话立即失效。"
            tone="warning"
          />
          <Switch
            checked={instanceForm.enabled}
            onChange={(checked) => onChange("enabled", checked)}
            label="启用实例"
          />
        </section>
      ) : null}
    </>
  );
}

export default function AdminInstances({
  instances,
  isLoading,
  onReload,
  onOpenInstance,
}) {
  const [sheetInstance, setSheetInstance] = useState(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [instanceForm, setInstanceForm] = useState({ ...EMPTY_INSTANCE_FORM });
  const [formErrorMessage, setFormErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingInstance, setDeletingInstance] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingAccessKeyAction, setPendingAccessKeyAction] = useState(null);
  const [isUpdatingAccessKey, setIsUpdatingAccessKey] = useState(false);
  const [generatedAccess, setGeneratedAccess] = useState(null);
  const [revealedAccessKeys, setRevealedAccessKeys] = useState({});
  const [loadingAccessKeyInstanceId, setLoadingAccessKeyInstanceId] = useState(null);
  const [testingInstanceId, setTestingInstanceId] = useState(null);

  const enabledInstanceCount = instances.filter((instance) => instance.enabled).length;
  const activeAccessKeyCount = instances.filter((instance) => instance.accessKey.enabled).length;
  const channelRecordCount = instances.reduce(
    (total, instance) => total + instance.channelRecordCount,
    0,
  );

  function openCreateSheet() {
    setSheetInstance(null);
    setInstanceForm({ ...EMPTY_INSTANCE_FORM });
    setFormErrorMessage("");
    setIsSheetOpen(true);
  }

  function openEditSheet(instance) {
    setSheetInstance(instance);
    setInstanceForm(createInstanceFormFromInstance(instance));
    setFormErrorMessage("");
    setIsSheetOpen(true);
  }

  function closeSheet() {
    setIsSheetOpen(false);
    setFormErrorMessage("");
  }

  function updateInstanceForm(fieldName, value) {
    setInstanceForm((currentForm) => ({ ...currentForm, [fieldName]: value }));
  }

  async function saveInstance(event) {
    event.preventDefault();
    setFormErrorMessage("");
    setIsSubmitting(true);
    try {
      await requestJson(
        sheetInstance ? `/api/admin/instances/${sheetInstance.id}` : "/api/admin/instances",
        {
          method: sheetInstance ? "PATCH" : "POST",
          body: JSON.stringify(createInstanceRequestBody(instanceForm)),
        },
      );
      showToast(sheetInstance ? "实例配置已更新" : "实例已创建", { type: "success" });
      setIsSheetOpen(false);
      await onReload();
    } catch (error) {
      const currentErrorMessage = error?.message || "保存实例失败";
      setFormErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteInstance() {
    if (!deletingInstance) {
      return;
    }
    setIsDeleting(true);
    try {
      const responsePayload = await requestJson(
        `/api/admin/instances/${deletingInstance.id}`,
        { method: "DELETE" },
      );
      const deletedRecordCount = responsePayload.data.deletedChannelRecordCount;
      const successMessage = deletedRecordCount > 0
        ? `实例已删除，同时删除 ${deletedRecordCount} 条本地渠道历史`
        : "实例已删除";
      showToast(successMessage, { type: "success" });
      setDeletingInstance(null);
      await onReload();
    } catch (error) {
      showToast(error?.message || "删除实例失败", { type: "error" });
    } finally {
      setIsDeleting(false);
    }
  }

  async function testInstance(instanceId) {
    setTestingInstanceId(instanceId);
    try {
      const responsePayload = await requestJson(
        `/api/admin/instances/${instanceId}/test`,
        { method: "POST", body: "{}" },
      );
      const successMessage = (
        `连接成功：${responsePayload.data.systemName} `
        + `${responsePayload.data.version}（${responsePayload.data.username}，渠道权限已验证）`
      );
      showToast(successMessage, { type: "success" });
    } catch (error) {
      showToast(error?.message || "测试连接失败", { type: "error" });
    } finally {
      setTestingInstanceId(null);
    }
  }

  async function generateAccessKey(instance) {
    setIsUpdatingAccessKey(true);
    try {
      const responsePayload = await requestJson(
        `/api/admin/instances/${instance.id}/access-key`,
        { method: "POST", body: "{}" },
      );
      setPendingAccessKeyAction(null);
      forgetRevealedAccessKey(instance.id);
      setGeneratedAccess({ instance, accessKey: responsePayload.data.accessKey });
      await onReload();
    } catch (error) {
      showToast(error?.message || "生成访问 Key 失败", { type: "error" });
    } finally {
      setIsUpdatingAccessKey(false);
    }
  }

  async function disableAccessKey(instance) {
    setIsUpdatingAccessKey(true);
    try {
      await requestJson(`/api/admin/instances/${instance.id}/access-key`, {
        method: "DELETE",
        body: "{}",
      });
      setPendingAccessKeyAction(null);
      forgetRevealedAccessKey(instance.id);
      showToast("实例访问 Key 已停用", { type: "success" });
      await onReload();
    } catch (error) {
      showToast(error?.message || "停用访问 Key 失败", { type: "error" });
    } finally {
      setIsUpdatingAccessKey(false);
    }
  }

  function forgetRevealedAccessKey(instanceId) {
    setRevealedAccessKeys((currentKeys) => {
      const remainingKeys = { ...currentKeys };
      delete remainingKeys[instanceId];
      return remainingKeys;
    });
  }

  async function loadAccessKey(instance) {
    if (revealedAccessKeys[instance.id]) {
      return revealedAccessKeys[instance.id];
    }
    setLoadingAccessKeyInstanceId(instance.id);
    try {
      const responsePayload = await requestJson(
        `/api/admin/instances/${instance.id}/access-key/reveal`,
        { method: "POST", body: "{}" },
      );
      const accessKey = responsePayload.data.accessKey;
      setRevealedAccessKeys((currentKeys) => ({ ...currentKeys, [instance.id]: accessKey }));
      return accessKey;
    } catch (error) {
      showToast(error?.message || "读取访问 Key 失败", { type: "error" });
      return null;
    } finally {
      setLoadingAccessKeyInstanceId(null);
    }
  }

  function toggleAccessKeyVisibility(instance) {
    if (revealedAccessKeys[instance.id]) {
      forgetRevealedAccessKey(instance.id);
      return;
    }
    loadAccessKey(instance);
  }

  async function copyAccessKey(instance) {
    const accessKey = await loadAccessKey(instance);
    if (!accessKey) {
      return;
    }
    try {
      await navigator.clipboard.writeText(accessKey);
      showToast("完整访问 Key 已复制", { type: "success" });
    } catch {
      showToast("复制访问 Key 失败，请检查浏览器权限", { type: "error" });
    }
  }

  function requestAccessKeyGeneration(instance) {
    if (instance.accessKey.configured) {
      setPendingAccessKeyAction({ type: "regenerate", instance });
      return;
    }
    generateAccessKey(instance);
  }

  async function copyGeneratedAccessKey() {
    try {
      await navigator.clipboard.writeText(generatedAccess.accessKey);
      showToast("完整访问 Key 已复制", { type: "success" });
    } catch (error) {
      showToast(error?.message || "复制访问 Key 失败", { type: "error" });
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="实例管理"
        description="维护 New API 实例的连接信息、渠道默认值和访问 Key。"
        actions={(
          <>
            <button className="btn btn-outline" type="button" disabled={isLoading} onClick={onReload}>
              <RefreshCw size={15} className={isLoading ? "spin" : ""} aria-hidden="true" />
              刷新
            </button>
            <button className="btn btn-primary" type="button" onClick={openCreateSheet}>
              <Plus size={15} aria-hidden="true" />
              新增实例
            </button>
          </>
        )}
      />

      <div className="stat-grid">
        <StatCard icon={Server} label="实例总数" value={instances.length} hint={`已启用 ${enabledInstanceCount} 个`} />
        <StatCard icon={KeyRound} label="生效的访问 Key" value={activeAccessKeyCount} hint="访问者凭 Key 进入对应实例" tone="success" />
        <StatCard icon={ListChecks} label="本地渠道记录" value={channelRecordCount} hint="通过本工具导入的渠道" tone="info" />
      </div>

      <div className="table-card" aria-busy={isLoading}>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>实例</th>
                <th>状态</th>
                <th>管理员</th>
                <th>渠道命名</th>
                <th>优先级 / 权重</th>
                <th>访问 Key</th>
                <th className="align-right">记录</th>
                <th className="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((instance) => (
                <tr key={instance.id}>
                  <td>
                    <div className="cell-stack">
                      <strong>{instance.name}</strong>
                      <span className="cell-mono">{instance.baseUrl}</span>
                    </div>
                  </td>
                  <td>
                    <StatusText status={instance.enabled ? "enabled" : "disabled"} />
                  </td>
                  <td>{instance.adminUsername}</td>
                  <td><span className="cell-mono">{formatChannelNamePattern(instance)}</span></td>
                  <td>{instance.priority} / {instance.weight}</td>
                  <td>
                    {instance.accessKey.enabled ? (
                      <div className="key-cell">
                        <span className="cell-mono key-value">
                          {revealedAccessKeys[instance.id] || instance.accessKey.mask}
                        </span>
                        {instance.accessKey.revealable ? (
                          <>
                            <button
                              className="btn btn-ghost btn-icon btn-xs"
                              type="button"
                              title={revealedAccessKeys[instance.id] ? "隐藏访问 Key" : "显示访问 Key"}
                              aria-label={revealedAccessKeys[instance.id] ? "隐藏访问 Key" : "显示访问 Key"}
                              disabled={loadingAccessKeyInstanceId === instance.id}
                              onClick={() => toggleAccessKeyVisibility(instance)}
                            >
                              {revealedAccessKeys[instance.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                            <button
                              className="btn btn-ghost btn-icon btn-xs"
                              type="button"
                              title="复制访问 Key"
                              aria-label="复制访问 Key"
                              disabled={loadingAccessKeyInstanceId === instance.id}
                              onClick={() => copyAccessKey(instance)}
                            >
                              <Copy size={14} />
                            </button>
                          </>
                        ) : (
                          <span
                            className="tag tag-muted"
                            title="该访问 Key 生成于加密保存之前，重新生成一次后即可随时查看"
                          >
                            重新生成后可查看
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="tag tag-muted">
                        {instance.accessKey.configured ? "已停用" : "未生成"}
                      </span>
                    )}
                  </td>
                  <td className="align-right">{instance.channelRecordCount}</td>
                  <td className="align-right">
                    <div className="row-actions">
                      <button className="btn btn-outline btn-sm" type="button" onClick={() => onOpenInstance(instance.id)}>
                        进入
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                      <button className="btn btn-ghost btn-icon btn-sm" type="button" title="编辑实例" aria-label={`编辑实例 ${instance.name}`} onClick={() => openEditSheet(instance)}>
                        <Pencil size={15} />
                      </button>
                      <DropdownMenu
                        label={`${instance.name} 的更多操作`}
                        items={[
                          {
                            label: testingInstanceId === instance.id ? "正在测试..." : "测试连接",
                            icon: PlugZap,
                            disabled: testingInstanceId === instance.id,
                            onSelect: () => testInstance(instance.id),
                          },
                          {
                            label: instance.accessKey.configured ? "重新生成访问 Key" : "生成访问 Key",
                            icon: KeyRound,
                            onSelect: () => requestAccessKeyGeneration(instance),
                          },
                          instance.accessKey.enabled ? {
                            label: "停用访问 Key",
                            icon: Ban,
                            onSelect: () => setPendingAccessKeyAction({ type: "disable", instance }),
                          } : null,
                          {
                            label: "删除实例",
                            icon: Trash2,
                            danger: true,
                            onSelect: () => setDeletingInstance(instance),
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!isLoading && instances.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="尚未配置实例"
            description="添加第一个 New API 实例后，即可为它生成访问 Key 并导入渠道。"
            action={(
              <button className="btn btn-primary" type="button" onClick={openCreateSheet}>
                <Plus size={15} aria-hidden="true" />
                新增实例
              </button>
            )}
          />
        ) : null}
      </div>

      <Sheet
        open={isSheetOpen}
        title={sheetInstance ? "编辑实例" : "新增实例"}
        description={sheetInstance
          ? `修改 ${sheetInstance.name} 的本地连接配置和渠道默认值。`
          : "填写 New API 管理员账号，系统将用它创建渠道。"}
        onClose={closeSheet}
        closeDisabled={isSubmitting}
        closeOnBackdrop={false}
        onSubmit={saveInstance}
        footer={(
          <>
            <button className="btn btn-outline" type="button" disabled={isSubmitting} onClick={closeSheet}>
              取消
            </button>
            <button className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? <Spinner /> : null}
              {isSubmitting ? "正在保存..." : sheetInstance ? "保存修改" : "创建实例"}
            </button>
          </>
        )}
      >
        <InstanceFormFields
          instanceForm={instanceForm}
          onChange={updateInstanceForm}
          isEditing={Boolean(sheetInstance)}
        />
        {formErrorMessage ? <p className="form-error">{formErrorMessage}</p> : null}
      </Sheet>

      <ConfirmDialog
        open={Boolean(deletingInstance)}
        title="确认删除实例"
        confirmLabel="确认删除本地实例"
        busyLabel="正在删除..."
        isBusy={isDeleting}
        onConfirm={deleteInstance}
        onCancel={() => setDeletingInstance(null)}
      >
        <p>
          将删除本系统中的实例“{deletingInstance?.name}”、访问 Key、访客会话和
          {" "}{deletingInstance?.channelRecordCount} 条本地渠道历史。
        </p>
        <p className="callout callout-warning">
          此操作不会连接 New API，也不会删除上游已经创建的真实渠道。
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(pendingAccessKeyAction)}
        title={pendingAccessKeyAction?.type === "disable" ? "停用访问 Key？" : "重新生成访问 Key？"}
        confirmLabel={pendingAccessKeyAction?.type === "disable" ? "确认停用" : "确认重新生成"}
        tone={pendingAccessKeyAction?.type === "disable" ? "danger" : "primary"}
        isBusy={isUpdatingAccessKey}
        onConfirm={() => (
          pendingAccessKeyAction.type === "disable"
            ? disableAccessKey(pendingAccessKeyAction.instance)
            : generateAccessKey(pendingAccessKeyAction.instance)
        )}
        onCancel={() => setPendingAccessKeyAction(null)}
      >
        <p>
          {pendingAccessKeyAction?.type === "disable"
            ? `停用后，“${pendingAccessKeyAction?.instance.name}”的访问 Key 和现有访客会话将立即失效。`
            : `重新生成后，“${pendingAccessKeyAction?.instance.name}”的旧访问 Key 和现有访客会话将立即失效。`}
        </p>
      </ConfirmDialog>

      <Modal
        open={Boolean(generatedAccess)}
        title="访问 Key 已生成"
        description={generatedAccess ? `实例：${generatedAccess.instance.name}` : undefined}
        size="sm"
        closeOnBackdrop={false}
        onClose={() => setGeneratedAccess(null)}
        footer={(
          <>
            <button className="btn btn-outline" type="button" onClick={() => setGeneratedAccess(null)}>
              完成
            </button>
            <button className="btn btn-primary" type="button" onClick={copyGeneratedAccessKey}>
              <Copy size={15} aria-hidden="true" />
              复制 Key
            </button>
          </>
        )}
      >
        <div className="secret-box">
          <ShieldCheck size={16} aria-hidden="true" />
          <code>{generatedAccess?.accessKey}</code>
        </div>
        <p className="callout callout-info">
          访问 Key 已加密保存，之后可以在实例列表中随时查看或复制。旧 Key 和现有访客会话已失效，请把新 Key 发给访问者。
        </p>
      </Modal>
    </div>
  );
}
