"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";

import { TOAST_EVENT_NAME } from "../lib/toast.js";

const TOAST_ICONS = Object.freeze({
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
});

const TOAST_LIFETIMES = Object.freeze({
  success: 3_500,
  info: 4_500,
  warning: 6_000,
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
      const toastType = ["success", "info", "warning", "error"].includes(event.detail?.type)
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
      {toasts.map((toast) => {
        const ToastIcon = TOAST_ICONS[toast.type];
        return (
          <div className={`toast toast-${toast.type}`} role="status" key={toast.id}>
            <ToastIcon className="toast-icon" size={18} aria-hidden="true" />
            <span className="toast-message">{toast.message}</span>
            <button
              className="toast-close"
              type="button"
              aria-label="关闭提示"
              onClick={() => dismissToast(toast.id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
