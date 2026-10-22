import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { LLM_PROVIDERS } from "../contracts/types";
import type { TrpcContext } from "./context";

const boundary = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  decryptApiKey: vi.fn(),
  getDb: vi.fn(),
  chatJson: vi.fn(),
  webSearch: vi.fn(),
  fetchPage: vi.fn(),
  isNetworkError: vi.fn(),
}));

vi.mock("./auth", () => ({
  getSessionUser: boundary.getSessionUser,
  decryptApiKey: boundary.decryptApiKey,
}));
vi.mock("./queries/connection", () => ({ getDb: boundary.getDb }));
vi.mock("./services/agentgw", () => ({
  chatJson: boundary.chatJson,
  webSearch: boundary.webSearch,
  fetchPage: boundary.fetchPage,
  isNetworkError: boundary.isNetworkError,
}));

let router: typeof import("./verify").verifyRouter;
let saved: Map<number, { p: string | null; k: string | null }>;
let admins: Set<number>;
let persistedCount: number;
let selectedTables: string[];
const dialect = new MySqlDialect();

function context(userId: number | null = 7): TrpcContext {
  return {
    req: new Request("https://truthlens.test/api/trpc", {
      headers: userId === null ? {} : { "x-test-user": String(userId) },
    }),
    resHeaders: new Headers(),
  };
}

function client(userId: number | null = 7) {
  return router.createCaller(context(userId));
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  saved = new Map([[7, { p: "deepseek", k: "encrypted-user-7" }]]);
  admins = new Set();
  persistedCount = 500;
  selectedTables = [];
  boundary.getSessionUser.mockImplementation(async (ctx: TrpcContext) => {
    const id = Number(ctx.req.headers.get("x-test-user"));
    return id
      ? { id, username: `user-${id}`, role: admins.has(id) ? "admin" : "user" }
      : null;
  });
  boundary.decryptApiKey.mockImplementation(
    (encrypted: string) => `sk-own-${encrypted}`
  );
  boundary.getDb.mockReturnValue({
    select: () => ({
      from: (table: Table) => {
        const tableName = getTableName(table);
        selectedTables.push(tableName);
        return {
          where: (condition: SQL) => ({
            limit: async () => {
              // Query the real Drizzle predicate to verify that the current user's
              // ID selects the key. A historical usage query is never permitted.
              const query = dialect.sqlToQuery(condition);
              if (tableName !== "users") {
                throw new Error(
                  "Starting a task must not query historical usage"
                );
              }
              const row = saved.get(Number(query.params[0]));
              return row ? [row] : [];
            },
          }),
        };
      },
    }),
    insert: () => ({ values: async () => [{ insertId: ++persistedCount }] }),
  });
  // Keep jobs active unless a test explicitly supplies completed model responses.
  boundary.chatJson.mockImplementation(() => new Promise(() => {}));
  boundary.webSearch.mockResolvedValue([
    {
      url: "https://evidence.test/source",
      title: "独立证据",
      snippet: "用于验证核查流程的公开摘要",
      authority: "A",
    },
  ]);
  boundary.fetchPage.mockResolvedValue("private fetched page body");
  boundary.isNetworkError.mockReturnValue(false);
  router = (await import("./verify")).verifyRouter;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("verification requires the signed-in user's own saved key", () => {
  it("rejects anonymous callers before database access, search, or model calls", async () => {
    await expect(
      client(null).start({ claim: "未登录用户提交的核查" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(boundary.getDb).not.toHaveBeenCalled();
    expect(boundary.chatJson).not.toHaveBeenCalled();
    expect(boundary.webSearch).not.toHaveBeenCalled();
    expect("quota" in router._def.procedures).toBe(false);
  });

  it.each(["user", "admin"])(
    "rejects a %s without a saved key, with no site fallback",
    async role => {
      if (role === "admin") admins.add(7);
      saved.set(7, { p: null, k: null });
      await expect(
        client().start({ claim: "没有设置个人密钥的核查" })
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(boundary.chatJson).not.toHaveBeenCalled();
      expect(boundary.webSearch).not.toHaveBeenCalled();
    }
  );

  it("fails closed when the saved configuration cannot be read", async () => {
    boundary.getDb.mockImplementation(() => {
      throw new Error("database unavailable");
    });
    await expect(
      client().start({ claim: "数据库读取失败的核查" })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "暂时无法读取已保存的 API 密钥，请稍后重试",
    });
    expect(boundary.chatJson).not.toHaveBeenCalled();
    expect(boundary.webSearch).not.toHaveBeenCalled();
  });

  it("rejects damaged ciphertext explicitly and never starts upstream work", async () => {
    boundary.decryptApiKey.mockImplementation(() => {
      throw new Error("bad authentication tag");
    });
    await expect(
      client().start({ claim: "保存密文已损坏的核查" })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("无法解密"),
    });
    expect(boundary.chatJson).not.toHaveBeenCalled();
    expect(boundary.webSearch).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "short",
    "sk-invalid\nheader",
    "sk-invalid space",
    "sk-密钥格式错误-test",
  ])("rejects invalid decrypted key %j", async key => {
    boundary.decryptApiKey.mockReturnValue(key);
    await expect(
      client().start({ claim: "保存密钥格式无效的核查" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(boundary.chatJson).not.toHaveBeenCalled();
  });

  it("rejects a prototype property as a model provider", async () => {
    saved.set(7, { p: "toString", k: "encrypted-user-7" });
    await expect(
      client().start({ claim: "无效模型平台的核查" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(boundary.chatJson).not.toHaveBeenCalled();
  });

  it.each(Object.entries(LLM_PROVIDERS))(
    "starts %s with that user's key and returns only the job ID",
    async (provider, preset) => {
      saved.set(8, { p: provider, k: "encrypted-user-8" });
      const ctx = context(8);
      const response = await router
        .createCaller(ctx)
        .start({ claim: "当前用户自己的密钥测试" });
      expect(Object.keys(response)).toEqual(["jobId"]);
      expect(ctx.resHeaders.has("Set-Cookie")).toBe(false);
      expect(boundary.chatJson.mock.calls[0][2].llm).toEqual({
        apiKey: "sk-own-encrypted-user-8",
        baseUrl: preset.baseUrl,
        model: preset.model,
      });
      const status = await client(8).status(response);
      expect(JSON.stringify(status)).not.toMatch(
        /encrypted-user|apiKey|guestId|ipHash/
      );
      await expect(client(7).status(response)).resolves.toMatchObject({
        stage: "error",
        claim: "",
      });
    }
  );

  it("requires a currently saved key even when a matching job is already active", async () => {
    const input = { claim: "重复提交但密钥已经删除" };
    await client().start(input);
    saved.set(7, { p: null, k: null });
    await expect(client().start(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(boundary.chatJson).toHaveBeenCalledTimes(1);
  });
});

describe("task reservations have concurrency limits but no daily/history limits", () => {
  it("deduplicates concurrent starts for the same owner, claim, and mode", async () => {
    const requests = Array.from({ length: 5 }, () =>
      client().start({ claim: "跨标签页同时提交同一主张" })
    );
    const responses = await Promise.all(requests);
    expect(new Set(responses.map(result => result.jobId)).size).toBe(1);
    expect(boundary.chatJson).toHaveBeenCalledTimes(1);
  });

  it("reserves at most two concurrent tasks per user, including admins", async () => {
    admins.add(7);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        client().start({ claim: `管理员并发测试主张 ${i}` })
      )
    );
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(2);
    for (const result of results) {
      if (result.status === "rejected")
        expect(result.reason.code).toBe("TOO_MANY_REQUESTS");
    }
  });

  it("enforces the global 100-task capacity across independent user locks", async () => {
    for (let id = 1; id <= 105; id++)
      saved.set(id, { p: "deepseek", k: `encrypted-user-${id}` });
    const results = await Promise.allSettled(
      Array.from({ length: 105 }, (_, i) =>
        client(i + 1).start({ claim: `全局并发测试主张 ${i}` })
      )
    );
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(100);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(
      5
    );
    expect(boundary.chatJson).toHaveBeenCalledTimes(100);
  });

  it("does not free an executing reservation merely because the job TTL elapsed", async () => {
    await client().start({ claim: "长任务并发测试第一条" });
    await client().start({ claim: "长任务并发测试第二条" });
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    await expect(
      client().start({ claim: "长任务并发测试第三条" })
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("accepts successive completed tasks regardless of the number already in history", async () => {
    boundary.chatJson.mockResolvedValue({
      verdict: "true",
      confidence: 75,
      summary: "证据支持该主张",
      reasoning: ["依据公开证据"],
      assessments: [],
    });
    for (let i = 0; i < 8; i++) {
      const response = await client().start({
        claim: `不限每日历史次数的核查 ${i}`,
        mode: "quick",
      });
      await vi.advanceTimersByTimeAsync(300);
      await expect(client().status(response)).resolves.toMatchObject({
        stage: "done",
      });
    }
    expect(persistedCount).toBe(508);
    expect(selectedTables).toEqual(Array(8).fill("users"));
    for (const call of boundary.chatJson.mock.calls) {
      expect(call[2].llm.apiKey).toBe("sk-own-encrypted-user-7");
    }
  });

  it("releases failed task slots without retrying on a site key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    boundary.chatJson.mockRejectedValue(new Error("个人模型服务 HTTP 401"));
    for (let i = 0; i < 3; i++) {
      const response = await client().start({
        claim: `个人密钥失效的核查 ${i}`,
      });
      await expect(client().status(response)).resolves.toMatchObject({
        stage: "error",
        error: "个人模型服务 HTTP 401",
      });
    }
    expect(boundary.chatJson).toHaveBeenCalledTimes(3);
    for (const call of boundary.chatJson.mock.calls) {
      expect(call[2].llm.apiKey).toBe("sk-own-encrypted-user-7");
    }
  });
});
