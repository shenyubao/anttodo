import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { currentAppUrl, instanceStorageKey } from "./instanceConfig";
import { supabase } from "./supabase";
import type { OpenPermission } from "../../supabase/functions/_shared/open-api-contract";
export type OpenGrant = { id:string; client_id:string; client_type:string; name:string; workspace_ids:string[]; permissions:OpenPermission[]; expires_at:string|null; revoked_at:string|null; created_at:string; last_used_at:string|null };
export type OpenApp = { client_id:string; name:string; client_type:string; redirect_uris:string[] };
export type OpenPlatformState = { grants:OpenGrant[]; apps:OpenApp[] };
export const openPlatformKey = (userId:string) => ["open-platform",instanceStorageKey(userId)] as const;
export async function openPlatformRequest<T = Record<string, unknown>>(body:Record<string,unknown>):Promise<T> {
  if(!supabase) throw new Error("Supabase 尚未配置");
  if(!navigator.onLine) throw new Error("当前离线，不能提交修改");
  const {data,error}=await supabase.functions.invoke("open-api/manage",{body:{...body,app_origin:currentAppUrl().replace(/\/$/,"")}});
  if(error) {
    let message=error.message;
    if("context" in error && error.context instanceof Response) { const payload=await error.context.json().catch(()=>null); message=payload?.message??message; }
    throw new Error(message);
  }
  return data as T;
}
export function useOpenPlatform(userId:string, online:boolean) {
  const client=useQueryClient(),queryKey=openPlatformKey(userId);
  const state=useQuery({queryKey,queryFn:()=>openPlatformRequest<OpenPlatformState>({action:"list"}),enabled:online&&!!supabase,retry:false});
  const workspaces=useQuery({queryKey:[...queryKey,"workspaces"],enabled:online&&!!supabase,queryFn:async()=>{
    const {data,error}=await supabase!.from("workspaces").select("id,name"); if(error) throw error; return data as {id:string;name:string}[];
  }});
  const mutation=useMutation({
    networkMode:"always",
    mutationFn:(input:Record<string,unknown>)=>openPlatformRequest(input),
    onSuccess:(data,input)=>{
      // Credentials are returned only to the form, never to query persistence.
      if(input.action==="revoke") client.setQueryData<OpenPlatformState>(queryKey,(old)=>old?{...old,grants:old.grants.map(g=>g.id===input.id?{...g,revoked_at:new Date().toISOString()}:g)}:old);
      void client.invalidateQueries({queryKey}).catch(()=>{});
      if(typeof data.authorization_url==="string") window.location.assign(data.authorization_url);
    },
  });
  return {state,workspaces,mutation};
}
export const openApiBaseUrl = () => `${(currentAppUrl()||window.location.origin).replace(/\/$/,"")}/api/open/v1`;
