"use client";

import { useState } from "react";
import { LockKeyhole, Save } from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import { Field, PageHeader, PasswordInput, SectionHeading, Spinner } from "./ui.js";

const EMPTY_ADMINISTRATOR_PASSWORD_FORM = Object.freeze({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});

export default function AccountSecurity({ username }) {
  const [administratorPasswordForm, setAdministratorPasswordForm] = useState({
    ...EMPTY_ADMINISTRATOR_PASSWORD_FORM,
  });
  const [passwordErrorMessage, setPasswordErrorMessage] = useState("");
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  function updateAdministratorPasswordForm(fieldName, value) {
    setAdministratorPasswordForm((currentForm) => ({
      ...currentForm,
      [fieldName]: value,
    }));
  }

  async function updateAdministratorPassword(event) {
    event.preventDefault();
    setPasswordErrorMessage("");
    setIsUpdatingPassword(true);
    try {
      await requestJson("/api/admin/password", {
        method: "POST",
        body: JSON.stringify(administratorPasswordForm),
      });
      setAdministratorPasswordForm({ ...EMPTY_ADMINISTRATOR_PASSWORD_FORM });
      showToast("管理员密码已修改，其他登录会话已失效", { type: "success" });
    } catch (error) {
      const currentErrorMessage = error?.message || "修改管理员密码失败";
      setPasswordErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    } finally {
      setIsUpdatingPassword(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="账号安全"
        description={`当前登录管理员：${username}`}
      />
      <form className="card settings-card" onSubmit={updateAdministratorPassword}>
        <SectionHeading
          icon={LockKeyhole}
          title="修改管理员密码"
          description="修改成功后保留当前会话，并撤销该管理员的其他登录会话。"
        />
        <div className="form-grid form-grid-single">
          <Field label="当前密码">
            <PasswordInput
              autoComplete="current-password"
              value={administratorPasswordForm.currentPassword}
              onChange={(event) => updateAdministratorPasswordForm(
                "currentPassword",
                event.target.value,
              )}
              required
            />
          </Field>
          <Field label="新密码" hint="至少 10 个字符。">
            <PasswordInput
              autoComplete="new-password"
              minLength={10}
              value={administratorPasswordForm.newPassword}
              onChange={(event) => updateAdministratorPasswordForm(
                "newPassword",
                event.target.value,
              )}
              required
            />
          </Field>
          <Field label="确认新密码" error={passwordErrorMessage}>
            <PasswordInput
              autoComplete="new-password"
              minLength={10}
              value={administratorPasswordForm.confirmPassword}
              onChange={(event) => updateAdministratorPasswordForm(
                "confirmPassword",
                event.target.value,
              )}
              required
            />
          </Field>
        </div>
        <div className="card-actions">
          <button className="btn btn-primary" disabled={isUpdatingPassword}>
            {isUpdatingPassword ? <Spinner /> : <Save size={15} aria-hidden="true" />}
            {isUpdatingPassword ? "正在修改..." : "保存新密码"}
          </button>
        </div>
      </form>
    </div>
  );
}
