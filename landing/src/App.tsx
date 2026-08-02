import {
  Apple,
  Bell,
  Building2,
  Check,
  ChevronRight,
  Cloud,
  Download,
  LayoutList,
  Menu,
  Smartphone,
  Sparkles,
  Tag,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
const DOWNLOAD_PATH = "/download";
const SESSION_APP_ORIGIN = import.meta.env.DEV ? "http://127.0.0.1:5173" : APP_ORIGIN;
const SUPPORT_EMAIL = "support@anttodo.com";

type ProductSceneImage = { src: string; alt: string };

type ProductScene = {
  id: string;
  icon: typeof Cloud;
  title: string;
  points: string[];
  images: ProductSceneImage[];
};

const productScenes: ProductScene[] = [
  {
    id: "collect",
    icon: Cloud,
    title: "待办收集",
    points: ["桌面端、WEB端、移动端全覆盖", "CLI助力Agent"],
    images: [
      { src: "/product/collect.jpg", alt: "蚂蚁清单待办收集：任务列表、标签树与详情面板" },
    ],
  },
  {
    id: "organize",
    icon: Tag,
    title: "待办整理",
    points: ["无限级标签体系", "日历整理模式", "思维导图整理模式", "Agent智能整理"],
    images: [
      { src: "/product/organize-mindmap.jpg", alt: "蚂蚁清单思维导图整理模式，按时间与标签展开任务" },
      { src: "/product/organize-calendar.jpg", alt: "蚂蚁清单日历整理模式，按月查看与安排任务" },
    ],
  },
  {
    id: "followup",
    icon: Bell,
    title: "待办跟进",
    points: ["自定义多级提醒", "全平台推送", "持续提醒模式"],
    images: [
      { src: "/product/followup.jpg", alt: "蚂蚁清单待办跟进：多级提醒与持续提醒设置" },
    ],
  },
  {
    id: "enterprise",
    icon: Building2,
    title: "企业级能力",
    points: ["单点登录", "用户组管理", "标签级权限", "瓶颈洞察", "外部连接器"],
    images: [
      { src: "/product/enterprise-permissions.jpg", alt: "蚂蚁清单标签级权限与用户组管理" },
      { src: "/product/enterprise-sso.jpg", alt: "蚂蚁清单企业级单点登录设置" },
    ],
  },
];

const PRODUCT_ROTATE_MS = 3_600;

function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/privacy") return <PrivacyPage />;
  if (path === "/support") return <SupportPage />;
  if (path === DOWNLOAD_PATH) return <DownloadPage />;
  return <MarketingApp />;
}

function useMacDownloads() {
  const [downloads, setDownloads] = useState<MacDownloads>(() => fallbackMacDownloads());

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

  return downloads;
}

function MarketingApp() {
  const sessionFrameRef = useRef<HTMLIFrameElement>(null);
  const skipSessionCheck = import.meta.env.DEV
    && new URLSearchParams(window.location.search).get("preview") === "1";

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

      <SiteHeader
        brandHref="#top"
        featuresHref="#features"
        membershipHref="#membership"
      />

      <main>
        <section id="top" className="hero">
          <div className="hero-orb hero-orb-one" aria-hidden="true" />
          <div className="hero-orb hero-orb-two" aria-hidden="true" />
          <div className="container hero-content">
            <h1>让团队里没有跟丢的待办</h1>
            <p className="hero-copy">蚂蚁清单，帮你收集、整理、跟进 整个团队的待办事项</p>
            <div className="hero-actions">
              <a className="button button-primary" href={LOGIN_URL}>立即使用 Web 版 <ChevronRight /></a>
              <a className="button button-secondary" href={DOWNLOAD_PATH}><Apple /> 下载 Mac 版</a>
            </div>
            <div id="features">
              <ProductShowcase />
            </div>
          </div>
        </section>

        <section id="membership" className="section membership-section">
          <div className="container">
            <SectionHeading kicker="高级会员" title="三档方案，按团队阶段扩展。" copy="先免费上手，再按整理能力、AI 用量与企业需求升级。价格将另行公布。" centered />
            <div className="pricing-grid">
              <PlanCard
                icon={<Users />}
                title="免费会员"
                copy="适合个人与小团队快速上手协作。"
                features={[
                  "全平台支持",
                  "待办提醒",
                  "团队成员：2",
                  "标签数量：30",
                  "单标签待办数量：100",
                ]}
                cta="免费开始"
                href={LOGIN_URL}
                secondary
              />
              <PlanCard
                icon={<Sparkles />}
                title="初创团队"
                copy="适合需要更强整理能力与企业连接的成长团队。"
                features={[
                  "免费会员所有能力",
                  "待办整理：日历模式 / 思维导图模式",
                  "AI能力：1000点数",
                  "标签数量：1000",
                  "单标签待办数量：2000",
                  "企业能力：单点登录、办公IM通知",
                ]}
                cta="登录升级"
                href={LOGIN_URL}
                featured
              />
              <PlanCard
                icon={<Building2 />}
                title="大型团队"
                copy="适合需要品牌定制、私有化与无限规模的组织。"
                features={[
                  "自定义品牌（域名、品牌、Logo）",
                  "独立部署",
                  "自有AI模型",
                  "无限量坐席",
                  "无限量待办",
                ]}
                cta="联系咨询"
                href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("蚂蚁清单大型团队咨询")}`}
              />
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

      <SiteFooter
        brandHref="#top"
        featuresHref="#features"
        membershipHref="#membership"
      />
    </div>
  );
}

function DownloadPage() {
  const downloads = useMacDownloads();

  return (
    <div className="site-shell download-page-shell">
      <SiteHeader
        brandHref="/"
        featuresHref="/#features"
        membershipHref="/#membership"
        downloadActive
      />

      <main className="download-page">
        <section className="section download-section">
          <div className="container download-wrap">
            <div className="download-copy">
              <div className="platform-mark"><Apple /></div>
              <div className="eyebrow"><span /> Mac 版现已上线</div>
              <h1>在桌面上，把 Action 推进到底。</h1>
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
      </main>

      <SiteFooter
        brandHref="/"
        featuresHref="/#features"
        membershipHref="/#membership"
      />
    </div>
  );
}

function SiteHeader({
  brandHref,
  featuresHref,
  membershipHref,
  downloadActive = false,
}: {
  brandHref: string;
  featuresHref: string;
  membershipHref: string;
  downloadActive?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header">
      <div className="container nav-wrap">
        <a className="brand" href={brandHref} aria-label="蚂蚁清单首页" onClick={closeMenu}>
          <img src="/anttodo-icon.png" alt="" />
          <span>蚂蚁清单</span>
        </a>
        <nav className="desktop-nav" aria-label="官网导航">
          <a href={featuresHref}>功能</a>
          <a href={membershipHref}>高级会员</a>
          <a href={DOWNLOAD_PATH} aria-current={downloadActive ? "page" : undefined}>下载</a>
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
        <a href={featuresHref} onClick={closeMenu}>功能</a>
        <a href={membershipHref} onClick={closeMenu}>高级会员</a>
        <a href={DOWNLOAD_PATH} aria-current={downloadActive ? "page" : undefined} onClick={closeMenu}>下载</a>
        <a href={LOGIN_URL}>登录 / 打开应用</a>
      </nav>
    </header>
  );
}

function SiteFooter({
  brandHref,
  featuresHref,
  membershipHref,
}: {
  brandHref: string;
  featuresHref: string;
  membershipHref: string;
}) {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <a className="brand" href={brandHref}>
            <img src="/anttodo-icon.png" alt="" />
            <span>蚂蚁清单</span>
          </a>
          <p>让团队里没有跟丢的待办</p>
        </div>
        <nav aria-label="页脚导航">
          <a href={featuresHref}>功能</a>
          <a href={membershipHref}>高级会员</a>
          <a href={DOWNLOAD_PATH}>下载</a>
          <a href={DOCS_URL}>产品文档</a>
          <a href="/support">技术支持</a>
          <a href="/privacy">隐私政策</a>
          <a href={LOGIN_URL}>登录</a>
        </nav>
        <p className="copyright">© {new Date().getFullYear()} AntTodo. All rights reserved.</p>
      </div>
    </footer>
  );
}

function LegalHeader() {
  return (
    <header className="legal-header">
      <div className="container legal-nav">
        <a className="brand" href="/" aria-label="返回蚂蚁清单首页">
          <img src="/anttodo-icon.png" alt="" />
          <span>蚂蚁清单</span>
        </a>
        <nav aria-label="帮助导航">
          <a href="/support">技术支持</a>
          <a href="/privacy">隐私政策</a>
        </nav>
      </div>
    </header>
  );
}

function LegalFooter() {
  return (
    <footer className="legal-footer">
      <div className="container">
        <span>© {new Date().getFullYear()} AntTodo</span>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </div>
    </footer>
  );
}

function PrivacyPage() {
  return (
    <div className="legal-shell">
      <LegalHeader />
      <main className="container legal-page">
        <span className="legal-kicker">ANTTODO PRIVACY</span>
        <h1>隐私政策</h1>
        <p className="legal-lead">蚂蚁清单尊重并保护你的隐私。本政策说明我们在提供 Web、macOS 与 iOS 服务时如何处理信息。</p>
        <p className="legal-updated">更新日期：2026 年 8 月 2 日</p>

        <section>
          <h2>我们处理的信息</h2>
          <p>为完成登录与账号管理，我们会处理你主动提供的手机号、电子邮箱或企业联合登录标识。为提供任务协作功能，我们会存储你创建的任务、标签、评论、附件、提醒、团队空间信息以及你选择上传的头像。</p>
          <p>服务运行期间可能产生必要的设备、网络、操作日志与崩溃诊断信息，用于保障安全、排查故障和改进稳定性。</p>
        </section>

        <section>
          <h2>使用目的</h2>
          <ul>
            <li>提供身份验证、任务管理、同步、提醒和团队协作功能；</li>
            <li>保护账号与服务安全，防止滥用并定位故障；</li>
            <li>响应你的支持请求并改进产品体验。</li>
          </ul>
        </section>

        <section>
          <h2>共享与第三方服务</h2>
          <p>我们不会出售你的个人信息，也不会将数据用于跨 App 或网站跟踪。为运行服务，我们会使用必要的云基础设施、身份认证、短信或企业登录服务商；这些服务商仅在提供相应能力所需的范围内处理信息。</p>
        </section>

        <section>
          <h2>存储、安全与保留</h2>
          <p>数据传输使用行业通用的加密连接。我们采用访问控制和最小权限原则保护数据。信息仅在提供服务、履行法定义务或解决争议所需的期限内保留。</p>
        </section>

        <section>
          <h2>你的选择与权利</h2>
          <p>你可以在应用内查看和修改个人资料，也可以在“账户设置”中申请删除账号。账号删除会按照产品提示处理关联数据；法律要求保留的信息除外。你也可以联系我们提出访问、更正或删除请求。</p>
        </section>

        <section>
          <h2>儿童隐私</h2>
          <p>蚂蚁清单不是面向 13 岁以下儿童设计的服务，我们不会有意收集 13 岁以下儿童的个人信息。</p>
        </section>

        <section>
          <h2>联系我们</h2>
          <p>如对本政策或个人信息处理有疑问，请发送邮件至 <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>。</p>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}

function SupportPage() {
  return (
    <div className="legal-shell">
      <LegalHeader />
      <main className="container legal-page support-page">
        <span className="legal-kicker">ANTTODO SUPPORT</span>
        <h1>技术支持</h1>
        <p className="legal-lead">我们会帮助你解决登录、同步、提醒、团队协作和账户管理相关问题。</p>

        <section className="support-grid">
          <article>
            <h2>快速体验</h2>
            <p>首次打开应用时，可点击“先查看产品演示”直接体验任务、标签、日历和思维导图，无需注册账号。</p>
          </article>
          <article>
            <h2>登录与同步</h2>
            <p>请确认网络连接可用，并使用手机号验证码或团队提供的企业登录入口。离线状态下应用仅提供只读访问。</p>
          </article>
          <article>
            <h2>提醒没有出现</h2>
            <p>请在 iPhone“设置”中允许蚂蚁清单发送通知，并确认任务提醒时间和系统时区设置正确。</p>
          </article>
          <article>
            <h2>账户与数据</h2>
            <p>头像、邮箱与账号删除入口位于应用内账户设置。删除账号前请确认不再需要相关团队空间与任务数据。</p>
          </article>
        </section>

        <section className="support-contact">
          <h2>联系支持</h2>
          <p>请描述设备型号、系统版本、问题发生步骤和错误提示，我们会尽快回复。</p>
          <a className="button button-primary" href={`mailto:${SUPPORT_EMAIL}`}>发送邮件至 {SUPPORT_EMAIL}</a>
          <a className="text-link" href={DOCS_URL}>查看产品文档 <ChevronRight /></a>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}

function SectionHeading({ kicker, title, copy, centered = false, light = false }: { kicker: string; title: string; copy: string; centered?: boolean; light?: boolean }) {
  return <div className={`section-heading ${centered ? "centered" : ""} ${light ? "light" : ""}`}><span className="kicker">{kicker}</span><h2>{title}</h2><p>{copy}</p></div>;
}

function ProductShowcase() {
  const [activeId, setActiveId] = useState(productScenes[0].id);
  const [imageIndex, setImageIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const activeScene = productScenes.find((scene) => scene.id === activeId) ?? productScenes[0];
  const activeImage = activeScene.images[Math.min(imageIndex, activeScene.images.length - 1)] ?? activeScene.images[0];

  const selectScene = (id: string) => {
    setActiveId(id);
    setImageIndex(0);
  };

  useEffect(() => {
    if (paused || activeScene.images.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setImageIndex((current) => (current + 1) % activeScene.images.length);
    }, PRODUCT_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [activeId, activeScene.images.length, paused]);

  return (
    <div className="product-showcase">
      <div className="product-showcase-nav" role="tablist" aria-label="产品能力预览">
        {productScenes.map((scene) => {
          const selected = scene.id === activeId;
          return (
            <button
              key={scene.id}
              id={`product-tab-${scene.id}`}
              className={`product-showcase-item${selected ? " active" : ""}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="product-showcase-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => selectScene(scene.id)}
              onMouseEnter={() => selectScene(scene.id)}
              onFocus={() => selectScene(scene.id)}
              onKeyDown={(event) => {
                const index = productScenes.findIndex((item) => item.id === scene.id);
                if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                  event.preventDefault();
                  const next = productScenes[(index + 1) % productScenes.length];
                  selectScene(next.id);
                  document.getElementById(`product-tab-${next.id}`)?.focus();
                }
                if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const prev = productScenes[(index - 1 + productScenes.length) % productScenes.length];
                  selectScene(prev.id);
                  document.getElementById(`product-tab-${prev.id}`)?.focus();
                }
              }}
            >
              <span className="product-showcase-icon" aria-hidden="true"><scene.icon /></span>
              <span className="product-showcase-copy">
                <strong>{scene.title}</strong>
                <ul>
                  {scene.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </span>
            </button>
          );
        })}
      </div>
      <div
        id="product-showcase-panel"
        className="product-showcase-panel"
        role="tabpanel"
        aria-labelledby={`product-tab-${activeScene.id}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <figure className="product-window">
          {productScenes.flatMap((scene) =>
            scene.images.map((image, index) => {
              const isActive = scene.id === activeId && index === Math.min(imageIndex, scene.images.length - 1);
              const isFirst = scene.id === productScenes[0].id && index === 0;
              return (
                <img
                  key={`${scene.id}-${image.src}-${index}`}
                  className={isActive ? "active" : undefined}
                  src={image.src}
                  alt={isActive ? image.alt : ""}
                  aria-hidden={!isActive}
                  loading={isFirst ? "eager" : "lazy"}
                  fetchPriority={isFirst ? "high" : "auto"}
                />
              );
            }),
          )}
        </figure>
        {activeScene.images.length > 1 && (
          <div className="product-showcase-dots" role="tablist" aria-label={`${activeScene.title}截图切换`}>
            {activeScene.images.map((image, index) => (
              <button
                key={`${activeScene.id}-dot-${index}`}
                type="button"
                className={`product-showcase-dot${index === Math.min(imageIndex, activeScene.images.length - 1) ? " active" : ""}`}
                aria-label={`查看${activeScene.title}第 ${index + 1} 张截图`}
                aria-current={index === Math.min(imageIndex, activeScene.images.length - 1) ? "true" : undefined}
                onClick={() => setImageIndex(index)}
              />
            ))}
          </div>
        )}
        <span className="sr-only">{activeImage.alt}</span>
      </div>
    </div>
  );
}

function PlanCard({
  icon,
  title,
  copy,
  features,
  cta,
  href,
  featured = false,
  secondary = false,
}: {
  icon: ReactNode;
  title: string;
  copy: string;
  features: string[];
  cta: string;
  href: string;
  featured?: boolean;
  secondary?: boolean;
}) {
  const buttonClass = featured ? "button-light" : secondary ? "button-secondary" : "button-primary";
  return (
    <article className={`plan-card${featured ? " featured" : ""}`}>
      <div className="plan-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{copy}</p>
      <ul>
        {features.map((feature) => (
          <li key={feature}><Check /> {feature}</li>
        ))}
      </ul>
      <a className={`button ${buttonClass}`} href={href}>{cta}<ChevronRight /></a>
    </article>
  );
}

function DownloadCard({ title, detail, href, recommended = false }: { title: string; detail: string; href: string; recommended?: boolean }) {
  return <a className="download-card" href={href} download><div><span>{title}</span><p>{detail}</p>{recommended && <em>推荐</em>}</div><Download aria-hidden="true" /></a>;
}

export default App;
