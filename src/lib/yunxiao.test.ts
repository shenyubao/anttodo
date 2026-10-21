import { describe, expect, it } from "vitest";
import {
  appendModifiedWindow,
  getWorkitemFile,
  getWorkitem,
  isWorkitemOfType,
  listAllWorkitemTypes,
  listProjectWorkitemTypes,
  normalizeDescription,
  normalizeYunxiaoOrganizationId,
  normalizeYunxiaoPersonalToken,
  normalizeYunxiaoTimestamp,
  mapYunxiaoPlanToDue,
  formatYunxiaoSyncedAt,
  formatYunxiaoTaskDescription,
  extractYunxiaoMarkdownImages,
  rewriteYunxiaoDescriptionImages,
  rewriteYunxiaoImageDestination,
  rewriteYunxiaoStoredDescription,
  parseYunxiaoSyncCursor,
  parseYunxiaoWorkitemRef,
  searchProjects,
  searchWorkitems,
  searchWorkitemsBySerialNumber,
  shouldStopYunxiaoFirstSync,
  startYunxiaoSyncCursor,
  updateWorkitemStatus,
  yunxiaoUpdateWorkitemPermissionHint,
  validateYunxiaoPublicConfig,
  yunxiaoFileIdentifier,
  yunxiaoTemporaryFileUrl,
  yunxiaoWorkitemUrl,
  rewriteYunxiaoStoredAttachmentTaskId,
  type YunxiaoPublicConfig,
} from "../../supabase/functions/_shared/yunxiao";

const config: YunxiaoPublicConfig = {
  organizationId: "org 1",
  projectId: "project-1",
  workitemTypeId: "type-bug",
  workitemTypeName: "缺陷",
  categoryId: "BUG",
  conditions: [[{ fieldIdentifier: "status", operator: "IN", value: ["open"] }]],
  orderBy: "gmtCreate",
  sort: "desc",
  completedStatusId: "done",
  completedStatusName: "已完成",
};

describe("yunxiao connector helpers", () => {
  it("uses the center edition API and fixed work item URL", () => {
    expect(yunxiaoWorkitemUrl("project-1", "BUG", "work/1")).toBe(
      "https://devops.aliyun.com/projex/project/project-1/bug/work%2F1",
    );
  });

  it("appends the modified window to every user condition group", () => {
    const result = appendModifiedWindow([
      [{ fieldIdentifier: "status", operator: "IN", value: ["open"] }],
      [{ fieldIdentifier: "assignedTo", operator: "EQ", value: "me" }],
    ], "2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z");
    expect(result.conditionGroups).toHaveLength(2);
    expect(result.conditionGroups[0].at(-1)).toEqual({
      fieldIdentifier: "gmtModified",
      operator: "BETWEEN",
      value: ["2026-08-01T00:00:00.000Z"],
      toValue: "2026-08-02T00:00:00.000Z",
      className: "dateTime",
      format: "input",
    });
    expect(result.conditionGroups[1].at(-1)).toEqual(result.conditionGroups[0].at(-1));
  });

  it("filters the selected concrete type after category search", () => {
    expect(isWorkitemOfType({ id: "1", workitemType: { id: "type-bug" } }, "type-bug"))
      .toBe(true);
    expect(isWorkitemOfType({ id: "2", workitemType: { id: "type-story" } }, "type-bug"))
      .toBe(false);
  });

  it("limits only the first sync to 100 newest items, then resumes from the watermark", () => {
    const cursor = {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-19T00:00:00.000Z",
      page: 7,
      offset: 83,
    };
    expect(parseYunxiaoSyncCursor(JSON.stringify(cursor), null)).toEqual(cursor);
    expect(parseYunxiaoSyncCursor(
      "invalid",
      "2026-07-01T00:00:00.000Z",
      "2026-08-19T00:00:00.000Z",
    )).toEqual({
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-08-19T00:00:00.000Z",
      page: 1,
      offset: 0,
    });
    expect(startYunxiaoSyncCursor(JSON.stringify(cursor), null, "2026-08-20T00:00:00.000Z"))
      .toEqual({
        isFirstSync: true,
        cursor: {
          from: "1970-01-01T00:00:00.000Z",
          to: "2026-08-20T00:00:00.000Z",
          page: 1,
          offset: 0,
        },
      });
    expect(startYunxiaoSyncCursor(
      JSON.stringify(cursor),
      "2026-08-19T00:00:00.000Z",
      "2026-08-20T00:00:00.000Z",
    )).toEqual({ isFirstSync: false, cursor });
    expect(startYunxiaoSyncCursor(null, "2026-08-19T00:00:00.000Z", "2026-08-20T00:00:00.000Z"))
      .toEqual({
        isFirstSync: false,
        cursor: {
          from: "2026-08-19T00:00:00.000Z",
          to: "2026-08-20T00:00:00.000Z",
          page: 1,
          offset: 0,
        },
      });
    expect(shouldStopYunxiaoFirstSync(true, 99)).toBe(false);
    expect(shouldStopYunxiaoFirstSync(true, 100)).toBe(true);
    expect(shouldStopYunxiaoFirstSync(false, 100)).toBe(false);
    expect(shouldStopYunxiaoFirstSync(false, 500)).toBe(false);
  });

  it("normalizes Yunxiao epoch and datetime values to ISO timestamps", () => {
    expect(normalizeYunxiaoTimestamp("1779694079000", "fallback")).toBe(
      "2026-05-25T07:27:59.000Z",
    );
    expect(normalizeYunxiaoTimestamp(1779694079000, "fallback")).toBe(
      "2026-05-25T07:27:59.000Z",
    );
    expect(normalizeYunxiaoTimestamp(1787190405, "fallback")).toBe(
      "2026-08-20T01:46:45.000Z",
    );
    expect(normalizeYunxiaoTimestamp("2026-05-25 08:47:59", "fallback"))
      .toBe("2026-05-25T08:47:59.000Z");
    expect(normalizeYunxiaoTimestamp("2026-05-25T08:47:59.000Z", "fallback"))
      .toBe("2026-05-25T08:47:59.000Z");
    expect(normalizeYunxiaoTimestamp("", "2026-08-20T00:00:00.000Z"))
      .toBe("2026-08-20T00:00:00.000Z");
  });

  it("maps plan dates to a due range or a single due date", () => {
    expect(mapYunxiaoPlanToDue({
      id: "1",
      startDate: "2026-05-25",
      endDate: "2026-05-27",
    })).toEqual({
      due_start_at: "2026-05-24T16:00:00.000Z",
      due_at: "2026-05-27T15:59:59.999Z",
      due_is_all_day: true,
      due_timezone: "Asia/Shanghai",
    });
    expect(mapYunxiaoPlanToDue({
      id: "2",
      endDate: "2026-05-25T08:47:59.000Z",
    })).toEqual({
      due_at: "2026-05-25T08:47:59.000Z",
      due_start_at: null,
      due_is_all_day: false,
      due_timezone: "Asia/Shanghai",
    });
    expect(mapYunxiaoPlanToDue({
      id: "3",
      customFieldValues: [{
        fieldName: "计划完成时间",
        values: [{ displayValue: "2026-08-20" }],
      }],
    })).toMatchObject({
      due_is_all_day: true,
      due_timezone: "Asia/Shanghai",
    });
  });

  it("formats the Yunxiao task detail block", () => {
    expect(formatYunxiaoTaskDescription({
      assigneeName: "张三",
      statusName: "处理中",
      sourceUrl: "https://devops.aliyun.com/projex/project/p/bug/w1",
      body: "修复表丢失",
      syncedAt: "2026-08-20 16:10",
    })).toBe([
      "- 最后同步时间：2026-08-20 16:10",
      "- 当前负责人：张三",
      "- 当前状态：处理中",
      "- 云效地址：[跳转](https://devops.aliyun.com/projex/project/p/bug/w1)",
      "- 云效描述：",
      "修复表丢失",
    ].join("\n"));
  });

  it("formats the last sync time in Asia/Shanghai", () => {
    expect(formatYunxiaoSyncedAt("2026-08-20T08:10:00.000Z")).toBe("2026-08-20 16:10");
  });

  it("normalizes safe rich text and markdown descriptions", () => {
    expect(normalizeDescription(
      '<p><strong>验收</strong><script>alert(1)</script><img alt="截图" src="https://cdn/a.png"></p>',
      "RICHTEXT",
    )).toBe("**验收**![截图](https://cdn/a.png)");
    expect(normalizeDescription("第一行\r\n\r\n\r\n第二行", "MARKDOWN"))
      .toBe("第一行\n\n第二行");
    expect(normalizeDescription(
      JSON.stringify({
        htmlValue: '<p>日更旗舰版</p><ul><li>支付人数偏高</li></ul><script>alert(1)</script>',
      }),
      "RICHTEXT",
    )).toBe("日更旗舰版\n\n- 支付人数偏高");
    expect(normalizeDescription(
      { htmlValue: '<p><img alt="x" src="javascript:alert(1)">安全</p>' },
      undefined,
    )).toBe("安全");
    expect(normalizeDescription(
      { markdownValue: "**已是 Markdown**\r\n\r\n\r\n第二段", htmlValue: "<p>应忽略</p>" },
      "MARKDOWN",
    )).toBe("**已是 Markdown**\n\n第二段");
    expect(normalizeDescription("# 标题\n\n- 条目", "MARKDOWN")).toBe("# 标题\n\n- 条目");
    expect(normalizeDescription(
      "<https://alidocs.dingtalk.com/i/nodes/example>",
      "MARKDOWN",
    )).toBe(
      "[https://alidocs.dingtalk.com/i/nodes/example](https://alidocs.dingtalk.com/i/nodes/example)",
    );
  });

  it("rewrites stored Yunxiao htmlValue JSON in the description block", () => {
    expect(rewriteYunxiaoStoredDescription([
      "- 当前负责人：申玉宝",
      "- 当前状态：待确认",
      "- 云效地址：https://devops.aliyun.com/projex/project/p/bug/w1",
      "- 云效描述：",
      JSON.stringify({
        htmlValue: "<p>日更旗舰版，3月20日</p><ul><li>支付人数偏高</li></ul>",
      }),
    ].join("\n"))).toBe([
      "- 当前负责人：申玉宝",
      "- 当前状态：待确认",
      "- 云效地址：https://devops.aliyun.com/projex/project/p/bug/w1",
      "- 云效描述：",
      "日更旗舰版，3月20日",
      "",
      "- 支付人数偏高",
    ].join("\n"));
    expect(rewriteYunxiaoStoredDescription([
      "- 云效描述： {\"htmlValue\":\"仅一行\"}",
    ].join("\n"))).toBe("- 云效描述：\n仅一行");
    expect(rewriteYunxiaoStoredDescription("- 云效描述：\n已经是 Markdown")).toBe(
      "- 云效描述：\n已经是 Markdown",
    );
    expect(rewriteYunxiaoStoredDescription([
      "- 云效描述：",
      "<https://alidocs.dingtalk.com/i/nodes/example>",
    ].join("\n"))).toBe([
      "- 云效描述：",
      "[https://alidocs.dingtalk.com/i/nodes/example](https://alidocs.dingtalk.com/i/nodes/example)",
    ].join("\n"));
  });

  it("rewrites relative, data-src, and leftover HTML image destinations", () => {
    expect(rewriteYunxiaoImageDestination("/projex/api/file/abc.png")).toBe(
      "https://devops.aliyun.com/projex/api/file/abc.png",
    );
    expect(rewriteYunxiaoImageDestination("//cdn.nlark.com/a.png")).toBe(
      "https://cdn.nlark.com/a.png",
    );
    expect(rewriteYunxiaoImageDestination(
      "http://127.0.0.1:5173/projex/api/workitem/file/abc",
    )).toBe("https://devops.aliyun.com/projex/api/workitem/file/abc");
    expect(normalizeDescription(
      '<p><img alt="截图" src="/projex/api/file/abc.png"></p>',
      "RICHTEXT",
    )).toBe("![截图](https://devops.aliyun.com/projex/api/file/abc.png)");
    expect(normalizeDescription(
      '<p><img data-src="https://cdn.nlark.com/a.png" src=""></p>',
      "RICHTEXT",
    )).toBe("![](https://cdn.nlark.com/a.png)");
    expect(normalizeDescription(
      '<p><img src="https://cdn/foo(1).png"></p>',
      "RICHTEXT",
    )).toBe("![](<https://cdn/foo(1).png>)");
    expect(normalizeDescription(
      { htmlValue: '<p><img src="data:image/png;base64,aaaa"></p>' },
      "RICHTEXT",
    )).toBe("![](data:image/png;base64,aaaa)");
    expect(rewriteYunxiaoDescriptionImages(
      '<img alt="图" src="/projex/api/file/abc.png" width="100" height="100">',
    )).toBe("![图](https://devops.aliyun.com/projex/api/file/abc.png)");
    expect(rewriteYunxiaoStoredDescription([
      "- 云效描述：",
      "![截图](/projex/api/file/abc.png)",
    ].join("\n"))).toBe([
      "- 云效描述：",
      "![截图](https://devops.aliyun.com/projex/api/file/abc.png)",
    ].join("\n"));
    expect(extractYunxiaoMarkdownImages(
      "![x](<https://cdn/foo(1).png>) and ![](/projex/a.png)",
    ).map(({ start, end, ...item }) => item)).toEqual([
      {
        alt: "x",
        source: "https://cdn/foo(1).png",
        originalSource: "https://cdn/foo(1).png",
        title: "",
      },
      {
        alt: "",
        source: "https://devops.aliyun.com/projex/a.png",
        originalSource: "/projex/a.png",
        title: "",
      },
    ]);
    expect(yunxiaoFileIdentifier(
      "https://devops.aliyun.com/projex/api/workitem/file/url?fileIdentifier=491521e13ce282268646989148",
    )).toBe("491521e13ce282268646989148");
    expect(yunxiaoTemporaryFileUrl({
      success: true,
      result: { url: "https://oss.aliyuncs.com/signed.png" },
    })).toBe("https://oss.aliyuncs.com/signed.png");
    const taskId = "d47785ce-d58c-4b97-ab36-e65d7b183807";
    const workspaceId = "f07e4612-5d4a-4d6a-b183-f7de184a32cf";
    const objectId = "9de6172c-5410-4d92-81dc-66ba73afb4d0";
    expect(rewriteYunxiaoStoredDescription(
      `![截图](anttodo-storage://task-attachments/${workspaceId}/f90ceede-6346-45c1-82e3-65879de9f1b0/${objectId}.png)`,
      taskId,
    )).toBe(
      `![截图](anttodo-storage://task-attachments/${workspaceId}/${taskId}/${objectId}.png)`,
    );
    expect(rewriteYunxiaoStoredAttachmentTaskId(
      `anttodo-storage://task-attachments/${workspaceId}/${taskId}/${objectId}.png`,
      taskId,
    )).toBe(
      `anttodo-storage://task-attachments/${workspaceId}/${taskId}/${objectId}.png`,
    );
  });

  it("pages SearchProjects until the last short page", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      const page = JSON.parse(String(init?.body)).page as number;
      const items = page === 1
        ? Array.from({ length: 200 }, (_, index) => ({
            id: `project-${index}`,
            name: `项目 ${index}`,
          }))
        : [{ id: "project-last", name: "收尾项目" }];
      return new Response(JSON.stringify({ success: true, result: items }), {
        headers: {
          "Content-Type": "application/json",
          "x-total-pages": "2",
        },
      });
    };
    await expect(searchProjects("org", "token", fetcher)).resolves.toEqual([
      ...Array.from({ length: 200 }, (_, index) => ({
        id: `project-${index}`,
        name: `项目 ${index}`,
      })),
      { id: "project-last", name: "收尾项目" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].input).toBe(
      "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/projects:search",
    );
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      page: 1,
      perPage: 200,
      orderBy: "gmtCreate",
    });
    expect(calls[0].init?.headers).toEqual(expect.objectContaining({
      "x-yunxiao-token": "token",
    }));
  });

  it("loads enabled project work item types across categories", async () => {
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("category=Bug")) {
        return Response.json({
          success: true,
          result: [
            { id: "bug", categoryId: "Bug", name: "缺陷", enable: true },
            { id: "off", categoryId: "Bug", name: "停用", enable: false },
          ],
        });
      }
      if (url.includes("category=Req")) {
        return Response.json({
          success: true,
          result: [{ id: "req", categoryId: "Req", name: "需求", enable: true }],
        });
      }
      return Response.json({ success: true, result: [] });
    };
    await expect(listProjectWorkitemTypes("org", "project-1", "token", fetcher))
      .resolves.toEqual([
        { id: "req", categoryId: "Req", name: "需求", enable: true },
        { id: "bug", categoryId: "Bug", name: "缺陷", enable: true },
      ]);
    expect(calls).toEqual(expect.arrayContaining([
      "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/projects/project-1/workitemTypes?category=Req",
      "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/projects/project-1/workitemTypes?category=Bug",
      "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/projects/project-1/workitemTypes?category=Task",
      "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/projects/project-1/workitemTypes?category=Risk",
    ]));
  });

  it("loads only enabled work item types", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return Response.json({
        success: true,
        result: [
          { id: "a", categoryId: "Bug", name: "缺陷", enable: true },
          { id: "b", categoryId: "Req", name: "需求", enable: false },
        ],
      });
    };
    await expect(listAllWorkitemTypes("org", "token", fetcher)).resolves.toEqual([
      { id: "a", categoryId: "Bug", name: "缺陷", enable: true },
    ]);
    expect(calls[0].input).toBe(
      "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/workitemTypes",
    );
    expect(calls[0].init?.headers).toEqual(expect.objectContaining({
      "x-yunxiao-token": "token",
    }));
  });

  it("normalizes pasted organization IDs and personal tokens", () => {
    expect(normalizeYunxiaoOrganizationId(
      "https://devops.aliyun.com/organization/6141c43fdd62cdb60fbbdbda/setting",
    )).toBe("6141c43fdd62cdb60fbbdbda");
    expect(normalizeYunxiaoPersonalToken('Bearer "pt-abc_123"')).toBe("pt-abc_123");
  });

  it("rewrites OpenAPI gateway permission errors", async () => {
    const fetcher: typeof fetch = async () =>
      Response.json({ message: "Current token has no permission to api." }, { status: 403 });
    await expect(searchProjects("org", "token", fetcher)).rejects.toThrow(
      /以 pt- 开头的新版个人访问令牌/,
    );
  });

  it("explains that completing a work item needs write scope even when read works", async () => {
    expect(yunxiaoUpdateWorkitemPermissionHint(true)).toMatch(/把「工作项」从「只读」改成「读写」/);
    const fetcher: typeof fetch = async (input, init) => {
      if (init?.method === "PUT") {
        return Response.json({ message: "Current token has no permission to api." }, { status: 403 });
      }
      return Response.json({ success: true, result: { id: "item-1", subject: "readable" } });
    };
    await expect(updateWorkitemStatus("org", "item-1", "done", "token", fetcher))
      .rejects.toThrow(/可以读取该工作项，但没有「更新工作项」OpenAPI 权限/);
  });

  it("surfaces Yunxiao network failures as a readable error", async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(listAllWorkitemTypes("org", "token", fetcher))
      .rejects.toThrow("无法连接云效 API：Failed to fetch");
  });

  it("builds SearchWorkitems and UpdateWorkitem requests", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return Response.json({ success: true, result: { items: [], total: 0 } });
    };
    await searchWorkitems(config, "token", {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    }, 2, 200, fetcher);
    const searchCall = calls[0];
    expect(searchCall.input).toBe(
      "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org%201/workitems:search",
    );
    const searchBody = JSON.parse(String(searchCall.init?.body));
    expect(searchBody).toMatchObject({
      category: "BUG",
      spaceId: "project-1",
      spaceType: "Project",
      page: 2,
      perPage: 200,
      orderBy: "gmtModified",
      sort: "desc",
    });
    expect(JSON.parse(searchBody.conditions).conditionGroups[0].at(-1).fieldIdentifier)
      .toBe("gmtModified");

    await updateWorkitemStatus("org", "item-1", "done", "token", fetcher);
    expect(calls[1].input).toBe(
      "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/workitems/item-1",
    );
    expect(calls[1].init).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ status: "done" }),
    });
  });

  it("always searches work items by modified time descending", async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      calls.push({ init });
      return Response.json({ success: true, result: { items: [], total: 0 } });
    };
    await searchWorkitems({
      ...config,
      orderBy: "name",
      sort: "asc",
    }, "token", {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    }, 1, 20, fetcher);
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      orderBy: "gmtModified",
      sort: "desc",
    });
  });

  it("falls back missing or invalid sort fields to modified time descending", () => {
    expect(validateYunxiaoPublicConfig({
      ...config,
      orderBy: "gmtModified",
    })).toMatchObject({
      orderBy: "gmtModified",
      sort: "desc",
    });
    expect(validateYunxiaoPublicConfig({
      ...config,
      orderBy: "priority",
      sort: "random",
    })).toMatchObject({
      orderBy: "gmtModified",
      sort: "desc",
    });
    const withoutSort = { ...config, orderBy: undefined, sort: undefined };
    expect(validateYunxiaoPublicConfig(withoutSort)).toMatchObject({
      orderBy: "gmtModified",
      sort: "desc",
    });
  });

  it("refreshes an attachment temporary URL through GetWorkitemFile", async () => {
    const calls: Array<RequestInfo | URL> = [];
    const fetcher: typeof fetch = async (input) => {
      calls.push(input);
      return Response.json({
        id: "file-record",
        name: "screen.png",
        suffix: ".png",
        url: "https://download.example/signed",
      });
    };
    await expect(getWorkitemFile("org", "item", "file/1", "token", fetcher))
      .resolves.toMatchObject({
        fileId: "file/1",
        fileName: "screen.png",
        url: "https://download.example/signed",
      });
    expect(calls[0]).toBe(
      "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/workitems/item/files/file%2F1",
    );
  });

  it("loads a work item detail for plan fields", async () => {
    const fetcher: typeof fetch = async (input) => {
      expect(String(input)).toBe(
        "https://openapi-rdc.aliyuncs.com/oapi/v1/projex/organizations/org/workitems/item-1",
      );
      return Response.json({
        success: true,
        result: { id: "item-1", startDate: "2026-05-25", endDate: "2026-05-26" },
      });
    };
    await expect(getWorkitem("org", "item-1", "token", fetcher)).resolves.toMatchObject({
      id: "item-1",
      startDate: "2026-05-25",
      endDate: "2026-05-26",
    });
  });
});

describe("yunxiao quick create refs", () => {
  it("parses short serial URLs and ignores a trailing title", () => {
    expect(parseYunxiaoWorkitemRef("https://devops.aliyun.com/projex/req/HQGS-354")).toEqual({
      kind: "serial",
      categoryId: "Req",
      serialNumber: "HQGS-354",
    });
    expect(parseYunxiaoWorkitemRef(
      "https://devops.aliyun.com/projex/req/HQGS-354# 《标题会被忽略》",
    )).toEqual({
      kind: "serial",
      categoryId: "Req",
      serialNumber: "HQGS-354",
    });
  });

  it("parses full work item URLs and category casing", () => {
    expect(parseYunxiaoWorkitemRef(
      "https://devops.aliyun.com/projex/project/proj-1/BUG/work%2F99",
    )).toEqual({
      kind: "id",
      projectId: "proj-1",
      categoryId: "Bug",
      workitemId: "work/99",
    });
    expect(parseYunxiaoWorkitemRef(
      "https://www.devops.aliyun.com/projex/TASK/ABC-1",
    )).toEqual({
      kind: "serial",
      categoryId: "Task",
      serialNumber: "ABC-1",
    });
  });

  it("rejects extra text around a Yunxiao URL", () => {
    expect(parseYunxiaoWorkitemRef("看这个 https://devops.aliyun.com/projex/req/HQGS-354")).toBeNull();
    expect(parseYunxiaoWorkitemRef("https://devops.aliyun.com/projex/req/HQGS-354 请跟进")).toBeNull();
    expect(parseYunxiaoWorkitemRef("https://example.com/projex/req/HQGS-354")).toBeNull();
  });

  it("searches work items by serialNumber EQUALS", async () => {
    const calls: Array<{ init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      calls.push({ init });
      return Response.json({
        success: true,
        result: { items: [{ id: "item-1", serialNumber: "HQGS-354" }] },
      });
    };
    await expect(searchWorkitemsBySerialNumber(
      "org 1",
      "project-1",
      "Req",
      "HQGS-354",
      "token",
      fetcher,
    )).resolves.toMatchObject({ id: "item-1", serialNumber: "HQGS-354" });
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toMatchObject({
      category: "Req",
      spaceId: "project-1",
      spaceType: "Project",
      page: 1,
      perPage: 20,
    });
    expect(JSON.parse(body.conditions)).toEqual({
      conditionGroups: [[{
        fieldIdentifier: "serialNumber",
        operator: "EQUALS",
        value: ["HQGS-354"],
        toValue: null,
        className: "string",
        format: "input",
      }]],
    });
  });
});
