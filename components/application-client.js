"use client";

import { useEffect, useState } from "react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import AccessGateway from "./access-gateway.js";
import AdminDashboard from "./admin-dashboard.js";
import InstanceWorkspace from "./instance-workspace.js";

const EMPTY_ADMINISTRATOR_PASSWORD_FORM = Object.freeze({
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
});

export default function ApplicationClient() {
  const [sessionState, setSessionState] = useState({
    status: "loading",
    principal: null,
  });
  const [selectedInstanceId, setSelectedInstanceId] = useState(null);
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false);
  const [administratorPasswordForm, setAdministratorPasswordForm] = useState({
    ...EMPTY_ADMINISTRATOR_PASSWORD_FORM,
  });
  const [passwordErrorMessage, setPasswordErrorMessage] = useState("");
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  useEffect(() => {
    let isActive = true;
    function handleSessionExpired() {
      setSelectedInstanceId(null);
      setIsPasswordDialogOpen(false);
      setSessionState({ status: "anonymous", principal: null });
      showToast("登录状态已失效，请重新验证", { type: "error" });
    }
    window.addEventListener("application-session-expired", handleSessionExpired);
    requestJson("/api/auth/me", { suppressSessionExpiredEvent: true })
      .then((responsePayload) => {
        if (!isActive) {
          return;
        }
        const authenticatedPrincipal = responsePayload.data.principal;
        setSessionState({
          status: "authenticated",
          principal: authenticatedPrincipal,
        });
        if (authenticatedPrincipal.kind === "visitor") {
          setSelectedInstanceId(authenticatedPrincipal.instanceId);
        }
      })
      .catch(() => {
        if (isActive) {
          setSessionState({ status: "anonymous", principal: null });
        }
      });
    return () => {
      isActive = false;
      window.removeEventListener("application-session-expired", handleSessionExpired);
    };
  }, []);

  function handleAuthenticated(principal) {
    setSessionState({ status: "authenticated", principal });
    setSelectedInstanceId(principal.kind === "visitor" ? principal.instanceId : null);
    showToast(
      principal.kind === "admin" ? "管理员登录成功" : "实例访问验证成功",
      { type: "success" },
    );
  }

  function openPasswordDialog() {
    setAdministratorPasswordForm({ ...EMPTY_ADMINISTRATOR_PASSWORD_FORM });
    setPasswordErrorMessage("");
    setIsPasswordDialogOpen(true);
  }

  function closePasswordDialog() {
    if (isUpdatingPassword) {
      return;
    }
    setIsPasswordDialogOpen(false);
    setAdministratorPasswordForm({ ...EMPTY_ADMINISTRATOR_PASSWORD_FORM });
    setPasswordErrorMessage("");
  }

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
      setIsPasswordDialogOpen(false);
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

  async function handleLogout() {
    try {
      await requestJson("/api/auth/logout", {
        method: "POST",
        body: "{}",
      });
      showToast("已退出登录", { type: "success" });
    } catch (error) {
      showToast(error?.message || "服务端退出登录失败", { type: "error" });
    } finally {
      setSelectedInstanceId(null);
      setIsPasswordDialogOpen(false);
      setSessionState({ status: "anonymous", principal: null });
    }
  }

  if (sessionState.status === "loading") {
    return (
      <main className="loading-page">
        <div className="loading-indicator" />
        <p>正在读取登录状态...</p>
      </main>
    );
  }

  if (sessionState.status !== "authenticated") {
    return <AccessGateway onAuthenticated={handleAuthenticated} />;
  }

  const currentPrincipal = sessionState.principal;
  return (
    <div className="application-shell">
      <header className="application-header">
        <button
          className="application-brand"
          type="button"
          onClick={() => currentPrincipal.kind === "admin" && setSelectedInstanceId(null)}
        >
          <span className="brand-mark brand-mark-small" aria-hidden="true">N</span>
          <span>
            <strong>New API 渠道管理</strong>
            <small>
              {currentPrincipal.kind === "admin" ? "管理端" : currentPrincipal.instanceName}
            </small>
          </span>
        </button>
        <div className="account-actions">
          <span>
            {currentPrincipal.kind === "admin" ? currentPrincipal.username : "实例访问"}
          </span>
          {currentPrincipal.kind === "admin" ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={openPasswordDialog}
            >
              修改密码
            </button>
          ) : null}
          <button className="button button-secondary" type="button" onClick={handleLogout}>
            退出登录
          </button>
        </div>
      </header>

      {selectedInstanceId ? (
        <InstanceWorkspace
          instanceId={selectedInstanceId}
          canGoBack={currentPrincipal.kind === "admin"}
          onGoBack={() => setSelectedInstanceId(null)}
        />
      ) : (
        <AdminDashboard onOpenInstance={setSelectedInstanceId} />
      )}

      {currentPrincipal.kind === "admin" && isPasswordDialogOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-dialog modal-dialog-compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="administrator-password-title"
          >
            <form onSubmit={updateAdministratorPassword}>
              <div className="panel-heading">
                <div>
                  <h2 id="administrator-password-title">修改管理员密码</h2>
                  <p>修改成功后保留当前会话，并撤销该管理员的其他登录会话。</p>
                </div>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={isUpdatingPassword}
                  onClick={closePasswordDialog}
                >
                  关闭
                </button>
              </div>

              <div className="form-grid">
                <label className="field form-grid-wide">
                  <span>当前密码</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={administratorPasswordForm.currentPassword}
                    onChange={(event) => updateAdministratorPasswordForm(
                      "currentPassword",
                      event.target.value,
                    )}
                    autoFocus
                    required
                  />
                </label>
                <label className="field form-grid-wide">
                  <span>新密码</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    value={administratorPasswordForm.newPassword}
                    onChange={(event) => updateAdministratorPasswordForm(
                      "newPassword",
                      event.target.value,
                    )}
                    required
                  />
                </label>
                <label className="field form-grid-wide">
                  <span>确认新密码</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    value={administratorPasswordForm.confirmPassword}
                    onChange={(event) => updateAdministratorPasswordForm(
                      "confirmPassword",
                      event.target.value,
                    )}
                    required
                  />
                </label>
              </div>

              {passwordErrorMessage ? (
                <p className="form-error">{passwordErrorMessage}</p>
              ) : null}

              <div className="modal-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={isUpdatingPassword}
                  onClick={closePasswordDialog}
                >
                  取消
                </button>
                <button className="button button-primary" disabled={isUpdatingPassword}>
                  {isUpdatingPassword ? "正在修改..." : "确认修改密码"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
