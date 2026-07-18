import "./globals.css";

import ToastViewport from "../components/toast-viewport.js";

export const metadata = {
  title: "New API 渠道管理",
  description: "管理多个 New API 实例并导入 Claude、OpenAI 与 Grok 渠道",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {children}
        <ToastViewport />
      </body>
    </html>
  );
}
