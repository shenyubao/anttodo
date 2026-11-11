import { useEffect, useState } from "react";
import { OPEN_OPERATIONS } from "../supabase/functions/_shared/open-api-contract";
import { openApiBaseUrl } from "./lib/openPlatform";

const sections=["快速开始","认证与权限","列表与标签","分页与并发","错误处理"];
const prose:Record<string,string>={
  "快速开始":"在设置 → 开放平台创建个人 Token，或注册 OAuth 应用。每次请求使用 Authorization: Bearer YOUR_TOKEN。建议为每个集成单独授权，便于独立撤销。",
  "认证与权限":"个人 Token 仅显示一次，默认只读、90 天有效。OAuth 使用授权码与 PKCE S256，支持刷新。标准 profile scope 用于身份资料；团队空间及任务读写、删除能力在授权页面单独选择。有效权限始终与你当前的团队空间和标签权限取交集。",
  "列表与标签":"List 包含系统视图、自定义视图和标签。收集箱不是标签；创建无标签任务会进入收集箱。标签列表创建时附加该标签。智能视图创建需要明确目标。标签间移动只替换来源标签，保留其他标签；移入收集箱会清空全部标签。按 capabilities 判断允许的操作。",
  "分页与并发":"任务查询支持 list_id、status、assignee_id（可为 me）、q、timezone、limit、cursor。默认 100 条，最多 200 条，使用 next_cursor 获取下一页。修改已有任务必须发送 If-Match: \"版本\"；缺失返回 428，冲突返回 412。写操作可发送 Idempotency-Key，同一个键和请求在 24 小时内不会重复执行；同键不同请求返回 409。只对手动排序的标签列表开放重排。离线时仅查看缓存，不允许写入。",
  "错误处理":"错误统一返回 code、message、request_id。400 参数错误；401 凭据失效；403 超出权限；404 资源不存在或不可见；409 状态或幂等冲突；412 版本过期；428 缺少版本；429 限流（读取 Retry-After）。每个授权每分钟最多 120 次 API 请求。",
};
export function OpenApiTokenResult() {
  const [token,setToken]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get("token")??"");
  useEffect(()=>{window.history.replaceState(null,"",window.location.pathname);},[]);
  return <main className="cli-auth-screen"><section className="cli-auth-card open-platform"><h1>个人 Token 已创建</h1><p>完整 Token 仅显示一次。离开页面后无法再次查看，可在开放平台撤销。</p>{token?<><code className="open-secret">{token}</code><button className="button primary" onClick={()=>void navigator.clipboard.writeText(token)}>复制 Token</button><button className="button secondary" onClick={()=>setToken("")}>已保存，隐藏 Token</button></>:<p>Token 已隐藏或不可用，请返回开放平台查看授权记录。</p>}<a href="/">返回蚂蚁清单</a></section></main>;
}
export function OpenApiDocs() {
  const [section,setSection]=useState("快速开始"),[opIndex,setOpIndex]=useState(0),[testing,setTesting]=useState(false),[token,setToken]=useState(""),[workspace,setWorkspace]=useState(""),[task,setTask]=useState(""),[payload,setPayload]=useState("{}"),[version,setVersion]=useState(""),[result,setResult]=useState(""),[busy,setBusy]=useState(false);
  const [workspaces,setWorkspaces]=useState<{id:string;name:string}[]>([]);
  const base=openApiBaseUrl(),op=OPEN_OPERATIONS[opIndex];
  const path=op[1].replace("{workspace_id}",workspace||"WORKSPACE_ID").replace("{task_id}",task||"TASK_ID");
  const curl=`curl '${base}${path}' -X ${op[0]} \\\n  -H 'Authorization: Bearer YOUR_TOKEN'${op[0]!=="GET"?` \\\n  -H 'Content-Type: application/json' \\\n  -H 'Idempotency-Key: UNIQUE_REQUEST_ID'${op[1].startsWith("/tasks/")?` \\\n  -H 'If-Match: "${version||"VERSION"}"'`:""} \\\n  -d '${payload.replaceAll("'","'\\''")}'`:""}`;
  const run=async(load=false)=>{
    setBusy(true);setResult("");
    try{
      if(!navigator.onLine)throw new Error("当前离线，无法运行请求");
      const body=op[0]==="GET"?undefined:JSON.stringify(JSON.parse(payload));
      const response=await fetch(`${base}${load?"/workspaces":path}`,{method:load?"GET":op[0],headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",...(version?{"If-Match":`"${version}"`}:{}),...(body?{"Idempotency-Key":crypto.randomUUID()}: {})},body:load?undefined:body,redirect:"error"});
      const data=await response.json();setResult(`${response.status}\n${JSON.stringify(data,null,2)}`);
      if(load&&response.ok&&Array.isArray(data)){setWorkspaces(data);if(!workspace&&data[0])setWorkspace(data[0].id);}
    }catch(error){setResult(error instanceof Error?error.message:"请求失败");}finally{setBusy(false);}
  };
  return <main className="open-docs"><header><a href="/">蚂蚁清单</a><h1>OpenAPI</h1><a href={`${base}/openapi.json`} target="_blank" rel="noreferrer">OpenAPI JSON ↗</a></header><div className="open-docs-layout"><aside aria-label="文档目录"><h3>开始使用</h3>{sections.map(s=><button className={s===section?"active":""} key={s} onClick={()=>setSection(s)}>{s}</button>)}<h3>接口</h3>{OPEN_OPERATIONS.map((o,i)=><button className={section==="接口"&&opIndex===i?"active":""} key={o[0]+o[1]} onClick={()=>{setSection("接口");setOpIndex(i);setPayload(o[3]==="create"?'{"title":"新任务","list_id":"inbox"}':"{}");}}><small>{o[0]}</small>{o[2]}</button>)}</aside><article><div className="open-docs-title"><h2>{section==="接口"?op[2]:section}</h2><button className="button secondary" onClick={()=>setTesting(!testing)}>{testing?"收起测试面板":"测试运行"}</button></div><small>BASE URL</small><code>{base}</code><p>{section==="接口"?`${op[0]} ${op[1]}`:prose[section]}</p><h3>请求示例</h3><pre>{curl}</pre><button onClick={()=>void navigator.clipboard.writeText(curl)}>复制 cURL</button>
      {testing&&<section className="open-card open-debug"><h3>测试运行</h3><p>当前实例：<strong>{base}</strong></p><p>新增、修改、删除会改变真实数据。Token 仅保存在当前页面内存。</p><label>Bearer Token<input type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="off"/></label><button disabled={!token||busy} onClick={()=>void run(true)}>加载团队空间</button><label>团队空间<select aria-label="团队空间" value={workspace} onChange={e=>setWorkspace(e.target.value)}><option value="">请选择团队空间</option>{workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>操作<select aria-label="操作" value={opIndex} onChange={e=>setOpIndex(+e.target.value)}>{OPEN_OPERATIONS.map((o,i)=><option key={i} value={i}>{o[0]} {o[2]}</option>)}</select></label>{op[1].includes("{task_id}")&&<><label>任务 ID<input value={task} onChange={e=>setTask(e.target.value)}/></label><label>任务版本（If-Match）<input value={version} onChange={e=>setVersion(e.target.value)}/></label></>}{op[0]!=="GET"&&<label>请求参数 JSON<textarea value={payload} onChange={e=>setPayload(e.target.value)} rows={6}/></label>}<code>{op[0]} {path}</code><button className="button primary" disabled={!token||busy} onClick={()=>void run()}>{busy?"请求中…":op[0]==="GET"?"运行查询":"运行写操作（修改真实数据）"}</button><pre aria-live="polite">{result||"尚未运行"}</pre></section>}
    </article></div></main>;
}
