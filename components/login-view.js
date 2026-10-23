"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import { Field, PasswordInput, Spinner } from "./ui.js";

export default function LoginView({ onAuthenticated }) {
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
    <form className="auth-form" onSubmit={handleSubmit}>
      <Field label="用户名">
        <input
          className="input"
          autoComplete="username"
          placeholder="输入管理员用户名"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoFocus
          required
        />
      </Field>
      <Field label="密码" error={errorMessage}>
        <PasswordInput
          autoComplete="current-password"
          placeholder="输入密码"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </Field>
      <button className="btn btn-primary btn-block" disabled={isSubmitting}>
        {isSubmitting ? <Spinner /> : <LogIn size={15} aria-hidden="true" />}
        {isSubmitting ? "正在登录..." : "登录"}
      </button>
    </form>
  );
}
