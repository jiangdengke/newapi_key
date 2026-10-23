"use client";

import { useEffect, useState } from "react";
import { KeyRound, LogOut, PanelLeft } from "lucide-react";

import ThemeToggle from "./theme-toggle.js";

export function BrandMark({ size = 24 }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <KeyRound size={Math.round(size * 0.56)} strokeWidth={2.4} />
    </span>
  );
}

export function BrandName({ tag }) {
  return (
    <span className="brand">
      <BrandMark />
      <strong>New API 渠道管理</strong>
      {tag ? <span className="brand-tag">{tag}</span> : null}
    </span>
  );
}

export default function AppShell({
  brandTag,
  user,
  navigation,
  activeKey,
  onNavigate,
  onLogout,
  children,
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [activeKey]);

  return (
    <div className="app">
      <header className="app-header">
        <button
          className="btn btn-ghost btn-icon sidebar-toggle"
          type="button"
          aria-label={isSidebarOpen ? "收起导航" : "展开导航"}
          aria-expanded={isSidebarOpen}
          onClick={() => setIsSidebarOpen((currentValue) => !currentValue)}
        >
          <PanelLeft size={16} />
        </button>
        <BrandName tag={brandTag} />
        <div className="header-actions">
          <ThemeToggle />
          <span className="user-chip" title={user.name}>
            <span className="avatar" aria-hidden="true">{user.initial}</span>
            <span className="user-chip-name">{user.name}</span>
          </span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onLogout}>
            <LogOut size={15} aria-hidden="true" />
            <span className="hide-on-mobile">退出</span>
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className={`app-sidebar ${isSidebarOpen ? "is-open" : ""}`}>
          {navigation.map((group) => (
            <nav className="nav-group" key={group.label} aria-label={group.label}>
              <p className="nav-group-label">{group.label}</p>
              {group.items.map((item) => {
                const ItemIcon = item.icon;
                const isActive = item.key === activeKey;
                return (
                  <button
                    className={`nav-item ${isActive ? "is-active" : ""}`}
                    type="button"
                    key={item.key}
                    aria-current={isActive ? "page" : undefined}
                    title={item.label}
                    onClick={() => {
                      setIsSidebarOpen(false);
                      onNavigate(item.key);
                    }}
                  >
                    {ItemIcon ? (
                      <ItemIcon size={16} aria-hidden="true" />
                    ) : (
                      <span className={`nav-dot ${item.dotTone || ""}`} aria-hidden="true" />
                    )}
                    <span className="nav-item-label">{item.label}</span>
                    {item.meta !== undefined ? <span className="nav-item-meta">{item.meta}</span> : null}
                  </button>
                );
              })}
            </nav>
          ))}
        </aside>
        {isSidebarOpen ? (
          <div
            className="sidebar-backdrop"
            role="presentation"
            onClick={() => setIsSidebarOpen(false)}
          />
        ) : null}
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
