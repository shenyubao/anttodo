import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isOpenUuid, normalizeOpenApiPath, mapOpenDatabaseError, OpenApiError, openApiDocument, OPEN_API_PERMISSIONS, validateOpenRequest } from "../_shared/open-api-contract.ts";
import { resolveUser } from "../_shared/resolveUser.ts";

const env = (key: string) => { const value = Deno.env.get(key)?.trim(); if (!value) throw new OpenApiError(503, "service_not_configured", `Missing configuration: ${key}`); return value; };
const appUrl = () => (Deno.env.get("PUBLIC_APP_URL") || "https://app.anttodo.com").replace(/\/$/, "");
const authUrl = () => (Deno.env.get("OPEN_API_OAUTH_PUBLIC_URL") || Deno.env.get("CLI_OAUTH_PUBLIC_URL") || env("SUPABASE_URL")).replace(/\/$/, "");
const callbackUrl = () => `${authUrl()}/functions/v1/open-api/callback`;
function allowedOrigin(candidate:string|null) {
  const fallback=appUrl(),allowed=[fallback,...(Deno.env.get('OPEN_API_PUBLIC_ORIGINS')||'').split(',').map(v=>v.trim()).filter(Boolean)];
  return candidate&&allowed.includes(candidate)?candidate:fallback;
}
function cors() { return { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type, if-match, idempotency-key, x-client-info", "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS", "access-control-expose-headers": "ETag, X-Request-ID, Retry-After", "cache-control": "no-store" }; }
function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,""); }
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)));
async function hash(value: string) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((n) => n.toString(16).padStart(2,"0")).join(""); }
async function challenge(value: string) { return base64(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))); }
function claims(token: string): Record<string, unknown> { try { return JSON.parse(atob(token.split(".")[1].replaceAll("-","+").replaceAll("_","/"))); } catch { throw new OpenApiError(401,"invalid_token"); } }
async function adminCall(admin: SupabaseClient, action: string, actor: string | null, body: Record<string, unknown> = {}) {
  const { data, error } = await admin.rpc("open_platform_admin", { p_action: action, p_actor: actor, p_body: body });
  if (error) throw mapOpenDatabaseError(error);
  return data;
}
async function authorizationDetails(token:string,id:string) {
  if(!/^[A-Za-z0-9_-]{8,200}$/.test(id))throw new OpenApiError(400,"invalid_authorization");
  const response=await fetch(`${env("SUPABASE_URL")}/auth/v1/oauth/authorizations/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`,apikey:env("SUPABASE_ANON_KEY")},redirect:"error",signal:AbortSignal.timeout(15000)});
  const data=await response.json();
  if(!response.ok||!data.client?.id)throw new OpenApiError(400,"invalid_authorization");
  return data as {client:{id:string;name:string}};
}
async function nativeToken(params: Record<string, string>) {
  const response = await fetch(`${env("SUPABASE_URL")}/auth/v1/oauth/token`, {
    method: "POST", headers: { "content-type":"application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${env("OPEN_API_PERSONAL_CLIENT_ID")}:${env("OPEN_API_PERSONAL_CLIENT_SECRET")}`)}` },
    body: new URLSearchParams(params), redirect: "error", signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok || typeof data.access_token !== "string" || typeof data.refresh_token !== "string") throw new OpenApiError(401,"authorization_expired");
  return data as { access_token: string; refresh_token: string; expires_in: number };
}
function validateBundle(bundle: { access_token: string }, userId: string, grantId: string) {
  const c = claims(bundle.access_token);
  if (c.sub !== userId || c.client_id !== env("OPEN_API_PERSONAL_CLIENT_ID") || c.open_grant_id !== grantId || c.role !== "anttodo_openapi") throw new OpenApiError(401,"invalid_token_binding");
}
async function readLimited(req: Request) {
  if (Number(req.headers.get("content-length")) > 65536) throw new OpenApiError(413,"request_too_large");
  const reader = req.body?.getReader();
  if (!reader) return "";
  let size=0; const chunks: Uint8Array[]=[];
  for (;;) { const {done,value}=await reader.read(); if (done) break; size+=value.byteLength; if(size>65536) { await reader.cancel(); throw new OpenApiError(413,"request_too_large"); } chunks.push(value); }
  const bytes=new Uint8Array(size); let offset=0; for(const chunk of chunks){ bytes.set(chunk,offset); offset+=chunk.length; }
  return new TextDecoder().decode(bytes);
}
async function readJson(req:Request) {
  let data: unknown; try { data=JSON.parse(await readLimited(req)||"{}"); } catch { throw new OpenApiError(400,"invalid_json"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new OpenApiError(400,"invalid_body");
  return data as Record<string, unknown>;
}
function addUrls(data: unknown,origin:string): unknown {
  if (Array.isArray(data)) return data.map(v=>addUrls(v,origin));
  if (data && typeof data === "object") { const value = data as Record<string, unknown>; return Object.fromEntries(Object.entries(value).map(([key,val])=>key==="url_path" ? ["url",`${origin}${val}`] : [key,addUrls(val,origin)])); }
  return data;
}
async function management(req: Request, admin: SupabaseClient, body: Record<string, unknown>) {
  const origin=allowedOrigin(typeof body.app_origin==="string"?body.app_origin:null);
  const user = await resolveUser(req,admin);
  if (!user || claims(user.token).client_id) throw new OpenApiError(401,"first_party_session_required");
  const actor=user.id;
  if (body.action === "list") return adminCall(admin,"list",actor);
  if (body.action === "revoke" && isOpenUuid(body.id)) return adminCall(admin,"revoke",actor,{ id:body.id });
  if (body.action === "revoke_app" && isOpenUuid(body.client_id)) return adminCall(admin,"revoke_app",actor,{ client_id:body.client_id });
  if (body.action === "create_app") {
    if (typeof body.name!=="string" || !body.name.trim() || body.name.length>100 || !["public","confidential"].includes(String(body.client_type)) || !Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length>10) throw new OpenApiError(400,"invalid_app");
    for (const uri of body.redirect_uris) { let u: URL; try { u=new URL(String(uri)); } catch { throw new OpenApiError(400,"invalid_redirect_uri"); } if (u.protocol!=="https:" || u.hash || u.username || u.password || /[*]/.test(u.href)) throw new OpenApiError(400,"invalid_redirect_uri"); }
    const clientId=crypto.randomUUID(),secret=body.client_type==='confidential'?random():null;
    await adminCall(admin,'register_app',actor,{client_id:clientId,name:body.name.trim(),client_type:body.client_type,redirect_uris:body.redirect_uris,client_secret_hash:secret?await hash(secret):null});
    return {client_id:clientId,client_type:body.client_type,...(secret?{client_secret:secret}:{})};
  }
  if(body.action==='inspect_flow' && isOpenUuid(body.id)) return adminCall(admin,'oauth_inspect',actor,{id:body.id});
  if(body.action==='deny_flow' && isOpenUuid(body.id)) {
    const flow=await adminCall(admin,'oauth_deny',actor,{id:body.id});
    const target=new URL(flow.redirect_uri);target.searchParams.set('error','access_denied');target.searchParams.set('state',flow.state);
    return {authorization_url:target.href};
  }
  if (body.action === 'authorize_flow' || body.action === 'create_token') {
    if(!Array.isArray(body.workspace_ids) || !body.workspace_ids.length || !body.workspace_ids.every(isOpenUuid) || !Array.isArray(body.permissions) || !body.permissions.every((p)=>OPEN_API_PERMISSIONS.includes(p as typeof OPEN_API_PERMISSIONS[number])) || !body.permissions.includes('tasks:read') || !['7','90','360','unlimited'].includes(String(body.lifetime??'90'))) throw new OpenApiError(400,'invalid_grant');
    const nativeId=env('OPEN_API_PERSONAL_CLIENT_ID');
    let clientId=nativeId,name=body.name;
    if(body.action==='authorize_flow') {
      if(!isOpenUuid(body.id))throw new OpenApiError(400,'invalid_authorization');
      const flow=await adminCall(admin,'oauth_inspect',actor,{id:body.id});
      clientId=flow.client_id;name=flow.name;
    }
    if(typeof name!=='string' || !name.trim() || name.length>100) throw new OpenApiError(400,'invalid_name');
    const grant=await adminCall(admin,'grant',actor,{client_id:clientId,oauth_client_id:nativeId,name:name.trim(),workspace_ids:body.workspace_ids,permissions:body.permissions,lifetime:body.lifetime??'90'});
    const state=random(),verifier=random();
    await adminCall(admin,'flow',actor,{grant_id:grant.id,state_hash:await hash(state),verifier,app_origin:origin,...(body.action==='authorize_flow'?{flow_id:body.id}:{})});
    const url=new URL(`${authUrl()}/auth/v1/oauth/authorize`);
    for(const [k,v] of Object.entries({client_id:nativeId,redirect_uri:callbackUrl(),response_type:'code',scope:'profile',state,code_challenge:await challenge(verifier),code_challenge_method:'S256',prompt:'consent'})) url.searchParams.set(k,v);
    return {authorization_url:url.href};
  }
  if(body.action==='personal_consent' && typeof body.authorization_id==='string') {
    const data=await authorizationDetails(user.token,body.authorization_id);
    if(data.client.id!==env('OPEN_API_PERSONAL_CLIENT_ID')) throw new OpenApiError(400,'invalid_authorization');
    return adminCall(admin,'pending',actor,{client_id:data.client.id});
  }
  throw new OpenApiError(400,"invalid_action");
}

export default { fetch: withSupabase({auth:"none"},async (req,ctx)=>{
  const requestId=crypto.randomUUID(),origin=allowedOrigin(req.headers.get("x-anttodo-origin"));
  const json=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{...cors(),"x-request-id":requestId,...headers}});
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors()});
  try {
    const url=new URL(req.url);
    const path=normalizeOpenApiPath(url.pathname);
    if(path==="/openapi.json" && req.method==="GET") return json(openApiDocument(`${origin}/api/open/v1`,authUrl()));
    if(path==="/discovery" && req.method==="GET") return json({api_url:`${origin}/api/open/v1`,authorization_endpoint:`${origin}/api/open/v1/oauth/authorize`,token_endpoint:`${origin}/api/open/v1/oauth/token`,revocation_endpoint:`${origin}/api/open/v1/oauth/revoke`,scopes_supported:["profile"],code_challenge_methods_supported:["S256"]});
    if(path==='/oauth/authorize' && req.method==='GET') {
      const q=Object.fromEntries(url.searchParams);
      if(!isOpenUuid(q.client_id)||q.response_type!=='code'||q.code_challenge_method!=='S256'||!/^[-_A-Za-z0-9]{43}$/.test(q.code_challenge??'')||!q.state||q.state.length>2000||(q.scope&&q.scope!=='profile')||!q.redirect_uri||q.redirect_uri.length>2000)throw new OpenApiError(400,'invalid_request');
      const flow=await adminCall(ctx.supabaseAdmin,'oauth_begin',null,{...q,state_hash:await hash(random()),app_origin:origin});
      return new Response(null,{status:302,headers:{location:`${origin}/openapi/authorize?request=${flow.id}`,'cache-control':'no-store','referrer-policy':'no-referrer'}});
    }
    if(path==='/oauth/token' && req.method==='POST') {
      if(!req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))throw new OpenApiError(400,'invalid_request');
      const form=Object.fromEntries(new URLSearchParams(await readLimited(req)));
      const basic=req.headers.get('authorization')?.match(/^Basic (.+)$/i);
      if(basic){let pair:string[];try{pair=atob(basic[1]).split(':');}catch{throw new OpenApiError(401,'invalid_client');}if(form.client_id&&form.client_id!==pair[0])throw new OpenApiError(401,'invalid_client');form.client_id=pair[0];form.client_secret=pair[1];}
      if(!isOpenUuid(form.client_id))throw new OpenApiError(401,'invalid_client');
      const access=random(),refresh=random();let input:Record<string,unknown>={client_id:form.client_id,client_secret_hash:form.client_secret?await hash(form.client_secret):null,grant_type:form.grant_type,access_hash:await hash(access),new_refresh_hash:await hash(refresh)};
      if(form.grant_type==='authorization_code') {
        if(!/^[-_A-Za-z0-9]{43}$/.test(form.code??'')||!/^[-._~A-Za-z0-9]{43,128}$/.test(form.code_verifier??''))throw new OpenApiError(400,'invalid_grant');
        input={...input,code_hash:await hash(form.code),code_challenge:await challenge(form.code_verifier),redirect_uri:form.redirect_uri};
      } else if(form.grant_type==='refresh_token') {
        const parsed=/^ator_v1_([0-9a-f-]{36})\.([\w-]{43})$/i.exec(form.refresh_token??'');
        if(!parsed)throw new OpenApiError(400,'invalid_grant');
        input={...input,id:parsed[1],refresh_hash:await hash(parsed[2])};
      } else throw new OpenApiError(400,'unsupported_grant_type');
      const result=await adminCall(ctx.supabaseAdmin,'oauth_token',null,input);
      return json({access_token:`atoa_v1_${result.id}.${access}`,refresh_token:`ator_v1_${result.id}.${refresh}`,token_type:'Bearer',expires_in:result.expires_in,scope:'profile'});
    }
    if(path==="/callback" && req.method==="GET") {
      const state=url.searchParams.get("state"),code=url.searchParams.get("code");
      if(!state || !code) throw new OpenApiError(400,"invalid_callback");
      const flow=await adminCall(ctx.supabaseAdmin,"callback",null,{state_hash:await hash(state)});
      const bundle=await nativeToken({grant_type:"authorization_code",code,redirect_uri:callbackUrl(),code_verifier:flow.verifier});
      validateBundle(bundle,flow.user_id,flow.grant_id);
      const secret=random(),token=`ato_v1_${flow.grant_id}.${secret}`;
      await adminCall(ctx.supabaseAdmin,"save_bundle",flow.user_id,{id:flow.grant_id,bundle,credential_hash:await hash(secret),access_expires_at:new Date(Number(claims(bundle.access_token).exp)*1000).toISOString()});
      if(flow.client_id){
        const outwardCode=random();await adminCall(ctx.supabaseAdmin,'oauth_code',flow.user_id,{id:flow.id,code_hash:await hash(outwardCode)});
        const target=new URL(flow.redirect_uri);target.searchParams.set('code',outwardCode);target.searchParams.set('state',flow.client_state);
        return new Response(null,{status:302,headers:{location:target.href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
      }
      return new Response(null,{status:302,headers:{location:`${allowedOrigin(flow.app_origin)}/openapi/token#token=${encodeURIComponent(token)}`,"cache-control":"no-store","referrer-policy":"no-referrer"}});
    }
    const body=req.method==="GET"?{}:await readJson(req);
    if(path==="/manage" && req.method==="POST") return json(await management(req,ctx.supabaseAdmin,body));
    let token=req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if(!token) throw new OpenApiError(401,"invalid_token");
    const personal=/^(ato_v1|atoa_v1)_([0-9a-f-]{36})\.([\w-]{43})$/i.exec(token);
    if(!personal)throw new OpenApiError(401,"invalid_token");
    if(personal) {
      const lease=crypto.randomUUID();
      const credential={id:personal[2],credential_hash:await hash(personal[3]),kind:personal[1]==="ato_v1"?"personal":"oauth",lease};
      const saved=await adminCall(ctx.supabaseAdmin,"exchange",null,credential);
      let bundle=saved.bundle;
      try {
        if(!bundle || typeof bundle.access_token!=="string") throw new OpenApiError(401,"invalid_token");
        if(Number(claims(bundle.access_token).exp)*1000<Date.now()+60000) {
          bundle=await nativeToken({grant_type:"refresh_token",refresh_token:bundle.refresh_token});
          validateBundle(bundle,saved.user_id,personal[2]);
          await adminCall(ctx.supabaseAdmin,"refresh",saved.user_id,{...credential,bundle,access_expires_at:new Date(Number(claims(bundle.access_token).exp)*1000).toISOString()});
        } else if(saved.lease_acquired) await adminCall(ctx.supabaseAdmin,"refresh",saved.user_id,credential);
        token=String(bundle.access_token);
      } catch(error) { if(saved.lease_acquired) await adminCall(ctx.supabaseAdmin,"refresh",saved.user_id,credential).catch(()=>{}); throw error; }
    }
    const userClient=createClient(env("SUPABASE_URL"),env("SUPABASE_ANON_KEY"),{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
    if(path==="/oauth/revoke" && req.method==="POST") {
      // Dispatcher validates the JWT/session/grant before service-side revoke.
      const {error}=await userClient.rpc("open_api_dispatch",{p_method:"GET",p_path:"/me"});
      if(error) throw mapOpenDatabaseError(error);
      const c=claims(token);
      return json(await adminCall(ctx.supabaseAdmin,"revoke",String(c.sub),{id:c.open_grant_id}));
    }
    const query=Object.fromEntries(url.searchParams);
    const {version}=validateOpenRequest(req.method,path,query,body,req.headers.get("if-match"));
    const {data,error}=await userClient.rpc("open_api_dispatch",{p_method:req.method,p_path:path,p_query:query,p_body:body,p_version:version,p_key:req.headers.get("idempotency-key")});
    if(error) throw mapOpenDatabaseError(error);
    const item=data.data?.task??data.data;
    return json(addUrls(data.data,origin),data.status,item?.version?{etag:`"${item.version}"`}:{});
  } catch(cause) {
    const error=cause instanceof OpenApiError?cause:new OpenApiError(500,"internal_error");
    if(error.status===500) console.error("Open API request failed",requestId,cause instanceof Error?cause.message:"unknown");
    if(new URL(req.url).pathname.endsWith('/oauth/token'))return json({error:error.code,error_description:error.message,request_id:requestId},error.status>=500?error.status:error.code==='invalid_client'?401:400);
    return json({code:error.code,message:error.message,request_id:requestId},error.status,error.status===429?{"retry-after":"30"}:{});
  }
}) };
