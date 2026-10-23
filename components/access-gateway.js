"use client";

import { useState } from "react";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import { BrandName } from "./app-shell.js";
import LoginView from "./login-view.js";
import ThemeToggle from "./theme-toggle.js";
import { Field, PasswordInput, Segmented, Spinner } from "./ui.js";

const AUTH_MODES = [
  { value: "access", label: "访问 Key", icon: KeyRound },
  { value: "admin", label: "管理员", icon: ShieldCheck },
];

function AccessKeyForm({ onAuthenticated }) {
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

  return (
    <form className="auth-form" onSubmit={handleAccessSubmit}>
      <Field label="实例访问 Key" hint="由管理员为每个实例单独生成，以 nai_ 开头。" error={errorMessage}>
        <PasswordInput
          autoComplete="off"
          placeholder="nai_..."
          spellCheck="false"
          value={accessKey}
          onChange={(event) => setAccessKey(event.target.value)}
          autoFocus
          required
        />
      </Field>
      <button className="btn btn-primary btn-block" disabled={isSubmitting}>
        {isSubmitting ? <Spinner /> : <ArrowRight size={15} aria-hidden="true" />}
        {isSubmitting ? "正在验证..." : "进入工作区"}
      </button>
    </form>
  );
}

export default function AccessGateway({ onAuthenticated }) {
  const [authMode, setAuthMode] = useState("access");
  const isAccessMode = authMode === "access";

  return (
    <div className="auth-page">
      <header className="auth-header">
        <BrandName />
        <ThemeToggle />
      </header>
      <main className="auth-main">
        <section className="auth-card">
          <h1>{isAccessMode ? "进入实例" : "管理员登录"}</h1>
          <p className="auth-description">
            {isAccessMode
              ? "输入管理员分配的访问 Key，进入对应 New API 实例的渠道工作区。"
              : "登录后维护 New API 实例，并为每个实例生成独立的访问 Key。"}
          </p>
          <Segmented
            options={AUTH_MODES}
            value={authMode}
            onChange={setAuthMode}
            ariaLabel="选择登录方式"
          />
          {isAccessMode ? (
            <AccessKeyForm onAuthenticated={onAuthenticated} />
          ) : (
            <LoginView onAuthenticated={onAuthenticated} />
          )}
        </section>
      </main>
      <footer className="auth-footer">
        批量导入 Claude、OpenAI 与 Grok 渠道 · Key 加密保存
      </footer>
    </div>
  );
}
