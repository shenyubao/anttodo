import * as Dialog from "@radix-ui/react-dialog";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Archive,
  Building2,
  Camera,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Circle,
  Cloud,
  CloudOff,
  Ellipsis,
  FolderClosed,
  FolderOpen,
  Flag,
  GripVertical,
  Inbox,
  Info,
  KeyRound,
  Keyboard,
  LayoutList,
  ListTodo,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Tag,
  Trash2,
  UserRound,
  Users,
  Workflow,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isSameDay } from "date-fns";
import clsx from "clsx";
import antTodoIconUrl from "./assets/anttodo-icon.png";
import { CalendarSidebar, CalendarWorkspace } from "./CalendarWorkspace";
import { initials, MemberAvatar } from "./MemberAvatar";
import { MindMapWorkspace } from "./MindMapWorkspace";
import { NotificationBell } from "./NotificationBell";
import { getPriorityOption } from "./PriorityControl";
import { TaskDetailDialog, TaskDetailPanel } from "./TaskDetail";
import type { CreateCommentInput } from "./TaskComments";
import {
  assignTask as assignTaskApi,
  createTaskComment as createTaskCommentApi,
  createLabelWithAccess as createLabelWithAccessApi,
  createTask,
  createTaskSection,
  createWorkspace,
  deleteWorkspace as deleteWorkspaceApi,
  isWorkspaceSlugAvailable,
  deleteTaskSection,
  deleteTaskComment as deleteTaskCommentApi,
  loadDateTimePreferences,
  listTaskAssigneeIds,
  listTaskCommentCandidateIds,
  loadNotifications,
  loadTaskActivity,
  loadTaskComments,
  loadUserQuota,
  loadWorkspaceBundle,
  loadWorkspaces,
  markAllNotificationsRead,
  markNotificationRead,
  saveDateTimePreferences,
  saveTaskSchedule as saveTaskScheduleApi,
  saveTaskListPreference,
  setTaskListOrder,
  toggleTaskLabel as toggleTaskLabelApi,
  updateTaskSection,
  updateTaskComment as updateTaskCommentApi,
  updateLabelWithAccess as updateLabelWithAccessApi,
  updateWorkspace,
} from "./lib/api";
import {
  createDemoAttachmentService,
  createSupabaseAttachmentService,
  type AttachmentService,
} from "./lib/attachments";
import { createDemoBundle, demoWorkspaces } from "./lib/demo";
import { getDueStatus } from "./lib/dueTime";
import { reminderTriggerAt } from "./lib/reminders";
import {
  AVATAR_ACCEPT,
  cropAvatarFile,
  updateAvatar,
  updateDisplayName,
} from "./lib/profile";
import { ensureWebPushSubscription } from "./lib/webPush";
import { searchTasks } from "./lib/taskSearch";
import {
  TASK_GROUPING_OPTIONS,
  TASK_SORT_OPTIONS,
  defaultSortDirection,
  groupTasks,
  isActiveTask,
  isCompletedTask,
  resolveTaskListPreference,
  sortTasks,
  taskListKey,
} from "./lib/taskList";
import {
  DATE_FORMAT_OPTIONS,
  DEFAULT_DATE_TIME_PREFERENCES,
  TIME_FORMAT_OPTIONS,
  WEEK_START_OPTIONS,
} from "./lib/dateTimePreferences";
import {
  buildWorkspaceTeamLoginUrl,
  resolveAppLocation,
} from "./lib/appHost";
import {
  normalizeWorkspaceSlug,
  suggestWorkspaceSlug,
  workspaceSlugValidationMessage,
} from "./lib/workspaceSlug";
import {
  isValidSmsOtp,
  maskPhone,
  normalizeMainlandPhone,
  phoneAuthErrorMessage,
} from "./lib/auth";
import {
  DEFAULT_LABEL_COLOR,
  hasExplicitLabelColor,
  LABEL_COLORS,
  newLabelAccessDefaults,
} from "./lib/labels";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { getAssignableMembers } from "./lib/taskAssignment";
import {
  currentLabelPermissionLevel,
  currentTaskPermissionLevel,
} from "./lib/permissions";
import {
  buildWorkspaceInviteUrl,
  workspaceInviteIdFromPath,
  workspaceInviteRoleLabel,
} from "./lib/workspaceInvites";
import {
  buildDingtalkCallbackUrl,
  dingtalkExchangeOnce,
  dingtalkDesktopCallbackUrl,
  dingtalkFrameLoginParams,
  dingtalkLoginErrorAction,
  dingtalkLoginErrorMessage,
  dingtalkOAuthAuthorizeUrl,
  dingtalkTokenHashOtpParams,
  edgeFunctionErrorMessage,
  isDingtalkCallbackPath,
  isDingtalkClientId,
  loadDingtalkLoginSdk,
  initialWorkspaceSsoProvider,
  parseWorkspaceSsoLoginConfig,
  type WorkspaceSsoLoginConfig,
  type WorkspaceSsoLoginProvider,
  type WorkspaceSsoProvider,
} from "./lib/sso";
import type {
  AppNotification,
  DateTimePreferences,
  Label,
  LabelAccessDraft,
  LabelAccessScope,
  Member,
  ReminderSchedule,
  Subtask,
  Task,
  TaskActivityEvent,
  TaskActivityPage,
  TaskComment,
  TaskKind,
  TaskListGrouping,
  TaskListPreference,
  TaskListSort,
  TaskSection,
  TaskPriority,
  UserQuota,
  UserGroup,
  Workspace,
  WorkspaceBundle,
  WorkspaceInviteLink,
  WorkspaceInvitePreview,
  WorkspaceInviteRole,
  WorkspaceRole,
} from "./types";

type SmartView = "all" | "today" | "assigned" | "inbox";
type AppSection = "tasks" | "calendar" | "mindmap";
type SettingsTab =
  | "account"
  | "date"
  | "team-mgmt"
  | "team"
  | "user-groups"
  | "sso"
  | "shortcuts"
  | "about";

const SIDEBAR_MIN_WIDTH = 213;
const SIDEBAR_MAX_WIDTH = 450;
const CALENDAR_SIDEBAR_DEFAULT_WIDTH = 242;
const CALENDAR_SIDEBAR_COLLAPSED_KEY = "anttodo:calendar-sidebar-collapsed";
const DETAIL_MIN_WIDTH = 320;
const DETAIL_MAX_WIDTH = 440;

const ROOT_LABEL_DROP_TARGET = "__root__";

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function useMinuteNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      setNow(new Date());
      interval = window.setInterval(() => setNow(new Date()), 60_000);
    }, 60_050 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, []);
  return now;
}

export default function App() {
  const demoMode = new URLSearchParams(window.location.search).get("demo") === "1";
  const pathname = window.location.pathname;
  const inviteId = workspaceInviteIdFromPath(pathname);
  const dingtalkCallback = isDingtalkCallbackPath(pathname);
  const appHost = resolveAppLocation(pathname);
  const teamSlug = appHost.kind === "team" ? appHost.slug : null;
  const loginSurface = teamSlug ? "team-sso" : "phone";
  const [session, setSession] = useState<Awaited<
    ReturnType<NonNullable<typeof supabase>["auth"]["getSession"]>
  >["data"]["session"]>(null);
  const [authReady, setAuthReady] = useState(demoMode);
  const [desktopAuthStatus, setDesktopAuthStatus] = useState<
    | null
    | { state: "processing" }
    | { state: "error"; message: string }
  >(null);
  const desktopAuthProcessing = useRef(false);
  const processedDesktopCodes = useRef(new Set<string>());

  useEffect(() => {
    if (!supabase || demoMode) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => subscription.unsubscribe();
  }, [demoMode]);

  useEffect(() => {
    const desktopAuth = window.anttodoDesktop?.auth;
    if (!desktopAuth || !supabase || demoMode) return;
    const desktopAuthBridge = desktopAuth;
    const authClient = supabase;
    let cancelled = false;

    async function consumePendingCallback() {
      if (desktopAuthProcessing.current) return;
      desktopAuthProcessing.current = true;
      try {
        let code = await desktopAuthBridge.takePendingCallback();
        while (!cancelled && code) {
          if (processedDesktopCodes.current.has(code)) {
            code = await desktopAuthBridge.takePendingCallback();
            continue;
          }
          processedDesktopCodes.current.add(code);
          setDesktopAuthStatus({ state: "processing" });
          const { data, error } = await authClient.functions.invoke("dingtalk-sso", {
            body: { action: "consume-handoff", code },
          });
          if (cancelled) return;
          if (error || !data?.workspaceId || !data?.tokenHash) {
            setDesktopAuthStatus({
              state: "error",
              message: await edgeFunctionErrorMessage(
                error,
                data,
                "无法完成钉钉客户端登录，请重新扫码。",
              ),
            });
            return;
          }
          const { error: verifyError } = await authClient.auth.verifyOtp(
            dingtalkTokenHashOtpParams(String(data.tokenHash)),
          );
          if (cancelled) return;
          if (verifyError) {
            setDesktopAuthStatus({
              state: "error",
              message: verifyError.message || "无法建立登录会话。",
            });
            return;
          }
          window.sessionStorage.setItem(
            "anttodo:pending-workspace",
            String(data.workspaceId),
          );
          setDesktopAuthStatus(null);
          code = await desktopAuthBridge.takePendingCallback();
        }
      } finally {
        desktopAuthProcessing.current = false;
      }
    }

    const unsubscribe = desktopAuthBridge.onCallbackAvailable(() => {
      void consumePendingCallback();
    });
    void consumePendingCallback();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [demoMode]);

  if (demoMode) return <DemoApplication />;
  if (!hasSupabaseConfig || !supabase) return <MissingConfig />;
  if (!authReady) return <Splash label="正在恢复工作区…" />;
  if (desktopAuthStatus?.state === "processing") {
    return <Splash label="正在完成钉钉登录…" />;
  }
  if (desktopAuthStatus?.state === "error") {
    return (
      <DesktopAuthErrorScreen
        message={desktopAuthStatus.message}
        onDismiss={() => setDesktopAuthStatus(null)}
      />
    );
  }
  if (dingtalkCallback) return <DingtalkCallbackScreen />;
  if (inviteId) {
    return (
      <WorkspaceInviteScreen
        inviteId={inviteId}
        userId={session?.user.id ?? null}
      />
    );
  }
  if (!session) {
    return (
      <AuthScreen
        loginSurface={loginSurface}
        teamSlug={teamSlug}
        showModeTabs={!teamSlug}
      />
    );
  }
  return (
    <RemoteApplication
      userId={session.user.id}
      email={session.user.email ?? ""}
      phone={session.user.phone ?? ""}
      preferredTeamSlug={teamSlug}
    />
  );
}

function DesktopAuthErrorScreen({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <div><h1>蚂蚁清单</h1></div>
        </div>
        <div className="dingtalk-login" role="alert">
          <strong>钉钉登录失败</strong>
          <p>{message}</p>
          <button type="button" className="button secondary full" onClick={onDismiss}>
            返回登录
          </button>
        </div>
      </section>
    </main>
  );
}

function WorkspaceInviteScreen({
  inviteId,
  userId,
}: {
  inviteId: string;
  userId: string | null;
}) {
  const [showAuth, setShowAuth] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");
  const previewQuery = useQuery({
    queryKey: ["workspace-invite-preview", inviteId],
    queryFn: async () => {
      const { data, error } = await supabase!.functions.invoke(
        "workspace-invite-preview",
        { body: { linkId: inviteId } },
      );
      if (error) throw error;
      return data as WorkspaceInvitePreview;
    },
    retry: false,
  });

  if (!userId && showAuth) return <AuthScreen loginSurface="phone" />;

  async function acceptInvite() {
    if (!userId) {
      setShowAuth(true);
      return;
    }
    setAccepting(true);
    setAcceptError("");
    const { data, error } = await supabase!.functions.invoke("workspace-invite", {
      body: { action: "accept", linkId: inviteId },
    });
    if (error || !data?.workspaceId) {
      setAcceptError("暂时无法加入团队空间，请确认邀请链接仍然有效。");
      setAccepting(false);
      return;
    }
    window.sessionStorage.setItem("anttodo:pending-workspace", data.workspaceId);
    window.location.assign("/");
  }

  const preview = previewQuery.data;
  const unavailable = previewQuery.isError || preview?.status === "revoked";

  return (
    <main className="invite-screen">
      <section className="invite-card">
        <div className="invite-brand">
          <BrandMark />
          <span>AntTodo</span>
        </div>
        {previewQuery.isLoading ? (
          <div className="invite-loading">正在读取邀请…</div>
        ) : unavailable || !preview ? (
          <div className="invite-state">
            <Link2 aria-hidden="true" />
            <h1>邀请链接已失效</h1>
            <p>该链接可能已被关闭，请联系团队管理员获取新的邀请。</p>
            <a className="button secondary full" href="/">返回 AntTodo</a>
          </div>
        ) : (
          <>
            <div className="invite-people">
              <span className="invite-avatar">{initials(preview.inviterDisplayName)}</span>
              <p><strong>{preview.inviterDisplayName}</strong> 邀请你加入</p>
            </div>
            <div className="invite-workspace">
              <Users aria-hidden="true" />
              <div>
                <h1>{preview.workspaceName}</h1>
                <span>加入身份：{workspaceInviteRoleLabel(preview.role)}</span>
              </div>
            </div>
            {preview.role === "admin" && (
              <p className="invite-admin-warning">
                管理员可以管理团队成员、标签权限和连接器。
              </p>
            )}
            {acceptError && <p className="form-error" role="alert">{acceptError}</p>}
            <button
              type="button"
              className="button primary full invite-accept"
              disabled={accepting}
              onClick={() => void acceptInvite()}
            >
              {accepting ? "正在加入…" : userId ? "确认加入" : "登录后加入"}
            </button>
            <p className="invite-confirmation">加入前由你确认，不会自动接受邀请。</p>
          </>
        )}
      </section>
    </main>
  );
}

function Splash({ label }: { label: string }) {
  return (
    <main className="splash-screen">
      <BrandMark />
      <p>{label}</p>
    </main>
  );
}

function BrandMark() {
  return (
    <img
      className="brand-mark"
      src={antTodoIconUrl}
      alt=""
      aria-hidden="true"
    />
  );
}

function MissingConfig() {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <div>
            <h1>AntTodo</h1>
            <p>团队任务，清晰推进</p>
          </div>
        </div>
        <div className="empty-state compact">
          <CloudOff size={30} />
          <h2>缺少 Supabase 配置</h2>
          <p>复制 .env.example 为 .env.local，并填写项目 URL 与 publishable key。</p>
        </div>
        <a className="button secondary full" href="?demo=1">
          先查看产品演示
        </a>
      </section>
    </main>
  );
}

function DingtalkCallbackScreen() {
  const [error, setError] = useState("");
  const [desktopDeepLink, setDesktopDeepLink] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function complete() {
      const client = supabase;
      if (!client) return;
      const params = new URLSearchParams(window.location.search);
      const authCode = params.get("authCode") || params.get("code");
      const state = params.get("state");
      const workspaceId = state?.split(".")[0] ?? "";
      if (!authCode || !state || !workspaceId) {
        setError("钉钉回调参数不完整，请重新扫码登录。");
        return;
      }
      const exchange = await dingtalkExchangeOnce(authCode, async () => {
        const { data, error: exchangeError } = await client.functions.invoke(
          "dingtalk-sso",
          {
            body: {
              action: "exchange",
              workspaceId,
              authCode,
              state,
            },
          },
        );
        if (
          exchangeError ||
          (data?.mode === "desktop" ? !data?.handoffCode : !data?.tokenHash)
        ) {
          return {
            ok: false as const,
            error: await edgeFunctionErrorMessage(
              exchangeError,
              data,
              "钉钉登录失败，请重试。",
            ),
          };
        }
        if (data.mode === "desktop") {
          return {
            ok: true as const,
            mode: "desktop" as const,
            workspaceId: String(data.workspaceId || workspaceId),
            handoffCode: String(data.handoffCode),
          };
        }
        return {
          ok: true as const,
          mode: "web" as const,
          workspaceId: String(data.workspaceId || workspaceId),
          tokenHash: String(data.tokenHash),
        };
      });
      if (cancelled) return;
      if (!exchange.ok) {
        setError(exchange.error);
        return;
      }
      if (exchange.mode === "desktop") {
        const deepLink = dingtalkDesktopCallbackUrl(exchange.handoffCode);
        if (!deepLink) {
          setError("客户端登录交接码无效，请重新扫码登录。");
          return;
        }
        setDesktopDeepLink(deepLink);
        window.location.assign(deepLink);
        return;
      }
      const { error: verifyError } = await client.auth.verifyOtp(
        dingtalkTokenHashOtpParams(exchange.tokenHash),
      );
      if (cancelled) return;
      if (verifyError) {
        setError(verifyError.message || "无法建立登录会话。");
        return;
      }
      window.sessionStorage.setItem(
        "anttodo:pending-workspace",
        exchange.workspaceId,
      );
      window.location.replace("/");
    }
    void complete();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <div>
            <h1>蚂蚁清单</h1>
          </div>
        </div>
        {error ? (
          <div className="dingtalk-login" role="alert">
            <strong>钉钉登录失败</strong>
            <p>{error}</p>
            <a className="button secondary full" href="/">
              返回登录
            </a>
          </div>
        ) : desktopDeepLink ? (
          <div className="dingtalk-login">
            <strong>授权已完成</strong>
            <p>AntTodo 应已自动打开。若没有反应，请点击下方按钮返回客户端。</p>
            <a className="button primary full" href={desktopDeepLink}>
              打开 AntTodo
            </a>
          </div>
        ) : (
          <div className="dingtalk-login">
            <strong>正在完成钉钉登录…</strong>
            <p>请稍候，正在验证授权并进入团队空间。</p>
          </div>
        )}
      </section>
    </main>
  );
}

type SsoProviderRendererProps = {
  provider: WorkspaceSsoLoginProvider;
  workspaceName: string;
  error: string;
  canChangeProvider: boolean;
  onRedirect: () => void;
  onChangeProvider: () => void;
};

const SSO_PROVIDER_RENDERERS: Record<
  WorkspaceSsoLoginProvider["provider"],
  (props: SsoProviderRendererProps) => ReactNode
> = {
  dingtalk: ({
    workspaceName,
    error,
    canChangeProvider,
    onRedirect,
    onChangeProvider,
  }) => (
    <>
      <div
        id="dingtalk_login_container"
        className="dingtalk-qr-frame"
        aria-label="钉钉登录二维码"
      />
      <strong>使用钉钉扫码登录</strong>
      <p>
        正在登录「{workspaceName}」。请打开钉钉扫描二维码，或改用跳转授权。
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button
        type="button"
        className="button secondary full"
        onClick={onRedirect}
      >
        <RefreshCw aria-hidden="true" />
        跳转到钉钉授权
      </button>
      {canChangeProvider && (
        <button
          type="button"
          className="auth-text-button"
          onClick={onChangeProvider}
        >
          更换登录方式
        </button>
      )}
    </>
  ),
};

function AuthScreen({
  loginSurface = "phone",
  teamSlug = null,
  showModeTabs = false,
}: {
  loginSurface?: "phone" | "team-sso";
  teamSlug?: string | null;
  showModeTabs?: boolean;
}) {
  const teamEntry = loginSurface === "team-sso";
  const [desktopTeamEntry, setDesktopTeamEntry] = useState(false);
  const ssoEntry = teamEntry || desktopTeamEntry;
  const [activeMode, setActiveMode] = useState<"account" | "enterprise">("account");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [sentPhone, setSentPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [phoneError, setPhoneError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [enterpriseSlug, setEnterpriseSlug] = useState("");
  const [enterpriseError, setEnterpriseError] = useState("");
  const [ssoLogin, setSsoLogin] = useState<WorkspaceSsoLoginConfig | null>(null);
  const [selectedProvider, setSelectedProvider] =
    useState<WorkspaceSsoLoginProvider | null>(null);
  const [ssoError, setSsoError] = useState("");
  const [ssoLoading, setSsoLoading] = useState(teamEntry);
  const dingtalkConfig = selectedProvider?.provider === "dingtalk"
    ? selectedProvider.config
    : null;
  const providerRenderer = selectedProvider
    ? SSO_PROVIDER_RENDERERS[selectedProvider.provider]
    : null;

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = window.setInterval(
      () => setCountdown((current) => Math.max(0, current - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [countdown]);

  async function loadSsoConfig(slug: string) {
    if (!supabase) return;
    setSsoLoading(true);
    setSsoError("");
    setSsoLogin(null);
    setSelectedProvider(null);
    const { data, error: configError } = await supabase.functions.invoke(
      "sso-login",
      {
        body: {
          slug,
          client: window.anttodoDesktop ? "desktop" : "web",
        },
      },
    );
    setSsoLoading(false);
    const loginConfig = parseWorkspaceSsoLoginConfig(data);
    if (configError || !loginConfig || loginConfig.providers.length === 0) {
      setSsoError(
        await edgeFunctionErrorMessage(
          configError,
          data,
          "未找到可用的企业联合登录配置，请确认企业地址或联系管理员。",
        ),
      );
      return;
    }
    setSsoLogin(loginConfig);
    setSelectedProvider(initialWorkspaceSsoProvider(loginConfig.providers));
    window.sessionStorage.setItem(
      "anttodo:pending-workspace",
      loginConfig.workspace.id,
    );
  }

  useEffect(() => {
    if (teamEntry && teamSlug) void loadSsoConfig(teamSlug);
  }, [teamEntry, teamSlug]);

  useEffect(() => {
    if (!ssoEntry || !dingtalkConfig?.state || !dingtalkConfig.redirectUri) return;
    const activeConfig = dingtalkConfig;
    let cancelled = false;
    let attempt = 0;
    let retryTimer = 0;
    const maxAttempts = 3;

    async function mountQr() {
      attempt += 1;
      try {
        await loadDingtalkLoginSdk();
        if (cancelled || !activeConfig.state) return;
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
        if (cancelled) return;
        const container = document.getElementById("dingtalk_login_container");
        if (!container) {
          if (!cancelled) setSsoError("钉钉二维码容器未就绪，请刷新页面重试。");
          return;
        }
        if (!window.DTFrameLogin) {
          if (!cancelled) setSsoError("钉钉登录组件未就绪，请改用跳转登录。");
          return;
        }
        setSsoError("");
        container.innerHTML = "";
        window.DTFrameLogin(
          {
            id: "dingtalk_login_container",
            width: 300,
            height: 300,
          },
          dingtalkFrameLoginParams({
            redirectUri: activeConfig.redirectUri,
            clientId: activeConfig.appKey,
            state: activeConfig.state,
            corpId: activeConfig.corpId,
          }),
          (result) => {
            if (cancelled) return;
            if (result?.redirectUrl) {
              if (window.anttodoDesktop) {
                void openDingtalkUrl(result.redirectUrl);
              } else {
                window.location.assign(result.redirectUrl);
              }
            }
          },
          (errorMsg) => {
            if (cancelled) return;
            // The official SDK can emit an empty postMessage error after the QR
            // iframe has mounted successfully. Retrying here clears a valid QR
            // and eventually turns the spurious callback into a fatal error.
            const errorAction = dingtalkLoginErrorAction(
              errorMsg,
              attempt,
              maxAttempts,
            );
            if (errorAction === "ignore") return;
            if (errorAction === "retry") {
              retryTimer = window.setTimeout(() => {
                if (!cancelled) void mountQr();
              }, 700 * attempt);
              return;
            }
            container.innerHTML = "";
            setSsoError(dingtalkLoginErrorMessage(errorMsg));
          },
        );
      } catch {
        if (cancelled) return;
        if (attempt < maxAttempts) {
          retryTimer = window.setTimeout(() => {
            if (!cancelled) void mountQr();
          }, 700 * attempt);
          return;
        }
        setSsoError("钉钉登录组件加载失败，请改用跳转登录。");
      }
    }

    void mountQr();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [ssoEntry, dingtalkConfig]);

  async function sendCode() {
    if (!supabase) return;
    const normalizedPhone = normalizeMainlandPhone(phone);
    if (!normalizedPhone) {
      setPhoneError("请输入正确的 11 位中国大陆手机号。");
      return;
    }
    setBusy(true);
    setPhoneError("");
    setMessage("");
    const { error: sendError } = await supabase.auth.signInWithOtp({
      phone: normalizedPhone,
      options: {
        data: { display_name: maskPhone(normalizedPhone) },
        shouldCreateUser: true,
      },
    });
    if (sendError) {
      setPhoneError(phoneAuthErrorMessage(sendError.message, "send"));
    } else {
      setSentPhone(normalizedPhone);
      setStep("otp");
      setCountdown(60);
      setMessage(`验证码已发送至 ${maskPhone(normalizedPhone)}`);
    }
    setBusy(false);
  }

  async function verifyCode() {
    if (!supabase || !sentPhone) return;
    if (!isValidSmsOtp(otp)) {
      setPhoneError("请输入 6 位数字验证码。");
      return;
    }
    setBusy(true);
    setPhoneError("");
    setMessage("");
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: sentPhone,
      token: otp,
      type: "sms",
    });
    if (verifyError) {
      setPhoneError(phoneAuthErrorMessage(verifyError.message, "verify"));
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step === "phone") await sendCode();
    else await verifyCode();
  }

  function editPhone() {
    setStep("phone");
    setOtp("");
    setPhoneError("");
    setMessage("");
  }

  async function openDingtalkUrl(url: string) {
    if (!window.anttodoDesktop) {
      window.location.assign(url);
      return;
    }
    const opened = await window.anttodoDesktop.auth.openDingtalkUrl(url);
    if (!opened) setSsoError("无法在系统浏览器打开钉钉授权，请稍后重试。");
  }

  function openRedirectLogin() {
    if (!dingtalkConfig?.state || !dingtalkConfig.redirectUri) return;
    void openDingtalkUrl(
      dingtalkOAuthAuthorizeUrl({
        redirectUri: dingtalkConfig.redirectUri,
        clientId: dingtalkConfig.appKey,
        state: dingtalkConfig.state,
        corpId: dingtalkConfig.corpId,
      }),
    );
  }

  function openEnterpriseLogin(event: FormEvent) {
    event.preventDefault();
    const normalizedSlug = normalizeWorkspaceSlug(enterpriseSlug);
    const validationError = workspaceSlugValidationMessage(normalizedSlug);
    if (validationError) {
      setEnterpriseError(validationError);
      return;
    }
    const loginUrl = buildWorkspaceTeamLoginUrl(
      normalizedSlug,
      window.location.protocol === "file:"
        ? import.meta.env.VITE_PUBLIC_APP_URL
        : undefined,
      window.location.origin,
    );
    if (!loginUrl) {
      setEnterpriseError("暂时无法生成企业登录地址，请稍后重试。");
      return;
    }
    setEnterpriseError("");
    if (window.anttodoDesktop) {
      setDesktopTeamEntry(true);
      void loadSsoConfig(normalizedSlug);
    } else {
      window.location.assign(loginUrl);
    }
  }

  function selectAuthMode(mode: "account" | "enterprise", focus = false) {
    setActiveMode(mode);
    if (focus) {
      window.requestAnimationFrame(() => {
        document.getElementById(`auth-tab-${mode}`)?.focus();
      });
    }
  }

  function handleAuthTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home" || event.key === "ArrowLeft") {
      selectAuthMode("account", true);
    } else {
      selectAuthMode("enterprise", true);
    }
  }

  const accountLoginForm = (
    <form className="auth-form" onSubmit={submit} aria-label="手机号验证码登录">
      {step === "phone" ? (
        <label>
          <div className="phone-input-group">
            <button
              type="button"
              className="phone-country"
              disabled
              aria-label="国家或地区区号"
              title="中国大陆 +86"
            >
              <span className="phone-country-flag" aria-hidden="true">🇨🇳</span>
              <span>+86</span>
            </button>
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(event) =>
                setPhone(event.target.value.replace(/\D/g, "").slice(0, 11))
              }
              placeholder="请输入手机号"
              autoComplete="tel-national"
              maxLength={11}
              autoFocus={activeMode === "account"}
              required
            />
          </div>
        </label>
      ) : (
        <>
          <div className="otp-destination">
            <span>验证码已发送至 +86 {maskPhone(sentPhone)}</span>
            <button type="button" onClick={editPhone}>修改号码</button>
          </div>
          <label>
            <span>短信验证码</span>
            <input
              className="otp-input"
              inputMode="numeric"
              value={otp}
              onChange={(event) =>
                setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="请输入 6 位验证码"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              required
            />
          </label>
        </>
      )}
      {phoneError && <p className="form-error" role="alert">{phoneError}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      <button className="button primary full" disabled={busy}>
        {busy ? "请稍候…" : step === "phone" ? "获取验证码" : "登录 AntTodo"}
      </button>
      {step === "otp" && (
        <button
          type="button"
          className="auth-resend"
          disabled={busy || countdown > 0}
          onClick={() => void sendCode()}
        >
          {countdown > 0 ? `${countdown} 秒后可重新发送` : "重新发送验证码"}
        </button>
      )}
    </form>
  );

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <div>
            <h1>蚂蚁清单</h1>
            {ssoEntry && ssoLogin?.workspace.name ? (
              <p>{ssoLogin.workspace.name}</p>
            ) : null}
          </div>
        </div>
        {showModeTabs && !ssoEntry && (
          <div className="auth-tabs" role="tablist" aria-label="登录方式">
            <button
              id="auth-tab-account"
              type="button"
              role="tab"
              aria-selected={activeMode === "account"}
              aria-controls="auth-panel-account"
              tabIndex={activeMode === "account" ? 0 : -1}
              className={activeMode === "account" ? "active" : undefined}
              onClick={() => selectAuthMode("account")}
              onKeyDown={handleAuthTabKeyDown}
            >
              主账户登录
            </button>
            <button
              id="auth-tab-enterprise"
              type="button"
              role="tab"
              aria-selected={activeMode === "enterprise"}
              aria-controls="auth-panel-enterprise"
              tabIndex={activeMode === "enterprise" ? 0 : -1}
              className={activeMode === "enterprise" ? "active" : undefined}
              onClick={() => selectAuthMode("enterprise")}
              onKeyDown={handleAuthTabKeyDown}
            >
              企业联合登录
            </button>
          </div>
        )}
        {!ssoEntry && activeMode === "account" ? (
          <div
            id="auth-panel-account"
            role={showModeTabs ? "tabpanel" : undefined}
            aria-labelledby={showModeTabs ? "auth-tab-account" : undefined}
          >
            {accountLoginForm}
            <div className="auth-divider"><span>或</span></div>
            <a className="button secondary full" href="?demo=1">查看产品演示</a>
          </div>
        ) : !ssoEntry ? (
          <div
            id="auth-panel-enterprise"
            role="tabpanel"
            aria-labelledby="auth-tab-enterprise"
          >
            <form
              className="auth-form enterprise-slug-form"
              onSubmit={openEnterpriseLogin}
              aria-label="企业联合登录"
            >
              <div className="enterprise-login-intro">
                <strong>进入企业登录入口</strong>
                <p>输入企业为你提供的唯一 Slug，确认后将跳转到企业专属登录地址。</p>
              </div>
              <label>
                <span>企业 Slug</span>
                <input
                  value={enterpriseSlug}
                  onChange={(event) => {
                    setEnterpriseSlug(event.target.value);
                    if (enterpriseError) setEnterpriseError("");
                  }}
                  placeholder="例如 yucekj"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  required
                />
              </label>
              {enterpriseError && (
                <p className="form-error" role="alert">{enterpriseError}</p>
              )}
              <button className="button primary full">确认并继续</button>
            </form>
          </div>
        ) : (
          <div className="dingtalk-login" role="region" aria-label="企业联合登录">
            {ssoLoading ? (
              <>
                <strong>正在加载企业登录…</strong>
                <p>正在读取企业的联合登录配置。</p>
              </>
            ) : ssoLogin && ssoLogin.providers.length > 1 && !selectedProvider ? (
              <div className="sso-provider-picker">
                <strong>选择企业登录方式</strong>
                <p>「{ssoLogin.workspace.name}」提供以下联合登录方式。</p>
                <div className="sso-provider-options">
                  {ssoLogin.providers.map((provider) => (
                    <button
                      key={provider.provider}
                      type="button"
                      className="sso-provider-option"
                      onClick={() => setSelectedProvider(provider)}
                    >
                      <span className="connector-settings-mark dingtalk">钉</span>
                      <span>{provider.displayName}</span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ) : providerRenderer && selectedProvider && ssoLogin ? (
              providerRenderer({
                provider: selectedProvider,
                workspaceName: ssoLogin.workspace.name,
                error: ssoError,
                canChangeProvider: ssoLogin.providers.length > 1,
                onRedirect: openRedirectLogin,
                onChangeProvider: () => setSelectedProvider(null),
              })
            ) : (
              <>
                <strong>暂时无法登录</strong>
                <p>该企业尚未启用可用的联合登录，或企业访问地址无效。请联系管理员。</p>
                {ssoError && <p className="form-error" role="alert">{ssoError}</p>}
                <a className="button secondary full" href={import.meta.env.VITE_PUBLIC_APP_URL || "/"}>
                  返回主站登录
                </a>
              </>
            )}
          </div>
        )}
      </section>
      <aside className="auth-preview">
        <div className="preview-orb orb-one" />
        <div className="preview-orb orb-two" />
        <div className="preview-window">
          <div className="preview-sidebar" />
          <div className="preview-content">
            <i /><i /><i /><i />
          </div>
        </div>
        <h2>企业级待办跟进平台</h2>
        <p>让天下没有跟丢的Action</p>
      </aside>
    </main>
  );
}

function RemoteApplication({
  userId,
  email,
  phone,
  preferredTeamSlug = null,
}: {
  userId: string;
  email: string;
  phone: string;
  preferredTeamSlug?: string | null;
}) {
  const client = supabase!;
  const queryClient = useQueryClient();
  const online = useOnline();
  const attachmentService = useMemo(
    () => createSupabaseAttachmentService(client),
    [client],
  );
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [commentsRevision, setCommentsRevision] = useState(0);
  const [activityRevision, setActivityRevision] = useState(0);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces", userId],
    queryFn: () => loadWorkspaces(client),
  });
  const quotaQuery = useQuery({
    queryKey: ["user-quota", userId],
    queryFn: () => loadUserQuota(client, userId),
  });

  useEffect(() => {
    return () => attachmentService.dispose();
  }, [attachmentService]);

  useEffect(() => {
    if (!workspacesQuery.data?.length) return;

    const pendingWorkspaceId = window.sessionStorage.getItem(
      "anttodo:pending-workspace",
    );
    const pendingWorkspace = workspacesQuery.data.find(
      (workspace) => workspace.id === pendingWorkspaceId,
    );
    const slugWorkspace = preferredTeamSlug
      ? workspacesQuery.data.find(
          (workspace) => workspace.slug === preferredTeamSlug,
        )
      : null;
    const preferred =
      slugWorkspace ?? pendingWorkspace ?? workspacesQuery.data[0];

    if (!workspaceId) {
      setWorkspaceId(preferred.id);
      window.sessionStorage.removeItem("anttodo:pending-workspace");
      return;
    }

    if (slugWorkspace && slugWorkspace.id !== workspaceId) {
      setWorkspaceId(slugWorkspace.id);
    }
    if (pendingWorkspaceId) {
      window.sessionStorage.removeItem("anttodo:pending-workspace");
    }
  }, [workspaceId, workspacesQuery.data, preferredTeamSlug]);

  const bundleQuery = useQuery({
    queryKey: ["workspace-bundle", workspaceId],
    queryFn: () => loadWorkspaceBundle(client, workspaceId!),
    enabled: Boolean(workspaceId),
  });
  const dateTimePreferencesQuery = useQuery({
    queryKey: ["date-time-preferences", userId],
    queryFn: () => loadDateTimePreferences(client, userId),
  });
  const notificationsQuery = useQuery({
    queryKey: ["notifications", workspaceId],
    queryFn: () => loadNotifications(client, workspaceId!),
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    if (!workspaceId) return;
    const channel = client
      .channel(`anttodo:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public" },
        (payload) => {
          const table = (payload as { table?: string }).table;
          if (table === "task_comments") {
            setCommentsRevision((value) => value + 1);
            void queryClient.invalidateQueries({ queryKey: ["notifications", workspaceId] });
            return;
          }
          if (table === "task_comment_mentions") {
            setCommentsRevision((value) => value + 1);
            return;
          }
          if (table === "notifications") {
            void queryClient.invalidateQueries({ queryKey: ["notifications", workspaceId] });
            return;
          }
          if (table === "activity_events") {
            setActivityRevision((value) => value + 1);
            return;
          }
          void queryClient.invalidateQueries({ queryKey: ["workspace-bundle", workspaceId] });
        },
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [client, queryClient, workspaceId]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspaces", userId] }),
      queryClient.invalidateQueries({ queryKey: ["user-quota", userId] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-bundle", workspaceId] }),
    ]);

  const workspaceMutation = useMutation({
    mutationFn: (input: { name: string; slug?: string }) =>
      createWorkspace(client, input, userId),
    onSuccess: async (workspace) => {
      await refresh();
      setWorkspaceId(workspace.id);
    },
  });

  if (workspacesQuery.isLoading) return <Splash label="正在读取团队空间…" />;
  if (workspacesQuery.error) {
    return <FatalState title="无法读取团队空间" message={workspacesQuery.error.message} />;
  }
  if (!workspacesQuery.data?.length) {
    return (
      <CreateWorkspaceScreen
        identity={maskPhone(phone) || email.split("@")[0] || "AntTodo 用户"}
        busy={workspaceMutation.isPending}
        onCreate={(name) => workspaceMutation.mutate({ name })}
      />
    );
  }
  if (!workspaceId || bundleQuery.isLoading || dateTimePreferencesQuery.isLoading) {
    return <Splash label="正在整理任务…" />;
  }
  if (bundleQuery.error || !bundleQuery.data) {
    return (
      <FatalState
        title="工作区暂时不可用"
        message={bundleQuery.error?.message ?? "没有可显示的数据"}
      />
    );
  }
  const activeWorkspaceId = workspaceId;
  const activeBundle = bundleQuery.data;

  async function updateTask(taskId: string, patch: Partial<Task>) {
    const payload: Record<string, unknown> = { ...patch };
    delete payload.label_ids;
    delete payload.subtasks;
    delete payload.reminders;
    delete payload.reminder_persistent;
    const { error } = await client.from("tasks").update(payload).eq("id", taskId);
    if (error) throw error;
    await refresh();
  }

  async function saveTaskSchedule(
    taskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) {
    await saveTaskScheduleApi(client, taskId, patch, schedule);
    if (schedule.reminders.length > 0 && !window.anttodoDesktop) {
      try {
        await ensureWebPushSubscription(client);
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : "浏览器通知订阅失败");
      }
    }
    await refresh();
  }

  async function assignTask(taskId: string, assigneeId: string | null) {
    const queryKey = ["workspace-bundle", workspaceId];
    const previous = queryClient.getQueryData<WorkspaceBundle>(queryKey);
    queryClient.setQueryData<WorkspaceBundle>(queryKey, (current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === taskId ? { ...task, assignee_id: assigneeId } : task,
            ),
          }
        : current,
    );

    try {
      await assignTaskApi(client, taskId, assigneeId);
    } catch (error) {
      queryClient.setQueryData(queryKey, previous);
      throw error;
    }
    await queryClient.invalidateQueries({ queryKey });
  }

  async function toggleTaskLabel(
    taskId: string,
    labelId: string,
    selected: boolean,
  ) {
    const queryKey = ["workspace-bundle", workspaceId];
    const previous = queryClient.getQueryData<WorkspaceBundle>(queryKey);
    queryClient.setQueryData<WorkspaceBundle>(queryKey, (current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) => {
              if (task.id !== taskId) return task;
              const labelIds = new Set(task.label_ids);
              if (selected) labelIds.add(labelId);
              else labelIds.delete(labelId);
              return { ...task, label_ids: [...labelIds] };
            }),
          }
        : current,
    );

    try {
      await toggleTaskLabelApi(client, taskId, labelId, selected);
    } catch (error) {
      queryClient.setQueryData(queryKey, previous);
      throw error;
    }
    await queryClient.invalidateQueries({ queryKey });
  }

  async function createLabel(draft: LabelAccessDraft) {
    await createLabelWithAccessApi(client, activeWorkspaceId, draft);
    await refresh();
  }

  async function saveLabelAccess(labelId: string, draft: LabelAccessDraft) {
    await updateLabelWithAccessApi(client, labelId, draft);
    await refresh();
  }

  async function updateLabel(labelId: string, patch: Partial<Label>) {
    const { error } = await client.from("labels").update(patch).eq("id", labelId);
    if (error) throw error;
    await refresh();
  }

  async function deleteLabel(labelId: string) {
    const { error } = await client.from("labels").delete().eq("id", labelId);
    if (error) throw error;
    await refresh();
  }

  async function mergeLabel(sourceLabelId: string, targetLabelId: string) {
    const { error } = await client.rpc("merge_label_into", {
      source_label: sourceLabelId,
      target_label: targetLabelId,
    });
    if (error) throw error;
    await refresh();
  }

  async function moveLabelToInbox(sourceLabelId: string) {
    const { error } = await client.rpc("move_label_to_inbox", {
      p_source_label: sourceLabelId,
    });
    if (error) throw error;
    await refresh();
  }

  async function updateMemberRole(memberId: string, role: WorkspaceRole) {
    const { error } = await client
      .from("workspace_members")
      .update({ role })
      .eq("workspace_id", workspaceId)
      .eq("user_id", memberId);
    if (error) throw error;
    await refresh();
  }

  async function createUserGroup(name: string, memberIds: string[]) {
    const { data: group, error } = await client
      .from("user_groups")
      .insert({ workspace_id: activeWorkspaceId, name: name.trim(), created_by: userId })
      .select("*")
      .single();
    if (error) throw error;
    if (memberIds.length) {
      const { error: membersError } = await client.from("user_group_members").insert(
        memberIds.map((memberId) => ({
          group_id: group.id,
          workspace_id: activeWorkspaceId,
          user_id: memberId,
        })),
      );
      if (membersError) {
        await client.from("user_groups").delete().eq("id", group.id);
        throw membersError;
      }
    }
    await refresh();
  }

  async function updateUserGroup(groupId: string, name: string, memberIds: string[]) {
    const { error } = await client
      .from("user_groups")
      .update({ name: name.trim() })
      .eq("id", groupId);
    if (error) throw error;

    const currentIds = new Set(
      activeBundle.userGroupMembers
        .filter((item) => item.group_id === groupId)
        .map((item) => item.user_id),
    );
    const nextIds = new Set(memberIds);
    const removedIds = [...currentIds].filter((memberId) => !nextIds.has(memberId));
    const addedIds = memberIds.filter((memberId) => !currentIds.has(memberId));
    if (removedIds.length) {
      const { error: removeError } = await client
        .from("user_group_members")
        .delete()
        .eq("group_id", groupId)
        .in("user_id", removedIds);
      if (removeError) throw removeError;
    }
    if (addedIds.length) {
      const { error: addError } = await client.from("user_group_members").insert(
        addedIds.map((memberId) => ({
          group_id: groupId,
          workspace_id: activeWorkspaceId,
          user_id: memberId,
        })),
      );
      if (addError) throw addError;
    }
    await refresh();
  }

  async function deleteUserGroup(groupId: string) {
    const { error } = await client.from("user_groups").delete().eq("id", groupId);
    if (error) throw error;
    await refresh();
  }

  async function createSubtask(taskId: string, title: string) {
    const task = bundleQuery.data?.tasks.find((item) => item.id === taskId);
    const { error } = await client.from("subtasks").insert({
      task_id: taskId,
      title,
      position: task?.subtasks.length ?? 0,
      created_by: userId,
    });
    if (error) throw error;
    await refresh();
  }

  async function toggleSubtask(subtaskId: string, completed: boolean) {
    const { error } = await client
      .from("subtasks")
      .update({ completed })
      .eq("id", subtaskId);
    if (error) throw error;
    await refresh();
  }

  async function updateSubtask(
    subtaskId: string,
    patch: Partial<Pick<Subtask, "due_at" | "assignee_id">>,
  ) {
    const { error } = await client.from("subtasks").update(patch).eq("id", subtaskId);
    if (error) throw error;
    await refresh();
  }

  async function deleteSubtask(subtaskId: string) {
    const { error } = await client.from("subtasks").delete().eq("id", subtaskId);
    if (error) throw error;
    await refresh();
  }

  async function loadInviteLink(workspaceId: string) {
    const { data, error } = await client.functions.invoke("workspace-invite", {
      body: { action: "get", workspaceId },
    });
    if (error) throw error;
    return (data?.link ?? null) as WorkspaceInviteLink | null;
  }

  async function enableInviteLink(workspaceId: string, role: WorkspaceInviteRole) {
    const { data, error } = await client.functions.invoke("workspace-invite", {
      body: { action: "enable", workspaceId, role },
    });
    if (error) throw error;
    queryClient.setQueryData(
      ["workspace-invite-link", workspaceId],
      data.link as WorkspaceInviteLink,
    );
    return data.link as WorkspaceInviteLink;
  }

  async function updateInviteLinkRole(workspaceId: string, role: WorkspaceInviteRole) {
    const { data, error } = await client.functions.invoke("workspace-invite", {
      body: { action: "update-role", workspaceId, role },
    });
    if (error) throw error;
    queryClient.setQueryData(
      ["workspace-invite-link", workspaceId],
      data.link as WorkspaceInviteLink,
    );
    return data.link as WorkspaceInviteLink;
  }

  async function disableInviteLink(workspaceId: string) {
    const { error } = await client.functions.invoke("workspace-invite", {
      body: { action: "disable", workspaceId },
    });
    if (error) throw error;
    queryClient.setQueryData(["workspace-invite-link", workspaceId], null);
  }

  async function copyInviteLink(link: WorkspaceInviteLink) {
    const inviteUrl = buildWorkspaceInviteUrl(
      link.id,
      import.meta.env.VITE_PUBLIC_APP_URL,
      window.location.origin,
    );
    if (!inviteUrl) {
      setNotice("请先配置 VITE_PUBLIC_APP_URL，再复制邀请链接");
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setNotice("邀请链接已复制，可发送给团队成员");
    } catch {
      setNotice("浏览器未允许访问剪贴板，请检查权限后重试");
    }
  }

  async function updateAccountEmail(nextEmail: string) {
    const { error } = await client.auth.updateUser({ email: nextEmail });
    if (error) throw error;
    setNotice("验证邮件已发送，请在新邮箱中确认修改");
  }

  async function updateAccountDisplayName(nextDisplayName: string) {
    await updateDisplayName(client, userId, nextDisplayName);
    await queryClient.invalidateQueries({ queryKey: ["workspace-bundle"] });
    setNotice("昵称已更新");
  }

  async function updateAccountAvatar(avatar: Blob | null) {
    const currentAvatarUrl = activeBundle.members.find(
      (member) => member.user_id === userId,
    )?.profile?.avatar_url ?? null;
    await updateAvatar(client, userId, currentAvatarUrl, avatar);
    await queryClient.invalidateQueries({ queryKey: ["workspace-bundle"] });
    setNotice(avatar ? "头像已更新" : "头像已移除");
  }

  async function deleteAccount() {
    const { error } = await client.functions.invoke("account-admin", {
      body: { action: "delete-account" },
    });
    if (error) throw error;
    await client.auth.signOut({ scope: "local" });
  }

  async function updateDateTimePreferences(next: DateTimePreferences) {
    const previous = dateTimePreferencesQuery.data ?? DEFAULT_DATE_TIME_PREFERENCES;
    queryClient.setQueryData(["date-time-preferences", userId], next);
    try {
      await saveDateTimePreferences(client, userId, next);
    } catch (error) {
      queryClient.setQueryData(["date-time-preferences", userId], previous);
      setNotice("日期与时间设置保存失败，请稍后重试");
      throw error;
    }
  }

  async function updateTaskListPreference(next: TaskListPreference) {
    const queryKey = ["workspace-bundle", workspaceId];
    const previous = queryClient.getQueryData<WorkspaceBundle>(queryKey);
    queryClient.setQueryData<WorkspaceBundle>(queryKey, (current) => current
      ? {
          ...current,
          taskListPreferences: [
            ...current.taskListPreferences.filter(
              (item) => item.list_key !== next.list_key || item.user_id !== next.user_id,
            ),
            next,
          ],
        }
      : current);
    try {
      await saveTaskListPreference(client, next);
    } catch (error) {
      queryClient.setQueryData(queryKey, previous);
      throw error;
    }
    await queryClient.invalidateQueries({ queryKey });
  }

  async function createComment(taskId: string, input: CreateCommentInput) {
    try {
      await createTaskCommentApi(client, { taskId, ...input });
    } catch (error) {
      await Promise.allSettled(input.imageUris.map((uri) => attachmentService.remove(uri)));
      throw error;
    }
  }

  async function deleteComment(comment: TaskComment) {
    await deleteTaskCommentApi(client, comment.id);
    await Promise.allSettled(comment.image_uris.map((uri) => attachmentService.remove(uri)));
  }

  async function updateComment(comment: TaskComment, input: CreateCommentInput) {
    await updateTaskCommentApi(client, { commentId: comment.id, ...input });
    await queryClient.invalidateQueries({ queryKey: ["notifications", workspaceId] });
  }

  async function addTaskSection(listKey: string, name: string) {
    const position = activeBundle.taskSections
      .filter((section) => section.list_key === listKey)
      .reduce((maximum, section) => Math.max(maximum, section.position + 1), 0);
    await createTaskSection(client, {
      workspace_id: activeWorkspaceId,
      list_key: listKey,
      name,
      position,
      created_by: userId,
    });
    await refresh();
  }

  async function editTaskSection(
    sectionId: string,
    patch: Partial<Pick<TaskSection, "name" | "position">>,
  ) {
    await updateTaskSection(client, sectionId, patch);
    await refresh();
  }

  async function removeTaskSection(sectionId: string) {
    await deleteTaskSection(client, sectionId);
    await refresh();
  }

  async function reorderTasks(
    listKey: string,
    sectionId: string | null,
    taskIds: string[],
  ) {
    await setTaskListOrder(client, {
      workspaceId: activeWorkspaceId,
      listKey,
      sectionId,
      taskIds,
    });
    await refresh();
  }

  return (
    <WorkspaceApplication
      workspaces={workspacesQuery.data}
      workspaceId={workspaceId}
      bundle={bundleQuery.data}
      currentUserId={userId}
      currentUserName={
        bundleQuery.data.members.find((member) => member.user_id === userId)
          ?.profile?.display_name || maskPhone(phone) || email.split("@")[0] || "AntTodo 用户"
      }
      currentUserEmail={email}
      currentUserPhone={phone}
      online={online}
      dateTimePreferences={
        dateTimePreferencesQuery.data ?? DEFAULT_DATE_TIME_PREFERENCES
      }
      attachmentService={attachmentService}
      commentsRevision={commentsRevision}
      activityRevision={activityRevision}
      notifications={notificationsQuery.data ?? []}
      notificationsLoading={notificationsQuery.isLoading}
      notice={notice}
      onDismissNotice={() => setNotice("")}
      onNotice={setNotice}
      onWorkspaceChange={setWorkspaceId}
      quota={quotaQuery.data ?? {
        user_id: userId,
        workspace_limit: 3,
        created_at: "",
        updated_at: "",
      }}
      onCreateWorkspace={(input) => workspaceMutation.mutateAsync(input)}
      onCheckWorkspaceSlug={(slug) => isWorkspaceSlugAvailable(client, slug)}
      onUpdateWorkspace={async (targetWorkspaceId, patch) => {
        const updated = await updateWorkspace(client, targetWorkspaceId, patch);
        await refresh();
        return updated;
      }}
      onDeleteWorkspace={async (targetWorkspaceId, confirmationName) => {
        await deleteWorkspaceApi(client, targetWorkspaceId, confirmationName);
        const remaining = (workspacesQuery.data ?? []).filter(
          (item) => item.id !== targetWorkspaceId,
        );
        if (workspaceId === targetWorkspaceId) {
          setWorkspaceId(remaining[0]?.id ?? null);
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["workspaces", userId] }),
          queryClient.invalidateQueries({ queryKey: ["user-quota", userId] }),
          queryClient.removeQueries({ queryKey: ["workspace-bundle", targetWorkspaceId] }),
          queryClient.removeQueries({ queryKey: ["workspace-invite-link", targetWorkspaceId] }),
        ]);
      }}
      onCreateTask={async (input) => {
        const created = await createTask(client, {
          workspaceId,
          ...input,
        });
        await refresh();
        return created;
      }}
      onUpdateTask={updateTask}
      onSaveTaskSchedule={saveTaskSchedule}
      onToggleTaskLabel={toggleTaskLabel}
      onLoadTaskAssignees={(taskId) => listTaskAssigneeIds(client, taskId)}
      onAssignTask={assignTask}
      onCreateSubtask={createSubtask}
      onToggleSubtask={toggleSubtask}
      onUpdateSubtask={updateSubtask}
      onDeleteSubtask={deleteSubtask}
      onLoadTaskComments={(taskId) => loadTaskComments(client, taskId)}
      onLoadTaskActivity={(taskId, cursor) => loadTaskActivity(client, taskId, cursor)}
      onLoadCommentCandidates={(taskId) => listTaskCommentCandidateIds(client, taskId)}
      onCreateComment={createComment}
      onUpdateComment={updateComment}
      onDeleteComment={deleteComment}
      onMarkNotificationRead={async (notificationId) => {
        await markNotificationRead(client, notificationId);
        await queryClient.invalidateQueries({ queryKey: ["notifications", workspaceId] });
      }}
      onMarkAllNotificationsRead={async () => {
        await markAllNotificationsRead(client, activeWorkspaceId);
        await queryClient.invalidateQueries({ queryKey: ["notifications", workspaceId] });
      }}
      onCreateLabel={createLabel}
      onSaveLabelAccess={saveLabelAccess}
      onUpdateLabel={updateLabel}
      onDeleteLabel={deleteLabel}
      onMergeLabel={mergeLabel}
      onMoveLabelToInbox={moveLabelToInbox}
      onUpdateMemberRole={updateMemberRole}
      onCreateUserGroup={createUserGroup}
      onUpdateUserGroup={updateUserGroup}
      onDeleteUserGroup={deleteUserGroup}
      onLoadInviteLink={loadInviteLink}
      onEnableInviteLink={enableInviteLink}
      onUpdateInviteLinkRole={updateInviteLinkRole}
      onDisableInviteLink={disableInviteLink}
      onCopyInviteLink={copyInviteLink}
      onUpdateDisplayName={updateAccountDisplayName}
      onUpdateAvatar={updateAccountAvatar}
      onUpdateEmail={updateAccountEmail}
      onDeleteAccount={deleteAccount}
      onUpdateDateTimePreferences={updateDateTimePreferences}
      onSaveTaskListPreference={updateTaskListPreference}
      onCreateTaskSection={addTaskSection}
      onUpdateTaskSection={editTaskSection}
      onDeleteTaskSection={removeTaskSection}
      onSetTaskListOrder={reorderTasks}
      onSignOut={() => client.auth.signOut()}
    />
  );
}

function applyDemoLabelAccess(
  bundle: WorkspaceBundle,
  labelId: string,
  draft: LabelAccessDraft,
): WorkspaceBundle {
  const userPermissions = new Map<string, "view" | "edit">();
  const groupPermissions = new Map<string, "view" | "edit">();
  if (draft.kind === "team") {
    if (draft.viewScope === "users") {
      draft.viewSubjectIds.forEach((id) => userPermissions.set(id, "view"));
    }
    if (draft.manageScope === "users") {
      draft.manageSubjectIds.forEach((id) => userPermissions.set(id, "edit"));
    }
    if (draft.viewScope === "groups") {
      draft.viewSubjectIds.forEach((id) => groupPermissions.set(id, "view"));
    }
    if (draft.manageScope === "groups") {
      draft.manageSubjectIds.forEach((id) => groupPermissions.set(id, "edit"));
    }
  }
  return {
    ...bundle,
    labelUserAcls: [
      ...bundle.labelUserAcls.filter((acl) => acl.label_id !== labelId),
      ...[...userPermissions].map(([userId, permission]) => ({
        label_id: labelId,
        workspace_id: bundle.labels.find((label) => label.id === labelId)!.workspace_id,
        user_id: userId,
        permission,
      })),
    ],
    labelGroupAcls: [
      ...bundle.labelGroupAcls.filter((acl) => acl.label_id !== labelId),
      ...[...groupPermissions].map(([groupId, permission]) => ({
        label_id: labelId,
        workspace_id: bundle.labels.find((label) => label.id === labelId)!.workspace_id,
        group_id: groupId,
        permission,
      })),
    ],
  };
}

function DemoApplication() {
  const online = useOnline();
  const attachmentService = useMemo(() => createDemoAttachmentService(), []);
  const [workspaces, setWorkspaces] = useState(demoWorkspaces);
  const [workspaceId, setWorkspaceId] = useState(demoWorkspaces[0].id);
  const [bundle, setBundle] = useState(createDemoBundle);
  const [notice, setNotice] = useState("你正在浏览演示空间，所有改动只保存在当前页面");
  const [inviteLink, setInviteLink] = useState<WorkspaceInviteLink | null>(null);
  const [dateTimePreferences, setDateTimePreferences] = useState(
    DEFAULT_DATE_TIME_PREFERENCES,
  );
  const [demoComments, setDemoComments] = useState<TaskComment[]>(() => {
    const createdAt = new Date(Date.now() - 5 * 60_000).toISOString();
    return [{
      id: "demo-comment-mention",
      workspace_id: "workspace-team",
      task_id: "task-2",
      author_id: "demo-member",
      body: "@沈宇宝 请确认一下详情面板的评论交互",
      image_uris: [],
      created_at: createdAt,
      updated_at: createdAt,
      author: { id: "demo-member", display_name: "产品同学", avatar_url: null },
      mentions: [{ user_id: "demo-user", display_name_snapshot: "沈宇宝" }],
    }];
  });
  const demoCommentsRef = useRef<TaskComment[]>(demoComments);
  const [demoNotifications, setDemoNotifications] = useState<AppNotification[]>(() => [{
    id: "demo-notification-mention",
    workspace_id: "workspace-team",
    task_id: "task-2",
    comment_id: "demo-comment-mention",
    recipient_id: "demo-user",
    actor_id: "demo-member",
    notification_type: "comment_mention",
    read_at: null,
    created_at: demoComments[0].created_at,
    actor: { id: "demo-member", display_name: "产品同学", avatar_url: null },
    task: { id: "task-2", title: "优化任务详情抽屉交互", kind: "todo" },
    comment: {
      id: "demo-comment-mention",
      body: demoComments[0].body,
      image_uris: [],
    },
  }]);
  const [commentsRevision, setCommentsRevision] = useState(0);
  const [activityRevision, setActivityRevision] = useState(0);
  const [demoActivities, setDemoActivities] = useState<TaskActivityEvent[]>([]);

  useEffect(() => {
    return () => attachmentService.dispose();
  }, [attachmentService]);

  function appendDemoActivity(
    taskId: string,
    eventType: string,
    payload: Record<string, unknown> = {},
  ) {
    const createdAt = new Date().toISOString();
    setDemoActivities((current) => [{
      id: crypto.randomUUID(),
      workspace_id: workspaceId,
      task_id: taskId,
      actor_id: "demo-user",
      event_type: eventType,
      payload,
      created_at: createdAt,
      actor: bundle.members.find((member) => member.user_id === "demo-user")?.profile,
    }, ...current]);
    setActivityRevision((value) => value + 1);
  }

  function patchTask(taskId: string, patch: Partial<Task>) {
    const task = bundle.tasks.find((item) => item.id === taskId);
    const auditableFields: Array<keyof Task> = [
      "title", "description", "kind", "status", "priority", "due_at",
      "due_start_at", "due_is_all_day", "due_timezone", "deleted_at",
    ];
    const changes = Object.fromEntries(auditableFields.flatMap((field) =>
      field in patch && task?.[field] !== patch[field]
        ? [[field, { before: task?.[field] ?? null, after: patch[field] ?? null }]]
        : []));
    setBundle((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? { ...task, ...patch, updated_at: new Date().toISOString(), version: task.version + 1 }
          : task,
      ),
    }));
    if (Object.keys(changes).length) appendDemoActivity(taskId, "task.updated", { changes });
    return Promise.resolve();
  }

  return (
    <WorkspaceApplication
      workspaces={workspaces}
      workspaceId={workspaceId}
      bundle={bundle}
      currentUserId="demo-user"
      currentUserName={
        bundle.members.find((member) => member.user_id === "demo-user")
          ?.profile?.display_name ?? "沈宇宝"
      }
      currentUserEmail=""
      currentUserPhone="+8613800138000"
      online={online}
      dateTimePreferences={dateTimePreferences}
      attachmentService={attachmentService}
      commentsRevision={commentsRevision}
      activityRevision={activityRevision}
      notifications={demoNotifications.filter((item) =>
        item.workspace_id === workspaceId && item.recipient_id === "demo-user")}
      notificationsLoading={false}
      notice={notice}
      onDismissNotice={() => setNotice("")}
      onNotice={setNotice}
      onWorkspaceChange={setWorkspaceId}
      quota={{
        user_id: "demo-user",
        workspace_limit: 3,
        created_at: "",
        updated_at: "",
      }}
      onCreateWorkspace={async (input) => {
        if (workspaces.filter((item) => item.role === "owner").length >= 3) {
          throw new Error("已达到可拥有的团队数量上限。");
        }
        const workspace = {
          id: crypto.randomUUID(),
          name: input.name.trim(),
          slug: normalizeWorkspaceSlug(input.slug),
          created_by: "demo-user",
          role: "owner" as const,
        };
        setWorkspaces((current) => [...current, workspace]);
        setWorkspaceId(workspace.id);
        return workspace;
      }}
      onCheckWorkspaceSlug={async (slug) =>
        !workspaces.some((item) => item.slug === normalizeWorkspaceSlug(slug))}
      onUpdateWorkspace={async (targetWorkspaceId, patch) => {
        const slug = normalizeWorkspaceSlug(patch.slug);
        const slugError = workspaceSlugValidationMessage(slug);
        if (slugError) throw new Error(slugError);
        if (
          workspaces.some(
            (item) => item.id !== targetWorkspaceId && item.slug === slug,
          )
        ) {
          throw new Error("团队 Slug 已被占用，请换一个。");
        }
        const updated = {
          ...workspaces.find((item) => item.id === targetWorkspaceId)!,
          name: patch.name.trim(),
          slug,
        };
        setWorkspaces((current) =>
          current.map((item) => (item.id === targetWorkspaceId ? updated : item)),
        );
        return updated;
      }}
      onDeleteWorkspace={async (targetWorkspaceId, confirmationName) => {
        const selected = workspaces.find((item) => item.id === targetWorkspaceId);
        if (!selected || selected.role !== "owner") throw new Error("仅所有者可以删除团队。");
        if (selected.name !== confirmationName) throw new Error("团队名称不匹配。");
        const remaining = workspaces.filter((item) => item.id !== targetWorkspaceId);
        setWorkspaces(remaining);
        if (workspaceId === targetWorkspaceId && remaining[0]) setWorkspaceId(remaining[0].id);
      }}
      onCreateTask={async (input) => {
        const createdAt = new Date().toISOString();
        const createdId = crypto.randomUUID();
        setBundle((current) => ({
          ...current,
          tasks: [
            {
              id: createdId,
              workspace_id: workspaceId,
              title: input.title,
              description: input.description ?? "",
              kind: input.kind ?? "todo",
              status: "open",
              priority: input.kind === "note" ? "none" : input.priority ?? "none",
              due_at: input.dueAt ?? null,
              due_start_at: null,
              due_is_all_day: false,
              due_timezone: null,
              assignee_id: null,
              created_by: "demo-user",
              completed_at: null,
              deleted_at: null,
              version: 1,
              created_at: createdAt,
              updated_at: createdAt,
              label_ids: input.labelIds,
              subtasks: [],
              reminders: [],
              reminder_persistent: false,
            },
            ...current.tasks,
          ],
        }));
        appendDemoActivity(createdId, "task.created", { title: input.title });
        return { id: createdId };
      }}
      onUpdateTask={patchTask}
      onSaveTaskSchedule={async (taskId, patch, schedule) => {
        const createdAt = new Date().toISOString();
        setBundle((current) => ({
          ...current,
          tasks: current.tasks.map((task) => task.id !== taskId ? task : {
            ...task,
            ...patch,
            reminders: schedule.reminders.map((rule, position) => ({
              id: `${taskId}:demo-reminder:${position}`,
              task_id: taskId,
              ...rule,
              trigger_at: reminderTriggerAt({ ...task, ...patch }, rule) ?? createdAt,
              position,
              created_by: "demo-user",
              created_at: createdAt,
              updated_at: createdAt,
            })),
            reminder_persistent: schedule.persistent,
            updated_at: createdAt,
            version: task.version + 1,
          }),
        }));
        const task = bundle.tasks.find((item) => item.id === taskId);
        const changes = Object.fromEntries(([
          "due_at", "due_start_at", "due_is_all_day", "due_timezone",
        ] as const).flatMap((field) => task?.[field] !== patch[field]
          ? [[field, { before: task?.[field] ?? null, after: patch[field] ?? null }]]
          : []));
        if (Object.keys(changes).length) appendDemoActivity(taskId, "task.updated", { changes });
        appendDemoActivity(taskId, "task.reminders_changed", {
          before: { reminders: task?.reminders ?? [], persistent: task?.reminder_persistent ?? false },
          after: { reminders: schedule.reminders, persistent: schedule.persistent },
        });
      }}
      onToggleTaskLabel={async (taskId, labelId, selected) => {
        setBundle((current) => ({
          ...current,
          tasks: current.tasks.map((task) => {
            if (task.id !== taskId) return task;
            const labelIds = new Set(task.label_ids);
            if (selected) labelIds.add(labelId);
            else labelIds.delete(labelId);
            return { ...task, label_ids: [...labelIds] };
          }),
        }));
        const label = bundle.labels.find((item) => item.id === labelId);
        appendDemoActivity(taskId, selected ? "task.label_added" : "task.label_removed", {
          label_id: labelId,
          label_name: label?.name ?? "标签",
          label_color: label?.color ?? "#8f959e",
        });
      }}
      onLoadTaskAssignees={async (taskId) => {
        const task = bundle.tasks.find((item) => item.id === taskId);
        return task
          ? getAssignableMembers(bundle, task, "demo-user").map(
              (member) => member.user_id,
            )
          : [];
      }}
      onAssignTask={async (taskId, assigneeId) => {
        const previous = bundle.tasks.find((item) => item.id === taskId)?.assignee_id ?? null;
        await patchTask(taskId, { assignee_id: assigneeId });
        if (previous !== assigneeId) appendDemoActivity(taskId, "task.assignee_changed", {
          previous_assignee_id: previous,
          assignee_id: assigneeId,
        });
      }}
      onCreateSubtask={async (taskId, title) => {
        const subtaskId = crypto.randomUUID();
        setBundle((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  subtasks: [
                    ...task.subtasks,
                    {
                      id: subtaskId,
                      task_id: taskId,
                      title,
                      completed: false,
                      position: task.subtasks.length,
                      due_at: null,
                      assignee_id: null,
                    },
                  ],
                }
              : task,
          ),
        }));
        appendDemoActivity(taskId, "task.subtask_created", {
          subtask_id: subtaskId,
          title,
          completed: false,
        });
      }}
      onToggleSubtask={async (subtaskId, completed) => {
        const ownerTask = bundle.tasks.find((task) => task.subtasks.some((subtask) => subtask.id === subtaskId));
        const subtask = ownerTask?.subtasks.find((item) => item.id === subtaskId);
        setBundle((current) => ({
          ...current,
          tasks: current.tasks.map((task) => ({
            ...task,
            subtasks: task.subtasks.map((subtask) =>
              subtask.id === subtaskId ? { ...subtask, completed } : subtask,
            ),
          })),
        }));
        if (ownerTask && subtask && subtask.completed !== completed) {
          appendDemoActivity(ownerTask.id, "task.subtask_updated", {
            subtask_id: subtaskId,
            title: subtask.title,
            changes: { completed: { before: subtask.completed, after: completed } },
          });
        }
      }}
      onUpdateSubtask={async (subtaskId, patch) => {
        const ownerTask = bundle.tasks.find((task) => task.subtasks.some((subtask) => subtask.id === subtaskId));
        const subtask = ownerTask?.subtasks.find((item) => item.id === subtaskId);
        setBundle((current) => ({
          ...current,
          tasks: current.tasks.map((task) => ({
            ...task,
            subtasks: task.subtasks.map((item) => item.id === subtaskId ? { ...item, ...patch } : item),
          })),
        }));
        if (ownerTask && subtask) {
          const changes = Object.fromEntries(Object.entries(patch).flatMap(([field, after]) =>
            subtask[field as "due_at" | "assignee_id"] !== after
              ? [[field, { before: subtask[field as "due_at" | "assignee_id"], after }]]
              : []));
          if (Object.keys(changes).length) appendDemoActivity(ownerTask.id, "task.subtask_updated", {
            subtask_id: subtaskId,
            title: subtask.title,
            changes,
          });
        }
      }}
      onDeleteSubtask={async (subtaskId) => {
        const ownerTask = bundle.tasks.find((task) => task.subtasks.some((subtask) => subtask.id === subtaskId));
        const subtask = ownerTask?.subtasks.find((item) => item.id === subtaskId);
        setBundle((current) => ({
          ...current,
          tasks: current.tasks.map((task) => ({
            ...task,
            subtasks: task.subtasks.filter((item) => item.id !== subtaskId),
          })),
        }));
        if (ownerTask && subtask) appendDemoActivity(ownerTask.id, "task.subtask_deleted", {
          subtask_id: subtaskId,
          title: subtask.title,
          completed: subtask.completed,
        });
      }}
      onLoadTaskComments={async (taskId) =>
        demoCommentsRef.current.filter((comment) => comment.task_id === taskId)}
      onLoadTaskActivity={async (taskId, cursor) => {
        const task = bundle.tasks.find((item) => item.id === taskId);
        const taskEvents = demoActivities.filter((event) => event.task_id === taskId);
        const createdEvent: TaskActivityEvent[] = task && !taskEvents.some(
          (event) => event.event_type === "task.created",
        ) ? [{
          id: `demo-created:${task.id}`,
          workspace_id: task.workspace_id,
          task_id: task.id,
          actor_id: task.created_by,
          event_type: "task.created",
          payload: { title: task.title },
          created_at: task.created_at,
          actor: bundle.members.find((member) => member.user_id === task.created_by)?.profile,
        }] : [];
        const all = [...taskEvents, ...createdEvent]
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        const start = cursor
          ? Math.max(0, all.findIndex((event) => event.id === cursor.id) + 1)
          : 0;
        const items = all.slice(start, start + 50);
        const last = items.at(-1);
        return {
          items,
          nextCursor: items.length === 50 && last ? { createdAt: last.created_at, id: last.id } : null,
        };
      }}
      onLoadCommentCandidates={async () => bundle.members.map((member) => member.user_id)}
      onCreateComment={async (taskId, input) => {
        const createdAt = new Date().toISOString();
        const commentId = crypto.randomUUID();
        const mentions = bundle.members
          .filter((member) => input.mentionedUserIds.includes(member.user_id))
          .map((member) => ({
            user_id: member.user_id,
            display_name_snapshot: member.profile?.display_name || "团队成员",
          }));
        const author = bundle.members.find((member) => member.user_id === "demo-user")?.profile;
        const comment: TaskComment = {
          id: commentId,
          workspace_id: workspaceId,
          task_id: taskId,
          author_id: "demo-user",
          body: input.body,
          image_uris: input.imageUris,
          created_at: createdAt,
          updated_at: createdAt,
          author,
          mentions,
        };
        const nextComments = [...demoCommentsRef.current, comment];
        demoCommentsRef.current = nextComments;
        setDemoComments(nextComments);
        const task = bundle.tasks.find((item) => item.id === taskId);
        const additions = mentions
          .filter((mention) => mention.user_id !== "demo-user")
          .map<AppNotification>((mention) => ({
            id: crypto.randomUUID(),
            workspace_id: workspaceId,
            task_id: taskId,
            comment_id: commentId,
            recipient_id: mention.user_id,
            actor_id: "demo-user",
            notification_type: "comment_mention",
            read_at: null,
            created_at: createdAt,
            actor: author,
            task: task ? { id: task.id, title: task.title, kind: task.kind } : undefined,
            comment: { id: comment.id, body: comment.body, image_uris: comment.image_uris },
          }));
        setDemoNotifications((current) => [...additions, ...current]);
        setCommentsRevision((value) => value + 1);
      }}
      onUpdateComment={async (comment, input) => {
        const updatedAt = new Date().toISOString();
        const mentions = bundle.members
          .filter((member) => input.mentionedUserIds.includes(member.user_id))
          .map((member) => ({
            user_id: member.user_id,
            display_name_snapshot: member.profile?.display_name || "团队成员",
          }));
        const updatedComment = {
          ...comment,
          body: input.body,
          image_uris: input.imageUris,
          mentions,
          updated_at: updatedAt,
        };
        const nextComments = demoCommentsRef.current.map((item) =>
          item.id === comment.id ? updatedComment : item);
        demoCommentsRef.current = nextComments;
        setDemoComments(nextComments);
        const task = bundle.tasks.find((item) => item.id === comment.task_id);
        const author = bundle.members.find((member) => member.user_id === comment.author_id)?.profile;
        setDemoNotifications((current) => {
          const retained = current.filter((item) =>
            item.comment_id !== comment.id || mentions.some((mention) => mention.user_id === item.recipient_id));
          const recipients = new Set(retained.filter((item) => item.comment_id === comment.id)
            .map((item) => item.recipient_id));
          const additions = mentions.filter((mention) =>
            mention.user_id !== comment.author_id && !recipients.has(mention.user_id))
            .map<AppNotification>((mention) => ({
              id: crypto.randomUUID(),
              workspace_id: comment.workspace_id,
              task_id: comment.task_id,
              comment_id: comment.id,
              recipient_id: mention.user_id,
              actor_id: comment.author_id,
              notification_type: "comment_mention",
              read_at: null,
              created_at: updatedAt,
              actor: author,
              task: task ? { id: task.id, title: task.title, kind: task.kind } : undefined,
              comment: { id: comment.id, body: input.body, image_uris: input.imageUris },
            }));
          return [...additions, ...retained.map((item) => item.comment_id === comment.id
            ? { ...item, comment: { id: comment.id, body: input.body, image_uris: input.imageUris } }
            : item)];
        });
        setCommentsRevision((value) => value + 1);
      }}
      onDeleteComment={async (comment) => {
        const nextComments = demoCommentsRef.current.filter((item) => item.id !== comment.id);
        demoCommentsRef.current = nextComments;
        setDemoComments(nextComments);
        setDemoNotifications((current) => current.filter((item) => item.comment_id !== comment.id));
        await Promise.allSettled(comment.image_uris.map((uri) => attachmentService.remove(uri)));
        setCommentsRevision((value) => value + 1);
      }}
      onMarkNotificationRead={async (notificationId) => {
        setDemoNotifications((current) => current.map((item) =>
          item.id === notificationId ? { ...item, read_at: new Date().toISOString() } : item));
      }}
      onMarkAllNotificationsRead={async () => {
        setDemoNotifications((current) => current.map((item) =>
          item.workspace_id === workspaceId && !item.read_at
            ? { ...item, read_at: new Date().toISOString() }
            : item));
      }}
      onCreateLabel={async (draft) => {
        setBundle((current) => {
          const labelId = crypto.randomUUID();
          return applyDemoLabelAccess({
            ...current,
            labels: [...current.labels, {
              id: labelId,
              workspace_id: workspaceId,
              parent_id: draft.parentId,
              name: draft.name,
              color: draft.color,
              kind: draft.kind,
              view_scope: draft.viewScope,
              manage_scope: draft.manageScope,
              inherit_permissions: Boolean(draft.parentId),
              position: current.labels.length,
              created_by: "demo-user",
            }],
            labelPermissionLevels: {
              ...current.labelPermissionLevels,
              [labelId]: 2,
            },
          }, labelId, draft);
        });
      }}
      onSaveLabelAccess={async (labelId, draft) => {
        setBundle((current) => applyDemoLabelAccess({
          ...current,
          labels: current.labels.map((label) => label.id === labelId ? {
            ...label,
            name: draft.name,
            color: draft.color,
            kind: draft.kind,
            view_scope: draft.viewScope,
            manage_scope: draft.manageScope,
            inherit_permissions: Boolean(label.parent_id),
          } : label),
        }, labelId, draft));
      }}
      onUpdateLabel={async (labelId, patch) => {
        setBundle((current) => ({
          ...current,
          labels: current.labels.map((label) =>
            label.id === labelId ? { ...label, ...patch } : label,
          ),
        }));
      }}
      onDeleteLabel={async (labelId) => {
        setBundle((current) => ({
          ...current,
          labels: current.labels.filter((label) => label.id !== labelId),
          tasks: current.tasks.map((task) => ({
            ...task,
            label_ids: task.label_ids.filter((id) => id !== labelId),
          })),
        }));
      }}
      onMergeLabel={async (sourceLabelId, targetLabelId) => {
        setBundle((current) => ({
          ...current,
          labels: current.labels
            .filter((label) => label.id !== sourceLabelId)
            .map((label) =>
              label.parent_id === sourceLabelId
                ? { ...label, parent_id: targetLabelId }
                : label
            ),
          tasks: current.tasks.map((task) => ({
            ...task,
            label_ids: task.label_ids.includes(sourceLabelId)
              ? [...new Set(task.label_ids.map((id) =>
                  id === sourceLabelId ? targetLabelId : id
                ))]
              : task.label_ids,
          })),
        }));
      }}
      onMoveLabelToInbox={async (sourceLabelId) => {
        setBundle((current) => {
          return {
            ...current,
            labels: current.labels
              .filter((label) => label.id !== sourceLabelId)
              .map((label) =>
                label.parent_id === sourceLabelId
                  ? {
                      ...label,
                      parent_id: null,
                      inherit_permissions: false,
                    }
                  : label
              ),
            tasks: current.tasks.map((task) => ({
              ...task,
              label_ids: task.label_ids.filter((labelId) => labelId !== sourceLabelId),
            })),
          };
        });
      }}
      onUpdateMemberRole={async (memberId, role) => {
        setBundle((current) => ({
          ...current,
          members: current.members.map((member) =>
            member.user_id === memberId ? { ...member, role } : member,
          ),
        }));
      }}
      onCreateUserGroup={async (name, memberIds) => {
        const groupId = crypto.randomUUID();
        const createdAt = new Date().toISOString();
        setBundle((current) => ({
          ...current,
          userGroups: [...current.userGroups, {
            id: groupId,
            workspace_id: workspaceId,
            name: name.trim(),
            created_by: "demo-user",
            created_at: createdAt,
            updated_at: createdAt,
          }],
          userGroupMembers: [
            ...current.userGroupMembers,
            ...memberIds.map((memberId) => ({
              group_id: groupId,
              workspace_id: workspaceId,
              user_id: memberId,
              added_at: createdAt,
            })),
          ],
        }));
      }}
      onUpdateUserGroup={async (groupId, name, memberIds) => {
        const selected = new Set(memberIds);
        const addedAt = new Date().toISOString();
        setBundle((current) => ({
          ...current,
          userGroups: current.userGroups.map((group) =>
            group.id === groupId
              ? { ...group, name: name.trim(), updated_at: addedAt }
              : group,
          ),
          userGroupMembers: [
            ...current.userGroupMembers.filter((item) => item.group_id !== groupId),
            ...current.members
              .filter((member) => selected.has(member.user_id))
              .map((member) => ({
                group_id: groupId,
                workspace_id: workspaceId,
                user_id: member.user_id,
                added_at: addedAt,
              })),
          ],
        }));
      }}
      onDeleteUserGroup={async (groupId) => {
        setBundle((current) => ({
          ...current,
          userGroups: current.userGroups.filter((group) => group.id !== groupId),
          userGroupMembers: current.userGroupMembers.filter((item) => item.group_id !== groupId),
        }));
      }}
      onLoadInviteLink={async (targetWorkspaceId) =>
        inviteLink?.workspace_id === targetWorkspaceId ? inviteLink : null}
      onEnableInviteLink={async (targetWorkspaceId, role) => {
        const nextLink: WorkspaceInviteLink = {
          id: crypto.randomUUID(),
          workspace_id: targetWorkspaceId,
          role,
          created_by: "demo-owner",
          created_at: new Date().toISOString(),
          revoked_at: null,
        };
        setInviteLink(nextLink);
        return nextLink;
      }}
      onUpdateInviteLinkRole={async (_targetWorkspaceId, role) => {
        const nextLink = { ...inviteLink!, role };
        setInviteLink(nextLink);
        return nextLink;
      }}
      onDisableInviteLink={async () => setInviteLink(null)}
      onCopyInviteLink={async () => setNotice("演示邀请链接已复制")}
      onUpdateDisplayName={async (displayName) => {
        setBundle((current) => ({
          ...current,
          members: current.members.map((member) =>
            member.user_id === "demo-user"
              ? {
                  ...member,
                  profile: {
                    id: "demo-user",
                    display_name: displayName.trim(),
                    avatar_url: member.profile?.avatar_url ?? null,
                  },
                }
              : member,
          ),
        }));
        setNotice("昵称已更新（演示模式）");
      }}
      onUpdateAvatar={async (avatar) => {
        setBundle((current) => ({
          ...current,
          members: current.members.map((member) => {
            if (member.user_id !== "demo-user") return member;
            const oldUrl = member.profile?.avatar_url;
            if (oldUrl?.startsWith("blob:")) URL.revokeObjectURL(oldUrl);
            return {
              ...member,
              profile: {
                id: "demo-user",
                display_name: member.profile?.display_name ?? "沈宇宝",
                avatar_url: avatar ? URL.createObjectURL(avatar) : null,
              },
            };
          }),
        }));
        setNotice(avatar ? "头像已更新（演示模式）" : "头像已移除（演示模式）");
      }}
      onUpdateEmail={async () => setNotice("演示模式不会实际修改邮箱")}
      onDeleteAccount={async () => {
        setNotice("演示模式不会实际删除账户");
      }}
      onUpdateDateTimePreferences={async (next) => {
        setDateTimePreferences(next);
      }}
      onSaveTaskListPreference={async (next) => {
        setBundle((current) => ({
          ...current,
          taskListPreferences: [
            ...current.taskListPreferences.filter(
              (item) => item.user_id !== next.user_id || item.list_key !== next.list_key,
            ),
            next,
          ],
        }));
      }}
      onCreateTaskSection={async (listKey, name) => {
        setBundle((current) => ({
          ...current,
          taskSections: [
            ...current.taskSections,
            {
              id: crypto.randomUUID(),
              workspace_id: workspaceId,
              list_key: listKey,
              name,
              position: current.taskSections.filter(
                (section) => section.list_key === listKey,
              ).length,
              created_by: "demo-user",
            },
          ],
        }));
      }}
      onUpdateTaskSection={async (sectionId, patch) => {
        setBundle((current) => ({
          ...current,
          taskSections: current.taskSections.map((section) =>
            section.id === sectionId ? { ...section, ...patch } : section),
        }));
      }}
      onDeleteTaskSection={async (sectionId) => {
        setBundle((current) => ({
          ...current,
          taskSections: current.taskSections.filter((section) => section.id !== sectionId),
          taskPlacements: current.taskPlacements.map((placement) =>
            placement.section_id === sectionId
              ? { ...placement, section_id: null }
              : placement),
        }));
      }}
      onSetTaskListOrder={async (listKey, sectionId, taskIds) => {
        setBundle((current) => {
          const moved = new Set(taskIds);
          return {
            ...current,
            taskPlacements: [
              ...current.taskPlacements.filter(
                (placement) =>
                  placement.list_key !== listKey || !moved.has(placement.task_id),
              ),
              ...taskIds.map((taskId, position) => ({
                workspace_id: workspaceId,
                list_key: listKey,
                task_id: taskId,
                section_id: sectionId,
                position,
              })),
            ],
          };
        });
      }}
      onSignOut={() => {
        window.location.href = window.location.pathname;
      }}
    />
  );
}

type WorkspaceAppProps = {
  workspaces: Workspace[];
  workspaceId: string;
  quota: UserQuota;
  bundle: WorkspaceBundle;
  currentUserId: string;
  currentUserName: string;
  currentUserEmail: string;
  currentUserPhone: string;
  online: boolean;
  dateTimePreferences: DateTimePreferences;
  attachmentService: AttachmentService;
  commentsRevision: number;
  activityRevision: number;
  notifications: AppNotification[];
  notificationsLoading: boolean;
  notice: string;
  onDismissNotice: () => void;
  onNotice: (message: string) => void;
  onWorkspaceChange: (id: string) => void;
  onCreateWorkspace: (input: { name: string; slug: string }) => Promise<Workspace>;
  onCheckWorkspaceSlug: (slug: string) => Promise<boolean>;
  onUpdateWorkspace: (workspaceId: string, patch: {
    name: string;
    slug: string;
  }) => Promise<Workspace>;
  onDeleteWorkspace: (workspaceId: string, confirmationName: string) => Promise<void>;
  onCreateTask: (input: {
    title: string;
    labelIds: string[];
    description?: string;
    dueAt?: string | null;
    dueTimezone?: string | null;
    priority?: TaskPriority;
    kind?: TaskKind;
  }) => Promise<unknown>;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onSaveTaskSchedule: (
    taskId: string,
    patch: Pick<Task, "due_at" | "due_start_at" | "due_is_all_day" | "due_timezone">,
    schedule: ReminderSchedule,
  ) => Promise<void>;
  onToggleTaskLabel: (
    taskId: string,
    labelId: string,
    selected: boolean,
  ) => Promise<void>;
  onLoadTaskAssignees: (taskId: string) => Promise<string[]>;
  onAssignTask: (taskId: string, assigneeId: string | null) => Promise<void>;
  onCreateSubtask: (taskId: string, title: string) => Promise<void>;
  onToggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;
  onUpdateSubtask: (
    subtaskId: string,
    patch: Partial<Pick<Subtask, "due_at" | "assignee_id">>,
  ) => Promise<void>;
  onDeleteSubtask: (subtaskId: string) => Promise<void>;
  onLoadTaskComments: (taskId: string) => Promise<TaskComment[]>;
  onLoadTaskActivity: (
    taskId: string,
    cursor?: TaskActivityPage["nextCursor"],
  ) => Promise<TaskActivityPage>;
  onLoadCommentCandidates: (taskId: string) => Promise<string[]>;
  onCreateComment: (taskId: string, input: CreateCommentInput) => Promise<void>;
  onUpdateComment: (comment: TaskComment, input: CreateCommentInput) => Promise<void>;
  onDeleteComment: (comment: TaskComment) => Promise<void>;
  onMarkNotificationRead: (notificationId: string) => Promise<void>;
  onMarkAllNotificationsRead: () => Promise<void>;
  onCreateLabel: (draft: LabelAccessDraft) => Promise<void>;
  onSaveLabelAccess: (labelId: string, draft: LabelAccessDraft) => Promise<void>;
  onUpdateLabel: (labelId: string, patch: Partial<Label>) => Promise<void>;
  onDeleteLabel: (labelId: string) => Promise<void>;
  onMergeLabel: (sourceLabelId: string, targetLabelId: string) => Promise<void>;
  onMoveLabelToInbox: (sourceLabelId: string) => Promise<void>;
  onUpdateMemberRole: (memberId: string, role: WorkspaceRole) => Promise<void>;
  onCreateUserGroup: (name: string, memberIds: string[]) => Promise<void>;
  onUpdateUserGroup: (groupId: string, name: string, memberIds: string[]) => Promise<void>;
  onDeleteUserGroup: (groupId: string) => Promise<void>;
  onLoadInviteLink: (workspaceId: string) => Promise<WorkspaceInviteLink | null>;
  onEnableInviteLink: (
    workspaceId: string,
    role: WorkspaceInviteRole,
  ) => Promise<WorkspaceInviteLink>;
  onUpdateInviteLinkRole: (
    workspaceId: string,
    role: WorkspaceInviteRole,
  ) => Promise<WorkspaceInviteLink>;
  onDisableInviteLink: (workspaceId: string) => Promise<void>;
  onCopyInviteLink: (link: WorkspaceInviteLink) => Promise<void>;
  onUpdateDisplayName: (displayName: string) => Promise<void>;
  onUpdateAvatar: (avatar: Blob | null) => Promise<void>;
  onUpdateEmail: (email: string) => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onUpdateDateTimePreferences: (preferences: DateTimePreferences) => Promise<void>;
  onSaveTaskListPreference: (preference: TaskListPreference) => Promise<void>;
  onCreateTaskSection: (listKey: string, name: string) => Promise<void>;
  onUpdateTaskSection: (
    sectionId: string,
    patch: Partial<Pick<TaskSection, "name" | "position">>,
  ) => Promise<void>;
  onDeleteTaskSection: (sectionId: string) => Promise<void>;
  onSetTaskListOrder: (
    listKey: string,
    sectionId: string | null,
    taskIds: string[],
  ) => Promise<void>;
  onSignOut: () => unknown;
};

function PanelResizeHandle({
  label,
  value,
  min,
  max,
  direction,
  className,
  onResize,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  direction: 1 | -1;
  className: string;
  onResize: (width: number) => void;
}) {
  function resizeByPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = value;
    handle.setPointerCapture(pointerId);
    document.body.classList.add("is-panel-resizing");

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth + (moveEvent.clientX - startX) * direction;
      onResize(Math.min(max, Math.max(min, nextWidth)));
    };

    const finishResize = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      document.body.classList.remove("is-panel-resizing");
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  function resizeByKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    let nextWidth: number | null = null;
    if (event.key === "Home") nextWidth = min;
    if (event.key === "End") nextWidth = max;
    if (event.key === "ArrowLeft") nextWidth = value - 10 * direction;
    if (event.key === "ArrowRight") nextWidth = value + 10 * direction;
    if (nextWidth === null) return;
    event.preventDefault();
    onResize(Math.min(max, Math.max(min, nextWidth)));
  }

  return (
    <div
      className={clsx("panel-resize-handle", className)}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onPointerDown={resizeByPointer}
      onKeyDown={resizeByKeyboard}
    />
  );
}

function WorkspaceApplication(props: WorkspaceAppProps) {
  const workspace = props.workspaces.find((item) => item.id === props.workspaceId)!;
  const [smartView, setSmartView] = useState<SmartView>("all");
  const [appSection, setAppSection] = useState<AppSection>("tasks");
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [createWorkspaceDialogOpen, setCreateWorkspaceDialogOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_MIN_WIDTH);
  const [calendarSidebarWidth, setCalendarSidebarWidth] = useState(
    CALENDAR_SIDEBAR_DEFAULT_WIDTH,
  );
  const [calendarSidebarCollapsed, setCalendarSidebarCollapsed] = useState(
    () => window.localStorage.getItem(CALENDAR_SIDEBAR_COLLAPSED_KEY) === "1",
  );
  const [calendarVisibleDate, setCalendarVisibleDate] = useState(() => new Date());
  const [calendarNavigationDate, setCalendarNavigationDate] = useState<Date | null>(null);
  const [mindMapCreateLabel, setMindMapCreateLabel] = useState<{
    parentId: string | null;
  } | null>(null);
  const [detailWidth, setDetailWidth] = useState(DETAIL_MAX_WIDTH);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<Set<string>>(
    () => new Set(["inbox", ...props.bundle.labels.map((label) => label.id)]),
  );
  const now = useMinuteNow();

  const selectedTask = props.bundle.tasks.find((task) => task.id === selectedTaskId) ?? null;
  const selectedTaskEditable = selectedTask
    ? currentTaskPermissionLevel(props.bundle, selectedTask, props.currentUserId) >= 2
    : false;

  useEffect(() => {
    if (selectedTaskId && !selectedTask) setSelectedTaskId(null);
  }, [selectedTask, selectedTaskId]);

  useEffect(() => {
    setSearchDialogOpen(false);
  }, [props.workspaceId]);

  function toggleCalendarSidebar() {
    if (window.matchMedia("(max-width: 900px)").matches) {
      setCalendarSidebarCollapsed(false);
      setMobileSidebar(true);
      return;
    }
    setCalendarSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      window.localStorage.setItem(CALENDAR_SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  useEffect(() => {
    setVisibleCalendarIds(new Set([
      "inbox",
      ...props.bundle.labels.map((label) => label.id),
    ]));
  }, [props.workspaceId]);

  const calendarSection = appSection === "calendar";
  const dialogSection = appSection === "calendar" || appSection === "mindmap";

  return (
    <main
      className={clsx(
        "app-shell",
        "task-section",
        appSection === "calendar" && "calendar-section",
        appSection === "mindmap" && "mind-map-section",
        calendarSection && calendarSidebarCollapsed && "calendar-sidebar-collapsed",
        appSection === "tasks" && selectedTask && "detail-open",
      )}
      style={{
        "--sidebar-width": `${calendarSection ? calendarSidebarWidth : sidebarWidth}px`,
        "--detail-width": `${detailWidth}px`,
      } as React.CSSProperties}
    >
      <NavigationRail
        activeSection={appSection}
        online={props.online}
        userName={props.currentUserName}
        workspaces={props.workspaces}
        workspaceId={props.workspaceId}
        notifications={props.notifications}
        notificationsLoading={props.notificationsLoading}
        onWorkspaceChange={props.onWorkspaceChange}
        onCreateWorkspace={() => setCreateWorkspaceDialogOpen(true)}
        onSearch={() => setSearchDialogOpen(true)}
        onSectionChange={(section) => {
          setAppSection(section);
          setSelectedTaskId(null);
          setMobileSidebar(false);
          setMindMapCreateLabel(null);
        }}
        onSettings={() => setSettingsDialogOpen(true)}
        onMarkNotificationRead={props.onMarkNotificationRead}
        onMarkAllNotificationsRead={props.onMarkAllNotificationsRead}
        onOpenNotificationTask={(taskId) => {
          setAppSection("tasks");
          setSmartView("all");
          setSelectedLabelId(null);
          setSelectedTaskId(taskId);
        }}
        onSignOut={props.onSignOut}
      />
      {appSection === "tasks" ? <Sidebar
        openMobile={mobileSidebar}
        bundle={props.bundle}
        currentUserId={props.currentUserId}
        online={props.online}
        smartView={smartView}
        selectedLabelId={selectedLabelId}
        onCloseMobile={() => setMobileSidebar(false)}
        onSmartView={(view) => {
          setSmartView(view);
          setSelectedLabelId(null);
          setSelectedTaskId(null);
        }}
        onLabel={(labelId) => {
          setSelectedLabelId(labelId);
          setSelectedTaskId(null);
        }}
        onCreateLabel={props.onCreateLabel}
        onSaveLabelAccess={props.onSaveLabelAccess}
        onUpdateLabel={props.onUpdateLabel}
        onDeleteLabel={props.onDeleteLabel}
        onMergeLabel={props.onMergeLabel}
        onMoveLabelToInbox={props.onMoveLabelToInbox}
      /> : appSection === "calendar" && !calendarSidebarCollapsed && <CalendarSidebar
        openMobile={mobileSidebar}
        bundle={props.bundle}
        visibleCalendarIds={visibleCalendarIds}
        onCloseMobile={() => setMobileSidebar(false)}
        onToggleCalendar={(id) => setVisibleCalendarIds((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        })}
        onShowAll={() => setVisibleCalendarIds((current) => {
          const ids = ["inbox", ...props.bundle.labels.map((label) => label.id)];
          return ids.every((id) => current.has(id)) ? new Set() : new Set(ids);
        })}
        visibleDate={calendarVisibleDate}
        dateTimePreferences={props.dateTimePreferences}
        onSelectDate={(date) => setCalendarNavigationDate(new Date(date))}
      />}
      {(appSection === "tasks" || (calendarSection && !calendarSidebarCollapsed)) && <PanelResizeHandle
        label="调整侧边栏宽度"
        value={calendarSection ? calendarSidebarWidth : sidebarWidth}
        min={SIDEBAR_MIN_WIDTH}
        max={SIDEBAR_MAX_WIDTH}
        direction={1}
        className="sidebar-resize-handle"
        onResize={calendarSection ? setCalendarSidebarWidth : setSidebarWidth}
      />}
      <section className="workspace-main">
        {appSection === "tasks" ? <TaskWorkspace
          bundle={props.bundle}
          workspaceId={props.workspaceId}
          currentUserId={props.currentUserId}
          smartView={smartView}
          selectedLabelId={selectedLabelId}
          selectedTaskId={selectedTaskId}
          online={props.online}
          now={now}
          dateTimePreferences={props.dateTimePreferences}
          onMenu={() => setMobileSidebar(true)}
          onSearch={() => setSearchDialogOpen(true)}
          onSelectTask={setSelectedTaskId}
          onCreateTask={props.onCreateTask}
          onUpdateTask={props.onUpdateTask}
          onToggleSubtask={props.onToggleSubtask}
          onSaveLabelAccess={props.onSaveLabelAccess}
          onSaveTaskListPreference={props.onSaveTaskListPreference}
          onCreateTaskSection={props.onCreateTaskSection}
          onUpdateTaskSection={props.onUpdateTaskSection}
          onDeleteTaskSection={props.onDeleteTaskSection}
          onSetTaskListOrder={props.onSetTaskListOrder}
        /> : appSection === "calendar" ? <CalendarWorkspace
          bundle={props.bundle}
          visibleCalendarIds={visibleCalendarIds}
          dateTimePreferences={props.dateTimePreferences}
          onSelectTask={setSelectedTaskId}
          sidebarVisible={!calendarSidebarCollapsed}
          onToggleSidebar={toggleCalendarSidebar}
          navigationDate={calendarNavigationDate}
          onVisibleDateChange={(date) => setCalendarVisibleDate((current) =>
            current.getTime() === date.getTime() ? current : new Date(date))}
        /> : <MindMapWorkspace
          workspaceId={props.workspaceId}
          bundle={props.bundle}
          dateTimePreferences={props.dateTimePreferences}
          online={props.online}
          onSelectTask={setSelectedTaskId}
          onCreateTask={props.onCreateTask}
          onUpdateTask={props.onUpdateTask}
          onToggleTaskLabel={props.onToggleTaskLabel}
          onDeleteLabel={props.onDeleteLabel}
          onRequestCreateLabel={(parentId) => setMindMapCreateLabel({ parentId })}
        />}
      </section>
      {appSection === "tasks" && selectedTask && (
        <>
          <PanelResizeHandle
            label="调整详情面板宽度"
            value={detailWidth}
            min={DETAIL_MIN_WIDTH}
            max={DETAIL_MAX_WIDTH}
            direction={-1}
            className="detail-resize-handle"
            onResize={setDetailWidth}
          />
          <TaskDetailPanel
            task={selectedTask}
            bundle={props.bundle}
            currentUserId={props.currentUserId}
            online={props.online}
            editable={selectedTaskEditable}
            attachmentService={props.attachmentService}
            now={now}
            dateTimePreferences={props.dateTimePreferences}
            onClose={() => setSelectedTaskId(null)}
            onUpdate={(patch) => props.onUpdateTask(selectedTask.id, patch)}
            onSaveSchedule={(patch, schedule) =>
              props.onSaveTaskSchedule(selectedTask.id, patch, schedule)}
            onLoadAssignees={() => props.onLoadTaskAssignees(selectedTask.id)}
            onAssign={(assigneeId) =>
              props.onAssignTask(selectedTask.id, assigneeId)}
            onToggleLabel={props.onToggleTaskLabel}
            onCreateSubtask={(title) => props.onCreateSubtask(selectedTask.id, title)}
            onToggleSubtask={props.onToggleSubtask}
            onUpdateSubtask={props.onUpdateSubtask}
            onDeleteSubtask={props.onDeleteSubtask}
            commentsRevision={props.commentsRevision}
            activityRevision={props.activityRevision}
            onLoadActivity={(cursor) => props.onLoadTaskActivity(selectedTask.id, cursor)}
            onLoadComments={() => props.onLoadTaskComments(selectedTask.id)}
            onLoadCommentCandidates={() => props.onLoadCommentCandidates(selectedTask.id)}
            onCreateComment={(input) => props.onCreateComment(selectedTask.id, input)}
            onUpdateComment={props.onUpdateComment}
            onDeleteComment={props.onDeleteComment}
          />
        </>
      )}
      {dialogSection && selectedTask && (
        <TaskDetailDialog
          open
          task={selectedTask}
          bundle={props.bundle}
          currentUserId={props.currentUserId}
          online={props.online}
          editable={selectedTaskEditable}
          attachmentService={props.attachmentService}
          now={now}
          dateTimePreferences={props.dateTimePreferences}
          onClose={() => setSelectedTaskId(null)}
          onUpdate={(patch) => props.onUpdateTask(selectedTask.id, patch)}
          onSaveSchedule={(patch, schedule) =>
            props.onSaveTaskSchedule(selectedTask.id, patch, schedule)}
          onLoadAssignees={() => props.onLoadTaskAssignees(selectedTask.id)}
          onAssign={(assigneeId) => props.onAssignTask(selectedTask.id, assigneeId)}
          onToggleLabel={props.onToggleTaskLabel}
          onCreateSubtask={(title) => props.onCreateSubtask(selectedTask.id, title)}
          onToggleSubtask={props.onToggleSubtask}
          onUpdateSubtask={props.onUpdateSubtask}
          onDeleteSubtask={props.onDeleteSubtask}
          commentsRevision={props.commentsRevision}
          activityRevision={props.activityRevision}
          onLoadActivity={(cursor) => props.onLoadTaskActivity(selectedTask.id, cursor)}
          onLoadComments={() => props.onLoadTaskComments(selectedTask.id)}
          onLoadCommentCandidates={() => props.onLoadCommentCandidates(selectedTask.id)}
          onCreateComment={(input) => props.onCreateComment(selectedTask.id, input)}
          onUpdateComment={props.onUpdateComment}
          onDeleteComment={props.onDeleteComment}
        />
      )}
      {mindMapCreateLabel && (
        <LabelEditorDialog
          bundle={props.bundle}
          currentUserId={props.currentUserId}
          parentId={mindMapCreateLabel.parentId}
          online={props.online}
          onClose={() => setMindMapCreateLabel(null)}
          onCreate={props.onCreateLabel}
        />
      )}
      <TaskSearchDialog
        open={searchDialogOpen}
        onOpenChange={setSearchDialogOpen}
        bundle={props.bundle}
        onSelectTask={(taskId) => {
          setSmartView("all");
          setSelectedLabelId(null);
          setSelectedTaskId(taskId);
          setSearchDialogOpen(false);
        }}
      />
      <SettingsDialog
        open={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        userId={props.currentUserId}
        userName={props.currentUserName}
        email={props.currentUserEmail}
        phone={props.currentUserPhone}
        avatarUrl={
          props.bundle.members.find((member) => member.user_id === props.currentUserId)
            ?.profile?.avatar_url ?? null
        }
        workspace={workspace}
        workspaces={props.workspaces}
        currentWorkspaceId={props.workspaceId}
        bundle={props.bundle}
        workspaceName={workspace.name}
        online={props.online}
        onLoadInviteLink={props.onLoadInviteLink}
        onEnableInviteLink={props.onEnableInviteLink}
        onUpdateInviteLinkRole={props.onUpdateInviteLinkRole}
        onDisableInviteLink={props.onDisableInviteLink}
        onCopyInviteLink={props.onCopyInviteLink}
        onUpdateMemberRole={props.onUpdateMemberRole}
        onCreateUserGroup={props.onCreateUserGroup}
        onUpdateUserGroup={props.onUpdateUserGroup}
        onDeleteUserGroup={props.onDeleteUserGroup}
        onUpdateWorkspace={props.onUpdateWorkspace}
        onDeleteWorkspace={props.onDeleteWorkspace}
        onUpdateDisplayName={props.onUpdateDisplayName}
        onUpdateAvatar={props.onUpdateAvatar}
        onUpdateEmail={props.onUpdateEmail}
        onDeleteAccount={props.onDeleteAccount}
        dateTimePreferences={props.dateTimePreferences}
        onUpdateDateTimePreferences={props.onUpdateDateTimePreferences}
        onNotice={props.onNotice}
      />
      <CreateWorkspaceDialog
        open={createWorkspaceDialogOpen}
        onOpenChange={setCreateWorkspaceDialogOpen}
        online={props.online}
        ownedCount={props.workspaces.filter((item) => item.role === "owner").length}
        limit={props.quota.workspace_limit}
        onCreate={props.onCreateWorkspace}
        onCheckSlug={props.onCheckWorkspaceSlug}
      />
      {props.notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{props.notice}</span>
          <button aria-label="关闭提示" onClick={props.onDismissNotice}><X size={15} /></button>
        </div>
      )}
    </main>
  );
}

function NavigationRail({
  activeSection,
  online,
  userName,
  workspaces,
  workspaceId,
  notifications,
  notificationsLoading,
  onWorkspaceChange,
  onCreateWorkspace,
  onSearch,
  onSectionChange,
  onSettings,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onOpenNotificationTask,
  onSignOut,
}: {
  activeSection: AppSection;
  online: boolean;
  userName: string;
  workspaces: Workspace[];
  workspaceId: string;
  notifications: AppNotification[];
  notificationsLoading: boolean;
  onWorkspaceChange: (id: string) => void;
  onCreateWorkspace: () => void;
  onSearch: () => void;
  onSectionChange: (section: AppSection) => void;
  onSettings: () => void;
  onMarkNotificationRead: (notificationId: string) => Promise<void>;
  onMarkAllNotificationsRead: () => Promise<void>;
  onOpenNotificationTask: (taskId: string) => void;
  onSignOut: () => unknown;
}) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
        setWorkspaceMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  const closeProfileMenu = () => {
    setProfileMenuOpen(false);
    setWorkspaceMenuOpen(false);
  };

  return (
    <nav className="navigation-rail" aria-label="主导航">
      <div className="rail-drag-space" />
      <div className="profile-menu-anchor" ref={profileMenuRef}>
        <button
          className="rail-avatar"
          aria-label={`${userName}的账户菜单`}
          aria-haspopup="menu"
          aria-expanded={profileMenuOpen}
          onClick={() => {
            setProfileMenuOpen((open) => !open);
            setWorkspaceMenuOpen(false);
          }}
        >
          {initials(userName)}
        </button>
        {profileMenuOpen && (
          <div className="profile-menu" role="menu" aria-label="账户菜单">
            <button
              className="profile-menu-item"
              role="menuitem"
              aria-expanded={workspaceMenuOpen}
              onClick={() => setWorkspaceMenuOpen((open) => !open)}
            >
              <ChevronsUpDown />
              <span>切换团队</span>
              <ChevronRight className={clsx("profile-menu-chevron", workspaceMenuOpen && "open")} />
            </button>
            {workspaceMenuOpen && (
              <div className="profile-workspace-list" role="menu" aria-label="选择团队">
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    className={clsx("profile-workspace-item", workspace.id === workspaceId && "active")}
                    role="menuitemradio"
                    aria-checked={workspace.id === workspaceId}
                    onClick={() => {
                      onWorkspaceChange(workspace.id);
                      closeProfileMenu();
                    }}
                  >
                    <span className="workspace-initial">{initials(workspace.name).slice(0, 1)}</span>
                    <span>{workspace.name}</span>
                    {workspace.id === workspaceId && <Check />}
                  </button>
                ))}
                <div className="profile-workspace-separator" />
                <button
                  className="profile-workspace-create"
                  type="button"
                  role="menuitem"
                  disabled={!online}
                  onClick={() => {
                    closeProfileMenu();
                    onCreateWorkspace();
                  }}
                >
                  <Plus />
                  <span>创建团队</span>
                </button>
              </div>
            )}
            <button
              className="profile-menu-item"
              role="menuitem"
              onClick={() => {
                closeProfileMenu();
                onSettings();
              }}
            >
              <Settings />
              <span>设置</span>
            </button>
            <div className="profile-menu-separator" />
            <button
              className="profile-menu-item danger"
              role="menuitem"
              onClick={() => {
                closeProfileMenu();
                void onSignOut();
              }}
            >
              <LogOut />
              <span>退出登录</span>
            </button>
          </div>
        )}
      </div>
      <button
        className={clsx("rail-button", activeSection === "tasks" && "active")}
        aria-label="任务"
        aria-pressed={activeSection === "tasks"}
        onClick={() => onSectionChange("tasks")}
      >
        <CheckCircle2 />
      </button>
      <button
        className={clsx("rail-button", activeSection === "calendar" && "active")}
        aria-label="日历"
        aria-pressed={activeSection === "calendar"}
        onClick={() => onSectionChange("calendar")}
      >
        <CalendarDays />
      </button>
      <button
        className={clsx("rail-button", activeSection === "mindmap" && "active")}
        aria-label="思维导图"
        aria-pressed={activeSection === "mindmap"}
        onClick={() => onSectionChange("mindmap")}
      >
        <Workflow />
      </button>
      <button className="rail-button" aria-label="搜索" onClick={onSearch}>
        <Search />
      </button>
      <div className="rail-spacer" />
      <div className={clsx("connection-dot", !online && "offline")} title={online ? "在线" : "离线"} />
      <NotificationBell
        notifications={notifications}
        loading={notificationsLoading}
        online={online}
        onRead={onMarkNotificationRead}
        onReadAll={onMarkAllNotificationsRead}
        onOpenTask={onOpenNotificationTask}
      />
    </nav>
  );
}

function TaskSearchDialog({
  open,
  onOpenChange,
  bundle,
  onSelectTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bundle: WorkspaceBundle;
  onSelectTask: (taskId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(
    () => searchTasks(bundle.tasks, query),
    [bundle.tasks, query],
  );
  const hasQuery = Boolean(query.trim());

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay task-search-overlay" />
        <Dialog.Content className="dialog-content task-search-dialog">
          <Dialog.Title className="sr-only">搜索任务</Dialog.Title>
          <Dialog.Description className="sr-only">
            搜索当前团队空间中的任务标题和描述
          </Dialog.Description>
          <div className="task-search-header">
            <Search aria-hidden="true" />
            <input
              aria-label="搜索任务"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索"
              autoFocus
            />
            <Dialog.Close className="task-search-close" aria-label="关闭搜索">
              <X />
            </Dialog.Close>
          </div>
          <div className="task-search-body">
            {!hasQuery ? (
              <div className="task-search-empty">
                <SearchBinoculars />
                <p>输入关键词即可搜索</p>
              </div>
            ) : results.length === 0 ? (
              <div className="task-search-empty task-search-no-results">
                <Search aria-hidden="true" />
                <strong>未找到相关任务</strong>
                <p>换个关键词试试</p>
              </div>
            ) : (
              <section className="task-search-results" aria-label="任务搜索结果">
                <header>
                  <span>任务</span>
                  <em>{results.length}</em>
                </header>
                <div className="task-search-result-list">
                  {results.map((task) => {
                    const labels = bundle.labels.filter((label) =>
                      task.label_ids.includes(label.id),
                    );
                    return (
                      <button
                        key={task.id}
                        className="task-search-result"
                        aria-label={`打开${task.kind === "note" ? "笔记" : "任务"}：${task.title}`}
                        onClick={() => onSelectTask(task.id)}
                      >
                        <span
                          className={clsx(
                            "task-search-status",
                            task.kind === "note" ? "note" : task.status,
                          )}
                          aria-hidden="true"
                        >
                          {task.kind === "note" ? (
                            <NotebookPen />
                          ) : task.status === "completed" ? (
                            <Check />
                          ) : task.status === "cancelled" ? (
                            <Archive />
                          ) : (
                            <Circle />
                          )}
                        </span>
                        <span className="task-search-result-title">{task.title}</span>
                        {labels.length > 0 && (
                          <span className="task-search-result-labels">
                            {labels.slice(0, 2).map((label) => (
                              <span key={label.id}>
                                <i
                                  style={{ backgroundColor: label.color }}
                                  aria-hidden="true"
                                />
                                {label.name}
                              </span>
                            ))}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SearchBinoculars() {
  return (
    <svg
      className="task-search-illustration"
      viewBox="0 0 160 116"
      role="img"
      aria-label="搜索任务"
    >
      <path
        d="M44 44 58 30l17 7 10-1 17-6 14 14 9 40-20 9-12-25H67L55 93l-20-9 9-40Z"
        fill="#f7f8fb"
        stroke="#20345f"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="m35 72 20 8-5 13-21-9 6-12Zm90 0-20 8 5 13 21-9-6-12Z" fill="#4772fa" />
      <circle cx="64" cy="52" r="16" fill="#fff" stroke="#20345f" strokeWidth="2" />
      <circle cx="101" cy="52" r="16" fill="#fff" stroke="#20345f" strokeWidth="2" />
      <circle cx="64" cy="52" r="11" fill="#20345f" />
      <circle cx="101" cy="52" r="11" fill="#4772fa" />
      <path d="M79 49c3-3 6-3 9 0" fill="none" stroke="#20345f" strokeWidth="2" />
      <path d="M95 82c1 15 5 24 13 25 12 2 17-11 13-25" fill="none" stroke="#20345f" strokeDasharray="2 2" />
      <path d="m29 40 2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4Zm109 8 1 3 3 1-3 2-1 3-2-3-3-2 3-1 2-3Zm-68 52 2 4 4 2-4 2-2 4-2-4-4-2 4-2 2-4Z" fill="#20345f" />
    </svg>
  );
}

function Sidebar({
  openMobile,
  bundle,
  currentUserId,
  online,
  smartView,
  selectedLabelId,
  onCloseMobile,
  onSmartView,
  onLabel,
  onCreateLabel,
  onSaveLabelAccess,
  onUpdateLabel,
  onDeleteLabel,
  onMergeLabel,
  onMoveLabelToInbox,
}: {
  openMobile: boolean;
  bundle: WorkspaceBundle;
  currentUserId: string;
  online: boolean;
  smartView: SmartView;
  selectedLabelId: string | null;
  onCloseMobile: () => void;
  onSmartView: (view: SmartView) => void;
  onLabel: (id: string) => void;
  onCreateLabel: WorkspaceAppProps["onCreateLabel"];
  onSaveLabelAccess: WorkspaceAppProps["onSaveLabelAccess"];
  onUpdateLabel: WorkspaceAppProps["onUpdateLabel"];
  onDeleteLabel: WorkspaceAppProps["onDeleteLabel"];
  onMergeLabel: WorkspaceAppProps["onMergeLabel"];
  onMoveLabelToInbox: WorkspaceAppProps["onMoveLabelToInbox"];
}) {
  const [creatingLabel, setCreatingLabel] = useState<{ parentId: string | null } | null>(null);
  const [editingLabel, setEditingLabel] = useState<Label | null>(null);
  const [mergingLabel, setMergingLabel] = useState<Label | null>(null);
  const [menu, setMenu] = useState<{ label: Label; x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [parentOverrides, setParentOverrides] = useState<Record<string, string | null>>({});
  const [menuError, setMenuError] = useState("");
  const [movingToInbox, setMovingToInbox] = useState(false);
  const openTasks = bundle.tasks.filter(isActiveTask);
  const labels = bundle.labels
    .map((label) => Object.hasOwn(parentOverrides, label.id)
      ? { ...label, parent_id: parentOverrides[label.id] }
      : label
    );
  const countForLabel = (labelId: string) =>
    openTasks.filter((task) => task.label_ids.includes(labelId)).length;

  function descendantsOf(labelId: string) {
    const result = new Set<string>();
    const visit = (parentId: string) => {
      labels.filter((label) => label.parent_id === parentId).forEach((label) => {
        result.add(label.id);
        visit(label.id);
      });
    };
    visit(labelId);
    return result;
  }

  function moveLabel(sourceId: string, targetId: string | null) {
    const source = labels.find((label) => label.id === sourceId);
    if (
      !source
      || source.parent_id === targetId
      || sourceId === targetId
      || (targetId !== null && descendantsOf(sourceId).has(targetId))
    ) return;
    setParentOverrides((current) => ({ ...current, [sourceId]: targetId }));
    if (targetId) {
      setCollapsed((current) => ({ ...current, [targetId]: false }));
    }
    void onUpdateLabel(sourceId, {
      parent_id: targetId,
      inherit_permissions: targetId !== null,
    }).then(() => {
      setParentOverrides((current) => {
        const next = { ...current };
        delete next[sourceId];
        return next;
      });
    }).catch(() => {
      setParentOverrides((current) => {
        const next = { ...current };
        delete next[sourceId];
        return next;
      });
    });
  }

  return (
    <>
      {openMobile && <button className="sidebar-scrim" onClick={onCloseMobile} aria-label="关闭侧栏" />}
      <aside className={clsx("sidebar", openMobile && "mobile-open")}>
        <div className="sidebar-list">
          <SidebarItem
            active={!selectedLabelId && smartView === "all"}
            icon={<LayoutList />}
            label="所有"
            count={openTasks.length}
            onClick={() => onSmartView("all")}
          />
          <SidebarItem
            active={!selectedLabelId && smartView === "today"}
            icon={<CalendarDays />}
            label="今天"
            count={openTasks.filter((task) => task.due_at && isSameDay(new Date(task.due_at), new Date())).length}
            onClick={() => onSmartView("today")}
          />
          <SidebarItem
            active={!selectedLabelId && smartView === "assigned"}
            icon={<UserRound />}
            label="指派给我"
            onClick={() => onSmartView("assigned")}
          />
          <SidebarItem
            active={!selectedLabelId && smartView === "inbox"}
            icon={<Inbox />}
            label="收集箱"
            count={openTasks.filter((task) => task.label_ids.length === 0).length}
            onClick={() => onSmartView("inbox")}
          />
        </div>
        <div className="sidebar-section-header">
          <span>标签</span>
          <button
            aria-label="新建标签"
            disabled={!online}
            onClick={() => setCreatingLabel({ parentId: null })}
          ><Plus /></button>
        </div>
        <div className="label-tree">
          {draggingId && (
            <div
              className={clsx(
                "label-root-drop-zone",
                dropTargetId === ROOT_LABEL_DROP_TARGET && "active",
              )}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTargetId(ROOT_LABEL_DROP_TARGET);
              }}
              onDragLeave={() => {
                if (dropTargetId === ROOT_LABEL_DROP_TARGET) setDropTargetId(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = draggingId || event.dataTransfer.getData("text/plain");
                if (sourceId) moveLabel(sourceId, null);
                setDraggingId(null);
                setDropTargetId(null);
              }}
            >
              移至顶层
            </div>
          )}
          <LabelTree
            labels={labels}
            canManageLabel={(labelId) => currentLabelPermissionLevel(bundle, labelId) >= 2}
            selectedId={selectedLabelId}
            countForLabel={countForLabel}
            onSelect={onLabel}
            onContext={(label, x, y) => {
              setMenuError("");
              setMenu({
                label,
                x: Math.min(x, window.innerWidth - 294),
                y: Math.min(y, window.innerHeight - 360),
              });
            }}
            collapsed={collapsed}
            onToggle={(labelId) =>
              setCollapsed((current) => ({ ...current, [labelId]: !current[labelId] }))
            }
            draggingId={draggingId}
            dropTargetId={dropTargetId}
            onDragStart={setDraggingId}
            onDragEnd={() => {
              setDraggingId(null);
              setDropTargetId(null);
            }}
            onDragOver={setDropTargetId}
            onDrop={(targetId) => {
              if (draggingId) moveLabel(draggingId, targetId);
              setDraggingId(null);
              setDropTargetId(null);
            }}
          />
        </div>
      </aside>
      {menu && (
        <>
          <button
            className="label-menu-scrim"
            aria-label="关闭标签菜单"
            onClick={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="label-context-menu"
            role="menu"
            style={{ left: menu.x, top: menu.y }}
          >
            <button role="menuitem" onClick={() => {
              setEditingLabel(menu.label);
              setMenu(null);
            }}>编辑</button>
            <button role="menuitem" onClick={() => {
              const siblings = labels.filter((label) => label.parent_id === menu.label.parent_id);
              const firstPosition = Math.min(...siblings.map((label) => label.position), 0);
              void onUpdateLabel(menu.label.id, { position: firstPosition - 1 });
              setMenu(null);
            }}>置顶</button>
            <button
              role="menuitem"
              disabled={!online}
              onClick={() => {
                setCreatingLabel({ parentId: menu.label.id });
                setCollapsed((current) => ({ ...current, [menu.label.id]: false }));
                setMenu(null);
              }}
            >添加子标签</button>
            <button role="menuitem" onClick={() => {
              setMergingLabel(menu.label);
              setMenu(null);
            }}>合并标签到…</button>
            <button
              role="menuitem"
              disabled={!online || movingToInbox}
              onClick={() => {
                const label = menu.label;
                if (!window.confirm(
                  `确定将标签“${label.name}”移至收集箱吗？此标签会从关联任务中移除，其子标签会移至标签顶层。`,
                )) return;
                setMovingToInbox(true);
                setMenuError("");
                void onMoveLabelToInbox(label.id)
                  .then(() => {
                    setMenu(null);
                    onSmartView("inbox");
                  })
                  .catch((cause) => {
                    setMenuError(cause instanceof Error ? cause.message : "移至收集箱失败，请重试");
                  })
                  .finally(() => setMovingToInbox(false));
              }}
            >
              {movingToInbox ? "移动中…" : "移至收集箱"}
            </button>
            <button className="danger" role="menuitem" onClick={() => {
              const label = menu.label;
              setMenu(null);
              if (window.confirm(`确定删除标签“${label.name}”吗？其子标签也会被删除。`)) {
                void onDeleteLabel(label.id);
              }
            }}>删除</button>
            {menuError && <p className="label-menu-error" role="alert">{menuError}</p>}
          </div>
        </>
      )}
      {creatingLabel && (
        <LabelEditorDialog
          bundle={{ ...bundle, labels }}
          currentUserId={currentUserId}
          parentId={creatingLabel.parentId}
          online={online}
          onClose={() => setCreatingLabel(null)}
          onCreate={onCreateLabel}
        />
      )}
      {editingLabel && (
        <LabelEditorDialog
          label={editingLabel}
          bundle={{ ...bundle, labels }}
          currentUserId={currentUserId}
          parentId={editingLabel.parent_id}
          online={online}
          onClose={() => setEditingLabel(null)}
          onCreate={onCreateLabel}
          onSave={onSaveLabelAccess}
        />
      )}
      {mergingLabel && (
        <MergeLabelDialog
          source={mergingLabel}
          labels={labels.filter((label) => currentLabelPermissionLevel(bundle, label.id) >= 2)}
          online={online}
          onClose={() => setMergingLabel(null)}
          onMerge={onMergeLabel}
        />
      )}
    </>
  );
}

function LabelTree({
  labels,
  canManageLabel,
  selectedId,
  countForLabel,
  onSelect,
  onContext,
  collapsed,
  onToggle,
  draggingId,
  dropTargetId,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  parentId = null,
  depth = 0,
}: {
  labels: Label[];
  canManageLabel: (labelId: string) => boolean;
  selectedId: string | null;
  countForLabel: (id: string) => number;
  onSelect: (id: string) => void;
  onContext: (label: Label, x: number, y: number) => void;
  collapsed: Record<string, boolean>;
  onToggle: (labelId: string) => void;
  draggingId: string | null;
  dropTargetId: string | null;
  onDragStart: (labelId: string) => void;
  onDragEnd: () => void;
  onDragOver: (labelId: string) => void;
  onDrop: (labelId: string) => void;
  parentId?: string | null;
  depth?: number;
}) {
  const children = labels
    .filter((label) => label.parent_id === parentId)
    .sort((a, b) => a.position - b.position);
  return children.map((label) => {
    const manageable = canManageLabel(label.id);
    const hasChildren = labels.some((item) => item.parent_id === label.id);
    const isCollapsed = collapsed[label.id];
    return (
      <div
        key={label.id}
        className="label-tree-node"
        data-label-id={label.id}
      >
        <button
          className={clsx(
            "label-row",
            selectedId === label.id && "active",
            draggingId === label.id && "dragging",
            dropTargetId === label.id && draggingId !== label.id && "drop-target",
            label.id.startsWith("optimistic-") && "pending",
          )}
          data-label-id={label.id}
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={() => onSelect(label.id)}
          draggable={manageable && !label.id.startsWith("optimistic-")}
          onDragStart={(event) => {
            if (!manageable || label.id.startsWith("optimistic-")) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", label.id);
            onDragStart(label.id);
          }}
          onDragEnd={onDragEnd}
          onDragOver={(event) => {
            if (!manageable || label.id.startsWith("optimistic-")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDragOver(label.id);
          }}
          onDrop={(event) => {
            if (!manageable || label.id.startsWith("optimistic-")) return;
            event.preventDefault();
            onDrop(label.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!manageable || label.id.startsWith("optimistic-")) return;
            onContext(label, event.clientX, event.clientY);
          }}
        >
          <span
            className={clsx("label-type-icon", hasChildren && "label-group-icon")}
            onClick={hasChildren
              ? (event) => {
                  event.stopPropagation();
                  onToggle(label.id);
                }
              : undefined}
          >
            {hasChildren
              ? (isCollapsed ? <FolderClosed /> : <FolderOpen />)
              : <Tag />}
          </span>
          <span className="label-name">{label.name}</span>
          {label.kind === "private" && <LockKeyhole size={12} />}
          {hasExplicitLabelColor(label.color) && (
            <i
              className="label-color-dot"
              style={{ backgroundColor: label.color }}
              aria-hidden="true"
            />
          )}
          <span className="item-count">{countForLabel(label.id) || ""}</span>
        </button>
        {hasChildren && !isCollapsed && (
          <LabelTree
            labels={labels}
            canManageLabel={canManageLabel}
            selectedId={selectedId}
            countForLabel={countForLabel}
            onSelect={onSelect}
            onContext={onContext}
            collapsed={collapsed}
            onToggle={onToggle}
            draggingId={draggingId}
            dropTargetId={dropTargetId}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            parentId={label.id}
            depth={depth + 1}
          />
        )}
      </div>
    );
  });
}

function MergeLabelDialog({
  source,
  labels,
  online,
  onClose,
  onMerge,
}: {
  source: Label;
  labels: Label[];
  online: boolean;
  onClose: () => void;
  onMerge: WorkspaceAppProps["onMergeLabel"];
}) {
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const excludedIds = useMemo(() => {
    const result = new Set([source.id]);
    const visit = (parentId: string) => {
      labels.filter((label) => label.parent_id === parentId).forEach((label) => {
        result.add(label.id);
        visit(label.id);
      });
    };
    visit(source.id);
    return result;
  }, [labels, source.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!targetId || saving || !online) return;
    setSaving(true);
    setError("");
    try {
      await onMerge(source.id, targetId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "标签合并失败，请重试");
      setSaving(false);
    }
  }

  function options(parentId: string | null = null, depth = 0): ReactNode {
    return labels
      .filter((label) =>
        label.parent_id === parentId
        && !excludedIds.has(label.id)
        && !label.id.startsWith("optimistic-")
      )
      .sort((a, b) => a.position - b.position)
      .map((label) => (
        <div key={label.id}>
          <label
            className={clsx("merge-label-option", targetId === label.id && "selected")}
            style={{ paddingLeft: 18 + depth * 20 }}
          >
            <input
              type="radio"
              name="merge-target"
              value={label.id}
              checked={targetId === label.id}
              onChange={() => setTargetId(label.id)}
            />
            <Tag size={18} />
            <span>{label.name}</span>
            <i style={{ backgroundColor: label.color }} />
          </label>
          {options(label.id, depth + 1)}
        </div>
      ));
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content merge-label-dialog">
          <Dialog.Title>合并“{source.name}”到</Dialog.Title>
          <Dialog.Description>
            选择目标标签。任务将改用目标标签，当前标签的子标签也会移到目标标签下。
          </Dialog.Description>
          <form onSubmit={submit}>
            <div className="merge-label-tree" role="radiogroup" aria-label="目标标签">
              {options()}
            </div>
            {error && <p className="merge-label-error" role="alert">{error}</p>}
            <div className="merge-label-actions">
              <button type="button" className="button" onClick={onClose}>取消</button>
              <button
                type="submit"
                className="button primary"
                disabled={!online || saving || !targetId}
              >
                {saving ? "合并中…" : "合并标签"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LabelAccessScopeEditor({
  title,
  scope,
  selectedIds,
  bundle,
  currentUserId,
  creatorUserId,
  management,
  allowInherit,
  disabled,
  onScopeChange,
  onSelectedIdsChange,
}: {
  title: string;
  scope: LabelAccessScope;
  selectedIds: string[];
  bundle: WorkspaceBundle;
  currentUserId: string;
  creatorUserId: string;
  management?: boolean;
  allowInherit: boolean;
  disabled: boolean;
  onScopeChange: (scope: LabelAccessScope) => void;
  onSelectedIdsChange: (ids: string[]) => void;
}) {
  const options = scope === "users"
    ? bundle.members.map((member) => ({
        id: member.user_id,
        name: member.profile?.display_name ?? "团队成员",
        description: member.user_id === creatorUserId && management
          ? "创建者 · 始终可管理"
          : member.user_id === currentUserId ? "我"
          : member.role === "admin" ? "管理员" : member.role === "owner" ? "所有者" : "成员",
      }))
    : scope === "groups"
      ? bundle.userGroups.map((group) => ({
          id: group.id,
          name: group.name,
          description: `${bundle.userGroupMembers.filter((item) => item.group_id === group.id).length} 位成员`,
        }))
      : [];
  return (
    <fieldset className="label-access-scope">
      <legend>{title}</legend>
      <select
        value={scope}
        disabled={disabled}
        aria-label={`${title}范围`}
        onChange={(event) => {
          const next = event.target.value as LabelAccessScope;
          onScopeChange(next);
          onSelectedIdsChange(
            next === "users" && management ? [creatorUserId] : [],
          );
        }}
      >
        {allowInherit && <option value="inherit">继承父级</option>}
        <option value="all">所有用户</option>
        <option value="users">指定用户</option>
        <option value="groups">指定用户组</option>
      </select>
      {(scope === "users" || scope === "groups") && (
        <div className="label-access-options">
          {options.length === 0 ? <p>暂无可选{scope === "groups" ? "用户组" : "用户"}</p> : options.map((option) => {
            const checked = selectedIds.includes(option.id);
            const fixed = Boolean(management && scope === "users" && option.id === creatorUserId);
            return (
              <label key={option.id}>
                <input
                  type="checkbox"
                  checked={checked || fixed}
                  disabled={disabled || fixed}
                  onChange={(event) => onSelectedIdsChange(
                    event.target.checked
                      ? [...new Set([...selectedIds, option.id])]
                      : selectedIds.filter((id) => id !== option.id),
                  )}
                />
                <span><strong>{option.name}</strong><small>{option.description}</small></span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function LabelEditorDialog({
  label,
  bundle,
  currentUserId,
  parentId: initialParentId,
  online,
  onClose,
  onCreate,
  onSave,
}: {
  label?: Label;
  bundle: WorkspaceBundle;
  currentUserId: string;
  parentId: string | null;
  online: boolean;
  onClose: () => void;
  onCreate: WorkspaceAppProps["onCreateLabel"];
  onSave?: WorkspaceAppProps["onSaveLabelAccess"];
}) {
  const labels = bundle.labels;
  const initialAccessDefaults = newLabelAccessDefaults(labels, initialParentId);
  const initialViewIds = label?.view_scope === "users"
    ? bundle.labelUserAcls.filter((acl) => acl.label_id === label.id).map((acl) => acl.user_id)
    : label?.view_scope === "groups"
      ? bundle.labelGroupAcls.filter((acl) => acl.label_id === label.id).map((acl) => acl.group_id)
      : [];
  const initialManageIds = label?.manage_scope === "users"
    ? bundle.labelUserAcls.filter((acl) => acl.label_id === label.id && acl.permission === "edit").map((acl) => acl.user_id)
    : label?.manage_scope === "groups"
      ? bundle.labelGroupAcls.filter((acl) => acl.label_id === label.id && acl.permission === "edit").map((acl) => acl.group_id)
      : [];
  const [name, setName] = useState(label?.name ?? "");
  const [color, setColor] = useState(label?.color ?? DEFAULT_LABEL_COLOR);
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [kind, setKind] = useState<Label["kind"]>(
    label?.kind ?? initialAccessDefaults.kind,
  );
  const [viewScope, setViewScope] = useState<LabelAccessScope>(
    label?.view_scope ?? initialAccessDefaults.viewScope,
  );
  const [manageScope, setManageScope] = useState<LabelAccessScope>(
    label?.manage_scope ?? initialAccessDefaults.manageScope,
  );
  const [viewSubjectIds, setViewSubjectIds] = useState<string[]>(initialViewIds);
  const [manageSubjectIds, setManageSubjectIds] = useState<string[]>(
    initialManageIds.length > 0
      ? initialManageIds
      : label?.manage_scope === "groups" ? [] : [label?.created_by ?? currentUserId],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const normalizedName = name.trim();
  const customColorSelected = hasExplicitLabelColor(color)
    && !LABEL_COLORS.some((option) => option === color);
  const noneColorSelected = !hasExplicitLabelColor(color);
  const selectedScopeMissing = kind === "team" && (
    ((viewScope === "users" || viewScope === "groups") && viewSubjectIds.length === 0)
    || ((manageScope === "users" || manageScope === "groups") && manageSubjectIds.length === 0)
  );

  const parentOptions = useMemo(() => {
    const result: { id: string; name: string; depth: number }[] = [];
    const visit = (currentParentId: string | null, depth: number) => {
      labels
        .filter((label) =>
          label.parent_id === currentParentId
          && !label.id.startsWith("optimistic-")
        )
        .sort((a, b) => a.position - b.position)
        .forEach((label) => {
          result.push({
            id: label.id,
            name: `${"—".repeat(depth)}${depth > 0 ? " " : ""}${label.name}`,
            depth,
          });
          visit(label.id, depth + 1);
        });
    };
    visit(null, 0);
    return result;
  }, [labels]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!normalizedName || saving || !online || selectedScopeMissing) return;
    setSaving(true);
    setError("");
    try {
      const draft: LabelAccessDraft = {
        name: normalizedName,
        color,
        parentId,
        kind,
        viewScope,
        manageScope,
        viewSubjectIds: viewScope === "users" || viewScope === "groups" ? viewSubjectIds : [],
        manageSubjectIds: manageScope === "users" || manageScope === "groups" ? manageSubjectIds : [],
      };
      if (label && onSave) await onSave(label.id, draft);
      else await onCreate(draft);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `标签${label ? "保存" : "创建"}失败，请重试`);
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay edit-label-overlay" />
        <Dialog.Content className="dialog-content edit-label-dialog create-label-dialog">
          <Dialog.Close className="edit-label-close" aria-label={label ? "关闭编辑标签" : "关闭添加标签"}>
            <X />
          </Dialog.Close>
          <Dialog.Title>{label ? "编辑标签" : "添加标签"}</Dialog.Title>
          <form onSubmit={submit}>
            <label className="edit-label-name">
              <span className="sr-only">标签名称</span>
              <Tag className="edit-label-name-icon" aria-hidden="true" />
              <input
                value={name}
                maxLength={80}
                placeholder="名称"
                disabled={!online || saving}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </label>
            <fieldset className="label-color-field">
              <legend>颜色</legend>
              <div className="label-color-options">
                <label
                  className={clsx(
                    "label-color-option none-color",
                    noneColorSelected && "selected",
                  )}
                  title="无颜色"
                >
                  <input
                    type="radio"
                    name="create-label-color"
                    value={DEFAULT_LABEL_COLOR}
                    checked={noneColorSelected}
                    disabled={!online || saving}
                    onChange={() => setColor(DEFAULT_LABEL_COLOR)}
                  />
                  <span />
                </label>
                {LABEL_COLORS.map((option) => (
                  <label
                    key={option}
                    className={clsx("label-color-option", color === option && "selected")}
                    style={{ "--label-color": option } as React.CSSProperties}
                    title={option}
                  >
                    <input
                      type="radio"
                      name="create-label-color"
                      value={option}
                      checked={color === option}
                      disabled={!online || saving}
                      onChange={() => setColor(option)}
                    />
                    <span />
                  </label>
                ))}
                <label
                  className={clsx(
                    "label-color-option custom-color",
                    customColorSelected && "selected",
                  )}
                  style={{ "--label-color": color } as React.CSSProperties}
                  title="自定义颜色"
                >
                  <input
                    type="color"
                    name="custom-create-label-color"
                    value={hasExplicitLabelColor(color) ? color : "#6e75f4"}
                    disabled={!online || saving}
                    onChange={(event) => {
                      if (hasExplicitLabelColor(event.target.value)) {
                        setColor(event.target.value);
                      }
                    }}
                  />
                  <span />
                </label>
              </div>
            </fieldset>
            {!label && (
              <label className="edit-label-parent-field">
                <span>上级标签</span>
                <span className="edit-label-parent-select">
                  <select
                    aria-label="上级标签"
                    value={parentId ?? ""}
                    disabled={!online || saving}
                    onChange={(event) => {
                      const nextParentId = event.target.value || null;
                      const nextAccessDefaults = newLabelAccessDefaults(labels, nextParentId);
                      setParentId(nextParentId);
                      setKind(nextAccessDefaults.kind);
                      setViewScope(nextAccessDefaults.viewScope);
                      setManageScope(nextAccessDefaults.manageScope);
                      setViewSubjectIds([]);
                      setManageSubjectIds(nextParentId ? [] : [currentUserId]);
                    }}
                  >
                    <option value="">无</option>
                    {parentOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
              </label>
            )}
            <fieldset className="label-kind-field">
              <legend>标签属性</legend>
              <div>
                <label className={clsx(kind === "private" && "selected")}>
                  <input type="radio" name="label-kind" value="private" checked={kind === "private"}
                    disabled={!online || saving} onChange={() => setKind("private")} />
                  <LockKeyhole /><span><strong>私人标签</strong><small>仅创建者可见</small></span>
                </label>
                <label className={clsx(kind === "team" && "selected")}>
                  <input type="radio" name="label-kind" value="team" checked={kind === "team"}
                    disabled={!online || saving} onChange={() => setKind("team")} />
                  <Users /><span><strong>团队标签</strong><small>配置团队成员权限</small></span>
                </label>
              </div>
            </fieldset>
            {kind === "team" && (
              <div className="label-access-grid">
                <LabelAccessScopeEditor
                  title="可见用户"
                  scope={viewScope}
                  selectedIds={viewSubjectIds}
                  bundle={bundle}
                  currentUserId={currentUserId}
                  creatorUserId={label?.created_by ?? currentUserId}
                  allowInherit={Boolean(parentId)}
                  disabled={!online || saving}
                  onScopeChange={setViewScope}
                  onSelectedIdsChange={setViewSubjectIds}
                />
                <LabelAccessScopeEditor
                  title="可管理用户"
                  scope={manageScope}
                  selectedIds={manageSubjectIds}
                  bundle={bundle}
                  currentUserId={currentUserId}
                  creatorUserId={label?.created_by ?? currentUserId}
                  management
                  allowInherit={Boolean(parentId)}
                  disabled={!online || saving}
                  onScopeChange={setManageScope}
                  onSelectedIdsChange={setManageSubjectIds}
                />
                <p className="label-access-note">可管理用户自动拥有查看权限；团队空间所有者和管理员始终可管理。</p>
              </div>
            )}
            {selectedScopeMissing && <p className="edit-label-error">请至少选择一个对应的用户或用户组。</p>}
            {error && <p className="edit-label-error" role="alert">{error}</p>}
            {!online && <p className="edit-label-error">离线状态下不可编辑标签。</p>}
            <div className="edit-label-actions">
              <button type="button" className="button" onClick={onClose}>关闭</button>
              <button
                type="submit"
                className="button primary"
                disabled={!online || saving || !normalizedName || selectedScopeMissing}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EditLabelDialog({
  label,
  online,
  onClose,
  onUpdate,
}: {
  label: Label;
  online: boolean;
  onClose: () => void;
  onUpdate: WorkspaceAppProps["onUpdateLabel"];
}) {
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const normalizedName = name.trim();
  const changed = normalizedName !== label.name || color !== label.color;
  const customColorSelected = hasExplicitLabelColor(color)
    && !LABEL_COLORS.some((option) => option === color);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!normalizedName || !changed || saving || !online) return;
    setSaving(true);
    setError("");
    try {
      await onUpdate(label.id, { name: normalizedName, color });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "标签保存失败，请重试");
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay edit-label-overlay" />
        <Dialog.Content className="dialog-content edit-label-dialog">
          <Dialog.Close className="edit-label-close" aria-label="关闭编辑标签">
            <X />
          </Dialog.Close>
          <Dialog.Title>编辑标签</Dialog.Title>
          <form onSubmit={submit}>
            <label className="edit-label-name">
              <span className="sr-only">标签名称</span>
              <Tag className="edit-label-name-icon" aria-hidden="true" />
              <input
                value={name}
                maxLength={80}
                disabled={!online || saving}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </label>
            <fieldset className="label-color-field">
              <legend>颜色</legend>
              <div className="label-color-options">
                {LABEL_COLORS.map((option) => (
                  <label
                    key={option}
                    className={clsx("label-color-option", color === option && "selected")}
                    style={{ "--label-color": option } as React.CSSProperties}
                    title={option}
                  >
                    <input
                      type="radio"
                      name="label-color"
                      value={option}
                      checked={color === option}
                      disabled={!online || saving}
                      onChange={() => setColor(option)}
                    />
                    <span />
                  </label>
                ))}
                <label
                  className={clsx(
                    "label-color-option custom-color",
                    customColorSelected && "selected",
                  )}
                  style={{ "--label-color": color } as React.CSSProperties}
                  title="自定义颜色"
                >
                  <input
                    type="color"
                    name="custom-label-color"
                    value={hasExplicitLabelColor(color) ? color : "#6e75f4"}
                    disabled={!online || saving}
                    onChange={(event) => {
                      if (hasExplicitLabelColor(event.target.value)) {
                        setColor(event.target.value);
                      }
                    }}
                  />
                  <span />
                </label>
              </div>
            </fieldset>
            {error && <p className="edit-label-error" role="alert">{error}</p>}
            {!online && <p className="edit-label-error">离线状态下不可编辑标签。</p>}
            <div className="edit-label-actions">
              <button type="button" className="button" onClick={onClose}>关闭</button>
              <button
                type="submit"
                className="button primary"
                disabled={!online || saving || !normalizedName || !changed}
              >
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SidebarItem({
  active,
  icon,
  label,
  count,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className={clsx("sidebar-item", active && "active")} onClick={onClick}>
      {icon}
      <span>{label}</span>
      <span className="item-count">{count || ""}</span>
    </button>
  );
}

const QUICK_ADD_SETTINGS_KEY = "anttodo:quick-add-settings";
const TASK_SUBTASKS_COLLAPSED_KEY = "anttodo:task-subtasks-collapsed";

function readCollapsedTaskSubtasks(workspaceId: string) {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(`${TASK_SUBTASKS_COLLAPSED_KEY}:${workspaceId}`) ?? "[]",
    );
    return new Set(
      Array.isArray(value)
        ? value.filter((taskId): taskId is string => typeof taskId === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

function storeCollapsedTaskSubtasks(
  workspaceId: string,
  collapsedTaskIds: ReadonlySet<string>,
) {
  try {
    window.localStorage.setItem(
      `${TASK_SUBTASKS_COLLAPSED_KEY}:${workspaceId}`,
      JSON.stringify([...collapsedTaskIds]),
    );
  } catch {
    // A disabled or full local storage should not block task-list interaction.
  }
}

function readQuickAddSettings(workspaceId: string): {
  kind: TaskKind;
  priority: TaskPriority;
} {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(`${QUICK_ADD_SETTINGS_KEY}:${workspaceId}`) ?? "null",
    ) as { kind?: unknown; priority?: unknown } | null;
    const kind = value?.kind === "note" ? "note" : "todo";
    const priority = ["none", "low", "medium", "high"].includes(String(value?.priority))
      ? value?.priority as TaskPriority
      : "none";
    return { kind, priority };
  } catch {
    return { kind: "todo", priority: "none" };
  }
}

function storeQuickAddSettings(
  workspaceId: string,
  settings: { kind: TaskKind; priority: TaskPriority },
) {
  try {
    window.localStorage.setItem(
      `${QUICK_ADD_SETTINGS_KEY}:${workspaceId}`,
      JSON.stringify(settings),
    );
  } catch {
    // A disabled or full local storage should not block task creation.
  }
}

function QuickAddSettings({
  online,
  kind,
  priority,
  onKindChange,
  onPriorityChange,
}: {
  online: boolean;
  kind: TaskKind;
  priority: TaskPriority;
  onKindChange: (kind: TaskKind) => void;
  onPriorityChange: (priority: TaskPriority) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const priorityOptions: TaskPriority[] = ["high", "medium", "low", "none"];

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="quick-add-settings" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="quick-add-more"
        aria-label="快速新增设置"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!online}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown />
      </button>
      {open && (
        <div className="quick-add-menu" role="menu" aria-label="快速新增设置">
          <section className={clsx("quick-add-option-row", kind === "note" && "disabled")}>
            <span>优先级</span>
            <div role="radiogroup" aria-label="快速新增优先级">
              {priorityOptions.map((value) => {
                const option = getPriorityOption(value);
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={priority === value}
                    aria-label={option.label}
                    className={priority === value ? "selected" : undefined}
                    disabled={kind === "note"}
                    style={{ "--quick-option-color": option.color } as React.CSSProperties}
                    onClick={() => onPriorityChange(value)}
                  >
                    <Flag />
                  </button>
                );
              })}
            </div>
          </section>
          <section className="quick-add-option-row">
            <span>类型</span>
            <div role="radiogroup" aria-label="快速新增类型">
              <button
                type="button"
                role="radio"
                aria-checked={kind === "todo"}
                aria-label="待办"
                className={kind === "todo" ? "selected" : undefined}
                onClick={() => onKindChange("todo")}
              >
                <ListTodo />
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={kind === "note"}
                aria-label="笔记"
                className={kind === "note" ? "selected" : undefined}
                onClick={() => onKindChange("note")}
              >
                <NotebookPen />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function TaskWorkspace({
  bundle,
  workspaceId,
  currentUserId,
  smartView,
  selectedLabelId,
  selectedTaskId,
  online,
  now,
  dateTimePreferences,
  onMenu,
  onSearch,
  onSelectTask,
  onCreateTask,
  onUpdateTask,
  onToggleSubtask,
  onSaveLabelAccess,
  onSaveTaskListPreference,
  onCreateTaskSection,
  onUpdateTaskSection,
  onDeleteTaskSection,
  onSetTaskListOrder,
}: {
  bundle: WorkspaceBundle;
  workspaceId: string;
  currentUserId: string;
  smartView: SmartView;
  selectedLabelId: string | null;
  selectedTaskId: string | null;
  online: boolean;
  now: Date;
  onMenu: () => void;
  onSearch: () => void;
  onSelectTask: (id: string) => void;
  onCreateTask: WorkspaceAppProps["onCreateTask"];
  onUpdateTask: WorkspaceAppProps["onUpdateTask"];
  onToggleSubtask: WorkspaceAppProps["onToggleSubtask"];
  onSaveLabelAccess: WorkspaceAppProps["onSaveLabelAccess"];
  dateTimePreferences: DateTimePreferences;
  onSaveTaskListPreference: WorkspaceAppProps["onSaveTaskListPreference"];
  onCreateTaskSection: WorkspaceAppProps["onCreateTaskSection"];
  onUpdateTaskSection: WorkspaceAppProps["onUpdateTaskSection"];
  onDeleteTaskSection: WorkspaceAppProps["onDeleteTaskSection"];
  onSetTaskListOrder: WorkspaceAppProps["onSetTaskListOrder"];
}) {
  const [quickTitle, setQuickTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const initialQuickSettings = useMemo(
    () => readQuickAddSettings(workspaceId),
    [workspaceId],
  );
  const [quickKind, setQuickKind] = useState<TaskKind>(initialQuickSettings.kind);
  const [quickPriority, setQuickPriority] = useState<TaskPriority>(
    initialQuickSettings.priority,
  );
  const [labelSettingsOpen, setLabelSettingsOpen] = useState(false);
  const [collapsedTaskSubtasks, setCollapsedTaskSubtasks] = useState(
    () => readCollapsedTaskSubtasks(workspaceId),
  );
  const selectedLabel = bundle.labels.find((label) => label.id === selectedLabelId);
  const canManageSelectedLabel = !selectedLabel
    || currentLabelPermissionLevel(bundle, selectedLabel.id) >= 2;
  const canEditTask = (task: Task) =>
    currentTaskPermissionLevel(bundle, task, currentUserId) >= 2;
  const title = selectedLabel?.name ?? {
    all: "所有",
    today: "今天",
    assigned: "指派给我",
    inbox: "收集箱",
  }[smartView];
  const listKey = taskListKey(smartView, selectedLabelId);
  const preference = resolveTaskListPreference(bundle.taskListPreferences, listKey);
  const sections = useMemo(
    () => bundle.taskSections.filter((section) => section.list_key === listKey),
    [bundle.taskSections, listKey],
  );
  const placements = useMemo(
    () => bundle.taskPlacements.filter((placement) => placement.list_key === listKey),
    [bundle.taskPlacements, listKey],
  );
  const dragEnabled =
    online && canManageSelectedLabel
    && preference.grouping === "none" && preference.sort === "custom";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    setQuickKind(initialQuickSettings.kind);
    setQuickPriority(initialQuickSettings.priority);
  }, [initialQuickSettings]);

  useEffect(() => {
    setCollapsedTaskSubtasks(readCollapsedTaskSubtasks(workspaceId));
  }, [workspaceId]);

  function toggleTaskSubtasks(taskId: string) {
    setCollapsedTaskSubtasks((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      storeCollapsedTaskSubtasks(workspaceId, next);
      return next;
    });
  }

  function changeQuickKind(kind: TaskKind) {
    setQuickKind(kind);
    storeQuickAddSettings(workspaceId, { kind, priority: quickPriority });
  }

  function changeQuickPriority(priority: TaskPriority) {
    setQuickPriority(priority);
    storeQuickAddSettings(workspaceId, { kind: quickKind, priority });
  }

  const tasks = useMemo(() => {
    let result = bundle.tasks.filter((task) => !task.deleted_at);
    if (selectedLabelId) result = result.filter((task) => task.label_ids.includes(selectedLabelId));
    else if (smartView === "today") {
      result = result.filter((task) => task.due_at && isSameDay(new Date(task.due_at), new Date()));
    } else if (smartView === "assigned") {
      result = result.filter((task) => task.assignee_id === currentUserId);
    } else if (smartView === "inbox") {
      result = result.filter((task) => task.label_ids.length === 0);
    }
    return result;
  }, [bundle.tasks, currentUserId, selectedLabelId, smartView]);

  const groups = useMemo(
    () => groupTasks({
      tasks,
      grouping: preference.grouping,
      sort: preference.sort,
      direction: preference.direction,
      labels: bundle.labels,
      members: bundle.members,
      sections,
      placements,
      now,
      preferences: dateTimePreferences,
    }),
    [
      bundle.labels,
      bundle.members,
      dateTimePreferences,
      now,
      placements,
      preference.direction,
      preference.grouping,
      preference.sort,
      sections,
      tasks,
    ],
  );
  const completedTasks = useMemo(
    () => sortTasks(
      tasks.filter(isCompletedTask),
      preference.sort,
      preference.direction,
      bundle.labels,
      bundle.members,
      placements,
    ),
    [
      bundle.labels,
      bundle.members,
      placements,
      preference.direction,
      preference.sort,
      tasks,
    ],
  );

  async function savePreference(
    patch: Partial<Pick<TaskListPreference, "grouping" | "sort" | "direction" | "show_labels">>,
  ) {
    if (!online) return;
    await onSaveTaskListPreference({
      user_id: currentUserId,
      workspace_id: workspaceId,
      list_key: listKey,
      grouping: preference.grouping,
      sort: preference.sort,
      direction: preference.direction,
      show_labels: preference.show_labels,
      ...patch,
    });
  }

  async function submitQuickTask(event: FormEvent) {
    event.preventDefault();
    if (!quickTitle.trim() || !online) return;
    setBusy(true);
    try {
      const created = await onCreateTask({
        title: quickTitle.trim(),
        labelIds: selectedLabelId ? [selectedLabelId] : [],
        kind: quickKind,
        priority: quickKind === "note" ? "none" : quickPriority,
      });
      const createdId = typeof created === "object" && created && "id" in created
        ? String(created.id)
        : null;
      if (createdId && dragEnabled) {
        await onSetTaskListOrder(
          listKey,
          null,
          [createdId, ...(groups[0]?.tasks.map((task) => task.id) ?? [])],
        );
      }
      setQuickTitle("");
    } finally {
      setBusy(false);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    if (!dragEnabled || !event.over || event.active.id === event.over.id) return;
    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    const source = groups.find((group) => group.tasks.some((task) => task.id === activeId));
    const target = overId.startsWith("group:")
      ? groups.find((group) => `group:${group.id}` === overId)
      : groups.find((group) => group.tasks.some((task) => task.id === overId));
    if (!source || !target) return;

    if (source.id !== target.id) return;
    const from = source.tasks.findIndex((task) => task.id === activeId);
    const to = target.tasks.findIndex((task) => task.id === overId);
    if (from < 0 || to < 0) return;
    await onSetTaskListOrder(
      listKey,
      null,
      arrayMove(source.tasks, from, to).map((task) => task.id),
    );
  }

  return (
    <>
      <header className="content-header">
        <div className="header-title">
          <button className="mobile-menu" onClick={onMenu}><Menu /></button>
          <h1>{title}</h1>
          <span>{tasks.filter(isActiveTask).length}</span>
        </div>
        <div className="header-actions">
          <button
            className="icon-button mobile-search-button"
            aria-label="搜索"
            onClick={onSearch}
          >
            <Search />
          </button>
          <TaskViewMenu
            preference={preference}
            online={online}
            onChange={savePreference}
          />
          <LabelActionsMenu
            hasSelectedLabel={Boolean(selectedLabel)}
            canManageSelectedLabel={canManageSelectedLabel}
            showLabels={preference.show_labels}
            online={online}
            onOpenPermissions={() => setLabelSettingsOpen(true)}
            onToggleShowLabels={() =>
              void savePreference({ show_labels: !preference.show_labels })}
          />
        </div>
      </header>
      <form className="quick-add" onSubmit={submitQuickTask}>
        {quickKind === "note" ? <NotebookPen /> : <Plus />}
        <input
          value={quickTitle}
          onChange={(event) => setQuickTitle(event.target.value)}
          placeholder={online
            ? `添加${quickKind === "note" ? "笔记" : "任务"}至“${selectedLabel?.name ?? title}”`
            : "离线状态下不可新增任务"}
          disabled={!online || busy || !canManageSelectedLabel}
        />
        {quickTitle && <kbd>Enter</kbd>}
        <QuickAddSettings
          online={online && !busy}
          kind={quickKind}
          priority={quickPriority}
          onKindChange={changeQuickKind}
          onPriorityChange={changeQuickPriority}
        />
      </form>
      <div className="task-scroll">
        {!online && (
          <div className="offline-banner">
            <CloudOff size={16} />
            当前显示离线缓存，恢复网络后会自动刷新
          </div>
        )}
        {groups.length === 0 && completedTasks.length === 0 ? (
          <div className="empty-state">
            <CheckCircle2 />
            <h2>这里很清爽</h2>
            <p>添加一个任务，或者换个标签看看。</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => void handleDragEnd(event)}
          >
            {groups.map((group) => (
              <TaskGroup
                key={group.id}
                id={group.id}
                title={group.title}
                tasks={group.tasks}
                labels={bundle.labels}
                members={bundle.members}
                selectedTaskId={selectedTaskId}
                online={online}
                now={now}
                showLabels={preference.show_labels}
                draggable={dragEnabled}
                collapsedTaskSubtasks={collapsedTaskSubtasks}
                canEditTask={canEditTask}
                onSelect={onSelectTask}
                onToggleSubtasks={toggleTaskSubtasks}
                onToggle={async (task) =>
                  onUpdateTask(task.id, {
                    status: task.status === "completed" ? "open" : "completed",
                    completed_at: task.status === "completed" ? null : new Date().toISOString(),
                  })
                }
                onToggleSubtask={onToggleSubtask}
              />
            ))}
          </DndContext>
        )}
        {completedTasks.length > 0 && (
          <TaskGroup
            id="completed"
            title="已完成"
            tasks={completedTasks}
            labels={bundle.labels}
            members={bundle.members}
            selectedTaskId={selectedTaskId}
            online={online}
            now={now}
            showLabels={preference.show_labels}
            collapsedTaskSubtasks={collapsedTaskSubtasks}
            onSelect={onSelectTask}
            onToggleSubtasks={toggleTaskSubtasks}
            canEditTask={canEditTask}
            onToggle={async (task) =>
              onUpdateTask(task.id, { status: "open", completed_at: null })}
            onToggleSubtask={onToggleSubtask}
          />
        )}
      </div>
      {selectedLabel && (
        labelSettingsOpen && <LabelEditorDialog
          label={selectedLabel}
          bundle={bundle}
          currentUserId={currentUserId}
          parentId={selectedLabel.parent_id}
          online={online}
          onClose={() => setLabelSettingsOpen(false)}
          onCreate={async () => undefined}
          onSave={onSaveLabelAccess}
        />
      )}
    </>
  );
}

function LabelActionsMenu({
  hasSelectedLabel,
  canManageSelectedLabel,
  showLabels,
  online,
  onOpenPermissions,
  onToggleShowLabels,
}: {
  hasSelectedLabel: boolean;
  canManageSelectedLabel: boolean;
  showLabels: boolean;
  online: boolean;
  onOpenPermissions: () => void;
  onToggleShowLabels: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="task-view-menu-anchor" ref={menuRef}>
      <button
        className="icon-button"
        aria-label={hasSelectedLabel ? "标签设置" : "更多操作"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis />
      </button>
      {open && (
        <div className="task-view-menu" role="menu" aria-label="标签设置">
          {hasSelectedLabel && canManageSelectedLabel && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenPermissions();
              }}
            >
              <span>设置权限</span>
            </button>
          )}
          <button
            role="menuitem"
            disabled={!online}
            onClick={() => {
              onToggleShowLabels();
              setOpen(false);
            }}
          >
            <span>{showLabels ? "隐藏标签" : "显示标签"}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function TaskViewMenu({
  preference,
  online,
  onChange,
}: {
  preference: Pick<TaskListPreference, "grouping" | "sort" | "direction">;
  online: boolean;
  onChange: (
    patch: Partial<Pick<TaskListPreference, "grouping" | "sort" | "direction">>,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"grouping" | "sort" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const groupingLabel = TASK_GROUPING_OPTIONS.find(
    (option) => option.value === preference.grouping,
  )?.label;
  const sortLabel = TASK_SORT_OPTIONS.find((option) => option.value === preference.sort)?.label;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setSubmenu(null);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function selectGrouping(grouping: TaskListGrouping) {
    await onChange({ grouping });
    setOpen(false);
    setSubmenu(null);
  }

  async function selectSort(sort: TaskListSort) {
    await onChange({ sort, direction: defaultSortDirection(sort) });
    setOpen(false);
    setSubmenu(null);
  }

  return (
    <div className="task-view-menu-anchor" ref={menuRef}>
      <button
        className="icon-button"
        aria-label="分组与排序"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setSubmenu(null);
        }}
      >
        <ArrowDownUp />
      </button>
      {open && (
        <div className="task-view-menu" role="menu" aria-label="分组与排序">
          <button
            role="menuitem"
            aria-expanded={submenu === "grouping"}
            onClick={() => setSubmenu((value) => value === "grouping" ? null : "grouping")}
          >
            <span>分组</span>
            <em>{groupingLabel}</em>
            <ChevronRight />
          </button>
          <button
            role="menuitem"
            aria-expanded={submenu === "sort"}
            onClick={() => setSubmenu((value) => value === "sort" ? null : "sort")}
          >
            <span>排序</span>
            <em>{sortLabel}</em>
            <ChevronRight />
          </button>
          {preference.sort !== "custom" && (
            <button
              role="menuitem"
              disabled={!online}
              onClick={() => void onChange({
                direction: preference.direction === "asc" ? "desc" : "asc",
              })}
            >
              {preference.direction === "asc" ? <ArrowUp /> : <ArrowDown />}
              <span>{preference.direction === "asc" ? "升序" : "降序"}</span>
            </button>
          )}
          {submenu === "grouping" && (
            <div className="task-view-submenu" role="menu" aria-label="分组方式">
              {TASK_GROUPING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={preference.grouping === option.value}
                  disabled={!online}
                  onClick={() => void selectGrouping(option.value)}
                >
                  <span>{option.label}</span>
                  {preference.grouping === option.value && <Check />}
                </button>
              ))}
            </div>
          )}
          {submenu === "sort" && (
            <div className="task-view-submenu" role="menu" aria-label="排序方式">
              {TASK_SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  role="menuitemradio"
                  aria-checked={preference.sort === option.value}
                  disabled={!online}
                  onClick={() => void selectSort(option.value)}
                >
                  <span>{option.label}</span>
                  {preference.sort === option.value && <Check />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskGroup({
  id,
  title,
  tasks,
  labels,
  members,
  selectedTaskId,
  online,
  now,
  showLabels = false,
  draggable = false,
  collapsedTaskSubtasks,
  editableSection,
  onRenameSection,
  onDeleteSection,
  onSelect,
  onToggle,
  onToggleSubtasks,
  onToggleSubtask,
  canEditTask,
}: {
  id: string;
  title: string;
  tasks: Task[];
  labels: Label[];
  members: Member[];
  selectedTaskId: string | null;
  online: boolean;
  now: Date;
  showLabels?: boolean;
  draggable?: boolean;
  collapsedTaskSubtasks: ReadonlySet<string>;
  editableSection?: TaskSection;
  onRenameSection?: (sectionId: string, name: string) => Promise<void>;
  onDeleteSection?: (sectionId: string) => Promise<void>;
  onSelect: (id: string) => void;
  onToggle: (task: Task) => Promise<void>;
  onToggleSubtasks: (taskId: string) => void;
  onToggleSubtask: WorkspaceAppProps["onToggleSubtask"];
  canEditTask: (task: Task) => boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title);
  const { setNodeRef, isOver } = useDroppable({
    id: `group:${id}`,
    disabled: !draggable,
  });
  const sectionSortable = useSortable({
    id: `section:${editableSection?.id ?? id}`,
    disabled: !draggable || !editableSection,
  });

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    const normalized = name.trim();
    if (!editableSection || !onRenameSection || !normalized) return;
    await onRenameSection(editableSection.id, normalized);
    setRenaming(false);
  }

  return (
    <section
      ref={(node) => {
        setNodeRef(node);
        sectionSortable.setNodeRef(node);
      }}
      className={clsx(
        "task-group",
        isOver && "drop-target",
        sectionSortable.isDragging && "section-dragging",
      )}
      data-group-id={id}
      style={{
        transform: CSS.Transform.toString(sectionSortable.transform),
        transition: sectionSortable.transition,
        zIndex: sectionSortable.isDragging ? 3 : undefined,
      }}
    >
      {title && (
        <div className="task-group-header">
          {editableSection && draggable && (
            <button
              className="task-section-drag-handle"
              aria-label={`拖动分组“${title}”`}
              {...sectionSortable.attributes}
              {...sectionSortable.listeners}
            >
              <GripVertical />
            </button>
          )}
          {renaming ? (
            <form className="task-section-rename" onSubmit={submitRename}>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                autoFocus
                onBlur={() => setRenaming(false)}
              />
            </form>
          ) : (
            <button
              className="task-group-collapse"
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed ? <ChevronRight /> : <ChevronDown />}
              <span>{title}</span>
              <em>{tasks.length}</em>
            </button>
          )}
          {editableSection && (
            <div className="task-section-actions">
              <button
                aria-label={`管理分组“${title}”`}
                aria-haspopup="menu"
                aria-expanded={sectionMenuOpen}
                onClick={() => setSectionMenuOpen((value) => !value)}
              >
                <Ellipsis />
              </button>
              {sectionMenuOpen && (
                <div className="task-section-menu" role="menu">
                  <button
                    role="menuitem"
                    onClick={() => {
                      setSectionMenuOpen(false);
                      setName(title);
                      setRenaming(true);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setSectionMenuOpen(false);
                      if (window.confirm(`删除分组“${title}”？任务会移至未分组。`)) {
                        void onDeleteSection?.(editableSection.id);
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {!collapsed && (
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              labels={labels}
              members={members}
              selected={selectedTaskId === task.id}
              online={online && canEditTask(task)}
              now={now}
              showLabels={showLabels}
              draggable={draggable && canEditTask(task)}
              subtasksCollapsed={collapsedTaskSubtasks.has(task.id)}
              onSelect={() => onSelect(task.id)}
              onToggleSubtasks={() => onToggleSubtasks(task.id)}
              onToggle={() => onToggle(task)}
              onToggleSubtask={onToggleSubtask}
            />
          ))}
        </SortableContext>
      )}
    </section>
  );
}

function TaskRow({
  task,
  labels,
  members,
  selected,
  online,
  now,
  showLabels = false,
  draggable = false,
  subtasksCollapsed,
  onSelect,
  onToggleSubtasks,
  onToggle,
  onToggleSubtask,
}: {
  task: Task;
  labels: Label[];
  members: Member[];
  selected: boolean;
  online: boolean;
  now: Date;
  showLabels?: boolean;
  draggable?: boolean;
  subtasksCollapsed: boolean;
  onSelect: () => void;
  onToggleSubtasks: () => void;
  onToggle: () => Promise<void>;
  onToggleSubtask: WorkspaceAppProps["onToggleSubtask"];
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !draggable });
  const taskLabels = labels.filter((label) => task.label_ids.includes(label.id));
  const assignee = members.find((member) => member.user_id === task.assignee_id);
  const dueStatus = getDueStatus(task.due_at, now);
  const hasSubtasks = task.kind !== "note" && task.subtasks.length > 0;
  const sortedSubtasks = useMemo(
    () => [...task.subtasks].sort((a, b) => a.position - b.position),
    [task.subtasks],
  );
  const [pendingSubtaskIds, setPendingSubtaskIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  async function toggleSubtask(subtask: Subtask) {
    if (!online || pendingSubtaskIds.has(subtask.id)) return;
    setPendingSubtaskIds((current) => new Set(current).add(subtask.id));
    try {
      await onToggleSubtask(subtask.id, !subtask.completed);
    } finally {
      setPendingSubtaskIds((current) => {
        const next = new Set(current);
        next.delete(subtask.id);
        return next;
      });
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={clsx("task-tree-item", isDragging && "dragging")}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 2 : undefined,
      }}
    >
      <article
        className={clsx(
          "task-row",
          hasSubtasks && "has-subtasks",
          selected && "selected",
          task.kind !== "note" && task.status === "completed" && "completed",
          isDragging && "dragging",
        )}
      >
      {task.kind !== "note" && task.priority !== "none" && (
        <span
          className="priority-bar"
          aria-hidden="true"
          style={{
            "--priority-color": getPriorityOption(task.priority).color,
          } as React.CSSProperties}
        />
      )}
      {draggable && (
        <button
          className="task-drag-handle"
          aria-label={`拖动${task.kind === "note" ? "笔记" : "任务"}“${task.title}”`}
          {...attributes}
          {...listeners}
        >
          <GripVertical />
        </button>
      )}
      {hasSubtasks && (
        <button
          type="button"
          className="task-subtasks-expander"
          aria-label={`${subtasksCollapsed ? "展开" : "收起"}子任务：${task.title}`}
          aria-expanded={!subtasksCollapsed}
          aria-controls={`task-subtasks-${task.id}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSubtasks();
          }}
        >
          {subtasksCollapsed ? <ChevronRight /> : <ChevronDown />}
        </button>
      )}
      {task.kind === "note" ? (
        <span className="task-note-icon" aria-label="笔记"><NotebookPen /></span>
      ) : (
        <button
          className="task-checkbox"
          disabled={!online}
          aria-label={task.status === "completed" ? "标记未完成" : "完成任务"}
          onClick={(event) => {
            event.stopPropagation();
            void onToggle();
          }}
        >
          {task.status === "completed" ? <Check /> : <Circle />}
        </button>
      )}
      <button className="task-row-content" onClick={onSelect}>
        <span className="task-main-line">
          <span className="task-title">{task.title}</span>
          {showLabels && taskLabels.length > 0 && (
            <span className="task-labels">
              {taskLabels.slice(0, 2).map((label) => (
                <span
                  key={label.id}
                  className="task-label"
                  style={{
                    "--task-label-color": label.color,
                  } as React.CSSProperties}
                >
                  {label.name}
                </span>
              ))}
            </span>
          )}
          <span className="task-meta">
            {task.kind !== "note" && task.subtasks.length > 0 && (
              <span>
                {task.subtasks.filter((subtask) => subtask.completed).length}/{task.subtasks.length}
              </span>
            )}
            {dueStatus && (
              <time className={dueStatus.overdue ? "overdue" : ""}>
                {dueStatus.label}
              </time>
            )}
            {assignee && (
              <MemberAvatar
                member={assignee}
                className="task-assignee-avatar"
                title={`负责人：${assignee.profile?.display_name ?? "团队成员"}`}
              />
            )}
          </span>
        </span>
      </button>
      </article>
      {hasSubtasks && !subtasksCollapsed && (
        <div
          id={`task-subtasks-${task.id}`}
          className="task-list-subtasks"
          role="list"
          aria-label={`子任务：${task.title}`}
        >
          {sortedSubtasks.map((subtask) => {
            const pending = pendingSubtaskIds.has(subtask.id);
            return (
              <article
                key={subtask.id}
                className={clsx("task-list-subtask-row", subtask.completed && "completed")}
                role="listitem"
              >
                <button
                  type="button"
                  className="task-list-subtask-checkbox"
                  aria-label={`${subtask.completed ? "重新打开" : "完成"}子任务：${subtask.title}`}
                  disabled={!online || pending}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleSubtask(subtask);
                  }}
                >
                  <span className={clsx("task-list-subtask-check", subtask.completed && "checked")}>
                    {subtask.completed && <Check />}
                  </span>
                </button>
                <button
                  type="button"
                  className="task-list-subtask-title"
                  onClick={onSelect}
                >
                  {subtask.title}
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamManagementList({
  workspaces,
  currentWorkspaceId,
  ...panelProps
}: {
  workspaces: Workspace[];
  currentWorkspaceId: string;
  online: boolean;
  onLoadInviteLink: WorkspaceAppProps["onLoadInviteLink"];
  onEnableInviteLink: WorkspaceAppProps["onEnableInviteLink"];
  onUpdateInviteLinkRole: WorkspaceAppProps["onUpdateInviteLinkRole"];
  onDisableInviteLink: WorkspaceAppProps["onDisableInviteLink"];
  onCopyInviteLink: WorkspaceAppProps["onCopyInviteLink"];
  onUpdateWorkspace: WorkspaceAppProps["onUpdateWorkspace"];
  onDeleteWorkspace: WorkspaceAppProps["onDeleteWorkspace"];
  onNotice: (message: string) => void;
}) {
  const [expandedId, setExpandedId] = useState(currentWorkspaceId);

  useEffect(() => {
    if (!workspaces.some((item) => item.id === expandedId)) {
      setExpandedId(
        workspaces.find((item) => item.id === currentWorkspaceId)?.id
          ?? workspaces[0]?.id
          ?? "",
      );
    }
  }, [currentWorkspaceId, expandedId, workspaces]);

  return (
    <div className="team-management-list-panel">
      <h1>团队管理</h1>
      <p className="team-mgmt-settings-lead">查看和配置你加入的全部团队空间。</p>
      <div className="team-management-list">
        {workspaces.map((workspace) => {
          const expanded = workspace.id === expandedId;
          const roleLabel = workspace.role === "owner"
            ? "所有者"
            : workspace.role === "admin" ? "管理员" : "成员";
          return (
            <article className={clsx("team-management-item", expanded && "expanded")} key={workspace.id}>
              <button
                type="button"
                className="team-management-item-trigger"
                aria-expanded={expanded}
                aria-controls={`team-management-detail-${workspace.id}`}
                onClick={() => setExpandedId(expanded ? "" : workspace.id)}
              >
                <span className="workspace-initial">{initials(workspace.name).slice(0, 1)}</span>
                <span className="team-management-item-copy">
                  <strong>{workspace.name}</strong>
                  <small>{workspace.slug}</small>
                </span>
                <span className="team-management-item-meta">
                  {workspace.id === currentWorkspaceId && <em>当前团队</em>}
                  <span>{roleLabel}</span>
                </span>
                <ChevronDown aria-hidden="true" />
              </button>
              {expanded && (
                <div id={`team-management-detail-${workspace.id}`} className="team-management-item-detail">
                  <TeamManagementPanel workspace={workspace} {...panelProps} />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function TeamManagementPanel({
  workspace,
  online,
  onLoadInviteLink,
  onEnableInviteLink,
  onUpdateInviteLinkRole,
  onDisableInviteLink,
  onCopyInviteLink,
  onUpdateWorkspace,
  onDeleteWorkspace,
  onNotice,
}: {
  workspace: Workspace;
  online: boolean;
  onLoadInviteLink: WorkspaceAppProps["onLoadInviteLink"];
  onEnableInviteLink: WorkspaceAppProps["onEnableInviteLink"];
  onUpdateInviteLinkRole: WorkspaceAppProps["onUpdateInviteLinkRole"];
  onDisableInviteLink: WorkspaceAppProps["onDisableInviteLink"];
  onCopyInviteLink: WorkspaceAppProps["onCopyInviteLink"];
  onUpdateWorkspace: WorkspaceAppProps["onUpdateWorkspace"];
  onDeleteWorkspace: WorkspaceAppProps["onDeleteWorkspace"];
  onNotice: (message: string) => void;
}) {
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const queryClient = useQueryClient();
  const inviteLinkQuery = useQuery({
    queryKey: ["workspace-invite-link", workspace.id],
    queryFn: () => onLoadInviteLink(workspace.id),
    enabled: canManage,
  });
  const inviteLink = inviteLinkQuery.data ?? null;
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const activeInviteRole = inviteLink?.role ?? "member";

  useEffect(() => {
    setName(workspace.name);
    setSlug(workspace.slug);
    setError("");
  }, [workspace.id, workspace.name, workspace.slug]);

  const dirty =
    name.trim() !== workspace.name ||
    normalizeWorkspaceSlug(slug) !== workspace.slug;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || !online || busy) return;

    const nextName = name.trim();
    const nextSlug = normalizeWorkspaceSlug(slug);
    if (!nextName) {
      setError("请输入团队名称。");
      return;
    }
    if (nextName.length > 80) {
      setError("团队名称最多 80 个字符。");
      return;
    }
    const slugError = workspaceSlugValidationMessage(nextSlug);
    if (slugError) {
      setError(slugError);
      return;
    }

    setBusy(true);
    setError("");
    try {
      await onUpdateWorkspace(workspace.id, { name: nextName, slug: nextSlug });
      onNotice("团队信息已更新");
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "团队信息暂时无法更新。",
      );
    } finally {
      setBusy(false);
    }
  }

  const teamLoginUrl = buildWorkspaceTeamLoginUrl(
    normalizeWorkspaceSlug(slug) || workspace.slug,
    import.meta.env.VITE_PUBLIC_APP_URL,
    window.location.origin,
  );

  async function setInviteEnabled(enabled: boolean) {
    setInviteBusy(true);
    setInviteError("");
    try {
      if (enabled) {
        const link = await onEnableInviteLink(workspace.id, activeInviteRole);
        queryClient.setQueryData(["workspace-invite-link", workspace.id], link);
      } else {
        await onDisableInviteLink(workspace.id);
        queryClient.setQueryData(["workspace-invite-link", workspace.id], null);
      }
    } catch {
      setInviteError(
        enabled ? "邀请链接暂时无法启用。" : "邀请链接暂时无法关闭。",
      );
    } finally {
      setInviteBusy(false);
    }
  }

  async function setInviteRole(role: WorkspaceInviteRole) {
    if (!inviteLink) return;
    setInviteBusy(true);
    setInviteError("");
    try {
      const link = await onUpdateInviteLinkRole(workspace.id, role);
      queryClient.setQueryData(["workspace-invite-link", workspace.id], link);
    } catch {
      setInviteError("邀请身份暂时无法更新。");
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div className="team-mgmt-settings-panel">
      <p className="team-mgmt-settings-lead">
        设置团队空间的显示名称与唯一 Slug。Slug 对应团队专属访问路径，用于企业 SSO 登录入口。
      </p>
      <form className="team-mgmt-settings-form" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          <span>团队名称</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!online || busy || !canManage}
            maxLength={80}
            required
            aria-label="团队名称"
          />
        </label>
        <label>
          <span>团队 Slug</span>
          <input
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            disabled={!online || busy || !canManage}
            maxLength={48}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            required
            aria-label="团队 Slug"
          />
          <small>仅小写字母、数字和连字符，全局唯一。</small>
        </label>
        <div className="team-mgmt-settings-readonly">
          <span>团队访问地址</span>
          <code aria-label="团队访问地址">
            {teamLoginUrl?.replace(/^https?:\/\//, "") || "未配置"}
          </code>
          <small>成员访问该地址时仅可使用钉钉 SSO 登录。</small>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {canManage ? (
          <button
            className="button primary"
            disabled={!online || busy || !dirty}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        ) : (
          <p className="team-mgmt-settings-readonly-note">
            仅所有者和管理员可以修改团队信息。
          </p>
        )}
      </form>
      {canManage && (
        <section className="invite-link-section" aria-label="邀请链接">
          <label className="invite-link-toggle-row">
            <span className="date-time-switch">
              <input
                type="checkbox"
                role="switch"
                aria-label="启用邀请链接"
                checked={Boolean(inviteLink)}
                disabled={!online || inviteBusy || inviteLinkQuery.isLoading}
                onChange={(event) => void setInviteEnabled(event.target.checked)}
              />
              <i aria-hidden="true" />
            </span>
            <span>启用邀请链接</span>
          </label>
          <div className={clsx("invite-link-control", !inviteLink && "disabled")}>
            <span>通过邀请链接加入的成员</span>
            <span className="invite-link-role">
              <select
                aria-label="邀请链接加入身份"
                value={activeInviteRole}
                disabled={!online || inviteBusy || !inviteLink}
                onChange={(event) =>
                  void setInviteRole(event.target.value as WorkspaceInviteRole)
                }
              >
                <option value="member">普通成员</option>
                <option value="admin">管理员</option>
              </select>
              <ChevronDown aria-hidden="true" />
            </span>
            <button
              type="button"
              disabled={!online || inviteBusy || !inviteLink}
              onClick={() => inviteLink && void onCopyInviteLink(inviteLink)}
            >
              复制链接
            </button>
          </div>
          {activeInviteRole === "admin" && inviteLink && (
            <p className="invite-link-warning">
              管理员可管理团队成员、标签权限和连接器。
            </p>
          )}
          {inviteError && (
            <p className="invite-link-error" role="alert">{inviteError}</p>
          )}
        </section>
      )}
      {workspace.role === "owner" && (
        <section className="team-danger-zone" aria-label="危险操作">
          <div>
            <strong>删除团队</strong>
            <p>永久删除团队及其任务、标签、成员、评论、附件、连接器和配置。</p>
          </div>
          <button
            type="button"
            className="button danger"
            disabled={!online}
            onClick={() => {
              setDeleteConfirmation("");
              setDeleteError("");
              setDeleteOpen(true);
            }}
          >
            删除团队
          </button>
        </section>
      )}
      <Dialog.Root open={deleteOpen} onOpenChange={(open) => !deleteBusy && setDeleteOpen(open)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content workspace-delete-dialog">
            <Dialog.Title>永久删除“{workspace.name}”</Dialog.Title>
            <Dialog.Description>
              团队中的所有数据都会被清理且无法还原。请输入完整团队名称以确认。
            </Dialog.Description>
            <label>
              <span>团队名称</span>
              <input
                autoFocus
                value={deleteConfirmation}
                disabled={deleteBusy}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                aria-label="输入团队名称确认删除"
              />
            </label>
            {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
            <div className="dialog-actions">
              <Dialog.Close className="button secondary" disabled={deleteBusy}>取消</Dialog.Close>
              <button
                type="button"
                className="button danger"
                disabled={!online || deleteBusy || deleteConfirmation !== workspace.name}
                onClick={() => void (async () => {
                  setDeleteBusy(true);
                  setDeleteError("");
                  try {
                    await onDeleteWorkspace(workspace.id, deleteConfirmation);
                    setDeleteOpen(false);
                    onNotice("团队已永久删除");
                  } catch (deleteCause) {
                    setDeleteError(
                      deleteCause instanceof Error
                        ? deleteCause.message
                        : "团队暂时无法删除，请稍后重试。",
                    );
                  } finally {
                    setDeleteBusy(false);
                  }
                })()}
              >
                {deleteBusy ? "正在删除…" : "永久删除"}
              </button>
            </div>
            <Dialog.Close className="dialog-close" aria-label="关闭" disabled={deleteBusy}><X /></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function TeamSettingsPanel({
  workspace,
  bundle,
  online,
  onUpdateMemberRole,
}: {
  workspace: Workspace;
  bundle: WorkspaceBundle;
  online: boolean;
  onUpdateMemberRole: WorkspaceAppProps["onUpdateMemberRole"];
}) {
  const groupsByMember = new Map<string, UserGroup[]>();
  for (const membership of bundle.userGroupMembers) {
    const group = bundle.userGroups.find((item) => item.id === membership.group_id);
    if (!group) continue;
    const current = groupsByMember.get(membership.user_id) ?? [];
    current.push(group);
    groupsByMember.set(membership.user_id, current);
  }

  return (
    <div className="team-settings-panel">
      <header className="team-settings-header">
        <h2>{workspace.name}</h2>
        <p>管理成员角色。标签权限会在任务查询时实时生效。</p>
      </header>
      <div className="member-list">
        {bundle.members.map((member) => (
          <div className="member-row" key={member.user_id}>
            <span className="member-avatar">{initials(member.profile?.display_name ?? "成员")}</span>
            <div className="member-row-copy">
              <strong>{member.profile?.display_name ?? "团队成员"}</strong>
              <div className="member-row-meta">
                <span>所属用户组</span>
                <div className="member-group-labels" aria-label="所属用户组">
                  {(groupsByMember.get(member.user_id) ?? []).slice(0, 3).map((group) => (
                    <span className="member-group-label" key={group.id}>{group.name}</span>
                  ))}
                  {(groupsByMember.get(member.user_id) ?? []).length > 3 && (
                    <span
                      className="member-group-label member-group-more"
                      title={(groupsByMember.get(member.user_id) ?? []).slice(3).map((group) => group.name).join("、")}
                    >…</span>
                  )}
                </div>
              </div>
            </div>
            {member.role === "owner" ? (
              <span className="role-chip">owner</span>
            ) : (
              <select
                className="role-select"
                value={member.role}
                disabled={!online || workspace.role === "member"}
                aria-label={`${member.profile?.display_name ?? "成员"}的角色`}
                onChange={(event) =>
                  void onUpdateMemberRole(
                    member.user_id,
                    event.target.value as WorkspaceRole,
                  )
                }
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function UserGroupsPanel({
  workspace,
  bundle,
  online,
  onCreateUserGroup,
  onUpdateUserGroup,
  onDeleteUserGroup,
}: {
  workspace: Workspace;
  bundle: WorkspaceBundle;
  online: boolean;
  onCreateUserGroup: WorkspaceAppProps["onCreateUserGroup"];
  onUpdateUserGroup: WorkspaceAppProps["onUpdateUserGroup"];
  onDeleteUserGroup: WorkspaceAppProps["onDeleteUserGroup"];
}) {
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const [editingGroup, setEditingGroup] = useState<UserGroup | "new" | null>(null);
  const [name, setName] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function openEditor(group: UserGroup | "new") {
    setEditingGroup(group);
    setName(group === "new" ? "" : group.name);
    setMemberIds(new Set(
      group === "new"
        ? []
        : bundle.userGroupMembers
            .filter((item) => item.group_id === group.id)
            .map((item) => item.user_id),
    ));
    setError("");
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("请输入用户组名称。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (editingGroup === "new") {
        await onCreateUserGroup(trimmedName, [...memberIds]);
      } else if (editingGroup) {
        await onUpdateUserGroup(editingGroup.id, trimmedName, [...memberIds]);
      }
      setEditingGroup(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "保存用户组失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeGroup(group: UserGroup) {
    if (!window.confirm(`确定删除用户组“${group.name}”吗？`)) return;
    setBusy(true);
    setError("");
    try {
      await onDeleteUserGroup(group.id);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "删除用户组失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="user-groups-panel">
      <header className="team-settings-header user-groups-header">
        <div>
          <h2>用户组</h2>
          <p>将团队成员整理到用户组中，便于识别和后续权限配置。</p>
        </div>
      {canManage && (
          <button className="button primary" type="button" disabled={!online || busy} onClick={() => openEditor("new")}>
            <Plus aria-hidden="true" />新建用户组
          </button>
        )}
      </header>
      {error && !editingGroup && <p className="form-error" role="alert">{error}</p>}
      <div className="user-group-list">
        {bundle.userGroups.length === 0 ? (
          <div className="user-group-empty">暂无用户组{canManage ? "，点击右上角创建" : ""}</div>
        ) : bundle.userGroups.map((group) => {
          const groupMemberIds = new Set(
            bundle.userGroupMembers.filter((item) => item.group_id === group.id).map((item) => item.user_id),
          );
          const groupMembers = bundle.members.filter((member) => groupMemberIds.has(member.user_id));
          return (
            <div className="user-group-row" key={group.id}>
              <div className="user-group-icon"><Users aria-hidden="true" /></div>
              <div className="user-group-copy">
                <strong>{group.name}</strong>
                <span>{groupMembers.length} 位成员</span>
                <div className="user-group-member-preview">
                  {groupMembers.slice(0, 5).map((member) => (
                    <span key={member.user_id}>{member.profile?.display_name ?? "团队成员"}</span>
                  ))}
                  {groupMembers.length > 5 && <span>等 {groupMembers.length} 人</span>}
                </div>
              </div>
              {canManage && (
                <div className="user-group-actions">
                  <button type="button" disabled={!online || busy} onClick={() => openEditor(group)}>编辑</button>
                  <button className="danger" type="button" disabled={!online || busy} onClick={() => void removeGroup(group)}>删除</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!canManage && <p className="team-mgmt-settings-readonly-note">仅所有者和管理员可以管理用户组。</p>}

      <Dialog.Root open={editingGroup !== null} onOpenChange={(open) => !open && !busy && setEditingGroup(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay user-group-dialog-overlay" />
          <Dialog.Content className="dialog-content user-group-dialog">
            <Dialog.Title>{editingGroup === "new" ? "新建用户组" : "编辑用户组"}</Dialog.Title>
            <Dialog.Description>设置用户组名称并选择要加入的团队成员。</Dialog.Description>
            <form onSubmit={(event) => void saveGroup(event)}>
              <label className="user-group-name-field">
                <span>名称</span>
                <input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：产品组" />
              </label>
              <fieldset className="user-group-member-picker">
                <legend>成员</legend>
                <div>
                  {bundle.members.map((member) => {
                    const checked = memberIds.has(member.user_id);
                    return (
                      <label key={member.user_id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setMemberIds((current) => {
                            const next = new Set(current);
                            if (checked) next.delete(member.user_id);
                            else next.add(member.user_id);
                            return next;
                          })}
                        />
                        <span className="member-avatar">{initials(member.profile?.display_name ?? "成员")}</span>
                        <strong>{member.profile?.display_name ?? "团队成员"}</strong>
                        <small>{member.role === "owner" ? "所有者" : member.role === "admin" ? "管理员" : "成员"}</small>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {error && <p className="form-error" role="alert">{error}</p>}
              <div className="user-group-dialog-actions">
                <button className="button" type="button" disabled={busy} onClick={() => setEditingGroup(null)}>取消</button>
                <button className="button primary" disabled={!online || busy || !name.trim()}>{busy ? "保存中…" : "保存"}</button>
              </div>
            </form>
            <Dialog.Close className="dialog-close" aria-label="关闭"><X /></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function SsoSettingsPanel({
  workspace,
  online,
  onNotice,
}: {
  workspace: Workspace;
  online: boolean;
  onNotice: (message: string) => void;
}) {
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"list" | "form">("list");
  const [corpId, setCorpId] = useState("");
  const [appKey, setAppKey] = useState("");
  const [agentId, setAgentId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const providerQuery = useQuery({
    queryKey: ["workspace-sso", workspace.id],
    enabled:
      Boolean(supabase) &&
      workspace.id !== "workspace-team" &&
      workspace.id !== "workspace-personal",
    queryFn: async () => {
      const { data, error: invokeError } = await supabase!.functions.invoke("sso-admin", {
        body: { action: "get", workspaceId: workspace.id },
      });
      if (invokeError) throw invokeError;
      return (data?.provider ?? null) as WorkspaceSsoProvider | null;
    },
  });

  const provider = providerQuery.data ?? null;
  const callbackUrl = buildDingtalkCallbackUrl(
    import.meta.env.VITE_PUBLIC_APP_URL,
    window.location.origin,
  );
  const loginUrl = buildWorkspaceTeamLoginUrl(
    workspace.slug,
    import.meta.env.VITE_PUBLIC_APP_URL,
    window.location.origin,
  );

  useEffect(() => {
    if (!provider) return;
    setCorpId(provider.public_config.corpId ?? "");
    setAppKey(provider.public_config.appKey ?? "");
    setAgentId(provider.public_config.agentId ?? "");
  }, [provider]);

  function startConfigure() {
    setMode("form");
    setError("");
    setAppSecret("");
    if (provider) {
      setCorpId(provider.public_config.corpId ?? "");
      setAppKey(provider.public_config.appKey ?? "");
      setAgentId(provider.public_config.agentId ?? "");
    } else {
      setCorpId("");
      setAppKey("");
      setAgentId("");
    }
  }

  async function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !canManage || !online) return;
    if (!corpId.trim() || !appKey.trim()) {
      setError("请填写 CorpId 与 AppKey。");
      return;
    }
    if (!isDingtalkClientId(appKey)) {
      setError("AppKey 无效，企业内部应用 Client ID 通常以 ding 开头。");
      return;
    }
    const appKeyChanged =
      Boolean(provider) &&
      appKey.trim() !== (provider?.public_config.appKey ?? "").trim();
    if (!provider && !appSecret.trim()) {
      setError("首次配置需要填写 AppSecret。");
      return;
    }
    if (appKeyChanged && !appSecret.trim()) {
      setError("更换 AppKey 后必须重新填写对应的 AppSecret。");
      return;
    }
    setBusy(true);
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("sso-admin", {
      body: {
        action: "upsert",
        workspaceId: workspace.id,
        publicConfig: {
          corpId: corpId.trim(),
          appKey: appKey.trim(),
          ...(agentId.trim() ? { agentId: agentId.trim() } : {}),
        },
        enabled: provider?.enabled ?? true,
        ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
      },
    });
    setBusy(false);
    if (invokeError || !data?.provider) {
      setError(
        await edgeFunctionErrorMessage(
          invokeError,
          data,
          "保存失败，请稍后重试。",
        ),
      );
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["workspace-sso", workspace.id] });
    setAppSecret("");
    setMode("list");
    onNotice("钉钉 SSO 配置已保存");
  }

  async function toggleEnabled() {
    if (!supabase || !provider || !canManage || !online) return;
    setBusy(true);
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("sso-admin", {
      body: {
        action: "set-enabled",
        workspaceId: workspace.id,
        enabled: !provider.enabled,
      },
    });
    setBusy(false);
    if (invokeError || !data?.provider) {
      setError(
        typeof data?.error === "string"
          ? data.error
          : invokeError?.message || "更新启用状态失败。",
      );
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["workspace-sso", workspace.id] });
    onNotice(provider.enabled ? "钉钉 SSO 已停用" : "钉钉 SSO 已启用");
  }

  async function removeProvider() {
    if (!supabase || !provider || !canManage || !online) return;
    if (!window.confirm("确定删除钉钉 SSO 配置？删除后成员将无法通过该企业扫码登录。")) {
      return;
    }
    setBusy(true);
    setError("");
    const { error: invokeError } = await supabase.functions.invoke("sso-admin", {
      body: { action: "delete", workspaceId: workspace.id },
    });
    setBusy(false);
    if (invokeError) {
      setError(invokeError.message || "删除失败，请稍后重试。");
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["workspace-sso", workspace.id] });
    setMode("list");
    onNotice("钉钉 SSO 配置已删除");
  }

  async function copyLoginUrl() {
    if (!loginUrl) {
      onNotice("请先配置 VITE_PUBLIC_APP_URL，再复制登录链接");
      return;
    }
    try {
      await navigator.clipboard.writeText(loginUrl);
      onNotice("团队登录地址已复制");
    } catch {
      onNotice("复制失败，请手动复制团队登录地址");
    }
  }

  if (
    workspace.id === "workspace-team" ||
    workspace.id === "workspace-personal"
  ) {
    return (
      <div className="sso-settings-panel">
        <h1>单点登录</h1>
        <p className="sso-settings-lead">
          演示模式仅预览界面。真实环境中可为每个团队空间配置钉钉企业内部应用 SSO。
        </p>
        <div className="connector-settings-grid">
          <article className="connector-settings-card">
            <span className="connector-settings-mark dingtalk">钉</span>
            <span className="connector-settings-copy">
              <strong>钉钉企业登录</strong>
              <small>通过钉钉企业内部应用扫码登录并加入本团队空间</small>
            </span>
            <em>演示预览</em>
          </article>
        </div>
      </div>
    );
  }

  if (mode === "form") {
    return (
      <div className="sso-settings-panel">
        <header className="sso-settings-header">
          <div>
            <h1>{provider ? "编辑钉钉 SSO" : "配置钉钉 SSO"}</h1>
            <p>填写钉钉企业内部应用凭证。AppSecret 仅写入 Vault，不会回显明文。</p>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setMode("list")}
          >
            返回
          </button>
        </header>
        <form className="sso-settings-form" onSubmit={(event) => void saveConfig(event)}>
          <label>
            <span>CorpId</span>
            <input
              value={corpId}
              onChange={(event) => setCorpId(event.target.value)}
              disabled={!online || busy}
              required
            />
          </label>
          <label>
            <span>AppKey / Client ID</span>
            <input
              value={appKey}
              onChange={(event) => setAppKey(event.target.value)}
              disabled={!online || busy}
              required
            />
          </label>
          <label>
            <span>AgentId（可选）</span>
            <input
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              disabled={!online || busy}
            />
          </label>
          <label>
            <span>
              {provider
                ? "AppSecret（更换 AppKey 时必填，否则留空保持不变）"
                : "AppSecret"}
            </span>
            <input
              type="password"
              value={appSecret}
              onChange={(event) => setAppSecret(event.target.value)}
              disabled={!online || busy}
              autoComplete="new-password"
              required={!provider}
            />
          </label>
          <div className="sso-settings-readonly">
            <span>回调域名</span>
            <code>{callbackUrl || "请配置 VITE_PUBLIC_APP_URL"}</code>
            <small>请将此地址登记到钉钉开放平台「登录与分享」回调域名。</small>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary" disabled={!online || busy || !canManage}>
            {busy ? "保存中…" : "保存配置"}
          </button>
        </form>
      </div>
    );
  }

  if (provider) {
    return (
      <div className="sso-settings-panel">
        <h1>单点登录</h1>
        <p className="sso-settings-lead">
          本团队空间已配置钉钉企业内部应用 SSO。请将团队访问地址分享给成员，对方访问后仅可使用钉钉扫码登录。
        </p>
        <section className="sso-settings-detail" aria-label="钉钉 SSO 配置">
          <div className="sso-settings-detail-row">
            <span>提供商</span>
            <strong>钉钉企业登录</strong>
          </div>
          <div className="sso-settings-detail-row">
            <span>状态</span>
            <strong>{provider.enabled ? "已启用" : "已停用"}</strong>
          </div>
          <div className="sso-settings-detail-row">
            <span>CorpId</span>
            <strong>{provider.public_config.corpId}</strong>
          </div>
          <div className="sso-settings-detail-row">
            <span>AppKey</span>
            <strong>{provider.public_config.appKey}</strong>
          </div>
          {provider.public_config.agentId && (
            <div className="sso-settings-detail-row">
              <span>AgentId</span>
              <strong>{provider.public_config.agentId}</strong>
            </div>
          )}
          <div className="sso-settings-detail-row">
            <span>AppSecret</span>
            <strong>{provider.credential_hint || "未配置"}</strong>
          </div>
          <div className="sso-settings-detail-row">
            <span>回调域名</span>
            <strong>{callbackUrl || "未配置 VITE_PUBLIC_APP_URL"}</strong>
          </div>
          <div className="sso-settings-detail-row">
            <span>团队登录地址</span>
            <strong className="sso-settings-link">{loginUrl || "未配置"}</strong>
          </div>
        </section>
        {error && <p className="form-error" role="alert">{error}</p>}
        {canManage ? (
          <div className="sso-settings-actions">
            <button
              type="button"
              className="button secondary"
              disabled={!online || busy}
              onClick={() => void copyLoginUrl()}
            >
              复制团队登录地址
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!online || busy}
              onClick={startConfigure}
            >
              编辑
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!online || busy}
              onClick={() => void toggleEnabled()}
            >
              {provider.enabled ? "停用" : "启用"}
            </button>
            <button
              type="button"
              className="button secondary danger"
              disabled={!online || busy}
              onClick={() => void removeProvider()}
            >
              删除
            </button>
          </div>
        ) : (
          <p className="sso-settings-readonly-note">仅所有者和管理员可以修改 SSO 配置。</p>
        )}
      </div>
    );
  }

  return (
    <div className="sso-settings-panel">
      <h1>单点登录</h1>
      <p className="sso-settings-lead">
        尚未配置 SSO。当前仅支持钉钉企业内部应用登录。
      </p>
      <div className="connector-settings-grid">
        <article className="connector-settings-card">
          <span className="connector-settings-mark dingtalk">钉</span>
          <span className="connector-settings-copy">
            <strong>钉钉企业登录</strong>
            <small>通过钉钉企业内部应用扫码登录并加入本团队空间</small>
          </span>
          {canManage ? (
            <button
              type="button"
              className="button secondary"
              disabled={!online || providerQuery.isLoading}
              onClick={startConfigure}
            >
              配置
            </button>
          ) : (
            <em>未配置</em>
          )}
        </article>
      </div>
      {providerQuery.isError && (
        <p className="form-error" role="alert">无法加载 SSO 配置，请稍后重试。</p>
      )}
    </div>
  );
}

function DateTimeSettingsPanel({
  preferences,
  online,
  onChange,
}: {
  preferences: DateTimePreferences;
  online: boolean;
  onChange: (preferences: DateTimePreferences) => Promise<void>;
}) {
  function update<K extends keyof DateTimePreferences>(
    key: K,
    value: DateTimePreferences[K],
  ) {
    if (!online || preferences[key] === value) return;
    void onChange({ ...preferences, [key]: value }).catch(() => undefined);
  }

  return (
    <section className="date-time-settings" aria-labelledby="date-time-settings-title">
      <h1 id="date-time-settings-title">日期与时间</h1>

      <div className="date-time-settings-card date-time-format-card">
        <label className="date-time-setting-row">
          <span>时间格式</span>
          <span className="date-time-select-wrap">
            <select
              aria-label="时间格式"
              value={preferences.timeFormat}
              disabled={!online}
              onChange={(event) =>
                update("timeFormat", event.target.value as DateTimePreferences["timeFormat"])
              }
            >
              {TIME_FORMAT_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronsUpDown aria-hidden="true" />
          </span>
        </label>
        <label className="date-time-setting-row">
          <span>日期格式</span>
          <span className="date-time-select-wrap">
            <select
              aria-label="日期格式"
              value={preferences.dateFormat}
              disabled={!online}
              onChange={(event) =>
                update("dateFormat", event.target.value as DateTimePreferences["dateFormat"])
              }
            >
              {DATE_FORMAT_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronsUpDown aria-hidden="true" />
          </span>
        </label>
        <label className="date-time-setting-row">
          <span>每周开始于</span>
          <span className="date-time-select-wrap">
            <select
              aria-label="每周开始于"
              value={preferences.weekStartsOn}
              disabled={!online}
              onChange={(event) =>
                update(
                  "weekStartsOn",
                  Number(event.target.value) as DateTimePreferences["weekStartsOn"],
                )
              }
            >
              {WEEK_START_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
            <ChevronsUpDown aria-hidden="true" />
          </span>
        </label>
      </div>

      <div className="date-time-settings-card">
        {([
          ["showLunar", "显示农历"],
          ["showWeekNumbers", "显示周数"],
          ["showHolidayAdjustments", "显示节假日调休"],
        ] as const).map(([key, label]) => (
          <label className="date-time-setting-row" key={key}>
            <span>{label}</span>
            <span className="date-time-switch">
              <input
                type="checkbox"
                role="switch"
                aria-label={label}
                checked={preferences[key]}
                disabled={!online}
                onChange={(event) => update(key, event.target.checked)}
              />
              <i aria-hidden="true" />
            </span>
          </label>
        ))}
      </div>

      <div className="date-time-settings-card date-time-zone-card">
        <label className="date-time-setting-row">
          <span>时区</span>
          <span className="date-time-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="时区"
              checked={preferences.timeZoneEnabled}
              disabled={!online}
              onChange={(event) => update("timeZoneEnabled", event.target.checked)}
            />
            <i aria-hidden="true" />
          </span>
        </label>
        <p>启用后，在时间选择界面设置时间时，可以选择时区。</p>
      </div>
      {!online && <p className="date-time-offline-note">离线模式下设置为只读</p>}
    </section>
  );
}

function SettingsDialog({
  open,
  onOpenChange,
  userId,
  userName,
  email,
  phone,
  avatarUrl,
  workspace,
  workspaces,
  currentWorkspaceId,
  bundle,
  workspaceName,
  online,
  onLoadInviteLink,
  onEnableInviteLink,
  onUpdateInviteLinkRole,
  onDisableInviteLink,
  onCopyInviteLink,
  onUpdateMemberRole,
  onCreateUserGroup,
  onUpdateUserGroup,
  onDeleteUserGroup,
  onUpdateWorkspace,
  onDeleteWorkspace,
  onUpdateDisplayName,
  onUpdateAvatar,
  onUpdateEmail,
  onDeleteAccount,
  dateTimePreferences,
  onUpdateDateTimePreferences,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
  workspace: Workspace;
  workspaces: Workspace[];
  currentWorkspaceId: string;
  bundle: WorkspaceBundle;
  workspaceName: string;
  online: boolean;
  onLoadInviteLink: WorkspaceAppProps["onLoadInviteLink"];
  onEnableInviteLink: WorkspaceAppProps["onEnableInviteLink"];
  onUpdateInviteLinkRole: WorkspaceAppProps["onUpdateInviteLinkRole"];
  onDisableInviteLink: WorkspaceAppProps["onDisableInviteLink"];
  onCopyInviteLink: WorkspaceAppProps["onCopyInviteLink"];
  onUpdateMemberRole: WorkspaceAppProps["onUpdateMemberRole"];
  onCreateUserGroup: WorkspaceAppProps["onCreateUserGroup"];
  onUpdateUserGroup: WorkspaceAppProps["onUpdateUserGroup"];
  onDeleteUserGroup: WorkspaceAppProps["onDeleteUserGroup"];
  onUpdateWorkspace: WorkspaceAppProps["onUpdateWorkspace"];
  onDeleteWorkspace: WorkspaceAppProps["onDeleteWorkspace"];
  onUpdateDisplayName: WorkspaceAppProps["onUpdateDisplayName"];
  onUpdateAvatar: WorkspaceAppProps["onUpdateAvatar"];
  onUpdateEmail: WorkspaceAppProps["onUpdateEmail"];
  onDeleteAccount: WorkspaceAppProps["onDeleteAccount"];
  dateTimePreferences: DateTimePreferences;
  onUpdateDateTimePreferences: WorkspaceAppProps["onUpdateDateTimePreferences"];
  onNotice: (message: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [accountAction, setAccountAction] = useState<
    "nickname" | "avatar" | "email" | "delete" | null
  >(null);
  const [nicknameDraft, setNicknameDraft] = useState(userName);
  const [emailDraft, setEmailDraft] = useState(email);
  const [avatarDraft, setAvatarDraft] = useState<Blob | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const settingsTabGroups: Array<{
    title: string | null;
    tabs: Array<{
      id: SettingsTab;
      label: string;
      icon: typeof UserRound;
    }>;
  }> = [
    {
      title: "基础配置",
      tabs: [
        { id: "account", label: "账户与安全", icon: UserRound },
        { id: "date", label: "日期与时间", icon: CalendarClock },
        { id: "shortcuts", label: "快捷键", icon: Keyboard },
      ],
    },
    {
      title: "团队配置",
      tabs: [
        { id: "team-mgmt", label: "团队管理", icon: Building2 },
        { id: "team", label: "成员管理", icon: Users },
        { id: "user-groups", label: "用户组", icon: Workflow },
        { id: "sso", label: "单点登录", icon: KeyRound },
      ],
    },
    {
      title: null,
      tabs: [{ id: "about", label: "关于", icon: Info }],
    },
  ];
  const settingsTabs: Array<{
    id: SettingsTab;
    label: string;
    icon: typeof UserRound;
  }> = settingsTabGroups.flatMap((group) => group.tabs);

  useEffect(() => {
    if (!open) return;
    setActiveTab("account");
    setAccountAction(null);
    setNicknameDraft(userName);
    setEmailDraft(email);
    setAvatarDraft(null);
    setAvatarPreviewUrl(null);
    setDeleteConfirmation("");
    setAccountError("");
  }, [open]);

  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

  function closeAccountAction() {
    if (accountBusy) return;
    setAccountAction(null);
    setAccountError("");
    setDeleteConfirmation("");
    setAvatarDraft(null);
    setAvatarPreviewUrl(null);
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay settings-overlay" />
        <Dialog.Content className="dialog-content settings-dialog">
          <Dialog.Description className="sr-only">
            管理 AntTodo 的账户、安全和应用偏好。
          </Dialog.Description>
          <aside className="settings-sidebar">
            <Dialog.Title className="settings-modal-title">设置</Dialog.Title>
            <nav className="settings-tabs" aria-label="设置分类">
              {settingsTabGroups.map((group, groupIndex) => (
                <div
                  key={group.title ?? "ungrouped"}
                  className={clsx(
                    "settings-tab-group",
                    groupIndex > 0 && "settings-tab-group-separated",
                  )}
                >
                  {group.title ? (
                    <div className="settings-tab-group-title">{group.title}</div>
                  ) : null}
                  {group.tabs.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className={clsx("settings-tab", activeTab === id && "active")}
                      aria-current={activeTab === id ? "page" : undefined}
                      autoFocus={activeTab === id}
                      onClick={() => {
                        setActiveTab(id);
                      }}
                    >
                      <Icon aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </nav>
          </aside>
          <section className="settings-main">
            {activeTab === "account" ? (
              <div className="account-settings">
                <header className="account-profile">
                  <button
                    type="button"
                    className="account-avatar-button"
                    aria-label="修改头像"
                    disabled={!online}
                    onClick={() => {
                      setAvatarDraft(null);
                      setAvatarPreviewUrl(null);
                      setAccountError("");
                      setAccountAction("avatar");
                    }}
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="account-avatar" />
                    ) : (
                      <span className="account-avatar account-avatar-fallback">
                        {initials(userName)}
                      </span>
                    )}
                    <span className="account-avatar-edit" aria-hidden="true">
                      <Camera />
                    </span>
                  </button>
                  <strong>{userName}</strong>
                  <span>
                    {workspaceName}
                    <i className={clsx("account-online-dot", !online && "offline")} />
                    {online ? "在线" : "离线"}
                  </span>
                </header>

                <div className="account-settings-groups">
                  <div className="account-settings-group">
                    <div className="account-setting-row">
                      <span>昵称</span>
                      <div className="account-setting-value">
                        <strong title={userName}>{userName}</strong>
                        <button
                          type="button"
                          disabled={!online}
                          onClick={() => {
                            setNicknameDraft(userName);
                            setAccountError("");
                            setAccountAction("nickname");
                          }}
                        >
                          修改
                        </button>
                      </div>
                    </div>
                    <div className="account-setting-row">
                      <span>头像</span>
                      <button
                        type="button"
                        disabled={!online}
                        onClick={() => {
                          setAvatarDraft(null);
                          setAvatarPreviewUrl(null);
                          setAccountError("");
                          setAccountAction("avatar");
                        }}
                      >
                        修改
                      </button>
                    </div>
                    <div className="account-setting-row">
                      <span>邮箱</span>
                      <div className="account-setting-value">
                        <strong title={email || undefined}>{email || "未设置"}</strong>
                        <button
                          type="button"
                          disabled={!online}
                          onClick={() => {
                            setEmailDraft(email);
                            setAccountError("");
                            setAccountAction("email");
                          }}
                        >
                          {email ? "修改" : "设置"}
                        </button>
                      </div>
                    </div>
                    <div className="account-setting-row">
                      <span>手机号</span>
                      <strong>{phone ? `+86 ${maskPhone(phone)}` : "未绑定"}</strong>
                    </div>
                    <div className="account-setting-row">
                      <span>双重验证</span>
                      <em className="account-coming-soon">稍后提供</em>
                    </div>
                  </div>

                  <div className="account-settings-group">
                    <div className="account-setting-row">
                      <span>微信</span>
                      <em className="account-coming-soon">稍后提供</em>
                    </div>
                  </div>

                  <div className="account-settings-group">
                    <div className="account-setting-row">
                      <span>API 口令</span>
                      <em className="account-coming-soon">稍后提供</em>
                    </div>
                    <div className="account-setting-row">
                      <span>备份与还原</span>
                      <em className="account-coming-soon">稍后提供</em>
                    </div>
                    <div className="account-setting-row">
                      <span>删除账户</span>
                      <button
                        type="button"
                        className="danger"
                        disabled={!online}
                        onClick={() => {
                          setAccountError("");
                          setDeleteConfirmation("");
                          setAccountAction("delete");
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>

                <span className="account-id">账户 ID · {userId}</span>
              </div>
            ) : activeTab === "date" ? (
              <DateTimeSettingsPanel
                preferences={dateTimePreferences}
                online={online}
                onChange={onUpdateDateTimePreferences}
              />
            ) : activeTab === "team-mgmt" ? (
              <TeamManagementList
                workspaces={workspaces}
                currentWorkspaceId={currentWorkspaceId}
                online={online}
                onLoadInviteLink={onLoadInviteLink}
                onEnableInviteLink={onEnableInviteLink}
                onUpdateInviteLinkRole={onUpdateInviteLinkRole}
                onDisableInviteLink={onDisableInviteLink}
                onCopyInviteLink={onCopyInviteLink}
                onUpdateWorkspace={onUpdateWorkspace}
                onDeleteWorkspace={onDeleteWorkspace}
                onNotice={onNotice}
              />
            ) : activeTab === "team" ? (
              <TeamSettingsPanel
                workspace={workspace}
                bundle={bundle}
                online={online}
                onUpdateMemberRole={onUpdateMemberRole}
              />
            ) : activeTab === "user-groups" ? (
              <UserGroupsPanel
                workspace={workspace}
                bundle={bundle}
                online={online}
                onCreateUserGroup={onCreateUserGroup}
                onUpdateUserGroup={onUpdateUserGroup}
                onDeleteUserGroup={onDeleteUserGroup}
              />
            ) : activeTab === "sso" ? (
              <SsoSettingsPanel
                workspace={workspace}
                online={online}
                onNotice={onNotice}
              />
            ) : (
              <div className="settings-placeholder">
                {(() => {
                  const tab = settingsTabs.find((item) => item.id === activeTab)!;
                  const Icon = tab.icon;
                  return (
                    <>
                      <Icon aria-hidden="true" />
                      <strong>{tab.label}</strong>
                      <span>该设置模块将在后续版本中开放。</span>
                    </>
                  );
                })()}
              </div>
            )}
          </section>
          <Dialog.Close className="settings-dialog-close" aria-label="关闭设置">
            <X />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        open={accountAction !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeAccountAction();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay account-action-overlay" />
          <Dialog.Content className="dialog-content account-action-dialog">
            {accountAction === "nickname" ? (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const nextName = nicknameDraft.trim();
                  if (!nextName || nextName === userName || nextName.length > 80) return;
                  setAccountBusy(true);
                  setAccountError("");
                  try {
                    await onUpdateDisplayName(nextName);
                    setAccountAction(null);
                  } catch {
                    setAccountError("昵称暂时无法修改，请稍后重试。");
                  } finally {
                    setAccountBusy(false);
                  }
                }}
              >
                <Dialog.Title>修改昵称</Dialog.Title>
                <Dialog.Description className="account-action-description">
                  昵称会展示给与你处于同一团队空间的成员。
                </Dialog.Description>
                <label className="account-action-field">
                  <span>昵称</span>
                  <input
                    value={nicknameDraft}
                    onChange={(event) => setNicknameDraft(event.target.value)}
                    maxLength={80}
                    autoComplete="nickname"
                    autoFocus
                    required
                  />
                </label>
                <span className="account-field-counter">{nicknameDraft.length}/80</span>
                {accountError && <p className="form-error" role="alert">{accountError}</p>}
                <div className="account-action-buttons">
                  <button type="button" className="button secondary" onClick={closeAccountAction}>
                    取消
                  </button>
                  <button
                    className="button primary"
                    disabled={
                      accountBusy ||
                      !nicknameDraft.trim() ||
                      nicknameDraft.trim() === userName ||
                      nicknameDraft.trim().length > 80
                    }
                  >
                    {accountBusy ? "正在保存…" : "保存"}
                  </button>
                </div>
              </form>
            ) : accountAction === "avatar" ? (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!avatarDraft) return;
                  setAccountBusy(true);
                  setAccountError("");
                  try {
                    await onUpdateAvatar(avatarDraft);
                    setAccountAction(null);
                    setAvatarDraft(null);
                    setAvatarPreviewUrl(null);
                  } catch {
                    setAccountError("头像暂时无法保存，请稍后重试。");
                  } finally {
                    setAccountBusy(false);
                  }
                }}
              >
                <Dialog.Title>修改头像</Dialog.Title>
                <Dialog.Description className="account-action-description">
                  图片会自动居中裁剪为正方形，支持 JPEG、PNG 和 WebP，最大 5MB。
                </Dialog.Description>
                <div className="account-avatar-editor">
                  {avatarPreviewUrl || avatarUrl ? (
                    <img
                      src={avatarPreviewUrl ?? avatarUrl ?? undefined}
                      alt="头像预览"
                      className="account-avatar-preview"
                    />
                  ) : (
                    <span className="account-avatar-preview account-avatar-fallback">
                      {initials(userName)}
                    </span>
                  )}
                  <label className={clsx("button secondary account-avatar-upload", accountBusy && "disabled")}>
                    选择图片
                    <input
                      type="file"
                      accept={AVATAR_ACCEPT}
                      disabled={accountBusy}
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setAccountBusy(true);
                        setAccountError("");
                        try {
                          const cropped = await cropAvatarFile(file);
                          setAvatarDraft(cropped);
                          setAvatarPreviewUrl(URL.createObjectURL(cropped));
                        } catch (cause) {
                          setAccountError(
                            cause instanceof Error ? cause.message : "头像图片处理失败",
                          );
                        } finally {
                          setAccountBusy(false);
                        }
                      }}
                    />
                  </label>
                  {avatarUrl ? (
                    <button
                      type="button"
                      className="account-avatar-remove"
                      disabled={accountBusy}
                      onClick={async () => {
                        setAccountBusy(true);
                        setAccountError("");
                        try {
                          await onUpdateAvatar(null);
                          setAccountAction(null);
                          setAvatarDraft(null);
                          setAvatarPreviewUrl(null);
                        } catch {
                          setAccountError("头像暂时无法移除，请稍后重试。");
                        } finally {
                          setAccountBusy(false);
                        }
                      }}
                    >
                      移除当前头像
                    </button>
                  ) : null}
                </div>
                {accountError && <p className="form-error" role="alert">{accountError}</p>}
                <div className="account-action-buttons">
                  <button type="button" className="button secondary" onClick={closeAccountAction}>
                    取消
                  </button>
                  <button className="button primary" disabled={accountBusy || !avatarDraft}>
                    {accountBusy ? "正在处理…" : "保存"}
                  </button>
                </div>
              </form>
            ) : accountAction === "email" ? (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  const nextEmail = emailDraft.trim().toLowerCase();
                  if (!nextEmail || nextEmail === email.toLowerCase()) return;
                  setAccountBusy(true);
                  setAccountError("");
                  try {
                    await onUpdateEmail(nextEmail);
                    setAccountAction(null);
                  } catch {
                    setAccountError("邮箱暂时无法修改，请检查地址后重试。");
                  } finally {
                    setAccountBusy(false);
                  }
                }}
              >
                <Dialog.Title>设置邮箱</Dialog.Title>
                <Dialog.Description className="account-action-description">
                  修改后需要前往新邮箱完成验证，验证前仍可使用当前登录方式。
                </Dialog.Description>
                <label className="account-action-field">
                  <span>新邮箱</span>
                  <input
                    type="email"
                    value={emailDraft}
                    onChange={(event) => setEmailDraft(event.target.value)}
                    placeholder="name@example.com"
                    autoComplete="email"
                    autoFocus
                    required
                  />
                </label>
                {accountError && <p className="form-error" role="alert">{accountError}</p>}
                <div className="account-action-buttons">
                  <button type="button" className="button secondary" onClick={closeAccountAction}>
                    取消
                  </button>
                  <button
                    className="button primary"
                    disabled={
                      accountBusy ||
                      !emailDraft.trim() ||
                      emailDraft.trim().toLowerCase() === email.toLowerCase()
                    }
                  >
                    {accountBusy ? "正在发送…" : "发送验证邮件"}
                  </button>
                </div>
              </form>
            ) : accountAction === "delete" ? (
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (deleteConfirmation !== "删除账户") return;
                  setAccountBusy(true);
                  setAccountError("");
                  try {
                    await onDeleteAccount();
                    onOpenChange(false);
                  } catch {
                    setAccountError("账户暂时无法删除。若上传过附件，请先删除附件后重试。");
                    setAccountBusy(false);
                  }
                }}
              >
                <Dialog.Title>永久删除账户</Dialog.Title>
                <Dialog.Description className="account-action-description">
                  此操作无法撤销。只有你一人的团队空间会一并删除；你管理的共享团队空间会移交给其他成员。
                </Dialog.Description>
                <label className="account-action-field">
                  <span>输入“删除账户”以确认</span>
                  <input
                    value={deleteConfirmation}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                    autoComplete="off"
                    autoFocus
                    required
                  />
                </label>
                {accountError && <p className="form-error" role="alert">{accountError}</p>}
                <div className="account-action-buttons">
                  <button type="button" className="button secondary" onClick={closeAccountAction}>
                    取消
                  </button>
                  <button
                    className="button danger account-delete-confirm"
                    disabled={accountBusy || deleteConfirmation !== "删除账户"}
                  >
                    {accountBusy ? "正在删除…" : "永久删除"}
                  </button>
                </div>
              </form>
            ) : null}
            <Dialog.Close
              className="dialog-close"
              aria-label="关闭"
              disabled={accountBusy}
            >
              <X />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  online,
  ownedCount,
  limit,
  onCreate,
  onCheckSlug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  online: boolean;
  ownedCount: number;
  limit: number;
  onCreate: WorkspaceAppProps["onCreateWorkspace"];
  onCheckSlug: WorkspaceAppProps["onCheckWorkspaceSlug"];
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const quotaExceeded = ownedCount >= limit;

  useEffect(() => {
    if (!open) return;
    setName("");
    setSlug("");
    setSlugTouched(false);
    setSlugAvailable(null);
    setBusy(false);
    setError("");
  }, [open]);

  async function checkSlug() {
    const normalized = normalizeWorkspaceSlug(slug);
    if (workspaceSlugValidationMessage(normalized)) {
      setSlugAvailable(null);
      return false;
    }
    const available = await onCheckSlug(normalized);
    setSlugAvailable(available);
    return available;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || busy || quotaExceeded) return;
    const nextName = name.trim();
    const nextSlug = normalizeWorkspaceSlug(slug);
    if (!nextName) {
      setError("请输入团队名称。");
      return;
    }
    const slugError = workspaceSlugValidationMessage(nextSlug);
    if (slugError) {
      setError(slugError);
      return;
    }

    setBusy(true);
    setError("");
    try {
      if (!(await checkSlug())) {
        setError("团队 Slug 已被占用，请换一个。");
        return;
      }
      await onCreate({ name: nextName, slug: nextSlug });
      onOpenChange(false);
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "团队暂时无法创建，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content workspace-create-dialog">
          <Dialog.Title>创建团队</Dialog.Title>
          <Dialog.Description>
            填写团队名称和用于专属访问地址的唯一 Slug。
          </Dialog.Description>
          <form onSubmit={(event) => void submit(event)}>
            <label>
              <span>团队名称</span>
              <input
                autoFocus
                value={name}
                maxLength={80}
                disabled={!online || busy}
                onChange={(event) => {
                  const nextName = event.target.value;
                  setName(nextName);
                  if (!slugTouched) setSlug(suggestWorkspaceSlug(nextName));
                }}
                aria-label="新团队名称"
                required
              />
            </label>
            <label>
              <span>团队 Slug</span>
              <input
                value={slug}
                maxLength={48}
                disabled={!online || busy}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(normalizeWorkspaceSlug(event.target.value));
                  setSlugAvailable(null);
                }}
                onBlur={() => void checkSlug()}
                aria-label="新团队 Slug"
                required
              />
              <small className={clsx(slugAvailable === false && "invalid")}>
                {slugAvailable === true
                  ? "Slug 可用"
                  : slugAvailable === false
                    ? "Slug 已被占用"
                    : "仅小写字母、数字和连字符，全局唯一。"}
              </small>
            </label>
            <p className={clsx("workspace-quota-summary", quotaExceeded && "limit-reached")}>
              已拥有 {ownedCount} / {limit} 个团队
              {quotaExceeded && "，请先删除一个由你拥有的团队。"}
            </p>
            {!online && <p className="form-error" role="alert">离线模式下无法创建团队。</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <Dialog.Close className="button secondary" disabled={busy}>取消</Dialog.Close>
              <button
                className="button primary"
                disabled={!online || busy || quotaExceeded || !name.trim() || Boolean(workspaceSlugValidationMessage(slug))}
              >
                {busy ? "正在创建…" : "创建团队"}
              </button>
            </div>
          </form>
          <Dialog.Close className="dialog-close" aria-label="关闭" disabled={busy}><X /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CreateWorkspaceScreen({
  identity,
  busy,
  onCreate,
}: {
  identity: string;
  busy: boolean;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <main className="onboarding-screen">
      <section className="onboarding-card">
        <BrandMark />
        <span className="eyebrow">欢迎，{identity}</span>
        <h1>创建你的第一个团队空间</h1>
        <p>未添加标签的待办会进入收集箱，并由你担任团队空间所有者。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onCreate(name.trim());
          }}
        >
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：产品研发团队"
            autoFocus
          />
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy ? "正在创建…" : "创建团队空间"}
          </button>
        </form>
      </section>
    </main>
  );
}

function FatalState({ title, message }: { title: string; message: string }) {
  return (
    <main className="fatal-screen">
      <CloudOff />
      <h1>{title}</h1>
      <p>{message}</p>
      <button className="button primary" onClick={() => window.location.reload()}>重新加载</button>
    </main>
  );
}
