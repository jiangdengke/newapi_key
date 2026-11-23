"use client";

import { useEffect, useState } from "react";
import { Plus, Users } from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import { EmptyState, Field, Modal, PasswordInput, Select, Spinner } from "./ui.js";

const USERS_PATH = "/api/admin/users";

export default function AdminUsers() {
  const [accounts, setAccounts] = useState(null);
  const [form, setForm] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function loadAccounts() {
    try {
      const response = await requestJson(USERS_PATH);
      setAccounts(response.data);
    } catch (error) {
      showToast(error.message || "读取用户列表失败", { type: "error" });
    }
  }

  useEffect(() => { loadAccounts(); }, []);

  function openForm(user = null) {
    setErrorMessage("");
    setForm({ id: user?.id, username: user?.username ?? "", enabled: user?.enabled ?? true,
      instanceIds: user?.instanceIds ?? [], password: "" });
  }

  function updateForm(field, value) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  async function saveUser(event) {
    event.preventDefault();
    setErrorMessage("");
    setIsSaving(true);
    try {
      await requestJson(USERS_PATH, {
        method: form.id ? "PATCH" : "POST",
        body: JSON.stringify(form),
      });
      setForm(null);
      showToast("账号已保存", { type: "success" });
      await loadAccounts();
    } catch (error) {
      setErrorMessage(error.message || "保存账号失败");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section>
      <div className="member-card-head">
        <h1>用户管理</h1>
        <button className="btn btn-primary" type="button" disabled={!accounts} onClick={() => openForm()}>
          <Plus size={15} aria-hidden="true" /> 新增用户
        </button>
      </div>
      <div className="member-list">
        {!accounts ? <Spinner /> : accounts.users.length === 0 ? (
          <EmptyState icon={Users} title="还没有普通用户" description="新建账号后，可直接勾选允许访问的 New API 实例。" />
        ) : accounts.users.map((user) => (
          <article className="member-card member-card-head" key={user.id}>
            <div className="cell-stack">
              <strong>{user.username}</strong>
              <span>{user.enabled ? "已启用" : "已停用"} · 可访问 {user.instanceIds.length} 个实例</span>
            </div>
            <button className="btn btn-outline" type="button" onClick={() => openForm(user)}>管理账号</button>
          </article>
        ))}
      </div>
      {form ? (
        <Modal
          open
          title={form.id ? "管理账号" : "新增用户"}
          onClose={() => setForm(null)}
          closeDisabled={isSaving}
          closeOnBackdrop={false}
          onSubmit={saveUser}
          footer={<button className="btn btn-primary" disabled={isSaving}>{isSaving ? "正在保存..." : "保存"}</button>}
        >
          <div className="form-grid">
            <Field label="用户名">
              <input className="input" value={form.username} required maxLength={128} autoComplete="off"
                onChange={(event) => updateForm("username", event.target.value)} />
            </Field>
            <Field label={form.id ? "重置密码" : "初始密码"} hint={form.id ? "留空则保留原密码" : "至少 10 个字符"}>
              <PasswordInput value={form.password} required={!form.id} minLength={10} autoComplete="new-password"
                onChange={(event) => updateForm("password", event.target.value)} />
            </Field>
            <Field label="账号状态" wide>
              <Select value={form.enabled ? "enabled" : "disabled"}
                onChange={(event) => updateForm("enabled", event.target.value === "enabled")}>
                <option value="enabled">启用</option>
                <option value="disabled">停用</option>
              </Select>
            </Field>
            <div className="field field-wide">
              <div className="field-label-row"><label>可访问实例</label></div>
              <p className="field-hint">勾选后该用户即可选择并推送到对应实例；首次授权会自动创建访问成员。</p>
              <div className="member-list">
                {(accounts?.instances ?? []).map((instance) => {
                  const isSelected = form.instanceIds.includes(instance.id);
                  return (
                    <label className="member-card member-card-head" key={instance.id}>
                      <span className="cell-stack">
                        <strong>{instance.name}</strong>
                        <span>{instance.enabled ? instance.baseUrl : "实例已停用"}</span>
                      </span>
                      <input className="checkbox" type="checkbox" checked={isSelected}
                        aria-label={`允许 ${form.username || "该用户"} 访问 ${instance.name}`}
                        onChange={(event) => updateForm("instanceIds", event.target.checked
                          ? [...form.instanceIds, instance.id]
                          : form.instanceIds.filter((instanceId) => instanceId !== instance.id))} />
                    </label>
                  );
                })}
                {accounts?.instances.length === 0 ? <p className="form-note">还没有配置 New API 实例。</p> : null}
              </div>
              <p className="field-hint">已有访问成员会保留；新增成员默认使用账号编号作为名称前缀，可在实例管理中调整。</p>
            </div>
          </div>
          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
        </Modal>
      ) : null}
    </section>
  );
}
