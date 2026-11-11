#!/usr/bin/env node
// Run once per instance after migrations. Secrets go to a 0600 output file,
// never stdout. Existing client IDs may be supplied to make retries idempotent.
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {writeFileSync} from 'node:fs';
const required=(name)=>{const v=process.env[name]?.trim();if(!v)throw Error(`${name} is required`);return v;};
const root=required('SUPABASE_URL').replace(/\/$/,''),app=required('PUBLIC_APP_URL').replace(/\/$/,''),output=required('OPEN_API_SECRETS_FILE');
const client=createClient(root,required('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
const lines=[];
async function register(name,kind,redirect,prefix){
  let id=process.env[`${prefix}_CLIENT_ID`],secret=process.env[`${prefix}_CLIENT_SECRET`];
  if(!id){
    const {data,error}=kind==='personal'?await client.auth.admin.oauth.createClient({client_name:name,client_type:'confidential',client_uri:app,redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'profile',token_endpoint_auth_method:'client_secret_basic'}):{data:{client_id:randomUUID(),client_secret:randomBytes(32).toString('base64url')},error:null};
    if(error||!data?.client_secret)throw error??Error('Client registration failed');
    id=data.client_id;secret=data.client_secret;
    const {error:registration}=await client.rpc('open_platform_admin',{p_action:'register_app',p_actor:null,p_body:{client_id:id,name,client_type:kind,redirect_uris:[redirect],client_secret_hash:kind==='personal'?null:createHash('sha256').update(secret).digest('hex')}});
    if(registration)throw registration;
  }
  if(!secret)throw Error(`${prefix}_CLIENT_SECRET missing`);
  lines.push(`${prefix}_CLIENT_ID=${id}`,`${prefix}_CLIENT_SECRET=${secret}`);
  // Persist each successful registration before the next network operation.
  writeFileSync(output,lines.join('\n')+'\n',{mode:0o600});
}
await register('AntTodo personal tokens','personal',`${root}/functions/v1/open-api/callback`,'OPEN_API_PERSONAL');
if(process.env.VISTAB_APP_URL)await register('VisTab','confidential',`${process.env.VISTAB_APP_URL.replace(/\/$/,'')}/api/v1/integrations/callback/anttodo`,'ANTTODO');
lines.push(`OPEN_API_OAUTH_PUBLIC_URL=${root}`,`PUBLIC_APP_URL=${app}`,`ANTTODO_SERVICE_URL=${app}`);
writeFileSync(output,lines.join('\n')+'\n',{mode:0o600});
process.stdout.write('Open API OAuth clients configured; secrets saved to the protected output file.\n');
