export type DingtalkAppCredentials = {
  appKey: string;
  appSecret: string;
  agentId?: string;
};

type TokenCacheEntry = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();

export async function getDingtalkAppAccessToken(input: {
  appKey: string;
  appSecret: string;
}) {
  const cacheKey = input.appKey;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const url = new URL("https://oapi.dingtalk.com/gettoken");
  url.searchParams.set("appkey", input.appKey);
  url.searchParams.set("appsecret", input.appSecret);
  const tokenResponse = await fetch(url.toString());
  const payload = await tokenResponse.json().catch(() => ({})) as {
    errcode?: number;
    errmsg?: string;
    access_token?: string;
    expires_in?: number;
  };
  if (!tokenResponse.ok || payload.errcode || !payload.access_token) {
    throw new Error(
      typeof payload.errmsg === "string"
        ? payload.errmsg
        : "Failed to get DingTalk app access token",
    );
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 7200;
  tokenCache.set(cacheKey, {
    token: payload.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return payload.access_token;
}

export async function resolveDingtalkUserId(input: {
  accessToken: string;
  unionId: string;
}) {
  const url = new URL("https://oapi.dingtalk.com/topapi/user/getbyunionid");
  url.searchParams.set("access_token", input.accessToken);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ unionid: input.unionId }),
  });
  const payload = await response.json().catch(() => ({})) as {
    errcode?: number;
    errmsg?: string;
    result?: { userid?: string };
  };
  if (!response.ok || payload.errcode || !payload.result?.userid) {
    throw new Error(
      typeof payload.errmsg === "string"
        ? payload.errmsg
        : "Failed to resolve DingTalk userid",
    );
  }
  return payload.result.userid;
}

export async function sendDingtalkWorkNotice(input: {
  accessToken: string;
  agentId: string;
  userIds: string[];
  title: string;
  text: string;
}) {
  if (input.userIds.length === 0) return { skipped: true as const };
  const url = new URL("https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2");
  url.searchParams.set("access_token", input.accessToken);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: Number(input.agentId) || input.agentId,
      userid_list: input.userIds.join(","),
      msg: {
        msgtype: "text",
        text: {
          content: `${input.title}\n${input.text}`.slice(0, 2000),
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    errcode?: number;
    errmsg?: string;
    task_id?: number;
  };
  if (!response.ok || payload.errcode) {
    throw new Error(
      typeof payload.errmsg === "string"
        ? payload.errmsg
        : "Failed to send DingTalk work notice",
    );
  }
  return { taskId: payload.task_id };
}

/** Resolve userid from unionId and send a work notice when agentId is present. */
export async function sendDingtalkNotification(input: {
  credentials: DingtalkAppCredentials;
  unionId: string;
  cachedUserId?: string | null;
  title: string;
  text: string;
}) {
  if (!input.credentials.agentId?.trim()) {
    return { skipped: "missing_agent_id" as const };
  }
  const accessToken = await getDingtalkAppAccessToken({
    appKey: input.credentials.appKey,
    appSecret: input.credentials.appSecret,
  });
  let userId = input.cachedUserId?.trim() || "";
  if (!userId) {
    userId = await resolveDingtalkUserId({
      accessToken,
      unionId: input.unionId,
    });
  }
  await sendDingtalkWorkNotice({
    accessToken,
    agentId: input.credentials.agentId,
    userIds: [userId],
    title: input.title,
    text: input.text,
  });
  return { userId };
}
