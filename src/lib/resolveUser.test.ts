import { describe,it,expect } from 'vitest';
import { resolveUser } from '../../supabase/functions/_shared/resolveUser';
const token=(claims:object)=>`header.${btoa(JSON.stringify(claims))}.signature`;
const verified={auth:{getUser:async()=>({data:{user:{id:'fixture'}},error:null})}};
describe('first-party Edge identity boundary',()=>{
  it('accepts a verified first-party user and preserves CLI user sessions',async()=>{
    for(const claims of [{role:'authenticated'},{role:'authenticated',client_id:'cli'}]) expect(await resolveUser(new Request('https://fixture/',{headers:{Authorization:`Bearer ${token(claims)}`}}),verified)).toMatchObject({id:'fixture'});
  });
  it('rejects isolated OAuth sessions even when Auth recognizes their user',async()=>{
    for(const value of [token({role:'anttodo_openapi'}),'ato_v1_fixture','malformed']) expect(await resolveUser(new Request('https://fixture/',{headers:{Authorization:`Bearer ${value}`}}),verified)).toBeNull();
  });
  it('never trusts unverified claims',async()=>{
    expect(await resolveUser(new Request('https://fixture/',{headers:{Authorization:`Bearer ${token({role:'authenticated'})}`}}),{auth:{getUser:async()=>({data:{user:null},error:{message:'invalid signature'}})}})).toBeNull();
  });
});
