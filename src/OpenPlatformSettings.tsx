import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { openPlatformRequest, useOpenPlatform } from "./lib/openPlatform";
import { supabase } from "./lib/supabase";
import { OPEN_API_PERMISSIONS, type OpenPermission } from "../supabase/functions/_shared/open-api-contract";

const permissionNames: Record<OpenPermission,string>={"tasks:read":"读取任务","tasks:write":"创建与修改任务","tasks:delete":"删除与恢复任务"};
function GrantFields({workspaces,ids,setIds,permissions,setPermissions,lifetime,setLifetime,disabled}:{workspaces:{id:string;name:string}[];ids:string[];setIds:(v:string[])=>void;permissions:OpenPermission[];setPermissions:(v:OpenPermission[])=>void;lifetime:string;setLifetime:(v:string)=>void;disabled:boolean}) {
  return <fieldset disabled={disabled} className="open-grant-fields"><legend>授权范围</legend><div><strong>团队空间</strong>{workspaces.map(w=><label key={w.id}><input type="checkbox" checked={ids.includes(w.id)} onChange={e=>setIds(e.target.checked?[...ids,w.id]:ids.filter(id=>id!==w.id))}/>{w.name}</label>)}</div><div><strong>操作权限</strong>{OPEN_API_PERMISSIONS.map(p=><label key={p}><input type="checkbox" disabled={p==="tasks:read"} checked={permissions.includes(p)} onChange={e=>setPermissions(e.target.checked?[...permissions,p]:permissions.filter(v=>v!==p))}/>{permissionNames[p]}</label>)}</div><label>有效期<select value={lifetime} onChange={e=>setLifetime(e.target.value)}><option value="7">7 天</option><option value="90">90 天</option><option value="360">360 天</option><option value="unlimited">无固定到期日</option></select></label></fieldset>;
}
export function OpenPlatformSettings({userId,online}:{userId:string;online:boolean}) {
  const {state,workspaces,mutation}=useOpenPlatform(userId,online);
  const [tab,setTab]=useState("tokens"),[name,setName]=useState(""),[ids,setIds]=useState<string[]>([]),[permissions,setPermissions]=useState<OpenPermission[]>(["tasks:read"]),[lifetime,setLifetime]=useState("90");
  const [appType,setAppType]=useState("confidential"),[redirects,setRedirects]=useState(""),[secret,setSecret]=useState("");
  const busy=!online||mutation.isPending;
  const submit=async()=>{
    const data=await mutation.mutateAsync(tab==="apps"?{action:"create_app",name,client_type:appType,redirect_uris:redirects.split(/\n/).map(s=>s.trim()).filter(Boolean)}:{action:"create_token",name,workspace_ids:ids,permissions,lifetime});
    if(typeof data.client_secret==="string") setSecret(data.client_secret);
    setName("");
  };
  return <section className="open-platform"><header><h2>开放平台</h2><p>使用个人 Token 或 OAuth，将蚂蚁清单接入 VisTab 和其他应用。</p><a href="/openapi" target="_blank" rel="noreferrer">查看 OpenAPI 文档 ↗</a></header>
    <nav className="open-tabs" aria-label="开放平台分类">{[["tokens","个人 Token"],["grants","已授权应用"],["apps","开发者应用"]].map(([id,title])=><button key={id} className={tab===id?"active":""} onClick={()=>{setTab(id);setSecret("");mutation.reset();}}>{title}</button>)}</nav>
    {!online&&<p role="status">当前离线，所有授权操作暂不可用。</p>}
    {state.isError&&<p role="alert">{state.error.message}</p>}
    {tab!=="grants"&&<form className="open-card" onSubmit={e=>{e.preventDefault();void submit().catch(()=>{});}}><h3>{tab==="tokens"?"创建个人 Token":"注册 OAuth 应用"}</h3><label>名称<input value={name} onChange={e=>setName(e.target.value)} maxLength={100} required disabled={busy} placeholder={tab==="tokens"?"例如：VisTab":"应用名称"}/></label>
      {tab==="tokens"?<GrantFields workspaces={workspaces.data??[]} ids={ids} setIds={setIds} permissions={permissions} setPermissions={setPermissions} lifetime={lifetime} setLifetime={setLifetime} disabled={busy}/>:<><label>客户端类型<select value={appType} onChange={e=>setAppType(e.target.value)} disabled={busy}><option value="confidential">Confidential · 服务端应用</option><option value="public">Public · 浏览器或移动端</option></select></label><label>回调地址（每行一个，精确匹配）<textarea value={redirects} onChange={e=>setRedirects(e.target.value)} placeholder="https://example.com/oauth/callback" required disabled={busy}/></label></>}
      {mutation.isError&&<p role="alert">{mutation.error.message}</p>}
      <button className="button primary" disabled={busy||!name.trim()||(tab==="tokens"&&!ids.length)}>{mutation.isPending?"正在提交…":tab==="tokens"?"创建并授权":"注册应用"}</button>
      {secret&&<div role="status"><p>Client Secret 仅显示一次，请立即保存。</p><code className="open-secret">{secret}</code><button type="button" onClick={()=>void navigator.clipboard.writeText(secret)}>复制</button><button type="button" onClick={()=>setSecret("")}>已保存，关闭</button></div>}
    </form>}
    <div className="open-records">{tab==="apps"?(state.data?.apps??[]).map(app=><article className="open-card" key={app.client_id}><strong>{app.name}</strong><code>{app.client_id}</code><small>{app.client_type} · {app.redirect_uris.join(", ")}</small><button disabled={busy} onClick={()=>mutation.mutate({action:"revoke_app",client_id:app.client_id})}>停用应用</button></article>):(state.data?.grants??[]).filter(g=>tab==="tokens"?g.client_type==="personal":g.client_type!=="personal").map(g=><article className="open-card" key={g.id}><strong>{g.name}</strong><small>{g.permissions.map(p=>permissionNames[p]).join(" · ")} · {g.expires_at?`到期 ${new Date(g.expires_at).toLocaleDateString()}`:"无固定到期日"}</small><span>{g.revoked_at?"已撤销":`最近使用：${g.last_used_at?new Date(g.last_used_at).toLocaleString():"尚未使用"}`}</span><button disabled={busy||!!g.revoked_at} onClick={()=>mutation.mutate({action:"revoke",id:g.id})}>撤销授权</button></article>)}</div>
  </section>;
}

export function OpenApiConsentPanel({authorizationId,onLegacy}:{authorizationId:string;onLegacy:()=>void}) {
  const [ids,setIds]=useState<string[]>([]),[permissions,setPermissions]=useState<OpenPermission[]>(["tasks:read"]),[lifetime,setLifetime]=useState("90"),[personal,setPersonal]=useState(false);
  const info=useQuery({queryKey:["open-consent",authorizationId],retry:false,queryFn:async()=>{
    try {return await openPlatformRequest<{client:{name:string}}>({action:"inspect_consent",authorization_id:authorizationId});}
    catch {try {const pending=await openPlatformRequest<{name:string;permissions:string[]}>({action:"personal_consent",authorization_id:authorizationId});setPersonal(true);return {client:{name:pending.name}};} catch {onLegacy();throw new Error("授权请求不可用");}}
  }});
  const workspaces=useQuery({queryKey:["open-consent-workspaces",authorizationId],queryFn:async()=>{const {data,error}=await supabase!.from("workspaces").select("id,name");if(error)throw error;return data as {id:string;name:string}[];}});
  const decision=useMutation({networkMode:"always",mutationFn:async(approve:boolean)=>{
    if(!navigator.onLine||!supabase)throw new Error("当前离线，无法授权");
    if(approve&&!personal)await openPlatformRequest({action:"consent",authorization_id:authorizationId,workspace_ids:ids,permissions,lifetime});
    const {data,error}=approve?await supabase.auth.oauth.approveAuthorization(authorizationId,{skipBrowserRedirect:true}):await supabase.auth.oauth.denyAuthorization(authorizationId,{skipBrowserRedirect:true});
    if(error||!data)throw error??new Error("授权失败"); window.location.assign(data.redirect_url);
  }});
  return <div className="open-platform"><h1>授权 {info.data?.client.name??"应用"}</h1><p>{personal?"确认刚才选择的授权范围。允许后将完成授权并返回。":"选择该应用可访问的团队空间和操作。授权不会超出你当前的任务和标签权限。"}</p>
    {!personal&&<GrantFields workspaces={workspaces.data??[]} ids={ids} setIds={setIds} permissions={permissions} setPermissions={setPermissions} lifetime={lifetime} setLifetime={setLifetime} disabled={decision.isPending}/>}
    {decision.isError&&<p role="alert">{decision.error.message}</p>}<div className="cli-auth-actions"><button className="button secondary" disabled={decision.isPending} onClick={()=>decision.mutate(false)}>拒绝</button><button className="button primary" disabled={decision.isPending||!info.data||(!personal&&!ids.length)} onClick={()=>decision.mutate(true)}>{decision.isPending?"正在授权…":"允许"}</button></div>
  </div>;
}

export function OpenBrokerConsentScreen({requestId}:{requestId:string}) {
  const [ids,setIds]=useState<string[]>([]),[permissions,setPermissions]=useState<OpenPermission[]>(["tasks:read"]),[lifetime,setLifetime]=useState("90");
  const info=useQuery({queryKey:["open-broker-flow",requestId],queryFn:()=>openPlatformRequest<{name:string}>({action:"inspect_flow",id:requestId}),retry:false,meta:{persist:false}});
  const workspaces=useQuery({queryKey:["open-broker-workspaces",requestId],queryFn:async()=>{const {data,error}=await supabase!.from("workspaces").select("id,name");if(error)throw error;return data as {id:string;name:string}[];},meta:{persist:false}});
  const decision=useMutation({networkMode:"always",mutationFn:async(approve:boolean)=>{
    const data=await openPlatformRequest({action:approve?"authorize_flow":"deny_flow",id:requestId,workspace_ids:ids,permissions,lifetime});
    if(typeof data.authorization_url==="string")window.location.assign(data.authorization_url);
    else window.location.assign("/");
  }});
  return <main className="cli-auth-screen"><section className="cli-auth-card open-platform"><h1>授权 {info.data?.name??"应用"}</h1><p>选择可访问的团队空间和操作。应用权限还会受到你当前团队空间和标签权限的限制。</p><GrantFields workspaces={workspaces.data??[]} ids={ids} setIds={setIds} permissions={permissions} setPermissions={setPermissions} lifetime={lifetime} setLifetime={setLifetime} disabled={decision.isPending}/>{(decision.isError||info.isError)&&<p role="alert">{decision.error?.message??info.error?.message}</p>}<div className="cli-auth-actions"><button className="button secondary" disabled={decision.isPending} onClick={()=>decision.mutate(false)}>拒绝</button><button className="button primary" disabled={decision.isPending||!ids.length||!info.data} onClick={()=>decision.mutate(true)}>允许</button></div></section></main>;
}
