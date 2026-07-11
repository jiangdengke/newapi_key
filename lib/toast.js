export const TOAST_EVENT_NAME = "application-toast";

export function showToast(message, { type = "info" } = {}) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(TOAST_EVENT_NAME, {
    detail: {
      message: String(message),
      type,
    },
  }));
}
