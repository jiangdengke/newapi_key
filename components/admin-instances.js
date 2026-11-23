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
  Trash2,
  Users,
} from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import { DEFAULT_CHANNEL_MODELS } from "../lib/validation.js";
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

      {!isEditing ? (
        <p className="form-note">
          创建后使用系统默认渠道设置；新建渠道流程中选择本批类型、Key、模型及每个目标实例的分组。用户命名前缀可在访问成员中设置。
        </p>
      ) : null}

      {isEditing ? (
        <section className="form-section">
          <SectionHeading
            icon={Power}
            title="实例状态"
            description="停用后普通用户无法访问该实例，不影响其访问其他实例。"
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
        description="维护 New API 连接和访问用户。实例只保存连接信息，渠道配置在新建渠道流程中填写。"
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
        <StatCard icon={Users} label="访问成员" value={activeMemberCount} hint="已启用且绑定有效账号的成员" tone="success" />
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
                  <td>
                    <button
                      className="btn btn-ghost btn-sm member-count-button"
                      type="button"
                      aria-label={`管理 ${instance.name} 的访问成员`}
                      onClick={() => setMembersInstanceId(instance.id)}
                    >
                      <Users size={14} aria-hidden="true" />
                      {instance.memberCount === 0
                        ? "管理访问成员"
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
          ? `修改 ${sheetInstance.name} 的连接信息或启停状态。`
          : "填写 New API 连接信息；渠道类型、Key、模型和分组稍后在新建渠道流程中选择。"}
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
          将删除本系统中的实例“{deletingInstance?.name}”、{deletingInstance?.memberCount} 个访问成员及其账号绑定，以及
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
