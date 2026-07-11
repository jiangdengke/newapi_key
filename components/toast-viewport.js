"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { TOAST_EVENT_NAME } from "../lib/toast.js";

const TOAST_LIFETIMES = Object.freeze({
  success: 3_500,
  info: 4_500,
  error: 7_000,
});

export default function ToastViewport() {
  const [toasts, setToasts] = useState([]);
  const nextToastId = useRef(1);

  const dismissToast = useCallback((toastId) => {
    setToasts((currentToasts) => (
      currentToasts.filter((toast) => toast.id !== toastId)
    ));
  }, []);

  useEffect(() => {
    function handleToast(event) {
      const toastId = nextToastId.current;
      nextToastId.current += 1;
      const toastType = ["success", "info", "error"].includes(event.detail?.type)
        ? event.detail.type
        : "info";
      setToasts((currentToasts) => [
        ...currentToasts,
        {
          id: toastId,
          message: String(event.detail?.message || "操作已完成"),
          type: toastType,
        },
      ].slice(-4));
      window.setTimeout(() => dismissToast(toastId), TOAST_LIFETIMES[toastType]);
    }

    window.addEventListener(TOAST_EVENT_NAME, handleToast);
    return () => window.removeEventListener(TOAST_EVENT_NAME, handleToast);
  }, [dismissToast]);

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className={`toast toast-${toast.type}`} role="status" key={toast.id}>
          <span className="toast-icon" aria-hidden="true">
            {toast.type === "success" ? "✓" : toast.type === "error" ? "!" : "i"}
          </span>
          <span className="toast-message">{toast.message}</span>
          <button
            className="toast-close"
            type="button"
            aria-label="关闭提示"
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
