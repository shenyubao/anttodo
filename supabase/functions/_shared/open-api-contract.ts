/** Shared by the Edge API and the public React documentation. */
export const OPEN_API_PREFIX = "/api/open/v1";
export function normalizeOpenApiPath(path:string) { return path.replace(/^.*\/(?:functions\/v1\/)?open-api(?=\/|$)/, "").replace(/^\/api\/open\/v1/, "") || "/"; }
export const OPEN_API_PERMISSIONS = ["tasks:read", "tasks:write", "tasks:delete"] as const;
export type OpenPermission = typeof OPEN_API_PERMISSIONS[number];
export type OpenCapabilities = Record<"edit" | "complete" | "delete" | "restore" | "move" | "reorder" | "duplicate" | "subtask", boolean>;
export type OpenTask = {
  id: string; workspace_id: string; parent_task_id: string | null; title: string; description: string;
  status: "open" | "completed" | "cancelled"; priority: "none" | "low" | "medium" | "high";
  due_at: string | null; due_start_at: string | null; due_timezone: string | null; due_is_all_day: boolean;
  recurrence: unknown; assignee_id: string | null; label_ids: string[]; position: number; version: number;
  created_at: string; updated_at: string; deleted_at: string | null; url: string; capabilities: OpenCapabilities;
};
export type OpenList = { id: string; workspace_id: string; name: string; type: "system" | "label" | "custom"; parent_id: string | null; color?: string; url: string; capabilities: { create: boolean; move: boolean; reorder: boolean } };
export class OpenApiError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isOpenUuid = (value: unknown): value is string => typeof value === "string" && uuidPattern.test(value);
type Field = { type?: string | string[]; format?: string; enum?: readonly string[]; minLength?: number; maxLength?: number; minimum?: number; items?: Field; maxItems?: number };
const title: Field = { type: "string", minLength: 1, maxLength: 500 };
const date: Field = { type: ["string", "null"], format: "date-time" };
const uuid: Field = { type: "string", format: "uuid" };
const nullableUuid: Field = { type: ["string", "null"], format: "uuid" };
export const OPEN_TASK_FIELDS: Record<string, Field> = {
  title, description: { type: "string", maxLength: 50000 }, priority: { type: "string", enum: ["none", "low", "medium", "high"] },
  due_at: date, due_start_at: date, due_is_all_day: { type: "boolean" }, due_timezone: { type: ["string", "null"], maxLength: 100 },
};
export const OPEN_BODY_FIELDS: Record<string, Record<string, Field>> = {
  create: { ...OPEN_TASK_FIELDS, list_id: { type: "string", maxLength: 100 }, parent_task_id: nullableUuid },
  patch: OPEN_TASK_FIELDS, complete: {}, reopen: {}, restore: {}, delete: {},
  duplicate: { title },
  move: { source_list_id: { type: "string", maxLength: 100 }, target_list_id: { type: "string", maxLength: 100 }, parent_task_id: nullableUuid, position: { type: "integer", minimum: 0 } },
  reorder: { list_id: { type: "string", maxLength: 100 }, task_ids: { type: "array", items: uuid, maxItems: 2000 }, position: { type: "integer", minimum: 0 } },
};
export const OPEN_OPERATIONS = [
  ["GET", "/me", "当前身份与授权范围", "read"],
  ["GET", "/workspaces", "已授权团队空间", "read"],
  ["GET", "/workspaces/{workspace_id}/labels", "标签元数据", "read"],
  ["GET", "/workspaces/{workspace_id}/lists", "可用列表", "read"],
  ["GET", "/workspaces/{workspace_id}/tasks", "分页读取任务", "read"],
  ["POST", "/workspaces/{workspace_id}/tasks", "创建任务与子任务", "create"],
  ["GET", "/tasks/{task_id}", "读取任务", "read"],
  ["PATCH", "/tasks/{task_id}", "修改任务", "patch"],
  ["DELETE", "/tasks/{task_id}", "移入回收站", "delete"],
  ...["complete", "reopen", "restore", "move", "reorder", "duplicate"].map((action) => ["POST", `/tasks/{task_id}/${action}`, ({ complete: "完成任务", reopen: "重新打开", restore: "恢复任务", move: "移动任务", reorder: "排序任务", duplicate: "复制任务" } as Record<string,string>)[action], action]),
] as readonly (readonly string[])[];

function checkField(value: unknown, field: Field): boolean {
  if (value === null) return Array.isArray(field.type) && field.type.includes("null");
  const types = Array.isArray(field.type) ? field.type : [field.type];
  if (types.includes("array")) return Array.isArray(value) && value.length <= (field.maxItems ?? 2000) && value.every((v) => checkField(v, field.items!));
  if (types.includes("integer")) return typeof value === "number" && Number.isSafeInteger(value) && value >= (field.minimum ?? 0);
  if (!types.includes(typeof value)) return false;
  if (typeof value === "string") {
    if (value.trim().length < (field.minLength ?? 0) || value.length > (field.maxLength ?? 50000)) return false;
    if (field.enum && !field.enum.includes(value)) return false;
    if (field.format === "uuid" && !isOpenUuid(value)) return false;
    if (field.format === "date-time" && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))) return false;
  }
  return true;
}
export function validateOpenRequest(method: string, path: string, query: Record<string, string>, body: unknown, ifMatch: string | null) {
  const operation = OPEN_OPERATIONS.find(([verb, template]) => verb === method && new RegExp(`^${template.replace(/\{[^}]+\}/g, "([0-9a-f-]+)")}$`, "i").test(path));
  if (!operation) throw new OpenApiError(404, "not_found");
  const segments = path.split("/").filter(Boolean);
  if (segments[1] && !isOpenUuid(segments[1])) throw new OpenApiError(400, "invalid_id");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OpenApiError(400, "invalid_body");
  const fields = OPEN_BODY_FIELDS[operation[3]] ?? {};
  for (const [key, value] of Object.entries(body)) if (!fields[key] || !checkField(value, fields[key])) throw new OpenApiError(400, "invalid_field", `Invalid field: ${key}`);
  const input = body as Record<string, unknown>;
  if (operation[3] === "create" && !input.title) throw new OpenApiError(400, "title_required");
  if (operation[3] === "move" && !("parent_task_id" in input) && !input.target_list_id) throw new OpenApiError(400, "move_target_required");
  if (operation[3] === "move" && "parent_task_id" in input && (input.target_list_id || input.source_list_id)) throw new OpenApiError(400, "ambiguous_move_target");
  if (operation[3] === "reorder" && !input.list_id) throw new OpenApiError(400, "list_required");
  if (input.due_start_at && input.due_at && Date.parse(String(input.due_start_at)) > Date.parse(String(input.due_at))) throw new OpenApiError(400, "invalid_date_range");
  if (input.due_timezone) { try { new Intl.DateTimeFormat("en", { timeZone: String(input.due_timezone) }); } catch { throw new OpenApiError(400, "invalid_timezone"); } }
  if (Object.keys(query).some((k) => !["list_id", "status", "assignee_id", "q", "limit", "cursor", "timezone"].includes(k))) throw new OpenApiError(400, "invalid_query");
  if (query.limit && (!/^\d+$/.test(query.limit) || +query.limit < 1 || +query.limit > 200)) throw new OpenApiError(400, "invalid_limit");
  if (query.cursor && !/^\d{1,9}$/.test(query.cursor)) throw new OpenApiError(400, "invalid_cursor");
  if (query.status && !["all", "open", "completed", "cancelled"].includes(query.status)) throw new OpenApiError(400, "invalid_status");
  if (query.assignee_id && query.assignee_id !== "me" && !isOpenUuid(query.assignee_id)) throw new OpenApiError(400, "invalid_assignee");
  if ((query.q?.length ?? 0) > 200) throw new OpenApiError(400, "invalid_query");
  let version: number | null = null;
  if (segments[0] === "tasks" && method !== "GET") {
    if (ifMatch === null) throw new OpenApiError(428, "if_match_required");
    const match = /^(?:"([0-9]+)"|([0-9]+))$/.exec(ifMatch);
    if (!match || !Number.isSafeInteger(version = Number(match[1] ?? match[2]))) throw new OpenApiError(400, "invalid_if_match");
  }
  return { operation, version };
}

export function openApiDocument(baseUrl: string, oauthBase: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  const ref=(name:string)=>({$ref:`#/components/schemas/${name}`});
  const array=(name:string)=>({type:"array",items:ref(name)});
  const taskProperties={...OPEN_TASK_FIELDS,id:uuid,workspace_id:uuid,parent_task_id:nullableUuid,assignee_id:nullableUuid,status:{type:"string",enum:["open","completed","cancelled"]},label_ids:{type:"array",items:uuid},position:{type:"integer"},version:{type:"integer"},created_at:date,updated_at:date,deleted_at:date,recurrence:{type:["object","null"]},url:{type:"string",format:"uri"},capabilities:{type:"object",additionalProperties:{type:"boolean"}}};
  const schemas:Record<string,unknown>={
    Task:{type:"object",required:["id","workspace_id","title","status","version","capabilities"],properties:taskProperties},
    Workspace:{type:"object",required:["id","name"],properties:{id:uuid,name:{type:"string"},slug:{type:"string"}}},
    Label:{type:"object",properties:{id:uuid,workspace_id:uuid,name:{type:"string"},color:{type:"string"},parent_id:nullableUuid,kind:{type:"string",enum:["team","private"]},position:{type:"integer"}}},
    List:{type:"object",required:["id","workspace_id","name","type","capabilities"],properties:{id:{type:"string"},workspace_id:uuid,name:{type:"string"},type:{type:"string",enum:["system","label","custom"]},parent_id:{type:["string","null"]},color:{type:"string"},url:{type:"string",format:"uri"},capabilities:{type:"object",properties:{create:{type:"boolean"},move:{type:"boolean"},reorder:{type:"boolean"}}}}},
    TaskPage:{type:"object",required:["items","next_cursor"],properties:{items:array("Task"),next_cursor:{type:["string","null"]}}},
    Mutation:{type:"object",required:["task","affected_tasks"],properties:{task:ref("Task"),affected_tasks:array("Task")}},
    Me:{type:"object",properties:{id:uuid,user_id:uuid,workspace_ids:{type:"array",items:uuid},permissions:{type:"array",items:{type:"string",enum:OPEN_API_PERMISSIONS}}}},
    Error:{type:"object",required:["code","message","request_id"],properties:{code:{type:"string"},message:{type:"string"},request_id:{type:"string"}}},
  };
  for (const [verb, path, summary, action] of OPEN_OPERATIONS) {
    const parameters: unknown[] = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: uuid }));
    if (path.endsWith("/tasks") && verb === "GET") for (const name of ["list_id", "status", "assignee_id", "q", "cursor", "timezone", "limit"]) parameters.push({ name, in: "query", schema: name === "limit" ? { type: "integer", default: 100, minimum: 1, maximum: 200 } : { type: "string" } });
    if (verb !== "GET") parameters.push({ name: "Idempotency-Key", in: "header", schema: { type: "string", maxLength: 200 } });
    if (path.startsWith("/tasks/") && verb !== "GET") parameters.push({ name: "If-Match", in: "header", required: true, schema: { type: "string" }, description: 'Task version, e.g. "3"' });
    const responseSchema=verb!=="GET"?(action==="create"?ref("Task"):ref("Mutation")):path==="/me"?ref("Me"):path==="/workspaces"?array("Workspace"):path.endsWith("/labels")?array("Label"):path.endsWith("/lists")?array("List"):path.endsWith("/tasks")?ref("TaskPage"):ref("Task");
    (paths[path] ??= {})[verb.toLowerCase()] = {
      operationId: `${verb.toLowerCase()}_${path.replace(/[^a-z0-9]+/gi,"_")}`, summary, parameters,
      ...(OPEN_BODY_FIELDS[action] && verb !== "DELETE" ? { requestBody: { required: action === "create", content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: OPEN_BODY_FIELDS[action], ...(action === "create" ? { required: ["title"] } : {}) } } } } } : {}),
      responses: Object.fromEntries([action==="create"?201:200,400,401,403,404,409,412,428,429].map((status) => [status, {
        description: status < 300 ? "Success" : "Request rejected",
        content: { "application/json": { schema: status < 300 ? responseSchema : ref("Error") } },
      }])),
    };
  }
  return { openapi: "3.1.0", info: { title: "AntTodo Open API", version: "1.0.0", description: "Business permissions and workspace access are selected on the consent screen, separately from OIDC scopes. Offline writes are unsupported." }, servers: [{ url: baseUrl }], security: [{ bearer: [] }, { oauth: ["profile"] }], paths,
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" }, oauth: { type: "oauth2", flows: { authorizationCode: { authorizationUrl: `${baseUrl}/oauth/authorize`, tokenUrl: `${baseUrl}/oauth/token`, scopes: { profile: "Basic profile. Business permissions require explicit consent." } } } } }, schemas } };
}

export function mapOpenDatabaseError(error: { code?: string; message?: string }) {
  const known: Record<string, number> = { "28000":401,"42501":403,"P0404":404,"P0409":409,"P0412":412,"P0428":428,"P0429":429,"40001":412,"23505":409 };
  const status = known[error.code ?? ""] ?? (error.code?.startsWith("22") || error.code?.startsWith("23") || error.code === "P0001" ? 400 : 500);
  return new OpenApiError(status, status === 500 ? "internal_error" : error.message ?? "request_failed");
}
