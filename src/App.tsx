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
  Bell,
  Building2,
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
  GripVertical,
  Inbox,
  Info,
  KeyRound,
  Keyboard,
  LayoutList,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Tag,
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
import { getPriorityOption } from "./PriorityControl";
import { TaskDetailDialog, TaskDetailPanel } from "./TaskDetail";
import {
  assignTask as assignTaskApi,
  createTask,
  createTaskSection,
  createWorkspace,
  deleteTaskSection,
  loadDateTimePreferences,
  listTaskAssigneeIds,
  loadWorkspaceBundle,
  loadWorkspaces,
  saveDateTimePreferences,
  saveTaskListPreference,
  setTaskListOrder,
  toggleTaskLabel as toggleTaskLabelApi,
  updateTaskSection,
  updateWorkspace,
} from "./lib/api";
import {
  createDemoAttachmentService,
  createSupabaseAttachmentService,
  type AttachmentService,
} from "./lib/attachments";
import { createDemoBundle, demoWorkspaces } from "./lib/demo";
import { getDueStatus } from "./lib/dueTime";
import { searchTasks } from "./lib/taskSearch";
import {
  TASK_GROUPING_OPTIONS,
  TASK_SORT_OPTIONS,
  defaultSortDirection,
  groupTasks,
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
} from "./lib/labels";
import { hasSupabaseConfig, supabase } from "./lib/supabase";
import { getAssignableMembers } from "./lib/taskAssignment";
import {
  buildWorkspaceInviteUrl,
  workspaceInviteIdFromPath,
  workspaceInviteRoleLabel,
} from "./lib/workspaceInvites";
import {
  buildDingtalkCallbackUrl,
  dingtalkExchangeOnce,
  dingtalkFrameLoginParams,
  dingtalkLoginErrorAction,
  dingtalkLoginErrorMessage,
  dingtalkOAuthAuthorizeUrl,
  dingtalkTokenHashOtpParams,
  edgeFunctionErrorMessage,
  isDingtalkCallbackPath,
  isDingtalkClientId,
  loadDingtalkLoginSdk,
  type DingtalkSsoPublicConfig,
  type WorkspaceSsoProvider,
} from "./lib/sso";
import type {
  DateTimePreferences,
  Label,
  LabelVisibility,
  Member,
  Subtask,
  Task,
  TaskListGrouping,
  TaskListPreference,
  TaskListSort,
  TaskSection,
  TaskPriority,
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

  if (demoMode) return <DemoApplication />;
  if (!hasSupabaseConfig || !supabase) return <MissingConfig />;
  if (!authReady) return <Splash label="正在恢复工作区…" />;
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
        if (exchangeError || !data?.tokenHash) {
          return {
            ok: false as const,
            error: await edgeFunctionErrorMessage(
              exchangeError,
              data,
              "钉钉登录失败，请重试。",
            ),
          };
        }
        return {
          ok: true as const,
          workspaceId: String(data.workspaceId || workspaceId),
          tokenHash: String(data.tokenHash),
        };
      });
      if (cancelled) return;
      if (!exchange.ok) {
        setError(exchange.error);
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

function AuthScreen({
  loginSurface = "phone",
  teamSlug = null,
}: {
  loginSurface?: "phone" | "team-sso";
  teamSlug?: string | null;
}) {
  const phoneOnly = loginSurface === "phone";
  const mode: "phone" | "dingtalk" = phoneOnly ? "phone" : "dingtalk";
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [sentPhone, setSentPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ssoConfig, setSsoConfig] = useState<DingtalkSsoPublicConfig | null>(null);
  const [ssoLoading, setSsoLoading] = useState(!phoneOnly);

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
    setError("");
    setSsoConfig(null);
    const { data, error: configError } = await supabase.functions.invoke(
      "dingtalk-sso",
      { body: { action: "public-config", slug } },
    );
    setSsoLoading(false);
    if (configError || !data?.workspaceId || !data?.appKey) {
      setError(
        await edgeFunctionErrorMessage(
          configError,
          data,
          "未找到可用的钉钉 SSO 配置，请确认团队访问地址或联系管理员。",
        ),
      );
      return;
    }
    const config = data as DingtalkSsoPublicConfig;
    setSsoConfig(config);
    window.sessionStorage.setItem(
      "anttodo:pending-workspace",
      config.workspaceId,
    );
  }

  useEffect(() => {
    if (phoneOnly) return;
    if (teamSlug) {
      void loadSsoConfig(teamSlug);
    }
  }, [phoneOnly, teamSlug]);

  useEffect(() => {
    if (mode !== "dingtalk" || !ssoConfig?.state || !ssoConfig.redirectUri) return;
    const activeConfig = ssoConfig;
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
          if (!cancelled) setError("钉钉二维码容器未就绪，请刷新页面重试。");
          return;
        }
        if (!window.DTFrameLogin) {
          if (!cancelled) setError("钉钉登录组件未就绪，请改用跳转登录。");
          return;
        }
        setError("");
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
              window.location.assign(result.redirectUrl);
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
            setError(dingtalkLoginErrorMessage(errorMsg));
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
        setError("钉钉登录组件加载失败，请改用跳转登录。");
      }
    }

    void mountQr();
    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [mode, ssoConfig]);

  async function sendCode() {
    if (!supabase) return;
    const normalizedPhone = normalizeMainlandPhone(phone);
    if (!normalizedPhone) {
      setError("请输入正确的 11 位中国大陆手机号。");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const { error: sendError } = await supabase.auth.signInWithOtp({
      phone: normalizedPhone,
      options: {
        data: { display_name: maskPhone(normalizedPhone) },
        shouldCreateUser: true,
      },
    });
    if (sendError) {
      setError(phoneAuthErrorMessage(sendError.message, "send"));
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
      setError("请输入 6 位数字验证码。");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: sentPhone,
      token: otp,
      type: "sms",
    });
    if (verifyError) {
      setError(phoneAuthErrorMessage(verifyError.message, "verify"));
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
    setError("");
    setMessage("");
  }

  function openRedirectLogin() {
    if (!ssoConfig?.state || !ssoConfig.redirectUri) return;
    window.location.assign(
      dingtalkOAuthAuthorizeUrl({
        redirectUri: ssoConfig.redirectUri,
        clientId: ssoConfig.appKey,
        state: ssoConfig.state,
        corpId: ssoConfig.corpId,
      }),
    );
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand">
          <BrandMark />
          <div>
            <h1>蚂蚁清单</h1>
            {!phoneOnly && ssoConfig?.workspaceName ? (
              <p>{ssoConfig.workspaceName}</p>
            ) : null}
          </div>
        </div>
        {mode === "phone" ? (
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
                    <span className="phone-country-flag" aria-hidden="true">
                      🇨🇳
                    </span>
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
                    autoFocus
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
            {error && <p className="form-error" role="alert">{error}</p>}
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
        ) : (
          <div className="dingtalk-login" role="region" aria-label="钉钉企业登录">
            {ssoLoading ? (
              <>
                <strong>正在加载钉钉登录…</strong>
                <p>正在读取团队空间的 SSO 配置。</p>
              </>
            ) : ssoConfig ? (
              <>
                <div
                  id="dingtalk_login_container"
                  className="dingtalk-qr-frame"
                  aria-label="钉钉登录二维码"
                />
                <strong>使用钉钉扫码登录</strong>
                <p>
                  正在登录「{ssoConfig.workspaceName}」。请打开钉钉扫描二维码，或改用跳转授权。
                </p>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button
                  type="button"
                  className="button secondary full"
                  onClick={openRedirectLogin}
                >
                  <RefreshCw aria-hidden="true" />
                  跳转到钉钉授权
                </button>
              </>
            ) : (
              <>
                <strong>暂时无法登录</strong>
                <p>
                  {teamSlug
                    ? "该团队尚未启用钉钉 SSO，或团队访问地址无效。请联系管理员。"
                    : "未找到可用的钉钉 SSO 配置。请通过团队访问地址进入登录。"}
                </p>
                {error && <p className="form-error" role="alert">{error}</p>}
                <a className="button secondary full" href={import.meta.env.VITE_PUBLIC_APP_URL || "/"}>
                  前往主站手机号登录
                </a>
              </>
            )}
          </div>
        )}
        {phoneOnly ? (
          <>
            <div className="auth-divider"><span>或</span></div>
            <a className="button secondary full" href="?demo=1">
              查看产品演示
            </a>
          </>
        ) : null}
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

  const workspacesQuery = useQuery({
    queryKey: ["workspaces", userId],
    queryFn: () => loadWorkspaces(client),
  });
  const activeWorkspace = workspacesQuery.data?.find(
    (workspace) => workspace.id === workspaceId,
  );
  const canManageInvite =
    activeWorkspace?.role === "owner" || activeWorkspace?.role === "admin";
  const inviteLinkQuery = useQuery({
    queryKey: ["workspace-invite-link", workspaceId],
    queryFn: async () => {
      const { data, error } = await client.functions.invoke("workspace-invite", {
        body: { action: "get", workspaceId },
      });
      if (error) throw error;
      return (data?.link ?? null) as WorkspaceInviteLink | null;
    },
    enabled: Boolean(workspaceId && canManageInvite),
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

  useEffect(() => {
    if (!workspaceId) return;
    const channel = client
      .channel(`anttodo:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public" },
        () => void queryClient.invalidateQueries({ queryKey: ["workspace-bundle", workspaceId] }),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [client, queryClient, workspaceId]);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspaces", userId] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-bundle", workspaceId] }),
    ]);

  const workspaceMutation = useMutation({
    mutationFn: (name: string) => createWorkspace(client, name, userId),
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
        onCreate={(name) => workspaceMutation.mutate(name)}
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
    const { error } = await client.from("tasks").update(payload).eq("id", taskId);
    if (error) throw error;
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

  async function createLabel(name: string, parentId: string | null, color = DEFAULT_LABEL_COLOR) {
    const temporaryId = `optimistic-${crypto.randomUUID()}`;
    const optimisticLabel: Label = {
      id: temporaryId,
      workspace_id: activeWorkspaceId,
      parent_id: parentId,
      name,
      color,
      visibility: "workspace",
      inherit_permissions: Boolean(parentId),
      position: activeBundle.labels.length,
      created_by: userId,
    };
    queryClient.setQueryData<WorkspaceBundle>(
      ["workspace-bundle", workspaceId],
      (current) => current
        ? { ...current, labels: [...current.labels, optimisticLabel] }
        : current,
    );
    const { data, error } = await client.from("labels").insert({
      workspace_id: workspaceId,
      parent_id: parentId,
      name,
      color,
      created_by: userId,
      inherit_permissions: Boolean(parentId),
    }).select("*").single();
    if (error) {
      queryClient.setQueryData<WorkspaceBundle>(
        ["workspace-bundle", workspaceId],
        (current) => current
          ? { ...current, labels: current.labels.filter((label) => label.id !== temporaryId) }
          : current,
      );
      throw error;
    }
    queryClient.setQueryData<WorkspaceBundle>(
      ["workspace-bundle", workspaceId],
      (current) => current
        ? {
            ...current,
            labels: current.labels.map((label) =>
              label.id === temporaryId ? data as Label : label
            ),
          }
        : current,
    );
    void refresh();
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

  async function setLabelPermission(
    labelId: string,
    memberId: string,
    permission: "none" | "view" | "edit",
  ) {
    const query =
      permission === "none"
        ? client
            .from("label_acl")
            .delete()
            .eq("label_id", labelId)
            .eq("user_id", memberId)
        : client.from("label_acl").upsert(
            { label_id: labelId, user_id: memberId, permission },
            { onConflict: "label_id,user_id" },
          );
    const { error } = await query;
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

  async function enableInviteLink(role: WorkspaceInviteRole) {
    const { data, error } = await client.functions.invoke("workspace-invite", {
      body: { action: "enable", workspaceId, role },
    });
    if (error) throw error;
    queryClient.setQueryData(
      ["workspace-invite-link", workspaceId],
      data.link as WorkspaceInviteLink,
    );
  }

  async function updateInviteLinkRole(role: WorkspaceInviteRole) {
    const { data, error } = await client.functions.invoke("workspace-invite", {
      body: { action: "update-role", workspaceId, role },
    });
    if (error) throw error;
    queryClient.setQueryData(
      ["workspace-invite-link", workspaceId],
      data.link as WorkspaceInviteLink,
    );
  }

  async function disableInviteLink() {
    const { error } = await client.functions.invoke("workspace-invite", {
      body: { action: "disable", workspaceId },
    });
    if (error) throw error;
    queryClient.setQueryData(["workspace-invite-link", workspaceId], null);
  }

  async function copyInviteLink() {
    const link = inviteLinkQuery.data;
    if (!link) return;
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
      notice={notice}
      onDismissNotice={() => setNotice("")}
      onNotice={setNotice}
      onWorkspaceChange={setWorkspaceId}
      onCreateWorkspace={(name) => workspaceMutation.mutateAsync(name)}
      onUpdateWorkspace={async (patch) => {
        const updated = await updateWorkspace(client, workspaceId, patch);
        await refresh();
        return updated;
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
      onToggleTaskLabel={toggleTaskLabel}
      onLoadTaskAssignees={(taskId) => listTaskAssigneeIds(client, taskId)}
      onAssignTask={assignTask}
      onCreateSubtask={createSubtask}
      onToggleSubtask={toggleSubtask}
      onCreateLabel={createLabel}
      onUpdateLabel={updateLabel}
      onDeleteLabel={deleteLabel}
      onMergeLabel={mergeLabel}
      onMoveLabelToInbox={moveLabelToInbox}
      onSetLabelPermission={setLabelPermission}
      onUpdateMemberRole={updateMemberRole}
      inviteLink={inviteLinkQuery.data ?? null}
      inviteLinkLoading={inviteLinkQuery.isLoading}
      onEnableInviteLink={enableInviteLink}
      onUpdateInviteLinkRole={updateInviteLinkRole}
      onDisableInviteLink={disableInviteLink}
      onCopyInviteLink={copyInviteLink}
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

  useEffect(() => {
    return () => attachmentService.dispose();
  }, [attachmentService]);

  function patchTask(taskId: string, patch: Partial<Task>) {
    setBundle((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === taskId
          ? { ...task, ...patch, updated_at: new Date().toISOString(), version: task.version + 1 }
          : task,
      ),
    }));
    return Promise.resolve();
  }

  return (
    <WorkspaceApplication
      workspaces={workspaces}
      workspaceId={workspaceId}
      bundle={bundle}
      currentUserId="demo-user"
      currentUserName="沈宇宝"
      currentUserEmail=""
      currentUserPhone="+8613800138000"
      online={online}
      dateTimePreferences={dateTimePreferences}
      attachmentService={attachmentService}
      notice={notice}
      onDismissNotice={() => setNotice("")}
      onNotice={setNotice}
      onWorkspaceChange={setWorkspaceId}
      onCreateWorkspace={async (name) => {
        const workspace = {
          id: crypto.randomUUID(),
          name,
          slug: suggestWorkspaceSlug(name),
          created_by: "demo-user",
          role: "owner" as const,
        };
        setWorkspaces((current) => [...current, workspace]);
        setWorkspaceId(workspace.id);
        return workspace;
      }}
      onUpdateWorkspace={async (patch) => {
        const slug = normalizeWorkspaceSlug(patch.slug);
        const slugError = workspaceSlugValidationMessage(slug);
        if (slugError) throw new Error(slugError);
        if (
          workspaces.some(
            (item) => item.id !== workspaceId && item.slug === slug,
          )
        ) {
          throw new Error("团队 Slug 已被占用，请换一个。");
        }
        const updated = {
          ...workspaces.find((item) => item.id === workspaceId)!,
          name: patch.name.trim(),
          slug,
        };
        setWorkspaces((current) =>
          current.map((item) => (item.id === workspaceId ? updated : item)),
        );
        return updated;
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
              status: "open",
              priority: input.priority ?? "none",
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
            },
            ...current.tasks,
          ],
        }));
        return { id: createdId };
      }}
      onUpdateTask={patchTask}
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
      }}
      onLoadTaskAssignees={async (taskId) => {
        const task = bundle.tasks.find((item) => item.id === taskId);
        return task
          ? getAssignableMembers(bundle, task, "demo-user").map(
              (member) => member.user_id,
            )
          : [];
      }}
      onAssignTask={(taskId, assigneeId) =>
        patchTask(taskId, { assignee_id: assigneeId })}
      onCreateSubtask={async (taskId, title) => {
        setBundle((current) => ({
          ...current,
          tasks: current.tasks.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  subtasks: [
                    ...task.subtasks,
                    {
                      id: crypto.randomUUID(),
                      task_id: taskId,
                      title,
                      completed: false,
                      position: task.subtasks.length,
                    },
                  ],
                }
              : task,
          ),
        }));
      }}
      onToggleSubtask={async (subtaskId, completed) => {
        setBundle((current) => ({
          ...current,
          tasks: current.tasks.map((task) => ({
            ...task,
            subtasks: task.subtasks.map((subtask) =>
              subtask.id === subtaskId ? { ...subtask, completed } : subtask,
            ),
          })),
        }));
      }}
      onCreateLabel={async (name, parentId, color = DEFAULT_LABEL_COLOR) => {
        setBundle((current) => ({
          ...current,
          labels: [
            ...current.labels,
            {
              id: crypto.randomUUID(),
              workspace_id: workspaceId,
              parent_id: parentId,
              name,
              color,
              visibility: "workspace",
              inherit_permissions: Boolean(parentId),
              position: current.labels.length,
              created_by: "demo-user",
            },
          ],
        }));
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
      onSetLabelPermission={async (labelId, memberId, permission) => {
        setBundle((current) => ({
          ...current,
          labelAcls:
            permission === "none"
              ? current.labelAcls.filter(
                  (acl) => acl.label_id !== labelId || acl.user_id !== memberId,
                )
              : [
                  ...current.labelAcls.filter(
                    (acl) => acl.label_id !== labelId || acl.user_id !== memberId,
                  ),
                  { label_id: labelId, user_id: memberId, permission },
                ],
        }));
      }}
      onUpdateMemberRole={async (memberId, role) => {
        setBundle((current) => ({
          ...current,
          members: current.members.map((member) =>
            member.user_id === memberId ? { ...member, role } : member,
          ),
        }));
      }}
      inviteLink={inviteLink}
      inviteLinkLoading={false}
      onEnableInviteLink={async (role) => {
        setInviteLink({
          id: crypto.randomUUID(),
          workspace_id: workspaceId,
          role,
          created_by: "demo-owner",
          created_at: new Date().toISOString(),
          revoked_at: null,
        });
      }}
      onUpdateInviteLinkRole={async (role) => {
        setInviteLink((current) => current ? { ...current, role } : current);
      }}
      onDisableInviteLink={async () => setInviteLink(null)}
      onCopyInviteLink={async () => setNotice("演示邀请链接已复制")}
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
  bundle: WorkspaceBundle;
  currentUserId: string;
  currentUserName: string;
  currentUserEmail: string;
  currentUserPhone: string;
  online: boolean;
  dateTimePreferences: DateTimePreferences;
  attachmentService: AttachmentService;
  notice: string;
  onDismissNotice: () => void;
  onNotice: (message: string) => void;
  onWorkspaceChange: (id: string) => void;
  onCreateWorkspace: (name: string) => Promise<Workspace>;
  onUpdateWorkspace: (patch: {
    name: string;
    slug: string;
  }) => Promise<Workspace>;
  onCreateTask: (input: {
    title: string;
    labelIds: string[];
    description?: string;
    dueAt?: string | null;
    dueTimezone?: string | null;
    priority?: TaskPriority;
  }) => Promise<unknown>;
  onUpdateTask: (taskId: string, patch: Partial<Task>) => Promise<void>;
  onToggleTaskLabel: (
    taskId: string,
    labelId: string,
    selected: boolean,
  ) => Promise<void>;
  onLoadTaskAssignees: (taskId: string) => Promise<string[]>;
  onAssignTask: (taskId: string, assigneeId: string | null) => Promise<void>;
  onCreateSubtask: (taskId: string, title: string) => Promise<void>;
  onToggleSubtask: (subtaskId: string, completed: boolean) => Promise<void>;
  onCreateLabel: (name: string, parentId: string | null, color?: string) => Promise<void>;
  onUpdateLabel: (labelId: string, patch: Partial<Label>) => Promise<void>;
  onDeleteLabel: (labelId: string) => Promise<void>;
  onMergeLabel: (sourceLabelId: string, targetLabelId: string) => Promise<void>;
  onMoveLabelToInbox: (sourceLabelId: string) => Promise<void>;
  onSetLabelPermission: (
    labelId: string,
    memberId: string,
    permission: "none" | "view" | "edit",
  ) => Promise<void>;
  onUpdateMemberRole: (memberId: string, role: WorkspaceRole) => Promise<void>;
  inviteLink: WorkspaceInviteLink | null;
  inviteLinkLoading: boolean;
  onEnableInviteLink: (role: WorkspaceInviteRole) => Promise<void>;
  onUpdateInviteLinkRole: (role: WorkspaceInviteRole) => Promise<void>;
  onDisableInviteLink: () => Promise<void>;
  onCopyInviteLink: () => Promise<void>;
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
        onWorkspaceChange={props.onWorkspaceChange}
        onSearch={() => setSearchDialogOpen(true)}
        onSectionChange={(section) => {
          setAppSection(section);
          setSelectedTaskId(null);
          setMobileSidebar(false);
          setMindMapCreateLabel(null);
        }}
        onSettings={() => setSettingsDialogOpen(true)}
        onSignOut={props.onSignOut}
      />
      {appSection === "tasks" ? <Sidebar
        openMobile={mobileSidebar}
        bundle={props.bundle}
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
          onUpdateLabel={props.onUpdateLabel}
          onSetLabelPermission={props.onSetLabelPermission}
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
            attachmentService={props.attachmentService}
            now={now}
            dateTimePreferences={props.dateTimePreferences}
            onClose={() => setSelectedTaskId(null)}
            onUpdate={(patch) => props.onUpdateTask(selectedTask.id, patch)}
            onLoadAssignees={() => props.onLoadTaskAssignees(selectedTask.id)}
            onAssign={(assigneeId) =>
              props.onAssignTask(selectedTask.id, assigneeId)}
            onToggleLabel={props.onToggleTaskLabel}
            onCreateSubtask={(title) => props.onCreateSubtask(selectedTask.id, title)}
            onToggleSubtask={props.onToggleSubtask}
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
          attachmentService={props.attachmentService}
          now={now}
          dateTimePreferences={props.dateTimePreferences}
          onClose={() => setSelectedTaskId(null)}
          onUpdate={(patch) => props.onUpdateTask(selectedTask.id, patch)}
          onLoadAssignees={() => props.onLoadTaskAssignees(selectedTask.id)}
          onAssign={(assigneeId) => props.onAssignTask(selectedTask.id, assigneeId)}
          onToggleLabel={props.onToggleTaskLabel}
          onCreateSubtask={(title) => props.onCreateSubtask(selectedTask.id, title)}
          onToggleSubtask={props.onToggleSubtask}
        />
      )}
      {mindMapCreateLabel && (
        <CreateLabelDialog
          labels={props.bundle.labels}
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
        bundle={props.bundle}
        workspaceName={workspace.name}
        online={props.online}
        inviteLink={props.inviteLink}
        inviteLinkLoading={props.inviteLinkLoading}
        onEnableInviteLink={props.onEnableInviteLink}
        onUpdateInviteLinkRole={props.onUpdateInviteLinkRole}
        onDisableInviteLink={props.onDisableInviteLink}
        onCopyInviteLink={props.onCopyInviteLink}
        onUpdateMemberRole={props.onUpdateMemberRole}
        onUpdateWorkspace={props.onUpdateWorkspace}
        onUpdateEmail={props.onUpdateEmail}
        onDeleteAccount={props.onDeleteAccount}
        dateTimePreferences={props.dateTimePreferences}
        onUpdateDateTimePreferences={props.onUpdateDateTimePreferences}
        onNotice={props.onNotice}
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
  onWorkspaceChange,
  onSearch,
  onSectionChange,
  onSettings,
  onSignOut,
}: {
  activeSection: AppSection;
  online: boolean;
  userName: string;
  workspaces: Workspace[];
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  onSearch: () => void;
  onSectionChange: (section: AppSection) => void;
  onSettings: () => void;
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
      <button className="rail-button" aria-label="通知"><Bell /></button>
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
                        aria-label={`打开任务：${task.title}`}
                        onClick={() => onSelectTask(task.id)}
                      >
                        <span
                          className={clsx(
                            "task-search-status",
                            task.status,
                          )}
                          aria-hidden="true"
                        >
                          {task.status === "completed" ? (
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
  online,
  smartView,
  selectedLabelId,
  onCloseMobile,
  onSmartView,
  onLabel,
  onCreateLabel,
  onUpdateLabel,
  onDeleteLabel,
  onMergeLabel,
  onMoveLabelToInbox,
}: {
  openMobile: boolean;
  bundle: WorkspaceBundle;
  online: boolean;
  smartView: SmartView;
  selectedLabelId: string | null;
  onCloseMobile: () => void;
  onSmartView: (view: SmartView) => void;
  onLabel: (id: string) => void;
  onCreateLabel: (name: string, parentId: string | null, color?: string) => Promise<void>;
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
  const openTasks = bundle.tasks.filter((task) => task.status === "open");
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
        <CreateLabelDialog
          labels={labels}
          parentId={creatingLabel.parentId}
          online={online}
          onClose={() => setCreatingLabel(null)}
          onCreate={onCreateLabel}
        />
      )}
      {editingLabel && (
        <EditLabelDialog
          label={editingLabel}
          online={online}
          onClose={() => setEditingLabel(null)}
          onUpdate={onUpdateLabel}
        />
      )}
      {mergingLabel && (
        <MergeLabelDialog
          source={mergingLabel}
          labels={labels}
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
          draggable={!label.id.startsWith("optimistic-")}
          onDragStart={(event) => {
            if (label.id.startsWith("optimistic-")) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", label.id);
            onDragStart(label.id);
          }}
          onDragEnd={onDragEnd}
          onDragOver={(event) => {
            if (label.id.startsWith("optimistic-")) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            onDragOver(label.id);
          }}
          onDrop={(event) => {
            if (label.id.startsWith("optimistic-")) return;
            event.preventDefault();
            onDrop(label.id);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            if (label.id.startsWith("optimistic-")) return;
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
          {label.visibility !== "workspace" && <LockKeyhole size={12} />}
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

function CreateLabelDialog({
  labels,
  parentId: initialParentId,
  online,
  onClose,
  onCreate,
}: {
  labels: Label[];
  parentId: string | null;
  online: boolean;
  onClose: () => void;
  onCreate: (name: string, parentId: string | null, color?: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_LABEL_COLOR);
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const normalizedName = name.trim();
  const customColorSelected = hasExplicitLabelColor(color)
    && !LABEL_COLORS.some((option) => option === color);
  const noneColorSelected = !hasExplicitLabelColor(color);

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
    if (!normalizedName || saving || !online) return;
    setSaving(true);
    setError("");
    try {
      await onCreate(normalizedName, parentId, color);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "标签创建失败，请重试");
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay edit-label-overlay" />
        <Dialog.Content className="dialog-content edit-label-dialog create-label-dialog">
          <Dialog.Close className="edit-label-close" aria-label="关闭添加标签">
            <X />
          </Dialog.Close>
          <Dialog.Title>添加标签</Dialog.Title>
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
            <label className="edit-label-parent-field">
              <span>上级标签</span>
              <span className="edit-label-parent-select">
                <select
                  value={parentId ?? ""}
                  disabled={!online || saving}
                  onChange={(event) =>
                    setParentId(event.target.value || null)}
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
            {error && <p className="edit-label-error" role="alert">{error}</p>}
            {!online && <p className="edit-label-error">离线状态下不可创建标签。</p>}
            <div className="edit-label-actions">
              <button type="button" className="button" onClick={onClose}>关闭</button>
              <button
                type="submit"
                className="button primary"
                disabled={!online || saving || !normalizedName}
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
  onUpdateLabel,
  onSetLabelPermission,
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
  onUpdateLabel: WorkspaceAppProps["onUpdateLabel"];
  onSetLabelPermission: WorkspaceAppProps["onSetLabelPermission"];
  dateTimePreferences: DateTimePreferences;
  onSaveTaskListPreference: WorkspaceAppProps["onSaveTaskListPreference"];
  onCreateTaskSection: WorkspaceAppProps["onCreateTaskSection"];
  onUpdateTaskSection: WorkspaceAppProps["onUpdateTaskSection"];
  onDeleteTaskSection: WorkspaceAppProps["onDeleteTaskSection"];
  onSetTaskListOrder: WorkspaceAppProps["onSetTaskListOrder"];
}) {
  const [quickTitle, setQuickTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [labelSettingsOpen, setLabelSettingsOpen] = useState(false);
  const selectedLabel = bundle.labels.find((label) => label.id === selectedLabelId);
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
    online && preference.grouping === "none" && preference.sort === "custom";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
      tasks.filter((task) => task.status === "completed"),
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
          <span>{tasks.filter((task) => task.status === "open").length}</span>
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
            showLabels={preference.show_labels}
            online={online}
            onOpenPermissions={() => setLabelSettingsOpen(true)}
            onToggleShowLabels={() =>
              void savePreference({ show_labels: !preference.show_labels })}
          />
        </div>
      </header>
      <form className="quick-add" onSubmit={submitQuickTask}>
        <Plus />
        <input
          value={quickTitle}
          onChange={(event) => setQuickTitle(event.target.value)}
          placeholder={online ? `添加任务至“${selectedLabel?.name ?? title}”` : "离线状态下不可新增任务"}
          disabled={!online || busy}
        />
        {quickTitle && <kbd>Enter</kbd>}
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
                onSelect={onSelectTask}
                onToggle={async (task) =>
                  onUpdateTask(task.id, {
                    status: task.status === "completed" ? "open" : "completed",
                    completed_at: task.status === "completed" ? null : new Date().toISOString(),
                  })
                }
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
            onSelect={onSelectTask}
            onToggle={async (task) =>
              onUpdateTask(task.id, { status: "open", completed_at: null })}
          />
        )}
      </div>
      {selectedLabel && (
        <LabelSettingsDialog
          open={labelSettingsOpen}
          onOpenChange={setLabelSettingsOpen}
          label={selectedLabel}
          bundle={bundle}
          online={online}
          onUpdate={onUpdateLabel}
          onSetPermission={onSetLabelPermission}
        />
      )}
    </>
  );
}

function LabelActionsMenu({
  hasSelectedLabel,
  showLabels,
  online,
  onOpenPermissions,
  onToggleShowLabels,
}: {
  hasSelectedLabel: boolean;
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
          {hasSelectedLabel && (
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

function LabelSettingsDialog({
  open,
  onOpenChange,
  label,
  bundle,
  online,
  onUpdate,
  onSetPermission,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: Label;
  bundle: WorkspaceBundle;
  online: boolean;
  onUpdate: WorkspaceAppProps["onUpdateLabel"];
  onSetPermission: WorkspaceAppProps["onSetLabelPermission"];
}) {
  const assignableMembers = bundle.members.filter(
    (member) => member.user_id !== label.created_by,
  );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content label-settings">
          <Dialog.Title>{label.name} · 权限</Dialog.Title>
          <Dialog.Description>
            子标签默认继承父级权限；指定成员可获得查看或编辑权限。
          </Dialog.Description>
          <label className="settings-field">
            <span>可见性</span>
            <select
              value={label.visibility}
              disabled={!online}
              onChange={(event) =>
                void onUpdate(label.id, {
                  visibility: event.target.value as LabelVisibility,
                })
              }
            >
              <option value="workspace">团队可见</option>
              <option value="private">仅自己</option>
              <option value="restricted">指定成员</option>
            </select>
          </label>
          {label.parent_id && (
            <label className="settings-check">
              <input
                type="checkbox"
                checked={label.inherit_permissions}
                disabled={!online}
                onChange={(event) =>
                  void onUpdate(label.id, {
                    inherit_permissions: event.target.checked,
                  })
                }
              />
              <span>
                <strong>继承父标签权限</strong>
                <em>继承模式只允许在本层进一步收紧</em>
              </span>
            </label>
          )}
          {label.visibility === "restricted" && (
            <div className="permission-list">
              {assignableMembers.length === 0 ? (
                <p>团队中暂无其他成员。</p>
              ) : (
                assignableMembers.map((member) => {
                  const acl = bundle.labelAcls.find(
                    (item) =>
                      item.label_id === label.id && item.user_id === member.user_id,
                  );
                  return (
                    <label key={member.user_id}>
                      <span className="member-avatar">
                        {initials(member.profile?.display_name ?? "成员")}
                      </span>
                      <strong>{member.profile?.display_name ?? "团队成员"}</strong>
                      <select
                        value={acl?.permission ?? "none"}
                        disabled={!online}
                        onChange={(event) =>
                          void onSetPermission(
                            label.id,
                            member.user_id,
                            event.target.value as "none" | "view" | "edit",
                          )
                        }
                      >
                        <option value="none">不可见</option>
                        <option value="view">可查看</option>
                        <option value="edit">可编辑</option>
                      </select>
                    </label>
                  );
                })
              )}
            </div>
          )}
          <Dialog.Close className="dialog-close"><X /></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
  editableSection,
  onRenameSection,
  onDeleteSection,
  onSelect,
  onToggle,
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
  editableSection?: TaskSection;
  onRenameSection?: (sectionId: string, name: string) => Promise<void>;
  onDeleteSection?: (sectionId: string) => Promise<void>;
  onSelect: (id: string) => void;
  onToggle: (task: Task) => Promise<void>;
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
              online={online}
              now={now}
              showLabels={showLabels}
              draggable={draggable}
              onSelect={() => onSelect(task.id)}
              onToggle={() => onToggle(task)}
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
  onSelect,
  onToggle,
}: {
  task: Task;
  labels: Label[];
  members: Member[];
  selected: boolean;
  online: boolean;
  now: Date;
  showLabels?: boolean;
  draggable?: boolean;
  onSelect: () => void;
  onToggle: () => Promise<void>;
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
  return (
    <article
      ref={setNodeRef}
      className={clsx(
        "task-row",
        selected && "selected",
        task.status === "completed" && "completed",
        isDragging && "dragging",
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 2 : undefined,
      }}
    >
      {task.priority !== "none" && (
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
          aria-label={`拖动任务“${task.title}”`}
          {...attributes}
          {...listeners}
        >
          <GripVertical />
        </button>
      )}
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
            {task.subtasks.length > 0 && (
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
  );
}

function TeamManagementPanel({
  workspace,
  online,
  inviteLink,
  inviteLinkLoading,
  onEnableInviteLink,
  onUpdateInviteLinkRole,
  onDisableInviteLink,
  onCopyInviteLink,
  onUpdateWorkspace,
  onNotice,
}: {
  workspace: Workspace;
  online: boolean;
  inviteLink: WorkspaceInviteLink | null;
  inviteLinkLoading: boolean;
  onEnableInviteLink: (role: WorkspaceInviteRole) => Promise<void>;
  onUpdateInviteLinkRole: (role: WorkspaceInviteRole) => Promise<void>;
  onDisableInviteLink: () => Promise<void>;
  onCopyInviteLink: () => Promise<void>;
  onUpdateWorkspace: WorkspaceAppProps["onUpdateWorkspace"];
  onNotice: (message: string) => void;
}) {
  const canManage = workspace.role === "owner" || workspace.role === "admin";
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState("");
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
      await onUpdateWorkspace({ name: nextName, slug: nextSlug });
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
      if (enabled) await onEnableInviteLink(activeInviteRole);
      else await onDisableInviteLink();
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
      await onUpdateInviteLinkRole(role);
    } catch {
      setInviteError("邀请身份暂时无法更新。");
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div className="team-mgmt-settings-panel">
      <h1>团队管理</h1>
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
                disabled={!online || inviteBusy || inviteLinkLoading}
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
              onClick={() => void onCopyInviteLink()}
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
            <div>
              <strong>{member.profile?.display_name ?? "团队成员"}</strong>
              <span>{member.role === "owner" ? "所有者" : member.role === "admin" ? "管理员" : "成员"}</span>
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
  bundle,
  workspaceName,
  online,
  inviteLink,
  inviteLinkLoading,
  onEnableInviteLink,
  onUpdateInviteLinkRole,
  onDisableInviteLink,
  onCopyInviteLink,
  onUpdateMemberRole,
  onUpdateWorkspace,
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
  bundle: WorkspaceBundle;
  workspaceName: string;
  online: boolean;
  inviteLink: WorkspaceInviteLink | null;
  inviteLinkLoading: boolean;
  onEnableInviteLink: WorkspaceAppProps["onEnableInviteLink"];
  onUpdateInviteLinkRole: WorkspaceAppProps["onUpdateInviteLinkRole"];
  onDisableInviteLink: WorkspaceAppProps["onDisableInviteLink"];
  onCopyInviteLink: WorkspaceAppProps["onCopyInviteLink"];
  onUpdateMemberRole: WorkspaceAppProps["onUpdateMemberRole"];
  onUpdateWorkspace: WorkspaceAppProps["onUpdateWorkspace"];
  onUpdateEmail: WorkspaceAppProps["onUpdateEmail"];
  onDeleteAccount: WorkspaceAppProps["onDeleteAccount"];
  dateTimePreferences: DateTimePreferences;
  onUpdateDateTimePreferences: WorkspaceAppProps["onUpdateDateTimePreferences"];
  onNotice: (message: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("account");
  const [accountAction, setAccountAction] = useState<"email" | "delete" | null>(null);
  const [emailDraft, setEmailDraft] = useState(email);
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
    setEmailDraft(email);
    setDeleteConfirmation("");
    setAccountError("");
  }, [open]);

  function closeAccountAction() {
    if (accountBusy) return;
    setAccountAction(null);
    setAccountError("");
    setDeleteConfirmation("");
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
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" className="account-avatar" />
                  ) : (
                    <span className="account-avatar account-avatar-fallback">
                      {initials(userName)}
                    </span>
                  )}
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
                      <span>邮箱</span>
                      <div className="account-setting-value">
                        <strong>{email || "未设置"}</strong>
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
              <TeamManagementPanel
                workspace={workspace}
                online={online}
                inviteLink={inviteLink}
                inviteLinkLoading={inviteLinkLoading}
                onEnableInviteLink={onEnableInviteLink}
                onUpdateInviteLinkRole={onUpdateInviteLinkRole}
                onDisableInviteLink={onDisableInviteLink}
                onCopyInviteLink={onCopyInviteLink}
                onUpdateWorkspace={onUpdateWorkspace}
                onNotice={onNotice}
              />
            ) : activeTab === "team" ? (
              <TeamSettingsPanel
                workspace={workspace}
                bundle={bundle}
                online={online}
                onUpdateMemberRole={onUpdateMemberRole}
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
            {accountAction === "email" ? (
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
