"use client";

import { useState } from "react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";

export default function LoginView({ onAuthenticated, onBack }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);
    try {
      const responsePayload = await requestJson("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
        suppressSessionExpiredEvent: true,
      });
      setPassword("");
      onAuthenticated(responsePayload.data.principal);
    } catch (error) {
      const currentErrorMessage = error?.message || "登录失败";
      setErrorMessage(currentErrorMessage);
      showToast(currentErrorMessage, { type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand-mark" aria-hidden="true">N</div>
        <p className="eyebrow">ADMIN CONSOLE</p>
        <h1>管理员登录</h1>
        <p className="login-description">
          登录后维护 New API 实例，并为每个实例生成独立的访问 Key。
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>用户名</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
          <button className="button button-primary button-block" disabled={isSubmitting}>
            {isSubmitting ? "正在登录..." : "登录"}
          </button>
          <button
            className="button button-secondary button-block"
            type="button"
            onClick={onBack}
          >
            返回实例访问
          </button>
        </form>
      </section>
    </main>
  );
}
