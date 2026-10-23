"use client";

import { useState } from "react";
import {
  ArrowRight,
  Boxes,
  Link2,
  ListChecks,
  Pencil,
  PlugZap,
  Plus,
  Power,
  RefreshCw,
  Server,
  Settings2,
  Trash2,
  Users,
} from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { formatChannelNamePattern } from "../lib/format.js";
import { showToast } from "../lib/toast.js";
import { CHANNEL_KIND_LABELS, DEFAULT_CHANNEL_MODELS } from "../lib/validation.js";
import InstanceMembersSheet from "./admin-members.js";
import {
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  Field,
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
          description="应用到之后通过该实例新建的每个渠道；访问成员可单独覆盖名称前缀、日期、序号、优先级和权重。"
          tone="success"
        />
        <div className="form-grid">
          <Field label="名称前缀" hint="新增成员时的参考值，实际导入使用成员自己的前缀。">
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
  const [membersInstanceId, setMembersInstanceId] = useState(null);
  const [testingInstanceId, setTestingInstanceId] = useState(null);

  const enabledInstanceCount = instances.filter((instance) => instance.enabled).length;
  const activeMemberCount = instances.reduce((total, instance) => total + instance.activeMemberCount, 0);
  const membersInstance = instances.find((instance) => instance.id === membersInstanceId) ?? null;
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

  return (
    <div className="page">
      <PageHeader
        title="实例管理"
        description="维护 New API 实例的连接信息、渠道默认值和访问成员。"
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
        <StatCard icon={Users} label="访问成员" value={activeMemberCount} hint="已启用的成员，各自凭 Key 进入实例" tone="success" />
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
                <th>默认命名</th>
                <th>优先级 / 权重</th>
                <th>访问成员</th>
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
                    <button
                      className="btn btn-ghost btn-sm member-count-button"
                      type="button"
                      aria-label={`管理 ${instance.name} 的访问成员`}
                      onClick={() => setMembersInstanceId(instance.id)}
                    >
                      <Users size={14} aria-hidden="true" />
                      {instance.memberCount === 0
                        ? "添加成员"
                        : instance.activeMemberCount === instance.memberCount
                          ? `${instance.memberCount} 人`
                          : `${instance.activeMemberCount} / ${instance.memberCount} 人`}
                    </button>
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
                            label: "管理访问成员",
                            icon: Users,
                            onSelect: () => setMembersInstanceId(instance.id),
                          },
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
            description="添加第一个 New API 实例后，即可为它添加访问成员并导入渠道。"
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
          将删除本系统中的实例“{deletingInstance?.name}”、{deletingInstance?.memberCount} 个访问成员、访客会话和
          {" "}{deletingInstance?.channelRecordCount} 条本地渠道历史。
        </p>
        <p className="callout callout-warning">
          此操作不会连接 New API，也不会删除上游已经创建的真实渠道。
        </p>
      </ConfirmDialog>

      <InstanceMembersSheet
        instance={membersInstance}
        onClose={() => setMembersInstanceId(null)}
        onChanged={onReload}
      />
    </div>
  );
}
