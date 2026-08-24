import { NodeHtmlMarkdown } from "node-html-markdown";

export const YUNXIAO_API_ORIGIN = "https://openapi-rdc.aliyuncs.com";

export const YUNXIAO_INTERVALS = [5, 30, 60, 180, 1440] as const;
export const YUNXIAO_FIRST_SYNC_LIMIT = 100;
export const YUNXIAO_FIRST_WATERMARK = "1970-01-01T00:00:00.000Z";

export type YunxiaoSyncCursor = {
  from: string;
  to: string;
  page: number;
  offset: number;
};

export function parseYunxiaoSyncCursor(
  value: string | null,
  watermark: string | null,
  now = new Date().toISOString(),
): YunxiaoSyncCursor {
  if (value) {
    try {
      const parsed = JSON.parse(value) as Partial<YunxiaoSyncCursor>;
      if (
        typeof parsed.from === "string" && typeof parsed.to === "string" &&
        Number.isInteger(parsed.page) && Number.isInteger(parsed.offset) &&
        Number(parsed.page) > 0 && Number(parsed.offset) >= 0
      ) return parsed as YunxiaoSyncCursor;
    } catch {
      // Restart from the committed watermark when a legacy cursor is invalid.
    }
  }
  return { from: watermark ?? YUNXIAO_FIRST_WATERMARK, to: now, page: 1, offset: 0 };
}

export function isYunxiaoFirstSync(watermark: string | null | undefined) {
  return !watermark;
}

export function startYunxiaoSyncCursor(
  savedCursor: string | null,
  watermark: string | null,
  now = new Date().toISOString(),
): { cursor: YunxiaoSyncCursor; isFirstSync: boolean } {
  const isFirstSync = isYunxiaoFirstSync(watermark);
  return {
    isFirstSync,
    // First sync always restarts from the newest items and must not resume a
    // historical page/offset leftover from an older backfill run.
    cursor: parseYunxiaoSyncCursor(isFirstSync ? null : savedCursor, watermark, now),
  };
}

export function shouldStopYunxiaoFirstSync(
  isFirstSync: boolean,
  processedCount: number,
) {
  return isFirstSync && processedCount >= YUNXIAO_FIRST_SYNC_LIMIT;
}

export type YunxiaoWorkitemType = {
  id: string;
  categoryId: string;
  name: string;
  enable: boolean;
};

export type YunxiaoProject = {
  id: string;
  name: string;
};

export type YunxiaoStatus = {
  id: string;
  name: string;
  identifier?: string;
};

export type YunxiaoPublicConfig = {
  organizationId: string;
  projectId: string;
  workitemTypeId: string;
  workitemTypeName: string;
  categoryId: string;
  conditions: unknown;
  orderBy: "gmtCreate" | "gmtModified" | "name";
  sort: "asc" | "desc";
  completedStatusId: string;
  completedStatusName: string;
};

export type YunxiaoWorkitem = {
  id: string;
  subject?: string;
  description?: unknown;
  formatType?: "RICHTEXT" | "MARKDOWN" | string;
  gmtModified?: string | number;
  status?: { id?: string; name?: string } | string;
  workitemType?: { id?: string; name?: string; categoryId?: string };
  [key: string]: unknown;
};

const YUNXIAO_TIMESTAMP_MIN_MS = Date.parse("1970-01-01T00:00:00.000Z");
const YUNXIAO_TIMESTAMP_MAX_MS = Date.parse("2100-01-01T00:00:00.000Z");

function isoFromEpoch(value: number) {
  if (!Number.isFinite(value)) return null;
  const ms = value >= 1e12 ? value : value >= 1e9 ? value * 1000 : NaN;
  if (ms < YUNXIAO_TIMESTAMP_MIN_MS || ms > YUNXIAO_TIMESTAMP_MAX_MS) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeYunxiaoTimestamp(value: unknown, fallback: string) {
  if (typeof value === "number") return isoFromEpoch(value) ?? fallback;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return isoFromEpoch(Number(trimmed)) ?? fallback;
  const parsed = Date.parse(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(trimmed)
      ? `${trimmed.replace(" ", "T")}Z`
      : trimmed,
  );
  if (
    Number.isNaN(parsed) ||
    parsed < YUNXIAO_TIMESTAMP_MIN_MS ||
    parsed > YUNXIAO_TIMESTAMP_MAX_MS
  ) {
    return fallback;
  }
  return new Date(parsed).toISOString();
}

export function isWorkitemOfType(item: YunxiaoWorkitem, workitemTypeId: string) {
  return item.workitemType?.id === workitemTypeId;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function parseConditions(value: unknown): unknown[][] {
  if (value === null || value === undefined || value === "") return [];
  let parsed = typeof value === "string" ? JSON.parse(value) : value;
  const parsedRecord = record(parsed);
  if (parsedRecord) parsed = parsedRecord.conditionGroups;
  if (!Array.isArray(parsed)) {
    throw new Error("过滤条件必须是 JSON 数组或包含 conditionGroups 的对象");
  }
  if (parsed.length === 0) return [];
  for (const item of parsed) {
    if (Array.isArray(item)) {
      if (item.some((condition) => !record(condition))) {
        throw new Error("过滤条件组内只能包含对象");
      }
    } else if (!record(item)) {
      throw new Error("过滤条件只能包含对象或对象数组");
    }
  }
  if (parsed.every(Array.isArray)) return parsed as unknown[][];
  if (parsed.some(Array.isArray)) {
    throw new Error("过滤条件不能混用分组和非分组写法");
  }
  return [parsed];
}

export function appendModifiedWindow(
  rawConditions: unknown,
  fromInclusive: string,
  toInclusive: string,
): { conditionGroups: unknown[][] } {
  const parsed = parseConditions(rawConditions);
  const modified = {
    fieldIdentifier: "gmtModified",
    operator: "BETWEEN",
    value: [fromInclusive],
    toValue: toInclusive,
    className: "dateTime",
    format: "input",
  };
  return {
    conditionGroups: parsed.length === 0
      ? [[modified]]
      : parsed.map((group) => [...group, modified]),
  };
}

export function yunxiaoWorkitemUrl(
  projectId: string,
  categoryId: string,
  workitemId: string,
) {
  return `https://devops.aliyun.com/projex/project/${encodeURIComponent(projectId)}/${encodeURIComponent(categoryId.toLowerCase())}/${encodeURIComponent(workitemId)}`;
}

const YUNXIAO_DUE_TIMEZONE = "Asia/Shanghai";
const PLAN_START_IDS = [
  "startdate", "planstartdate", "planstarttime", "plannedstarttime", "gmtplanstart",
];
const PLAN_END_IDS = [
  "enddate", "planenddate", "planendtime", "plannedendtime", "gmtplanend",
];
const PLAN_START_NAMES = ["计划开始时间", "开始时间"];
const PLAN_END_NAMES = ["计划完成时间", "计划结束时间", "截止时间", "完成时间"];

export type YunxiaoDueFields = {
  due_at: string | null;
  due_start_at: string | null;
  due_is_all_day: boolean;
  due_timezone: string | null;
};

export function parseYunxiaoTimestamp(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const iso = normalizeYunxiaoTimestamp(value, "");
  return iso || null;
}

function shanghaiDateKey(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: YUNXIAO_DUE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function shanghaiDayStart(dateKey: string) {
  return new Date(`${dateKey}T00:00:00+08:00`).toISOString();
}

function shanghaiDayEnd(dateKey: string) {
  return new Date(`${dateKey}T23:59:59.999+08:00`).toISOString();
}

function isYunxiaoDateOnly(raw: unknown, iso: string) {
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return true;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: YUNXIAO_DUE_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
  return time === "00:00:00";
}

function namedText(value: unknown) {
  if (typeof value === "string") return value.trim();
  const entry = record(value);
  if (!entry) return "";
  return String(entry.displayName ?? entry.name ?? entry.nickName ?? "").trim();
}

export function yunxiaoAssigneeName(item: YunxiaoWorkitem) {
  return namedText(item.assignedTo);
}

export function yunxiaoStatusName(item: YunxiaoWorkitem) {
  return namedText(item.status);
}

function customFieldValue(item: YunxiaoWorkitem, names: string[], ids: string[]) {
  const fields = Array.isArray(item.customFieldValues) ? item.customFieldValues : [];
  for (const field of fields) {
    const entry = record(field);
    if (!entry) continue;
    const name = String(entry.fieldName ?? entry.name ?? "").trim();
    const id = String(entry.fieldId ?? entry.fieldIdentifier ?? entry.identifier ?? "")
      .trim()
      .toLowerCase();
    const matched = names.includes(name) || ids.includes(id);
    if (!matched) continue;
    const values = entry.values;
    if (Array.isArray(values) && values.length > 0) {
      const first = record(values[0]);
      return first?.displayValue ?? first?.identifier ?? values[0];
    }
    return entry.value ?? entry.displayValue ?? null;
  }
  return null;
}

function firstPlanValue(item: YunxiaoWorkitem, keys: string[], names: string[], ids: string[]) {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "") {
      return item[key];
    }
  }
  return customFieldValue(item, names, ids);
}

export function mapYunxiaoPlanToDue(item: YunxiaoWorkitem): YunxiaoDueFields {
  const empty: YunxiaoDueFields = {
    due_at: null,
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: null,
  };
  const startRaw = firstPlanValue(
    item,
    ["startDate", "planStartDate", "planStartTime", "plannedStartTime"],
    PLAN_START_NAMES,
    PLAN_START_IDS,
  );
  const endRaw = firstPlanValue(
    item,
    ["endDate", "planEndDate", "planEndTime", "plannedEndTime"],
    PLAN_END_NAMES,
    PLAN_END_IDS,
  );
  const startIso = parseYunxiaoTimestamp(startRaw);
  const endIso = parseYunxiaoTimestamp(endRaw);
  if (!startIso && !endIso) return empty;
  const startAllDay = startIso ? isYunxiaoDateOnly(startRaw, startIso) : false;
  const endAllDay = endIso ? isYunxiaoDateOnly(endRaw, endIso) : false;
  const allDayRange = (startKey: string, endKey: string): YunxiaoDueFields => {
    const [from, to] = startKey <= endKey ? [startKey, endKey] : [endKey, startKey];
    return {
      due_start_at: shanghaiDayStart(from),
      due_at: shanghaiDayEnd(to),
      due_is_all_day: true,
      due_timezone: YUNXIAO_DUE_TIMEZONE,
    };
  };

  if (startIso && endIso) {
    if (startAllDay && endAllDay) {
      return allDayRange(shanghaiDateKey(startIso), shanghaiDateKey(endIso));
    }
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    return {
      due_start_at: startMs <= endMs ? startIso : endIso,
      due_at: startMs <= endMs ? endIso : startIso,
      due_is_all_day: false,
      due_timezone: YUNXIAO_DUE_TIMEZONE,
    };
  }
  if (endIso) {
    if (endAllDay) return allDayRange(shanghaiDateKey(endIso), shanghaiDateKey(endIso));
    return {
      due_at: endIso,
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: YUNXIAO_DUE_TIMEZONE,
    };
  }
  if (startAllDay) return allDayRange(shanghaiDateKey(startIso!), shanghaiDateKey(startIso!));
  return {
    due_at: startIso,
    due_start_at: null,
    due_is_all_day: false,
    due_timezone: YUNXIAO_DUE_TIMEZONE,
  };
}

export function formatYunxiaoSyncedAt(value: Date | string = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: YUNXIAO_DUE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

export function formatYunxiaoTaskDescription(item: {
  assigneeName: string;
  statusName: string;
  sourceUrl: string;
  body: string;
  syncedAt: string;
}) {
  const body = item.body.trim();
  return [
    `- 最后同步时间：${item.syncedAt}`,
    `- 当前负责人：${item.assigneeName || "未指定"}`,
    `- 当前状态：${item.statusName || "未知"}`,
    `- 云效地址：[跳转](${item.sourceUrl})`,
    "- 云效描述：",
    body,
  ].filter((line) => line !== "").join("\n");
}

const YUNXIAO_TIMEOUT_MS = 15_000;

function apiUrl(path: string) {
  return `${YUNXIAO_API_ORIGIN}${path}`;
}

function yunxiaoErrorText(detail: JsonRecord | null, fallback: string) {
  const message = detail && (
    detail.message ?? detail.errorMessage ?? detail.errorMsg ?? detail.error_description
  );
  return typeof message === "string" && message.trim()
    ? `云效 API：${message.trim()}`
    : fallback;
}

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null) as unknown;
  const detail = record(payload);
  if (!response.ok) {
    throw new Error(yunxiaoErrorText(detail, `云效 API 请求失败（${response.status}）`));
  }
  if (detail && detail.success === false) {
    throw new Error(yunxiaoErrorText(detail, "云效 API 返回失败"));
  }
  return detail?.result ?? detail?.data ?? payload;
}

function headers(token: string) {
  return {
    "Content-Type": "application/json",
    "x-yunxiao-token": token,
  };
}

async function yunxiaoRequest(
  path: string,
  token: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
) {
  try {
    return await fetcher(apiUrl(path), {
      ...init,
      headers: { ...headers(token), ...(init.headers ?? {}) },
      signal: init.signal ?? AbortSignal.timeout(YUNXIAO_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("云效 API 请求超时，请稍后重试");
    }
    throw new Error(
      `无法连接云效 API：${error instanceof Error ? error.message : "网络错误"}`,
    );
  }
}

function listFromResult(result: unknown, candidates: string[]) {
  if (Array.isArray(result)) return result;
  const resultRecord = record(result);
  if (!resultRecord) return [];
  for (const key of candidates) {
    const value = resultRecord[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function mapWorkitemTypes(result: unknown): YunxiaoWorkitemType[] {
  return listFromResult(result, ["items", "workitemTypes", "list"])
    .map((item) => record(item))
    .filter((item): item is JsonRecord => Boolean(item))
    .map((item) => ({
      id: String(item.id ?? ""),
      categoryId: String(item.categoryId ?? item.categoryIdentifier ?? ""),
      name: String(item.name ?? item.displayName ?? ""),
      enable: item.enable !== false && item.enabled !== false,
    }))
    .filter((item) => item.id && item.categoryId && item.name && item.enable);
}

const YUNXIAO_PROJECT_PAGE_SIZE = 200;
const YUNXIAO_PROJECT_PAGE_LIMIT = 10;
const YUNXIAO_TYPE_CATEGORIES = ["Req", "Bug", "Task", "Risk"] as const;

export async function searchProjects(
  organizationId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<YunxiaoProject[]> {
  const projects: YunxiaoProject[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= YUNXIAO_PROJECT_PAGE_LIMIT; page += 1) {
    const response = await yunxiaoRequest(
      `/oapi/v1/projex/organizations/${encodeURIComponent(organizationId)}/projects:search`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          conditions: "",
          extraConditions: "",
          orderBy: "gmtCreate",
          page,
          perPage: YUNXIAO_PROJECT_PAGE_SIZE,
          sort: "desc",
        }),
      },
      fetcher,
    );
    const items = listFromResult(await readJson(response), ["projects", "items", "list"]);
    for (const item of items) {
      const entry = record(item);
      if (!entry) continue;
      const id = String(entry.id ?? entry.identifier ?? "").trim();
      const name = String(entry.name ?? entry.customCode ?? id).trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      projects.push({ id, name: name || id });
    }
    const totalPages = Number(response.headers.get("x-total-pages") ?? "0");
    if (totalPages > 0 && page >= totalPages) break;
    if (items.length < YUNXIAO_PROJECT_PAGE_SIZE) break;
  }
  return projects;
}

export async function listAllWorkitemTypes(
  organizationId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<YunxiaoWorkitemType[]> {
  const response = await yunxiaoRequest(
    `/oapi/v1/projex/organizations/${encodeURIComponent(organizationId)}/workitemTypes`,
    token,
    {},
    fetcher,
  );
  return mapWorkitemTypes(await readJson(response));
}

export async function listProjectWorkitemTypes(
  organizationId: string,
  projectId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<YunxiaoWorkitemType[]> {
  const settled = await Promise.allSettled(
    YUNXIAO_TYPE_CATEGORIES.map(async (category) => {
      const response = await yunxiaoRequest(
        `/oapi/v1/projex/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/workitemTypes?category=${encodeURIComponent(category)}`,
        token,
        {},
        fetcher,
      );
      return mapWorkitemTypes(await readJson(response));
    }),
  );
  const types: YunxiaoWorkitemType[] = [];
  const seen = new Set<string>();
  const errors: unknown[] = [];
  for (const result of settled) {
    if (result.status === "rejected") {
      errors.push(result.reason);
      continue;
    }
    for (const item of result.value) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      types.push(item);
    }
  }
  if (!types.length && errors.length) {
    throw errors[0] instanceof Error ? errors[0] : new Error("云效验证失败");
  }
  return types;
}

export async function getWorkitemWorkflow(
  organizationId: string,
  projectId: string,
  workitemTypeId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<YunxiaoStatus[]> {
  const response = await yunxiaoRequest(
    `/oapi/v1/projex/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/workitemTypes/${encodeURIComponent(workitemTypeId)}/workflows`,
    token,
    {},
    fetcher,
  );
  const result = await readJson(response);
  const workflow = record(result);
  return listFromResult(
    workflow?.workflow ?? workflow?.workflows ?? result,
    ["statuses", "statusList", "items", "list"],
  ).map((item) => record(item))
    .filter((item): item is JsonRecord => Boolean(item))
    .map((item) => ({
      id: String(item.id ?? item.statusId ?? ""),
      name: String(item.name ?? item.displayName ?? item.identifier ?? ""),
      identifier: typeof item.identifier === "string" ? item.identifier : undefined,
    }))
    .filter((item) => item.id && item.name);
}

export async function getWorkitem(
  organizationId: string,
  workitemId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<YunxiaoWorkitem | null> {
  const response = await yunxiaoRequest(
    `/oapi/v1/projex/organizations/${encodeURIComponent(organizationId)}/workitems/${encodeURIComponent(workitemId)}`,
    token,
    {},
    fetcher,
  );
  const entry = record(await readJson(response));
  if (!entry) return null;
  return { ...entry, id: String(entry.id ?? workitemId) } as YunxiaoWorkitem;
}

export async function searchWorkitems(
  config: YunxiaoPublicConfig,
  token: string,
  window: { from: string; to: string },
  page: number,
  perPage = 200,
  fetcher: typeof fetch = fetch,
): Promise<{ items: YunxiaoWorkitem[]; total: number | null }> {
  const conditions = appendModifiedWindow(
    config.conditions,
    window.from,
    window.to,
  );
  const response = await yunxiaoRequest(
    `/oapi/v1/projex/organizations/${encodeURIComponent(config.organizationId)}/workitems:search`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        category: config.categoryId,
        conditions: JSON.stringify(conditions),
        orderBy: "gmtModified",
        page,
        perPage: Math.min(Math.max(perPage, 1), 200),
        sort: "desc",
        spaceId: config.projectId,
        spaceType: "Project",
      }),
    },
    fetcher,
  );
  const result = await readJson(response);
  const resultRecord = record(result);
  const items = listFromResult(result, ["items", "workitems", "list"])
    .filter((item): item is YunxiaoWorkitem => Boolean(record(item)));
  const totalValue = resultRecord?.total ?? resultRecord?.totalCount;
  return {
    items,
    total: typeof totalValue === "number" ? totalValue : null,
  };
}

export async function updateWorkitemStatus(
  organizationId: string,
  workitemId: string,
  statusId: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await yunxiaoRequest(
    `/oapi/v1/projex/organizations/${encodeURIComponent(organizationId)}/workitems/${encodeURIComponent(workitemId)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ status: statusId }),
    },
    fetcher,
  );
  return await readJson(response);
}

export type YunxiaoAttachment = {
  id: string;
  fileId: string;
  fileName: string;
  suffix: string;
  url: string;
};

export async function listWorkitemAttachments(
  organizationId: string,
  workitemId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<YunxiaoAttachment[]> {
  const response = await yunxiaoRequest(
    `/oapi/v1/projex/organizations/${encodeURIComponent(organizationId)}/workitems/${encodeURIComponent(workitemId)}/attachments`,
    token,
    {},
    fetcher,
  );
  const result = await readJson(response);
  return listFromResult(result, ["items", "attachments", "list"])
    .map((item) => record(item))
    .filter((item): item is JsonRecord => Boolean(item))
    .map((item) => ({
      id: String(item.id ?? ""),
      fileId: String(item.fileId ?? item.id ?? ""),
      fileName: String(item.fileName ?? item.name ?? ""),
      suffix: String(item.suffix ?? ""),
      url: String(item.url ?? ""),
    }))
    .filter((item) => item.fileId);
}

export async function getWorkitemFile(
  organizationId: string,
  workitemId: string,
  fileId: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<YunxiaoAttachment> {
  const response = await yunxiaoRequest(
    `/oapi/v1/projex/organizations/${encodeURIComponent(organizationId)}/workitems/${encodeURIComponent(workitemId)}/files/${encodeURIComponent(fileId)}`,
    token,
    {},
    fetcher,
  );
  const result = record(await readJson(response));
  if (!result || typeof result.url !== "string" || !result.url) {
    throw new Error("云效附件未返回临时下载地址");
  }
  return {
    id: String(result.id ?? fileId),
    fileId,
    fileName: String(result.name ?? result.fileName ?? ""),
    suffix: String(result.suffix ?? ""),
    url: result.url,
  };
}

export function yunxiaoFileIdentifier(source: string) {
  try {
    const parsed = new URL(source, `${YUNXIAO_WEB_ORIGIN}/`);
    for (const key of ["fileIdentifier", "fileId", "file_id", "fileID"]) {
      const value = parsed.searchParams.get(key)?.trim();
      if (value) return value;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    const filesIndex = parts.lastIndexOf("files");
    if (filesIndex >= 0 && parts[filesIndex + 1]) return decodeURIComponent(parts[filesIndex + 1]);
  } catch {
    // Fall through to a query-string scan for malformed destinations.
  }
  const match = /(?:fileIdentifier|fileId|file_id)=([^&\s)]+)/i.exec(source);
  return match ? decodeURIComponent(match[1]) : "";
}

export function yunxiaoTemporaryFileUrl(payload: unknown, depth = 0): string | null {
  if (depth > 3 || payload == null) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  }
  const entry = record(payload);
  if (!entry) return null;
  for (const key of ["url", "downloadUrl", "fileUrl", "embedUrl"]) {
    const value = entry[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
  }
  for (const key of ["result", "data", "file"]) {
    const nested = yunxiaoTemporaryFileUrl(entry[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

export function rewriteYunxiaoStoredAttachmentTaskId(description: string, taskId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
    return description;
  }
  return description.replace(
    /anttodo-storage:\/\/task-attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//gi,
    (_full, workspaceId) => `anttodo-storage://task-attachments/${workspaceId}/${taskId}/`,
  );
}

export const YUNXIAO_WEB_ORIGIN = "https://devops.aliyun.com";

const HTML_IMAGE_SOURCE_ATTRS = ["src", "data-src", "data-original", "data-url", "data-href"];

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlAttribute(tag: string, name: string) {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return decodeHtmlEntities((match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim());
}

function htmlImageSourceFromTag(tag: string) {
  for (const name of HTML_IMAGE_SOURCE_ATTRS) {
    const value = htmlAttribute(tag, name);
    if (value && !/^javascript:/i.test(value)) return value;
  }
  return "";
}

function htmlImageSourceFromNode(node: { getAttribute(name: string): string | null | undefined }) {
  for (const name of HTML_IMAGE_SOURCE_ATTRS) {
    const value = node.getAttribute(name)?.trim() ?? "";
    if (value && !/^javascript:/i.test(value)) return value;
  }
  return "";
}

export function rewriteYunxiaoImageDestination(src: string) {
  let value = decodeHtmlEntities(src.trim());
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  if (!value || /^javascript:/i.test(value)) return "";
  if (/^(data:image\/|anttodo-storage:)/i.test(value)) return value;
  if (value.startsWith("//")) value = `https:${value}`;
  try {
    const parsed = new URL(value, `${YUNXIAO_WEB_ORIGIN}/`);
    if (
      parsed.pathname.startsWith("/projex/") &&
      /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname)
    ) {
      return `${YUNXIAO_WEB_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return parsed.href;
  } catch {
    return value;
  }
}

export function formatYunxiaoMarkdownImage(alt: string, src: string, title = "") {
  const url = rewriteYunxiaoImageDestination(src);
  if (!url) return "";
  const destination = /[\s()]/.test(url) ? `<${url}>` : url;
  const escapedAlt = alt.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
  const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
  return `![${escapedAlt}](${destination}${titlePart})`;
}

type MarkdownImageMatch = {
  alt: string;
  source: string;
  title: string;
  start: number;
  end: number;
};

function scanMarkdownImages(markdown: string) {
  const matches: MarkdownImageMatch[] = [];
  let index = 0;
  while (index < markdown.length) {
    const start = markdown.indexOf("![", index);
    if (start < 0) break;
    const bracket = markdown.indexOf("](", start + 2);
    if (bracket < 0 || markdown.slice(start + 2, bracket).includes("\n")) {
      index = start + 2;
      continue;
    }
    const alt = markdown.slice(start + 2, bracket);
    let cursor = bracket + 2;
    while (cursor < markdown.length && /\s/.test(markdown[cursor])) cursor += 1;
    let source = "";
    if (markdown[cursor] === "<") {
      const close = markdown.indexOf(">", cursor + 1);
      if (close < 0) {
        index = start + 2;
        continue;
      }
      source = markdown.slice(cursor + 1, close);
      cursor = close + 1;
    } else {
      const urlStart = cursor;
      let depth = 0;
      while (cursor < markdown.length) {
        const char = markdown[cursor];
        if (char === "(") depth += 1;
        else if (char === ")") {
          if (depth === 0) break;
          depth -= 1;
        } else if (/\s/.test(char) && depth === 0) break;
        cursor += 1;
      }
      source = markdown.slice(urlStart, cursor);
    }
    while (cursor < markdown.length && /\s/.test(markdown[cursor])) cursor += 1;
    let title = "";
    if (markdown[cursor] === '"' || markdown[cursor] === "'") {
      const quote = markdown[cursor];
      const endQuote = markdown.indexOf(quote, cursor + 1);
      if (endQuote < 0) {
        index = start + 2;
        continue;
      }
      title = markdown.slice(cursor + 1, endQuote);
      cursor = endQuote + 1;
    }
    while (cursor < markdown.length && /\s/.test(markdown[cursor])) cursor += 1;
    if (markdown[cursor] !== ")") {
      index = start + 2;
      continue;
    }
    matches.push({ alt, source, title, start, end: cursor + 1 });
    index = cursor + 1;
  }
  return matches;
}

export function extractYunxiaoMarkdownImages(markdown: string) {
  return scanMarkdownImages(markdown).map((item) => ({
    alt: item.alt,
    source: rewriteYunxiaoImageDestination(item.source),
    originalSource: item.source,
    title: item.title,
    start: item.start,
    end: item.end,
  })).filter((item) => item.source);
}

export function rewriteYunxiaoDescriptionImages(markdown: string) {
  const withoutHtml = markdown.replace(/<img\b[^>]*>/gi, (tag) => {
    const source = htmlImageSourceFromTag(tag);
    if (!source) return "";
    return formatYunxiaoMarkdownImage(
      htmlAttribute(tag, "alt"),
      source,
      htmlAttribute(tag, "title"),
    );
  });
  const matches = scanMarkdownImages(withoutHtml);
  if (matches.length === 0) return withoutHtml;
  let result = "";
  let cursor = 0;
  for (const match of matches) {
    result += withoutHtml.slice(cursor, match.start);
    result += formatYunxiaoMarkdownImage(match.alt, match.source, match.title)
      || withoutHtml.slice(match.start, match.end);
    cursor = match.end;
  }
  return result + withoutHtml.slice(cursor);
}

const htmlToMarkdown = new NodeHtmlMarkdown({
  ignore: ["script", "style"],
  bulletMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
  maxConsecutiveNewlines: 2,
  keepDataImages: true,
  preferNativeParser: false,
}, {
  img: ({ node }) => {
    const source = htmlImageSourceFromNode(node);
    const content = formatYunxiaoMarkdownImage(
      node.getAttribute("alt") || "",
      source,
      node.getAttribute("title") || "",
    );
    return content ? { content, recurse: false } : { ignore: true };
  },
});

function normalizeMarkdown(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function looksLikeHtml(value: string) {
  return /<(p|div|span|br|img|a|ul|ol|li|table|tr|td|th|h[1-6]|strong|em|blockquote|pre|code)\b/i
    .test(value);
}

function stringField(entry: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function unwrapDescriptionPayload(description: unknown): {
  html?: string;
  markdown?: string;
  text: string;
} {
  if (description == null) return { text: "" };
  const entry = typeof description === "string"
    ? parseDescriptionRecord(description)
    : record(description);
  if (entry) {
    const html = stringField(entry, ["htmlValue", "html"]);
    const markdown = stringField(entry, ["markdownValue", "markdown"]);
    if (html !== undefined || markdown !== undefined) {
      return { html, markdown, text: markdown ?? html ?? "" };
    }
  }
  return { text: typeof description === "string" ? description : String(description) };
}

function parseDescriptionRecord(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return record(JSON.parse(trimmed) as unknown);
  } catch {
    return null;
  }
}

function stripUnsafeHtml(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<img\b[^>]*\bsrc\s*=\s*(['"]?)\s*javascript:[^>]*>/gi, "")
    .replace(/<a\b[^>]*\bhref\s*=\s*(['"]?)\s*javascript:[^>]*>[\s\S]*?<\/a>/gi, "");
}

function stripUnsafeMarkdown(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*]\(\s*javascript:[^)]*\)/gi, "")
    .replace(/\[[^\]]*]\(\s*javascript:[^)]*\)/gi, "");
}

export function richTextToMarkdown(html: string) {
  return normalizeMarkdown(
    stripUnsafeMarkdown(htmlToMarkdown.translate(stripUnsafeHtml(html))),
  );
}

export function normalizeDescription(
  description: unknown,
  formatType: string | null | undefined,
) {
  const payload = unwrapDescriptionPayload(description);
  const type = (formatType ?? "").trim().toUpperCase();
  const markdown = type === "MARKDOWN" && payload.markdown
    ? normalizeMarkdown(payload.markdown)
    : payload.html
    ? richTextToMarkdown(payload.html)
    : payload.markdown
    ? normalizeMarkdown(payload.markdown)
    : type === "RICHTEXT" || looksLikeHtml(payload.text)
    ? richTextToMarkdown(payload.text)
    : normalizeMarkdown(payload.text);
  return rewriteYunxiaoDescriptionImages(markdown);
}

const YUNXIAO_DESCRIPTION_MARKER = "- 云效描述：";

function extractJsonPayloadText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) return trimmed;
  const start = trimmed.search(/\{\s*"(?:htmlValue|markdownValue)"/);
  if (start < 0) return null;
  return trimmed.slice(start);
}

export function rewriteYunxiaoStoredDescription(description: string, taskId?: string) {
  let result = description;
  if (/"htmlValue"|"markdownValue"/.test(description)) {
    const index = description.indexOf(YUNXIAO_DESCRIPTION_MARKER);
    const body = index >= 0
      ? description.slice(index + YUNXIAO_DESCRIPTION_MARKER.length).replace(/^\r?\n/, "")
      : description;
    const jsonText = extractJsonPayloadText(body);
    const payload = jsonText ? unwrapDescriptionPayload(jsonText) : null;
    if (payload && (payload.html !== undefined || payload.markdown !== undefined)) {
      const converted = normalizeDescription(jsonText, undefined);
      result = index < 0
        ? converted
        : [description.slice(0, index + YUNXIAO_DESCRIPTION_MARKER.length), converted]
          .filter((line) => line !== "").join("\n");
    }
  }
  result = rewriteYunxiaoDescriptionImages(result);
  return taskId ? rewriteYunxiaoStoredAttachmentTaskId(result, taskId) : result;
}

export function validateYunxiaoPublicConfig(value: unknown): YunxiaoPublicConfig {
  const config = record(value);
  if (!config) throw new Error("云效配置无效");
  const required = [
    "organizationId", "projectId", "workitemTypeId", "workitemTypeName",
    "categoryId", "completedStatusId", "completedStatusName",
  ];
  for (const key of required) {
    if (typeof config[key] !== "string" || !String(config[key]).trim()) {
      throw new Error(`云效配置缺少 ${key}`);
    }
  }
  parseConditions(config.conditions);
  return {
    organizationId: String(config.organizationId).trim(),
    projectId: String(config.projectId).trim(),
    workitemTypeId: String(config.workitemTypeId).trim(),
    workitemTypeName: String(config.workitemTypeName).trim(),
    categoryId: String(config.categoryId).trim(),
    conditions: config.conditions,
    orderBy: config.orderBy === "gmtCreate" || config.orderBy === "gmtModified" || config.orderBy === "name"
      ? config.orderBy
      : "gmtModified",
    sort: config.sort === "asc" || config.sort === "desc" ? config.sort : "desc",
    completedStatusId: String(config.completedStatusId).trim(),
    completedStatusName: String(config.completedStatusName).trim(),
  };
}
