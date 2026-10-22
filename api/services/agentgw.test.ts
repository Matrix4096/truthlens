import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLM_PROVIDERS } from "@contracts/types";

vi.mock("node:https", () => ({ default: { request: vi.fn() } }));

type NativeReply = {
  status?: number;
  chunks?: string[];
  error?: string;
  delayMs?: number;
  contentLength?: number;
  hang?: boolean;
};

function nativeReply(reply: NativeReply = {}) {
  const payloads: string[] = [];
  vi.mocked(https.request).mockImplementationOnce(((
    _options: unknown,
    callback: (response: IncomingMessage) => void,
  ) => {
    const request = new EventEmitter() as ClientRequest;
    request.write = vi.fn((payload: string) => { payloads.push(payload); return true; });
    request.destroy = vi.fn(() => request);
    request.end = vi.fn(() => {
      const dispatch = () => {
        if (reply.hang) return;
        if (reply.error) {
          request.emit("error", Object.assign(new Error("untrusted-upstream-secret"), { code: reply.error }));
          return;
        }
        const response = new EventEmitter() as IncomingMessage;
        response.statusCode = reply.status ?? 200;
        response.headers = reply.contentLength ? { "content-length": String(reply.contentLength) } : {};
        let destroyed = false;
        response.destroy = vi.fn(() => { destroyed = true; return response; });
        callback(response);
        for (const chunk of reply.chunks ?? ['{"search_results":[]}']) {
          if (!destroyed) response.emit("data", Buffer.from(chunk));
        }
        if (!destroyed) response.emit("end");
      };
      if (reply.delayMs) setTimeout(dispatch, reply.delayMs);
      else queueMicrotask(dispatch);
      return request;
    }) as ClientRequest["end"];
    return request;
  }) as typeof https.request);
  return payloads;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("KIMI_API_KEY", "test-key-only");
  vi.stubEnv("KIMI_BASE_URL", "https://gateway.invalid");
  vi.stubEnv("LLM_API_KEY", "");
  vi.stubEnv("LLM_BASE_URL", "");
  vi.stubEnv("LLM_MODEL", "");
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("gateway transport boundaries", () => {
  it("handles a synchronous HTTP error callback before initializing the deadline timer", async () => {
    vi.mocked(https.request).mockImplementationOnce(((
      _options: unknown,
      callback: (response: IncomingMessage) => void,
    ) => {
      const request = new EventEmitter() as ClientRequest;
      const response = new EventEmitter() as IncomingMessage;
      response.statusCode = 401;
      response.headers = {};
      response.destroy = vi.fn(() => response);
      callback(response);
      return request;
    }) as typeof https.request);
    const { webSearch } = await import("./agentgw");

    await expect(webSearch("test query")).rejects.toThrow("HTTP 401");
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([400, 401, 403, 404])("does not replay permanent HTTP %i errors or expose response bodies", async (status) => {
    nativeReply({ status, chunks: ["untrusted-upstream-secret"] });
    const { webSearch } = await import("./agentgw");

    await expect(webSearch("test query")).rejects.toThrow(`HTTP ${status}`);
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("untrusted-upstream-secret");
  });

  it("retries HTTP 429 with bounded backoff, without switching transports", async () => {
    nativeReply({ status: 429 });
    nativeReply({ chunks: ['{"search_results":[{"title":"Recovered"}]}'] });
    const { webSearch } = await import("./agentgw");
    const pending = webSearch("test query");

    await vi.advanceTimersByTimeAsync(1200);
    await expect(pending).resolves.toEqual([{ title: "Recovered" }]);
    expect(https.request).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops after the configured retry count for server errors", async () => {
    nativeReply({ status: 503 });
    nativeReply({ status: 503 });
    nativeReply({ status: 503 });
    const { webSearch } = await import("./agentgw");
    const assertion = expect(webSearch("test query")).rejects.toThrow("HTTP 503");

    await vi.advanceTimersByTimeAsync(3600);
    await assertion;
    expect(https.request).toHaveBeenCalledTimes(3);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to fetch for a genuine network failure", async () => {
    nativeReply({ error: "ECONNRESET" });
    vi.mocked(fetch).mockResolvedValue(new Response('{"search_results":[{"title":"Fallback"}]}'));
    const { webSearch } = await import("./agentgw");

    await expect(webSearch("test query")).resolves.toEqual([{ title: "Fallback" }]);
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a permanent HTTP error returned by the fallback", async () => {
    nativeReply({ error: "ECONNRESET" });
    vi.mocked(fetch).mockResolvedValue(new Response("untrusted-upstream-secret", { status: 401 }));
    const { webSearch } = await import("./agentgw");

    await expect(webSearch("test query")).rejects.toThrow("HTTP 401");
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("untrusted-upstream-secret");
  });

  it("shares a single deadline across native and fallback transports", async () => {
    nativeReply({ error: "ECONNRESET", delayMs: 11_000 });
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const { fetchPage } = await import("./agentgw");
    const pending = fetchPage("https://example.invalid/article");

    await vi.advanceTimersByTimeAsync(11_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe("");
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enforces an absolute native timeout even when no response arrives", async () => {
    nativeReply({ hang: true });
    const { fetchPage } = await import("./agentgw");
    const pending = fetchPage("https://example.invalid/article");

    await vi.advanceTimersByTimeAsync(12_000);
    await expect(pending).resolves.toBe("");
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects oversized native streams without fallback or retry", async () => {
    nativeReply({ chunks: ["x".repeat(1024 * 1024), "x".repeat(1024 * 1024 + 1)] });
    const { webSearch } = await import("./agentgw");

    await expect(webSearch("test query")).rejects.toThrow("2 MiB");
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects oversized fallback streams without retry", async () => {
    nativeReply({ error: "ECONNRESET" });
    vi.mocked(fetch).mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1)));
    const { webSearch } = await import("./agentgw");

    await expect(webSearch("test query")).rejects.toThrow("2 MiB");
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry permanent LLM authentication failures", async () => {
    nativeReply({ status: 401 });
    const { chatJson } = await import("./agentgw");

    await expect(chatJson("system", "user", {
      llm: { apiKey: "test-user-key-only", baseUrl: "https://model.invalid/v1", model: "test-model" },
    })).resolves.toBeNull();
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("personal model credentials", () => {
  const personal = {
    apiKey: "test-user-key-only",
    baseUrl: "https://personal-model.invalid/v1",
    model: "personal-model-only",
  };

  beforeEach(() => {
    // A configured site account must never be used by chatJson.
    vi.stubEnv("LLM_API_KEY", "test-site-key-never-use");
    vi.stubEnv("LLM_BASE_URL", "https://site-model.invalid/v1");
    vi.stubEnv("LLM_MODEL", "site-model-never-use");
    vi.stubEnv("KIMI_CHAT_ID", "site-chat-never-use");
  });

  it.each([
    { label: "missing options", opts: undefined },
    { label: "null options", opts: null },
    { label: "missing model config", opts: {} },
    { label: "null model config", opts: { llm: null } },
    { label: "missing key", opts: { llm: { baseUrl: personal.baseUrl, model: personal.model } } },
    { label: "blank key", opts: { llm: { ...personal, apiKey: "   " } } },
    { label: "blank endpoint", opts: { llm: { ...personal, baseUrl: "\n " } } },
    { label: "blank model", opts: { llm: { ...personal, model: "\t " } } },
  ])("rejects $label before any request despite site credentials", async ({ opts }) => {
    const { chatJson } = await import("./agentgw");

    await expect(chatJson("system", "user", opts as Parameters<typeof chatJson>[2]))
      .rejects.toThrow("模型调用缺少有效的个人 API Key");
    expect(https.request).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { provider: "deepseek", hostname: "api.deepseek.com", path: "/v1/chat/completions", model: "deepseek-chat" },
    { provider: "kimi", hostname: "api.moonshot.cn", path: "/v1/chat/completions", model: "kimi-k2.5" },
    { provider: "zhipu", hostname: "open.bigmodel.cn", path: "/api/paas/v4/chat/completions", model: "glm-4.5-flash" },
    { provider: "qwen", hostname: "dashscope.aliyuncs.com", path: "/compatible-mode/v1/chat/completions", model: "qwen-plus" },
  ] as const)("uses only the supplied key and $provider preset", async ({ provider, hostname, path, model }) => {
    const payloads = nativeReply({ chunks: [JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })] });
    const { chatJson } = await import("./agentgw");

    await expect(chatJson("system", "user", {
      llm: { apiKey: personal.apiKey, ...LLM_PROVIDERS[provider] },
      maxTokens: 200,
    })).resolves.toEqual({ ok: true });
    expect(https.request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      hostname,
      path,
      headers: expect.objectContaining({ Authorization: `Bearer ${personal.apiKey}` }),
    }), expect.any(Function));
    expect(https.request).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.not.objectContaining({ "X-Kimi-Chat-Id": expect.anything() }),
    }), expect.any(Function));
    expect(JSON.parse(payloads[0])).toMatchObject({
      model, max_tokens: 200, response_format: { type: "json_object" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never switches account after a personal key is rejected and does not expose its echoed value", async () => {
    nativeReply({ status: 401, chunks: [JSON.stringify({ error: `Invalid key ${personal.apiKey}` })] });
    const { chatJson } = await import("./agentgw");

    await expect(chatJson("system", "user", { llm: personal })).resolves.toBeNull();
    expect(https.request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      hostname: "personal-model.invalid",
      headers: expect.objectContaining({ Authorization: `Bearer ${personal.apiKey}` }),
    }), expect.any(Function));
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(personal.apiKey);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain("HTTP 401");
  });

  it("keeps the same personal account, model and endpoint when changing network transport", async () => {
    nativeReply({ error: "ECONNRESET" });
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    const { chatJson } = await import("./agentgw");

    await expect(chatJson("system", "user", { llm: personal })).resolves.toEqual({ ok: true });
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://personal-model.invalid/v1/chat/completions", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${personal.apiKey}` }),
      body: expect.any(String),
    }));
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(JSON.parse(String(init?.body)).model).toBe(personal.model);
    expect(init?.headers).not.toHaveProperty("X-Kimi-Chat-Id");
  });
});
