"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { THEME_STORAGE_KEY } from "../lib/preferences.js";

const THEME_OPTIONS = Object.freeze({
  system: { label: "跟随系统", icon: Monitor, next: "light" },
  light: { label: "浅色", icon: Sun, next: "dark" },
  dark: { label: "深色", icon: Moon, next: "system" },
});

function applyTheme(theme) {
  if (theme === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
  try {
    if (theme === "system") {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    return;
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState("system");

  useEffect(() => {
    const appliedTheme = document.documentElement.dataset.theme;
    if (appliedTheme === "light" || appliedTheme === "dark") {
      setTheme(appliedTheme);
    }
  }, []);

  const currentOption = THEME_OPTIONS[theme];
  const ThemeIcon = currentOption.icon;
  const nextLabel = THEME_OPTIONS[currentOption.next].label;
  return (
    <button
      className="btn btn-ghost btn-icon"
      type="button"
      title={`主题：${currentOption.label}（点击切换为${nextLabel}）`}
      aria-label={`切换主题，当前为${currentOption.label}`}
      onClick={() => {
        applyTheme(currentOption.next);
        setTheme(currentOption.next);
      }}
    >
      <ThemeIcon size={16} />
    </button>
  );
}
