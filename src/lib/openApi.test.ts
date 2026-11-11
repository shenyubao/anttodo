import { describe,it,expect } from "vitest";
import { openApiDocument,validateOpenRequest,mapOpenDatabaseError } from "../../supabase/functions/_shared/open-api-contract";
const id="f1000000-0000-4000-8000-000000000001";
describe("Open API boundary",()=>{
  it("rejects missing/stale preconditions without accepting wildcard writes",()=>{
    expect(()=>validateOpenRequest("PATCH",`/tasks/${id}`,{},{title:"updated"},null)).toThrowError(expect.objectContaining({status:428}));
    for(const value of ['*','W/"2"','"2" trailing','-1'])expect(()=>validateOpenRequest("PATCH",`/tasks/${id}`,{},{title:"updated"},value)).toThrowError(expect.objectContaining({status:400}));
    expect(validateOpenRequest("PATCH",`/tasks/${id}`,{},{title:"updated"},'"2"').version).toBe(2);
    expect(mapOpenDatabaseError({code:"P0412",message:"version_conflict"}).status).toBe(412);
  });
  it("prevents mass assignment and enforces date/pagination constraints",()=>{
    for(const body of [{status:"completed"},{workspace_id:id},{label_ids:[id]},{connector_id:id},{version:999},{title:" "},{due_at:"2026-11-04"},{due_timezone:"Invalid/Zone"}])expect(()=>validateOpenRequest("PATCH",`/tasks/${id}`,{},body,'"1"')).toThrow();
    expect(()=>validateOpenRequest("GET",`/workspaces/${id}/tasks`,{limit:"201"},{},null)).toThrow();
    expect(()=>validateOpenRequest("GET",`/workspaces/${id}/tasks`,{cursor:"-1"},{},null)).toThrow();
    expect(()=>validateOpenRequest("PATCH",`/tasks/${id}`,{},{due_at:"2026-11-04T00:00:00Z",due_start_at:"2026-11-05T00:00:00Z"},'"1"')).toThrow();
  });
  it("documents the same editable fields and mandatory versions as the validator",()=>{
    const doc=openApiDocument("https://app.anttodo.com/api/open/v1","https://auth.anttodo.com");
    const patch=doc.paths["/tasks/{task_id}"].patch as any;
    expect(patch.parameters).toContainEqual(expect.objectContaining({name:"If-Match",required:true}));
    expect(patch.requestBody.content["application/json"].schema.additionalProperties).toBe(false);
    expect(patch.requestBody.content["application/json"].schema.properties).not.toHaveProperty("status");
    expect(doc.components.securitySchemes.oauth.flows.authorizationCode.scopes).not.toHaveProperty("tasks:write");
  });
  it("does not return database internals as public errors",()=>{
    expect(mapOpenDatabaseError({code:"XX000",message:"private table details"})).toMatchObject({status:500,code:"internal_error",message:"internal_error"});
    expect(()=>validateOpenRequest("POST","/tasks/invalid/complete",{},{},'"1"')).toThrow();
  });
});

import {normalizeOpenApiPath} from '../../supabase/functions/_shared/open-api-contract';
it('normalizes cloud, self-hosted Edge Runtime and proxy routes',()=>{
 for(const prefix of ['/functions/v1/open-api','/open-api','/api/open/v1']) expect(normalizeOpenApiPath(prefix+'/discovery')).toBe('/discovery');
});
