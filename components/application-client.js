"use client";

import { useEffect, useState } from "react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import AccessGateway from "./access-gateway.js";
import AdminDashboard from "./admin-dashboard.js";
import InstanceWorkspace from "./instance-workspace.js";

export default function ApplicationClient() {
  const [sessionState, setSessionState] = useState({
    status: "loading",
    principal: null,
  });
  const [selectedInstanceId, setSelectedInstanceId] = useState(null);

  useEffect(() => {
    let isActive = true;
    function handleSessionExpired() {
      setSelectedInstanceId(null);
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
    </div>
  );
}
