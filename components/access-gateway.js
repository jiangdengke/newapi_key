"use client";

import { BrandName } from "./app-shell.js";
import LoginView from "./login-view.js";
import ThemeToggle from "./theme-toggle.js";

export default function AccessGateway({ onAuthenticated }) {
  return (
    <div className="auth-page">
      <header className="auth-header">
        <BrandName />
        <ThemeToggle />
      </header>
      <main className="auth-main">
        <section className="auth-card">
          <h1>账号登录</h1>
          <p className="auth-description">
            使用账号密码登录，进入已授权的 New API 实例。
          </p>
          <LoginView onAuthenticated={onAuthenticated} />
        </section>
      </main>
      <footer className="auth-footer">
        批量导入 Claude、OpenAI 与 Grok 渠道 · Key 加密保存
      </footer>
    </div>
  );
}
