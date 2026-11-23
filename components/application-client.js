"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Rocket, Server, ShieldCheck, Users } from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import AccessGateway from "./access-gateway.js";
import AccountSecurity from "./account-security.js";
import AdminInstances from "./admin-instances.js";
import AdminRecordsOverview from "./admin-records-overview.js";
import AdminUsers from "./admin-users.js";
import AppShell from "./app-shell.js";
import ChannelPublisher from "./channel-publisher.js";
import InstanceWorkspace from "./instance-workspace.js";
import { EmptyState, Spinner } from "./ui.js";

const ADMINISTRATOR_PAGES = new Set(["instances", "users", "records", "security"]);

function readRouteSegments() {
  return window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

function parseRoute(principal, routeSegments) {
  if (routeSegments[0] === "publish") {
    return { page: "publish" };
  }
  if (routeSegments[0] === "instances" && routeSegments[1]) {
    const instanceId = Number(routeSegments[1]);
    if (Number.isSafeInteger(instanceId) && instanceId > 0) {
      return {
        page: "workspace",
        instanceId,
        workspaceView: routeSegments[2] === "records" ? "records" : "import",
      };
    }
  }
  return {
    page: principal.kind === "admin" && ADMINISTRATOR_PAGES.has(routeSegments[0]) ? routeSegments[0] : "instances",
  };
}

function navigateTo(routePath) {
  const nextHash = `#/${routePath}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
}

function clearRoute() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function createNavigation(principal, instances) {
  const isAdministrator = principal.kind === "admin";
  return [
    {
      label: "控制台",
      items: [
        { key: "publish", label: "新建渠道", icon: Rocket },
        { key: "instances", label: isAdministrator ? "实例管理" : "我的实例", icon: Server, meta: instances.length },
        ...(isAdministrator ? [
          { key: "users", label: "用户管理", icon: Users },
          { key: "records", label: "Key 记录", icon: KeyRound },
        ] : []),
      ],
    },
    ...(instances.length > 0 ? [{
      label: "实例",
      items: instances.map((instance) => ({
        key: `instance:${instance.id}`,
        label: instance.name,
        initial: instance.name.slice(0, 1).toUpperCase(),
        dotTone: instance.enabled ? "is-enabled" : "is-disabled",
      })),
    }] : []),
    ...(isAdministrator ? [{
      label: "个人",
      items: [{ key: "security", label: "账号安全", icon: ShieldCheck }],
    }] : []),
  ];
}

export default function ApplicationClient() {
  const [sessionState, setSessionState] = useState({
    status: "loading",
    principal: null,
  });
  const [routeSegments, setRouteSegments] = useState([]);
  const [instances, setInstances] = useState([]);
  const [isLoadingInstances, setIsLoadingInstances] = useState(false);

  const isAdministrator = sessionState.principal?.kind === "admin";

  const loadInstances = useCallback(async (signal) => {
    setIsLoadingInstances(true);
    try {
      const responsePayload = await requestJson(isAdministrator ? "/api/admin/instances" : "/api/instances", { signal });
      if (!signal?.aborted) setInstances(responsePayload.data.instances);
    } catch (error) {
      if (!signal?.aborted) showToast(error?.message || "读取实例列表失败", { type: "error" });
    } finally {
      if (!signal?.aborted) setIsLoadingInstances(false);
    }
  }, [isAdministrator]);

  useEffect(() => {
    let isActive = true;
    function handleSessionExpired() {
      clearRoute();
      setSessionState({ status: "anonymous", principal: null });
      showToast("登录状态已失效，请重新验证", { type: "error" });
    }
    function handleHashChange() {
      setRouteSegments(readRouteSegments());
    }
    setRouteSegments(readRouteSegments());
    window.addEventListener("application-session-expired", handleSessionExpired);
    window.addEventListener("hashchange", handleHashChange);
    requestJson("/api/auth/me", { suppressSessionExpiredEvent: true })
      .then((responsePayload) => {
        if (isActive) {
          setSessionState({
            status: "authenticated",
            principal: responsePayload.data.principal,
          });
        }
      })
      .catch(() => {
        if (isActive) {
          setSessionState({ status: "anonymous", principal: null });
        }
      });
    return () => {
      isActive = false;
      window.removeEventListener("application-session-expired", handleSessionExpired);
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    if (sessionState.status !== "authenticated") {
      setInstances([]);
      setIsLoadingInstances(false);
      return;
    }
    const controller = new AbortController();
    loadInstances(controller.signal);
    return () => controller.abort();
  }, [sessionState.status, loadInstances]);

  function handleAuthenticated(principal) {
    clearRoute();
    setRouteSegments([]);
    setSessionState({ status: "authenticated", principal });
    showToast(
      "登录成功",
      { type: "success" },
    );
  }

  async function handleLogout() {
    try {
      await requestJson("/api/auth/logout", {
        method: "POST",
        body: "{}",
      });
      showToast("已退出登录", { type: "success" });
    } catch (error) {
      showToast(error?.message || "服务端退出登录失败", { type: "error" });
    } finally {
      clearRoute();
      setRouteSegments([]);
      setSessionState({ status: "anonymous", principal: null });
    }
  }

  if (sessionState.status === "loading") {
    return (
      <main className="fullscreen-loading">
        <Spinner size={22} />
        <p>正在读取登录状态...</p>
      </main>
    );
  }

  if (sessionState.status !== "authenticated") {
    return <AccessGateway onAuthenticated={handleAuthenticated} />;
  }

  const currentPrincipal = sessionState.principal;
  const route = parseRoute(currentPrincipal, routeSegments);
  const openInstance = (instanceId) => navigateTo(`instances/${instanceId}`);

  function handleNavigate(navigationKey) {
    if (navigationKey.startsWith("instance:")) {
      openInstance(navigationKey.slice("instance:".length));
      return;
    }
    navigateTo(navigationKey);
  }

  function changeWorkspaceView(workspaceView) {
    navigateTo(`instances/${route.instanceId}/${workspaceView}`);
  }

  const activeNavigationKey = route.page === "workspace" ? `instance:${route.instanceId}` : route.page;
  const shellUser = { name: currentPrincipal.username, initial: currentPrincipal.username.slice(0, 1).toUpperCase() };

  let pageContent;
  if (route.page === "workspace") {
    pageContent = (
      <InstanceWorkspace
        key={route.instanceId}
        instanceId={route.instanceId}
        view={route.workspaceView}
        onViewChange={changeWorkspaceView}
        onBack={() => navigateTo("instances")}
      />
    );
  } else if (route.page === "records") {
    pageContent = <AdminRecordsOverview instances={instances} onOpenInstance={openInstance} />;
  } else if (route.page === "publish") {
    pageContent = <ChannelPublisher instances={instances} isLoadingInstances={isLoadingInstances} />;
  } else if (route.page === "users") {
    pageContent = <AdminUsers />;
  } else if (route.page === "security") {
    pageContent = <AccountSecurity username={currentPrincipal.username} />;
  } else if (isAdministrator) {
    pageContent = (
      <AdminInstances
        instances={instances}
        isLoading={isLoadingInstances}
        onReload={() => loadInstances()}
        onOpenInstance={openInstance}
      />
    );
  } else {
    pageContent = (
      <section>
        <h1>我的实例</h1>
        {isLoadingInstances ? <Spinner /> : instances.length === 0 ? (
          <EmptyState icon={Server} title="暂无可访问的实例" description="请联系管理员分配实例。" />
        ) : (
          <div className="member-list">
            {instances.map((instance) => (
              <article className="member-card member-card-head" key={instance.id}>
                <strong>{instance.name}</strong>
                <button className="btn btn-outline" type="button" onClick={() => openInstance(instance.id)}>进入实例</button>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <AppShell
      brandTag={currentPrincipal.kind === "admin" ? "管理端" : "工作区"}
      user={shellUser}
      navigation={createNavigation(currentPrincipal, instances)}
      activeKey={activeNavigationKey}
      onNavigate={handleNavigate}
      onLogout={handleLogout}
    >
      {pageContent}
    </AppShell>
  );
}
