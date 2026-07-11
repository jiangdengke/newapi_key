"use client";

import { useCallback, useEffect, useState } from "react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import AdminRecordsOverview from "./admin-records-overview.js";

const EMPTY_INSTANCE_FORM = Object.freeze({
  name: "",
  baseUrl: "",
  username: "",
  password: "",
  group: "anthropic",
  namePrefix: "claude",
  startNumber: "1",
  continueFromExisting: true,
  priority: "0",
  weight: "0",
  dateMode: "auto",
  enabled: true,
});

function createInstanceFormFromInstance(instance) {
  return {
    name: instance.name,
    baseUrl: instance.baseUrl,
    username: instance.adminUsername,
    password: "",
    group: instance.group,
    namePrefix: instance.namePrefix,
    startNumber: String(instance.startNumber),
    continueFromExisting: instance.continueFromExisting,
    priority: String(instance.priority),
    weight: String(instance.weight),
    dateMode: instance.dateMode,
    enabled: instance.enabled,
  };
}

function createInstanceRequestBody(instanceForm) {
  return {
    ...instanceForm,
    startNumber: Number(instanceForm.startNumber),
    priority: Number(instanceForm.priority),
    weight: Number(instanceForm.weight),
  };
}

function InstanceFormFields({ instanceForm, onChange, isEditing }) {
  return (
    <>
      <div className="form-grid">
        <label className="field">
          <span>实例名称</span>
          <input value={instanceForm.name} onChange={(event) => onChange("name", event.target.value)} required />
        </label>
        <label className="field form-grid-wide">
          <span>New API URL</span>
          <input type="url" value={instanceForm.baseUrl} onChange={(event) => onChange("baseUrl", event.target.value)} required />
        </label>
        <label className="field">
          <span>管理员用户名</span>
          <input value={instanceForm.username} onChange={(event) => onChange("username", event.target.value)} required />
        </label>
        <label className="field">
          <span>{isEditing ? "更新管理员密码（留空保持不变）" : "管理员密码"}</span>
          <input type="password" autoComplete="new-password" value={instanceForm.password} onChange={(event) => onChange("password", event.target.value)} required={!isEditing} />
        </label>
        <label className="field">
          <span>渠道分组</span>
          <input value={instanceForm.group} onChange={(event) => onChange("group", event.target.value)} required />
        </label>
        <label className="field">
          <span>名称前缀</span>
          <input value={instanceForm.namePrefix} onChange={(event) => onChange("namePrefix", event.target.value)} required />
        </label>
        <label className="field">
          <span>起始序号</span>
          <input type="number" min="1" max="999999" value={instanceForm.startNumber} onChange={(event) => onChange("startNumber", event.target.value)} required />
        </label>
        <label className="field">
          <span>渠道优先级</span>
          <input type="number" step="1" value={instanceForm.priority} onChange={(event) => onChange("priority", event.target.value)} required />
        </label>
        <label className="field">
          <span>渠道权重</span>
          <input type="number" min="0" step="1" value={instanceForm.weight} onChange={(event) => onChange("weight", event.target.value)} required />
        </label>
        <label className="field">
          <span>日期模式</span>
          <input value={instanceForm.dateMode} onChange={(event) => onChange("dateMode", event.target.value)} placeholder="auto 或 0711" required />
        </label>
      </div>
      <div className="checkbox-row">
        <label>
          <input type="checkbox" checked={instanceForm.continueFromExisting} onChange={(event) => onChange("continueFromExisting", event.target.checked)} />
          接续现有同前缀序号
        </label>
        {isEditing ? (
          <label>
            <input type="checkbox" checked={instanceForm.enabled} onChange={(event) => onChange("enabled", event.target.checked)} />
            启用实例
          </label>
        ) : null}
      </div>
    </>
  );
}

export default function AdminDashboard({ onOpenInstance }) {
  const [instances, setInstances] = useState([]);
  const [createInstanceForm, setCreateInstanceForm] = useState({ ...EMPTY_INSTANCE_FORM });
  const [editingInstance, setEditingInstance] = useState(null);
  const [editInstanceForm, setEditInstanceForm] = useState({ ...EMPTY_INSTANCE_FORM });
  const [deletingInstance, setDeletingInstance] = useState(null);
  const [generatedAccessKeys, setGeneratedAccessKeys] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [recordsRefreshToken, setRecordsRefreshToken] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  const loadManagementData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const responsePayload = await requestJson("/api/admin/instances");
      setInstances(responsePayload.data.instances);
    } catch (error) {
      const currentErrorMessage = error?.message || "读取管理数据失败";
      setErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadManagementData();
  }, [loadManagementData]);

  function resetMessages() {
    setErrorMessage("");
  }

  function updateCreateInstanceForm(fieldName, value) {
    setCreateInstanceForm((currentForm) => ({ ...currentForm, [fieldName]: value }));
  }

  function updateEditInstanceForm(fieldName, value) {
    setEditInstanceForm((currentForm) => ({ ...currentForm, [fieldName]: value }));
  }

  function startEditingInstance(instance) {
    resetMessages();
    setEditingInstance(instance);
    setEditInstanceForm(createInstanceFormFromInstance(instance));
  }

  function closeEditInstanceModal() {
    setEditingInstance(null);
    setEditInstanceForm({ ...EMPTY_INSTANCE_FORM });
  }

  async function createInstance(event) {
    event.preventDefault();
    resetMessages();
    setIsSubmitting(true);
    try {
      await requestJson("/api/admin/instances", {
        method: "POST",
        body: JSON.stringify(createInstanceRequestBody(createInstanceForm)),
      });
      const successMessage = "New API 实例已创建";
      showToast(successMessage, { type: "success" });
      setCreateInstanceForm({ ...EMPTY_INSTANCE_FORM });
      await loadManagementData();
    } catch (error) {
      const currentErrorMessage = error?.message || "保存实例失败";
      setErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateInstance(event) {
    event.preventDefault();
    if (!editingInstance) {
      return;
    }
    resetMessages();
    setIsSubmitting(true);
    try {
      await requestJson(`/api/admin/instances/${editingInstance.id}`, {
        method: "PATCH",
        body: JSON.stringify(createInstanceRequestBody(editInstanceForm)),
      });
      const successMessage = "实例配置已更新";
      showToast(successMessage, { type: "success" });
      closeEditInstanceModal();
      await loadManagementData();
    } catch (error) {
      const currentErrorMessage = error?.message || "保存实例失败";
      setErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteInstance() {
    if (!deletingInstance) {
      return;
    }
    resetMessages();
    setIsDeleting(true);
    try {
      const responsePayload = await requestJson(
        `/api/admin/instances/${deletingInstance.id}`,
        { method: "DELETE" },
      );
      setGeneratedAccessKeys((currentKeys) => {
        const remainingKeys = { ...currentKeys };
        delete remainingKeys[deletingInstance.id];
        return remainingKeys;
      });
      const deletedRecordCount = responsePayload.data.deletedChannelRecordCount;
      const successMessage = deletedRecordCount > 0
        ? `实例已删除，同时删除 ${deletedRecordCount} 条本地渠道历史`
        : "实例已删除";
      showToast(successMessage, { type: "success" });
      setDeletingInstance(null);
      setRecordsRefreshToken((currentToken) => currentToken + 1);
      await loadManagementData();
    } catch (error) {
      const currentErrorMessage = error?.message || "删除实例失败";
      setErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    } finally {
      setIsDeleting(false);
    }
  }

  async function testInstance(instanceId) {
    resetMessages();
    try {
      const responsePayload = await requestJson(
        `/api/admin/instances/${instanceId}/test`,
        { method: "POST", body: "{}" },
      );
      const successMessage = (
        `连接成功：${responsePayload.data.systemName} `
        + `${responsePayload.data.version}（${responsePayload.data.username}）`
      );
      showToast(successMessage, { type: "success" });
    } catch (error) {
      const currentErrorMessage = error?.message || "测试连接失败";
      setErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    }
  }

  async function generateAccessKey(instance) {
    resetMessages();
    if (
      instance.accessKey.configured
      && !window.confirm("重新生成后，旧访问 Key 和现有访客会话将立即失效。是否继续？")
    ) {
      return;
    }
    try {
      const responsePayload = await requestJson(
        `/api/admin/instances/${instance.id}/access-key`,
        { method: "POST", body: "{}" },
      );
      setGeneratedAccessKeys((currentKeys) => ({
        ...currentKeys,
        [instance.id]: responsePayload.data.accessKey,
      }));
      const successMessage = "访问 Key 已生成。请立即复制保存，关闭或刷新页面后无法再次查看完整值。";
      showToast(successMessage, { type: "success" });
      await loadManagementData();
    } catch (error) {
      const currentErrorMessage = error?.message || "生成访问 Key 失败";
      setErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    }
  }

  async function disableAccessKey(instance) {
    resetMessages();
    if (!window.confirm("停用后，该访问 Key 和现有访客会话将立即失效。是否继续？")) {
      return;
    }
    try {
      await requestJson(`/api/admin/instances/${instance.id}/access-key`, {
        method: "DELETE",
        body: "{}",
      });
      setGeneratedAccessKeys((currentKeys) => {
        const remainingKeys = { ...currentKeys };
        delete remainingKeys[instance.id];
        return remainingKeys;
      });
      const successMessage = "实例访问 Key 已停用";
      showToast(successMessage, { type: "success" });
      await loadManagementData();
    } catch (error) {
      const currentErrorMessage = error?.message || "停用访问 Key 失败";
      setErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    }
  }

  async function copyAccessKey(instanceId) {
    try {
      await navigator.clipboard.writeText(generatedAccessKeys[instanceId]);
      const successMessage = "完整访问 Key 已复制";
      showToast(successMessage, { type: "success" });
    } catch (error) {
      const currentErrorMessage = error?.message || "复制访问 Key 失败";
      setErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    }
  }

  return (
    <main className="page-shell admin-page">
      {errorMessage ? <p className="form-error panel-message">{errorMessage}</p> : null}

      <AdminRecordsOverview
        instances={instances}
        onOpenInstance={onOpenInstance}
        refreshToken={recordsRefreshToken}
      />

      <>
          <form className="panel management-form" onSubmit={createInstance}>
            <div className="panel-heading">
              <div>
                <h2>新增 New API 实例</h2>
                <p>New API 管理员密码将加密保存，实例访问者不会看到连接凭据。</p>
              </div>
            </div>
            <InstanceFormFields
              instanceForm={createInstanceForm}
              onChange={updateCreateInstanceForm}
              isEditing={false}
            />
            <div className="submit-row">
              <button className="button button-primary" disabled={isSubmitting}>
                {isSubmitting ? "正在保存..." : "创建实例"}
              </button>
            </div>
          </form>

          <section className="instance-grid" aria-busy={isLoading}>
            {instances.map((instance) => (
              <article className="instance-card" key={instance.id}>
                <div className="instance-card-header">
                  <div>
                    <span className={`status-dot ${instance.enabled ? "enabled" : "disabled"}`} />
                    <strong>{instance.name}</strong>
                  </div>
                  <span className="subtle-label">#{instance.id}</span>
                </div>
                <p className="instance-url">{instance.baseUrl}</p>
                <dl className="instance-metadata">
                  <div><dt>管理员</dt><dd>{instance.adminUsername}</dd></div>
                  <div><dt>命名</dt><dd>{instance.namePrefix}-{instance.dateMode}-序号</dd></div>
                  <div><dt>分组</dt><dd>{instance.group}</dd></div>
                  <div><dt>优先级</dt><dd>{instance.priority}</dd></div>
                  <div><dt>权重</dt><dd>{instance.weight}</dd></div>
                  <div>
                    <dt>访问 Key</dt>
                    <dd>
                      {instance.accessKey.enabled
                        ? instance.accessKey.mask
                        : instance.accessKey.configured ? "已停用" : "未生成"}
                    </dd>
                  </div>
                </dl>
                {generatedAccessKeys[instance.id] ? (
                  <div className="generated-key-panel">
                    <strong>完整访问 Key（仅本次显示）</strong>
                    <input readOnly value={generatedAccessKeys[instance.id]} />
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={() => copyAccessKey(instance.id)}
                    >
                      复制 Key
                    </button>
                  </div>
                ) : null}
                <div className="card-actions">
                  <button className="button button-primary" type="button" onClick={() => onOpenInstance(instance.id)}>进入实例</button>
                  <button className="button button-secondary" type="button" onClick={() => testInstance(instance.id)}>测试</button>
                  <button className="button button-secondary" type="button" onClick={() => startEditingInstance(instance)}>编辑</button>
                  <button className="button button-secondary" type="button" onClick={() => generateAccessKey(instance)}>
                    {instance.accessKey.configured ? "重新生成 Key" : "生成访问 Key"}
                  </button>
                  {instance.accessKey.enabled ? (
                    <button className="button button-secondary" type="button" onClick={() => disableAccessKey(instance)}>
                      停用 Key
                    </button>
                  ) : null}
                  <button
                    className="button button-danger"
                    type="button"
                    onClick={() => {
                      resetMessages();
                      setDeletingInstance(instance);
                    }}
                  >
                    删除实例
                  </button>
                </div>
              </article>
            ))}
            {!isLoading && instances.length === 0 ? <div className="empty-state">尚未配置 New API 实例。</div> : null}
          </section>
      </>

      {editingInstance ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-instance-title"
          >
            <form onSubmit={updateInstance}>
              <div className="panel-heading">
                <div>
                  <h2 id="edit-instance-title">编辑实例</h2>
                  <p>修改 {editingInstance.name} 的本地连接配置和渠道默认值。</p>
                </div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={isSubmitting}
                  onClick={closeEditInstanceModal}
                >
                  关闭
                </button>
              </div>
              <InstanceFormFields
                instanceForm={editInstanceForm}
                onChange={updateEditInstanceForm}
                isEditing
              />
              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={isSubmitting}
                  onClick={closeEditInstanceModal}
                >
                  取消
                </button>
                <button className="button button-primary" disabled={isSubmitting}>
                  {isSubmitting ? "正在保存..." : "保存修改"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {deletingInstance ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-dialog modal-dialog-compact"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-instance-title"
            aria-describedby="delete-instance-description"
          >
            <h2 id="delete-instance-title">确认删除实例</h2>
            <p id="delete-instance-description">
              将删除本系统中的实例“{deletingInstance.name}”、访问 Key、访客会话和
              {deletingInstance.channelRecordCount} 条本地渠道历史。
            </p>
            <p className="delete-confirmation-summary">
              此操作不会连接 New API，也不会删除上游已经创建的真实渠道。
            </p>
            <div className="modal-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingInstance(null)}
              >
                取消
              </button>
              <button
                className="button button-danger"
                type="button"
                disabled={isDeleting}
                onClick={deleteInstance}
              >
                {isDeleting ? "正在删除..." : "确认删除本地实例"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
