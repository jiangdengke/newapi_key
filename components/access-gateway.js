"use client";

import { useState } from "react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import LoginView from "./login-view.js";

export default function AccessGateway({ onAuthenticated }) {
  const [showAdministratorLogin, setShowAdministratorLogin] = useState(false);
  const [accessKey, setAccessKey] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleAccessSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);
    try {
      const responsePayload = await requestJson("/api/access/login", {
        method: "POST",
        body: JSON.stringify({ accessKey }),
        suppressSessionExpiredEvent: true,
      });
      setAccessKey("");
      onAuthenticated(responsePayload.data.principal);
    } catch (error) {
      const currentErrorMessage = error?.message || "实例访问 Key 验证失败";
      setErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (showAdministratorLogin) {
    return (
      <LoginView
        onAuthenticated={onAuthenticated}
        onBack={() => setShowAdministratorLogin(false)}
      />
    );
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark" aria-hidden="true">N</div>
        <p className="eyebrow">NEW API WORKSPACE</p>
        <h1>进入实例</h1>
        <p className="login-description">
          输入管理员分配的实例访问 Key，进入对应的 New API 渠道工作区。
        </p>

        <form className="login-form" onSubmit={handleAccessSubmit}>
          <label className="field">
            <span>实例访问 Key</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="nai_..."
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              required
            />
          </label>
          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
          <button className="button button-primary button-block" disabled={isSubmitting}>
            {isSubmitting ? "正在验证..." : "进入工作区"}
          </button>
          <button
            className="button button-secondary button-block"
            type="button"
            onClick={() => setShowAdministratorLogin(true)}
          >
            管理员登录
          </button>
        </form>
      </section>
    </main>
  );
}
