import {
  Apple,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Cloud,
  Download,
  Keyboard,
  LayoutList,
  Menu,
  Network,
  Smartphone,
  Sparkles,
  Tag,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  MAC_DOWNLOAD_MANIFEST,
  fallbackMacDownloads,
  parseMacDownloads,
  type MacDownloads,
} from "./downloadManifest";
import {
  APP_ORIGIN,
  isTrustedSessionMessage,
  sessionBridgeUrl,
} from "./sessionRedirect";

const LOGIN_URL = `${APP_ORIGIN}/`;
const DOCS_URL = "https://docs.anttodo.com/";
const SESSION_APP_ORIGIN = import.meta.env.DEV ? "http://127.0.0.1:5173" : APP_ORIGIN;

const collectFeatures = [
  { icon: Cloud, title: "Web 与 Mac", copy: "随时捕捉临时冒出的 Action，在浏览器与桌面端保持同步。", status: "已上线" },
  { icon: Smartphone, title: "全平台客户端", copy: "Windows、iOS 与 Android 客户端正在路上。", status: "即将上线" },
  { icon: Users, title: "办公机器人", copy: "从团队沟通现场直接收集待办，减少来回切换。", status: "即将上线" },
  { icon: Keyboard, title: "CLI", copy: "让开发者在终端中快速记录、查询与推进任务。", status: "即将上线" },
];

const organizeFeatures = [
  { icon: Tag, title: "标签体系", copy: "用可继承的树形标签组织个人任务与团队协作边界。" },
  { icon: CalendarDays, title: "日历模式", copy: "把任务放回时间里，看清每一天与每一周真正需要完成什么。" },
  { icon: Workflow, title: "思维导图模式", copy: "按月份、周、日期与标签展开任务，让复杂计划一览无余。" },
  { icon: Sparkles, title: "AI 整理收集箱", copy: "自动归类、补充上下文并给出整理建议。", comingSoon: true },
];

const reminderFeatures = [
  { icon: Bell, title: "系统提醒", copy: "在 Web 与 Mac 上及时收到任务提醒。" },
  { icon: CalendarDays, title: "重复提醒", copy: "按节奏自动生成下一次提醒，周期性事项不再靠记忆。" },
  { icon: Network, title: "艾宾浩斯提醒", copy: "让需要持续记忆与跟进的 Action 在合适的时间再次出现。" },
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloads, setDownloads] = useState<MacDownloads>(() => fallbackMacDownloads());
  const sessionFrameRef = useRef<HTMLIFrameElement>(null);
  const skipSessionCheck = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("preview") === "1";

  useEffect(() => {
    const controller = new AbortController();
    void fetch(MAC_DOWNLOAD_MANIFEST, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("download manifest unavailable");
        return response.json() as Promise<unknown>;
      })
      .then((value) => {
        const parsed = parseMacDownloads(value);
        if (parsed) setDownloads(parsed);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (skipSessionCheck) return;
    const timeout = window.setTimeout(() => {
      sessionFrameRef.current?.remove();
    }, 4_000);
    const receiveStatus = (event: MessageEvent) => {
      if (!isTrustedSessionMessage(
        event,
        sessionFrameRef.current?.contentWindow ?? null,
        SESSION_APP_ORIGIN,
      )) return;
      window.clearTimeout(timeout);
      sessionFrameRef.current?.remove();
      if (event.data.authenticated) window.location.replace(LOGIN_URL);
    };
    window.addEventListener("message", receiveStatus);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receiveStatus);
    };
  }, [skipSessionCheck]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="site-shell">
      {!skipSessionCheck && (
        <iframe
          ref={sessionFrameRef}
          className="session-check"
          src={sessionBridgeUrl(window.location.origin, SESSION_APP_ORIGIN)}
          title="检查登录状态"
          tabIndex={-1}
          aria-hidden="true"
        />
      )}

      <header className="site-header">
        <div className="container nav-wrap">
          <a className="brand" href="#top" aria-label="蚂蚁清单首页" onClick={closeMenu}>
            <img src="/anttodo-icon.png" alt="" />
            <span>蚂蚁清单</span>
          </a>
          <nav className="desktop-nav" aria-label="官网导航">
            <a href="#features">功能</a>
            <a href="#membership">高级会员</a>
            <a href="#download">下载</a>
          </nav>
          <div className="nav-actions">
            <a className="login-link" href={LOGIN_URL}>登录</a>
            <a className="button button-primary nav-cta" href={LOGIN_URL}>
              打开应用 <ChevronRight aria-hidden="true" />
            </a>
            <button
              className="menu-button"
              type="button"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? "关闭导航菜单" : "打开导航菜单"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {menuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        <nav id="mobile-nav" className={`mobile-nav ${menuOpen ? "open" : ""}`} aria-label="移动端导航">
          <a href="#features" onClick={closeMenu}>功能</a>
          <a href="#membership" onClick={closeMenu}>高级会员</a>
          <a href="#download" onClick={closeMenu}>下载</a>
          <a href={LOGIN_URL}>登录 / 打开应用</a>
        </nav>
      </header>

      <main>
        <section id="top" className="hero">
          <div className="hero-orb hero-orb-one" aria-hidden="true" />
          <div className="hero-orb hero-orb-two" aria-hidden="true" />
          <div className="container hero-content">
            <h1>让团队里没有跟丢的待办事项</h1>
            <p className="hero-copy">蚂蚁清单，帮你收集、整理、跟进 整个团队的待办事项</p>
            <div className="hero-actions">
              <a className="button button-primary" href={LOGIN_URL}>立即使用 Web 版 <ChevronRight /></a>
              <a className="button button-secondary" href="#download"><Apple /> 下载 Mac 版</a>
            </div>
            <p className="hero-note"><Check /> Web 与 Mac 已上线，核心任务随时同步</p>
            <ProductWindow src="/product/tasks.jpg" alt="蚂蚁清单任务列表：主导航栏、侧边栏、主工作区与任务详情布局" priority />
          </div>
        </section>

        <section id="features" className="section collect-section">
          <div className="container">
            <SectionHeading kicker="任务收集" title="Action 从哪里来，都先接住。" copy="灵感、承诺、会议结论和临时请求不必停留在脑海里。先快速进入收集箱，再选择合适的时间整理。" />
            <div className="collect-grid">
              {collectFeatures.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </section>

        <section className="section organize-section">
          <div className="container">
            <div className="split-heading">
              <SectionHeading kicker="任务整理" title="同一批任务，换个视角就清楚了。" copy="标签负责结构，日历负责时间，思维导图负责全貌。选择最符合当下思考方式的视图。" />
              <div className="mini-stat"><strong>3</strong><span>种原生整理视图</span></div>
            </div>
            <div className="organize-list">
              {organizeFeatures.map((feature) => (
                <article className="organize-item" key={feature.title}>
                  <feature.icon aria-hidden="true" />
                  <div><h3>{feature.title}</h3><p>{feature.copy}</p></div>
                  {feature.comingSoon && <span className="status status-soon">即将上线</span>}
                </article>
              ))}
            </div>
            <div className="showcase-grid">
              <div>
                <span className="showcase-label">日历模式</span>
                <ProductWindow src="/product/calendar.jpg" alt="蚂蚁清单日历模式，按月查看任务排期" />
              </div>
              <div>
                <span className="showcase-label">思维导图模式</span>
                <ProductWindow src="/product/mindmap.jpg" alt="蚂蚁清单思维导图模式，按时间与标签展开任务" />
              </div>
            </div>
          </div>
        </section>

        <section className="section reminder-section">
          <div className="container reminder-layout">
            <div>
              <SectionHeading kicker="任务提醒" title="把惦记交给系统，把注意力留给当下。" copy="一次提醒解决一次行动，重复提醒守住固定节奏，艾宾浩斯提醒帮助需要持续跟进的事情再次出现。" light />
              <a className="text-link light-link" href={LOGIN_URL}>开始安排第一个提醒 <ChevronRight /></a>
            </div>
            <div className="reminder-stack">
              {reminderFeatures.map((feature, index) => (
                <article className="reminder-card" key={feature.title} style={{ "--delay": `${index * 70}ms` } as CSSProperties}>
                  <div className="reminder-icon"><feature.icon /></div>
                  <div><h3>{feature.title}</h3><p>{feature.copy}</p></div>
                  <Check className="reminder-check" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="membership" className="section membership-section">
          <div className="container">
            <SectionHeading kicker="高级会员" title="为更重的任务量，也为更严谨的协作。" copy="首版只展示能力，不设置虚构价格。你可以先使用产品，再根据个人或团队需求选择升级方向。" centered />
            <div className="pricing-grid">
              <PlanCard
                icon={<Sparkles />}
                title="高级版"
                copy="适合希望把更多 Action 交给系统管理的高频用户。"
                features={["10 倍核心用量", "AI 收集箱整理（即将上线）", "AI 任务重排期（即将上线）"]}
                cta="登录使用"
                href={LOGIN_URL}
                featured
              />
              <PlanCard
                icon={<Building2 />}
                title="企业版"
                copy="适合需要统一身份、精细权限与私有化能力的团队。"
                features={["企业联合登录", "标签级权限控制", "独立部署", "数据洞察"]}
                cta="登录了解企业版"
                href={LOGIN_URL}
              />
            </div>
          </div>
        </section>

        <section id="download" className="section download-section">
          <div className="container download-wrap">
            <div className="download-copy">
              <div className="platform-mark"><Apple /></div>
              <div className="eyebrow"><span /> Mac 版现已上线</div>
              <h2>在桌面上，把 Action 推进到底。</h2>
              <p>原生系统提醒、安全的 Electron 外壳，以及和 Web 版共享的完整工作体验。</p>
              {downloads.version && <span className="version-pill">当前版本 v{downloads.version}</span>}
            </div>
            <div className="download-cards">
              <DownloadCard title="Apple Silicon" detail="适用于 M1、M2、M3、M4 及更新芯片" href={downloads.arm64} recommended />
              <DownloadCard title="Intel" detail="适用于 Intel 处理器 Mac" href={downloads.x64} />
              <div className="future-platforms">
                <span><Smartphone /> iOS / Android <em>即将上线</em></span>
                <span><LayoutList /> Windows <em>即将上线</em></span>
              </div>
            </div>
          </div>
        </section>

        <section className="final-cta">
          <div className="container final-cta-inner">
            <img src="/anttodo-icon.png" alt="" />
            <div><span>从今天开始</span><h2>不再跟丢下一个 Action。</h2></div>
            <a className="button button-light" href={LOGIN_URL}>打开蚂蚁清单 <ChevronRight /></a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-grid">
          <div className="footer-brand"><a className="brand" href="#top"><img src="/anttodo-icon.png" alt="" /><span>蚂蚁清单</span></a><p>让团队里没有跟丢的待办事项</p></div>
          <nav aria-label="页脚导航"><a href="#features">功能</a><a href="#membership">高级会员</a><a href="#download">下载</a><a href={DOCS_URL}>产品文档</a><a href={LOGIN_URL}>登录</a></nav>
          <p className="copyright">© {new Date().getFullYear()} AntTodo. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function SectionHeading({ kicker, title, copy, centered = false, light = false }: { kicker: string; title: string; copy: string; centered?: boolean; light?: boolean }) {
  return <div className={`section-heading ${centered ? "centered" : ""} ${light ? "light" : ""}`}><span className="kicker">{kicker}</span><h2>{title}</h2><p>{copy}</p></div>;
}

function FeatureCard({ icon: Icon, title, copy, status }: { icon: typeof Cloud; title: string; copy: string; status: string }) {
  const available = status === "已上线";
  return <article className={`feature-card ${available ? "available" : ""}`}><div className="feature-icon"><Icon /></div><span className={`status ${available ? "status-live" : "status-soon"}`}>{status}</span><h3>{title}</h3><p>{copy}</p></article>;
}

function ProductWindow({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return <figure className="product-window"><div className="window-bar" aria-hidden="true"><span /><span /><span /><em>蚂蚁清单</em></div><img src={src} alt={alt} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} /></figure>;
}

function PlanCard({ icon, title, copy, features, cta, href, featured = false }: { icon: ReactNode; title: string; copy: string; features: string[]; cta: string; href: string; featured?: boolean }) {
  return <article className={`plan-card ${featured ? "featured" : ""}`}><div className="plan-icon">{icon}</div><h3>{title}</h3><p>{copy}</p><ul>{features.map((feature) => <li key={feature}><Check /> {feature}</li>)}</ul><a className={`button ${featured ? "button-light" : "button-primary"}`} href={href}>{cta}<ChevronRight /></a></article>;
}

function DownloadCard({ title, detail, href, recommended = false }: { title: string; detail: string; href: string; recommended?: boolean }) {
  return <a className="download-card" href={href} download><div><span>{title}</span><p>{detail}</p>{recommended && <em>推荐</em>}</div><Download aria-hidden="true" /></a>;
}

export default App;
