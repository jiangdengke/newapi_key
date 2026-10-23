"use client";

import { useCallback, useEffect, useState } from "react";
import { FileInput, History, KeyRound, Server, ShieldCheck } from "lucide-react";

import { requestJson } from "../lib/client-api.js";
import { showToast } from "../lib/toast.js";
import AccessGateway from "./access-gateway.js";
import AccountSecurity from "./account-security.js";
import AdminInstances from "./admin-instances.js";
import AdminRecordsOverview from "./admin-records-overview.js";
import AppShell from "./app-shell.js";
import InstanceWorkspace from "./instance-workspace.js";
import { Spinner } from "./ui.js";

const ADMINISTRATOR_PAGES = new Set(["instances", "records", "security"]);

function readRouteSegments() {
  return window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

function parseRoute(principal, routeSegments) {
  if (principal.kind === "visitor") {
    return {
      page: "workspace",
      instanceId: principal.instanceId,
      workspaceView: routeSegments[0] === "records" ? "records" : "import",
    };
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
    page: ADMINISTRATOR_PAGES.has(routeSegments[0]) ? routeSegments[0] : "instances",
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
  if (principal.kind === "visitor") {
    return [{
      label: "工作区",
      items: [
        { key: "import", label: "渠道导入", icon: FileInput },
        { key: "records", label: "导入记录", icon: History },
      ],
    }];
  }
  return [
    {
      label: "控制台",
      items: [
        { key: "instances", label: "实例管理", icon: Server, meta: instances.length },
        { key: "records", label: "Key 记录", icon: KeyRound },
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
    {
      label: "个人",
      items: [{ key: "security", label: "账号安全", icon: ShieldCheck }],
    },
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

  const loadInstances = useCallback(async () => {
    setIsLoadingInstances(true);
    try {
      const responsePayload = await requestJson("/api/admin/instances");
      setInstances(responsePayload.data.instances);
    } catch (error) {
      showToast(error?.message || "读取实例列表失败", { type: "error" });
    } finally {
      setIsLoadingInstances(false);
    }
  }, []);

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
    if (isAdministrator) {
      loadInstances();
    } else {
      setInstances([]);
    }
  }, [isAdministrator, loadInstances]);

  function handleAuthenticated(principal) {
    clearRoute();
    setRouteSegments([]);
    setSessionState({ status: "authenticated", principal });
    showToast(
      principal.kind === "admin" ? "管理员登录成功" : "实例访问验证成功",
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
    if (currentPrincipal.kind === "visitor") {
      navigateTo(navigationKey);
      return;
    }
    if (navigationKey.startsWith("instance:")) {
      openInstance(navigationKey.slice("instance:".length));
      return;
    }
    navigateTo(navigationKey);
  }

  function changeWorkspaceView(workspaceView) {
    if (currentPrincipal.kind === "visitor") {
      navigateTo(workspaceView);
      return;
    }
    navigateTo(`instances/${route.instanceId}/${workspaceView}`);
  }

  const activeNavigationKey = currentPrincipal.kind === "visitor"
    ? route.workspaceView
    : route.page === "workspace" ? `instance:${route.instanceId}` : route.page;
  const shellUser = currentPrincipal.kind === "admin"
    ? { name: currentPrincipal.username, initial: currentPrincipal.username.slice(0, 1).toUpperCase() }
    : {
      name: currentPrincipal.memberName
        ? `${currentPrincipal.memberName} · ${currentPrincipal.instanceName}`
        : currentPrincipal.instanceName,
      initial: (currentPrincipal.memberName || currentPrincipal.instanceName).slice(0, 1).toUpperCase(),
    };

  let pageContent;
  if (route.page === "workspace") {
    pageContent = (
      <InstanceWorkspace
        key={route.instanceId}
        instanceId={route.instanceId}
        view={route.workspaceView}
        onViewChange={changeWorkspaceView}
        isAdministrator={currentPrincipal.kind === "admin"}
        onBack={() => navigateTo("instances")}
      />
    );
  } else if (route.page === "records") {
    pageContent = <AdminRecordsOverview instances={instances} onOpenInstance={openInstance} />;
  } else if (route.page === "security") {
    pageContent = <AccountSecurity username={currentPrincipal.username} />;
  } else {
    pageContent = (
      <AdminInstances
        instances={instances}
        isLoading={isLoadingInstances}
        onReload={loadInstances}
        onOpenInstance={openInstance}
      />
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
