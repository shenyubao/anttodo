import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSharedImportMap,
  formatSharedDenoJsonc,
  listLocalFunctionDirs,
  mergeFunctionImportMaps,
  remoteFunctionDirsToRemove,
} from "./yuce-edge-functions.mjs";

describe("yuce edge function deploy helpers", () => {
  it("merges function import maps and prefers a covering caret range", () => {
    expect(mergeFunctionImportMaps([
      {
        name: "connector-sync",
        imports: {
          "@supabase/server": "npm:@supabase/server@^1",
          "node-html-markdown": "npm:node-html-markdown@2.0.0",
        },
      },
      {
        name: "send-sms",
        imports: {
          "@supabase/functions-js": "jsr:@supabase/functions-js@2.5.0",
          "standardwebhooks": "npm:standardwebhooks@1.0.0",
        },
      },
      {
        name: "workspace-admin",
        imports: {
          "@supabase/functions-js": "jsr:@supabase/functions-js@^2",
          "@supabase/server": "npm:@supabase/server@^1",
        },
      },
    ])).toEqual({
      "@supabase/functions-js": "jsr:@supabase/functions-js@^2",
      "@supabase/server": "npm:@supabase/server@^1",
      "node-html-markdown": "npm:node-html-markdown@2.0.0",
      "standardwebhooks": "npm:standardwebhooks@1.0.0",
    });
  });

  it("rejects incompatible import specifiers", () => {
    expect(() => mergeFunctionImportMaps([
      { name: "one", imports: { "web-push": "npm:web-push@3.6.7" } },
      { name: "two", imports: { "web-push": "npm:web-push@4.0.0" } },
    ])).toThrow(/import map conflict for "web-push"/);
  });

  it("keeps the edge-runtime main worker and hello sample", () => {
    expect(remoteFunctionDirsToRemove(
      ["_shared", "ai-task-decompose", "connector-sync", "hello", "main"],
      ["_shared", "connector-sync"],
    )).toEqual(["ai-task-decompose"]);
  });

  it("reads local function dirs and their deno.json import maps", () => {
    const root = mkdtempSync(path.join(tmpdir(), "anttodo-functions-"));
    mkdirSync(path.join(root, "_shared"));
    mkdirSync(path.join(root, "connector-sync"));
    mkdirSync(path.join(root, "hello"));
    writeFileSync(
      path.join(root, "connector-sync", "deno.json"),
      JSON.stringify({
        imports: { "node-html-markdown": "npm:node-html-markdown@2.0.0" },
      }),
    );
    expect(listLocalFunctionDirs(root)).toEqual(["_shared", "connector-sync"]);
    expect(buildSharedImportMap(root)).toEqual({
      "node-html-markdown": "npm:node-html-markdown@2.0.0",
    });
    expect(formatSharedDenoJsonc({ "node-html-markdown": "npm:node-html-markdown@2.0.0" }))
      .toBe(`${JSON.stringify({
        imports: { "node-html-markdown": "npm:node-html-markdown@2.0.0" },
      }, null, 2)}\n`);
  });
});
