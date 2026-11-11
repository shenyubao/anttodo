// Disposable local integration harness. Requires the named test Auth/REST/DB
// containers; all keys and users below are generated test fixtures.
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHmac,randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const remote=process.env.OPEN_API_SMOKE_ORIGIN;
const secret='anttodo-disposable-test-secret-32-characters',root=remote||'http://127.0.0.1:54351',nativeRoot=remote?process.env.SUPABASE_URL:root;
if(remote&&!['https://app.anttodo.com','https://todo.yuce-tech.cn'].includes(remote))throw Error('Unsupported production smoke origin');
const endpoint=path=>(path.startsWith('/auth/v1')||path.startsWith('/rest/v1')?nativeRoot:root)+path;
function jwt(role){const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:'supabase',role,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400})).toString('base64url');return `${head}.${body}.${createHmac('sha256',secret).update(`${head}.${body}`).digest('base64url')}`;}
const service=remote?process.env.SUPABASE_SERVICE_ROLE_KEY:jwt('service_role'),anon=remote?process.env.SUPABASE_ANON_KEY:jwt('anon'),directory=mkdtempSync(join(tmpdir(),'anttodo-api-smoke-'));
const proxy=http.createServer(async(req,res)=>{try{const path=req.url??'/';let target;
  if(path.startsWith('/auth/v1'))target='http://127.0.0.1:54352'+path.slice('/auth/v1'.length);
  else if(path.startsWith('/rest/v1'))target='http://127.0.0.1:54353'+path.slice('/rest/v1'.length);
  else target='http://127.0.0.1:54354/functions/v1/open-api'+path.replace(/^\/(functions\/v1\/open-api|api\/open\/v1)/,'');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await fetch(target,{method:req.method,headers:{...req.headers,host:new URL(target).host},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),redirect:'manual'});
  const headers=new Headers(response.headers);headers.delete('content-length');headers.delete('content-encoding');headers.delete('transfer-encoding');
  res.writeHead(response.status,Object.fromEntries(headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch{res.writeHead(502);res.end('Local test upstream unavailable');}});
if(!remote)await new Promise(resolve=>proxy.listen(54351,'127.0.0.1',resolve));
async function request(path,token=service,method='GET',body,extra={}){
 const response=await fetch(endpoint(path),{method,headers:{apikey:anon,Authorization:`Bearer ${token}`,'content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
 const raw=await response.text();let data;
 try{data=JSON.parse(raw||'{}');}catch{throw Error(`Invalid local JSON response: ${path} ${response.status}, ${raw.length} bytes`);}
 if(!response.ok)throw Error(`${method} ${path}: ${response.status} ${data.code??data.error??''} ${data.message??data.error_description??''}`);
 return data;
}
let edge,fixtureUser,fixtureBroker;
try{
 const password=randomBytes(24).toString('base64url');
 const user=await request('/auth/v1/admin/users',service,'POST',{email:`api-smoke-${randomUUID()}@example.invalid`,password,email_confirm:true,role:'authenticated'});
 fixtureUser=user.id;
 const login=await request('/auth/v1/token?grant_type=password',anon,'POST',{email:user.email,password});
 const actor=login.access_token,wid=randomUUID();
 await request('/rest/v1/workspaces',actor,'POST',{id:wid,name:'Disposable API smoke',created_by:user.id});
 const broker=remote?{client_id:process.env.OPEN_API_PERSONAL_CLIENT_ID,client_secret:process.env.OPEN_API_PERSONAL_CLIENT_SECRET}:await request('/auth/v1/admin/oauth/clients',service,'POST',{client_name:'Disposable personal broker',client_type:'confidential',redirect_uris:[`${root}/functions/v1/open-api/callback`],grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'profile',token_endpoint_auth_method:'client_secret_basic'});
 if(!remote){fixtureBroker=broker.client_id;await request('/rest/v1/rpc/open_platform_admin',service,'POST',{p_action:'register_app',p_actor:user.id,p_body:{client_id:broker.client_id,name:'Disposable broker',client_type:'personal',redirect_uris:[]}});}
 if(!remote){
 const entry=join(directory,'edge.ts');writeFileSync(entry,`import app from ${JSON.stringify(new URL('../supabase/functions/open-api/index.ts',import.meta.url).href)}; Deno.serve({hostname:"127.0.0.1",port:54354},app.fetch);`);
 edge=spawn('pnpm',['dlx','deno@2.6.4','run','--allow-all','--config',resolve('supabase/functions/open-api/deno.json'),entry],{detached:true,env:{...process.env,SUPABASE_URL:root,SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:anon}),SUPABASE_SECRET_KEYS:JSON.stringify({default:service}),PUBLIC_APP_URL:'http://127.0.0.1:4173',OPEN_API_OAUTH_PUBLIC_URL:root,OPEN_API_PERSONAL_CLIENT_ID:broker.client_id,OPEN_API_PERSONAL_CLIENT_SECRET:broker.client_secret},stdio:['ignore','pipe','pipe']});
 let edgeLog='';edge.stdout.on('data',s=>edgeLog+=s);edge.stderr.on('data',s=>edgeLog+=s);
 let ready=false;for(let i=0;i<120;i++){try{const r=await fetch(root+'/api/open/v1/discovery');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
 if(!ready)throw Error('Local Edge failed to start: '+edgeLog.slice(-2000));
 }
 const basic={name:'Fixture',workspace_ids:[wid],permissions:['tasks:read','tasks:write','tasks:delete'],lifetime:'7'};
 const manage=(body)=>request('/api/open/v1/manage',actor,'POST',body);
 const issued=await manage({action:'create_token',...basic,app_origin:root});
 assert(typeof issued.authorization_url==='string','Personal issuance response keys: '+Object.keys(issued));
 const auth=await fetch(issued.authorization_url,{redirect:'manual'}),location=new URL(auth.headers.get('location'));
 const authorization=location.searchParams.get('authorization_id');assert(authorization,`Native OAuth authorization ID: ${location.pathname} ${location.searchParams.get('error')??''} ${location.searchParams.get('error_description')??''}`);
 await manage({action:'personal_consent',authorization_id:authorization});
 const approved=await request(`/auth/v1/oauth/authorizations/${authorization}/consent`,actor,'POST',{action:'approve'});
 const callback=await fetch(approved.redirect_url,{redirect:'manual'});
 assert(callback.status===302,'Personal callback completes');
 const personal=new URLSearchParams(new URL(callback.headers.get('location')).hash.slice(1)).get('token');
 assert(/^ato_v1_/.test(personal),'Opaque personal credential, not a Supabase JWT');
 const me=await request('/api/open/v1/me',personal);assert(me.id===user.id,'PAT user binding');
 const idempotency=randomUUID();
 const task=await request(`/api/open/v1/workspaces/${wid}/tasks`,personal,'POST',{title:'Local smoke task',list_id:'inbox'},{'idempotency-key':idempotency});
 const retry=await request(`/api/open/v1/workspaces/${wid}/tasks`,personal,'POST',{title:'Local smoke task',list_id:'inbox'},{'idempotency-key':idempotency});assert(retry.id===task.id,'HTTP retry is idempotent');
 const complete=await request(`/api/open/v1/tasks/${task.id}/complete`,personal,'POST',{}, {'if-match':`"${task.version}"`,'idempotency-key':randomUUID()});assert(complete.task.status==='completed','HTTP completion');
 const raw=await fetch(endpoint(`/rest/v1/tasks?workspace_id=eq.${wid}`),{headers:{apikey:anon,Authorization:`Bearer ${personal}`}});assert(!raw.ok,'Opaque PAT cannot be used against PostgREST');
 if(!process.env.VISTAB_SMOKE_DEVICE_TOKEN){
 const app=await manage({action:'create_app',name:'Public client fixture',client_type:'public',redirect_uris:['https://client.anttodo.com/callback']});assert(app.client_type==='public','Public client registration is preserved');
 const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
 const url=new URL(root+'/api/open/v1/oauth/authorize');for(const[k,v]of Object.entries({client_id:app.client_id,redirect_uri:'https://client.anttodo.com/callback',response_type:'code',scope:'profile',code_challenge:challenge,code_challenge_method:'S256',state:randomUUID()}))url.searchParams.set(k,v);
 const outward=await fetch(url,{redirect:'manual'});assert(outward.status===302,'Broker authorization begins');
 const flowId=new URL(outward.headers.get('location')).searchParams.get('request');
 const begun=await manage({action:'authorize_flow',id:flowId,...basic,app_origin:root});
 const native=await fetch(begun.authorization_url,{redirect:'manual'}),aId=new URL(native.headers.get('location')).searchParams.get('authorization_id');
 assert(aId,'Second native authorization: '+new URL(native.headers.get('location')).pathname+' '+new URL(native.headers.get('location')).searchParams.get('error_description'));
 const detailsProbe=await fetch(endpoint('/auth/v1/oauth/authorizations/'+aId),{headers:{Authorization:'Bearer '+actor,apikey:anon}});
 const details=await detailsProbe.json();
 const consent=details.redirect_url?details:await request(`/auth/v1/oauth/authorizations/${aId}/consent`,actor,'POST',{action:'approve'});
 const finish=await fetch(consent.redirect_url,{redirect:'manual'});assert(finish.status===302,'Broker callback completes');
 const code=new URL(finish.headers.get('location')).searchParams.get('code');
 const tokenForm={grant_type:'authorization_code',client_id:app.client_id,redirect_uri:'https://client.anttodo.com/callback',code,code_verifier:verifier};
 const exchange=body=>fetch(root+'/api/open/v1/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});
 const response=await exchange(tokenForm),bundle=await response.json();assert(response.ok,'Public OAuth code exchange: '+JSON.stringify(bundle));
 const external=bundle.access_token;assert(/^atoa_v1_/.test(external),'OAuth access is opaque');assert((await request('/api/open/v1/me',external)).id===user.id,'OAuth API access');
 const replay=await exchange(tokenForm);assert(replay.status===400,'Authorization code single use');
 const authMutation=await fetch(endpoint('/auth/v1/user'),{method:'PUT',headers:{Authorization:`Bearer ${external}`,'content-type':'application/json'},body:JSON.stringify({data:{open_api_fixture:true}})});assert(authMutation.status>=400,'OAuth API tokens cannot mutate the Auth account');
 const denied=await fetch(endpoint('/rest/v1/tasks'),{headers:{apikey:anon,Authorization:`Bearer ${external}`}});assert(!denied.ok,'Opaque OAuth token cannot bypass the dispatcher');
 const refresh=await exchange({grant_type:'refresh_token',client_id:app.client_id,refresh_token:bundle.refresh_token});assert(refresh.ok,'OAuth refresh works with immutable grant binding');
 const reused=await exchange({grant_type:'refresh_token',client_id:app.client_id,refresh_token:bundle.refresh_token});assert(!reused.ok,'Refresh token rotates');
 const rawJwt=await fetch(root+'/api/open/v1/me',{headers:{Authorization:`Bearer ${actor}`}});assert(rawJwt.status===401,'First party JWT is not an API credential');
 await request('/api/open/v1/oauth/revoke',(await refresh.json()).access_token,'POST',{});
 }
 if(process.env.VISTAB_SMOKE_DEVICE_TOKEN){
   console.log('Testing VisTab Token/OAuth connection for '+root);
   const visHeaders={Authorization:'Bearer '+process.env.VISTAB_SMOKE_DEVICE_TOKEN,'content-type':'application/json'};
   const vis=async(path,body)=>{const r=await fetch('https://vistab.app/api/v1/'+path,{method:body?'POST':'GET',headers:visHeaders,body:body?JSON.stringify(body):undefined,redirect:'manual'});const d=await r.json();assert(r.ok,'Live VisTab '+root+' '+path+': '+r.status+' '+(d.error??''));return d};
   await vis('integrations',{action:'token',provider:'anttodo',token:personal,serviceUrl:root});
   const read=await vis('integrations/tasks?'+new URLSearchParams({provider:'anttodo',container:wid+'/inbox'}));assert(read.items.some(t=>t.id===task.id),'VisTab reads the real connected instance');
   await vis('integrations',{action:'task',provider:'anttodo',task:{action:'create',container:wid+'/inbox',title:'VisTab live fixture',requestId:randomUUID()}});
   await vis('integrations',{action:'disconnect',provider:'anttodo'});
   const begin=await vis('integrations',{action:'connect',provider:'anttodo',configuration:{serviceUrl:root,...(root==='https://app.anttodo.com'?{}:{clientId:process.env.ANTTODO_CLIENT_ID,clientSecret:process.env.ANTTODO_CLIENT_SECRET})}});
   const authorize=await fetch(begin.url,{redirect:'manual'});assert(authorize.status===302,'VisTab starts a cookie-bound OAuth flow');
   const cookie=authorize.headers.get('set-cookie').split(';')[0];
   const offered=await fetch(authorize.headers.get('location'),{redirect:'manual'});assert(offered.status===302,'AntTodo accepts the VisTab confidential client');
   const visFlow=new URL(offered.headers.get('location')).searchParams.get('request');
   const permission=await manage({action:'authorize_flow',id:visFlow,...basic,app_origin:root});
   const nativeStart=await fetch(permission.authorization_url,{redirect:'manual'}),nativeId=new URL(nativeStart.headers.get('location')).searchParams.get('authorization_id');
   const detail=await request('/auth/v1/oauth/authorizations/'+nativeId,actor);
   const allowed=detail.redirect_url?detail:await request('/auth/v1/oauth/authorizations/'+nativeId+'/consent',actor,'POST',{action:'approve'});
   const returned=await fetch(allowed.redirect_url,{redirect:'manual'});assert(returned.status===302,'AntTodo returns a one-use code to VisTab');
   let refreshGrant;
   const fixtureSql=(sql)=>execFileSync('ssh',['-o','BatchMode=yes','yuce-anttodo','docker exec -i supabase-db psql -U postgres -d postgres -At -v ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'}).trim();
   if(process.env.VISTAB_SMOKE_FIXTURE_ID){
     refreshGrant=(await manage({action:'list'})).grants.find(g=>g.client_id===process.env.ANTTODO_CLIENT_ID&&!g.revoked_at);
     assert(refreshGrant&&/^[0-9a-f-]{36}$/.test(refreshGrant.id)&&/^[0-9a-f-]{36}$/.test(user.id),'Owned OAuth fixture grant');
     fixtureSql(`update anttodo_private.open_grants set expires_at=now()+interval '50 seconds' where id='${refreshGrant.id}' and user_id='${user.id}';`);
   }
   const saved=await fetch(returned.headers.get('location'),{headers:{Cookie:cookie},redirect:'manual'});assert([302,303].includes(saved.status)&&!new URL(saved.headers.get('location')).searchParams.has('error'),'VisTab OAuth callback saves the encrypted binding');
   const connected=await vis('integrations');assert(connected.connections.some(c=>c.provider==='anttodo'&&c.connected),'VisTab OAuth is connected');
   const previousRefresh=refreshGrant?fixtureSql(`select refresh_hash from anttodo_private.open_grants where id='${refreshGrant.id}';`):null;
   await vis('integrations/tasks?'+new URLSearchParams({provider:'anttodo',container:wid+'/inbox'}));
   if(refreshGrant)assert(fixtureSql(`select refresh_hash from anttodo_private.open_grants where id='${refreshGrant.id}';`)!==previousRefresh,'VisTab proactively refreshes and rotates the short-lived OAuth fixture');
   await vis('integrations',{action:'disconnect',provider:'anttodo'});
   console.log('Live VisTab Token/OAuth, confidential callback, task read/write and disconnect passed for '+root);
 } else await request('/api/open/v1/oauth/revoke',personal,'POST',{});

 const revoked=await fetch(root+'/api/open/v1/me',{headers:{apikey:anon,Authorization:`Bearer ${personal}`}});assert(revoked.status===401,'PAT revocation immediately blocks access');
 console.log(`${remote?'Production '+root:'Local'} HTTP smoke passed:`+' PAT issuance, OAuth public/PKCE, refresh, task create/complete, idempotency, direct Data API denial and revocation.');
 // All objects belong to the newly generated disposable user.
 await request(`/auth/v1/admin/users/${user.id}`,service,'DELETE');fixtureUser=null;
}finally{if(fixtureUser)await request(`/auth/v1/admin/users/${fixtureUser}`,service,'DELETE').catch(()=>{});if(fixtureBroker)await request(`/auth/v1/admin/oauth/clients/${fixtureBroker}`,service,'DELETE').catch(()=>{});if(edge){try{process.kill(-edge.pid,'SIGTERM');}catch{}}proxy.closeAllConnections();proxy.close();rmSync(directory,{recursive:true,force:true});}
