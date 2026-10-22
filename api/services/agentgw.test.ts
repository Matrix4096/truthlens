import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import https from "node:https";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  vi.mocked(https.request).mockImplementationOnce(((
    _options: unknown,
    callback: (response: IncomingMessage) => void,
  ) => {
    const request = new EventEmitter() as ClientRequest;
    request.write = vi.fn(() => true);
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

    await expect(chatJson("system", "user")).resolves.toBeNull();
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
