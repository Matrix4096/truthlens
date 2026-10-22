import { scryptSync } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<unknown[] | Error>,
  select: vi.fn(), set: vi.fn(), update: vi.fn(), insert: vi.fn(),
  chatJson: vi.fn(),
}));
vi.mock("./queries/connection", () => ({ getDb: () => mocks }));
vi.mock("./services/agentgw", () => ({ chatJson: mocks.chatJson }));

const session = { id: 7, username: "reader", role: "user", expiresAt: new Date("2099-01-01") };
const key = "test-personal-model-key";
const context = (signedIn = true) => ({
  req: new Request("https://truthlens.test/api/trpc", {
    headers: signedIn ? { authorization: "Bearer test-session" } : {},
  }),
  resHeaders: new Headers(),
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("APP_SECRET", "test-encryption-secret-only");
  mocks.rows.length = 0;
  mocks.select.mockImplementation(() => {
    const query = {
      from: () => query, innerJoin: () => query, where: () => query,
      limit: async () => {
        const result = mocks.rows.shift() ?? [];
        if (result instanceof Error) throw result;
        return result;
      },
    };
    return query;
  });
  mocks.set.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  mocks.chatJson.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());

describe("personal model configuration", () => {
  it("requires an authenticated account before validating or storing a key", async () => {
    const { authRouter } = await import("./auth");
    await expect(authRouter.createCaller(context(false)).setLlmKey({ provider: "deepseek", apiKey: key }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.chatJson).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([null, {}, { ok: false }, { ok: "true" }])("does not replace a saved key when the model probe is invalid: %j", async probe => {
    mocks.rows.push([session]);
    mocks.chatJson.mockResolvedValue(probe);
    const { authRouter } = await import("./auth");
    await expect(authRouter.createCaller(context()).setLlmKey({ provider: "deepseek", apiKey: key }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("probes the user's selected model, stores encrypted data, and returns no key", async () => {
    mocks.rows.push([session]);
    const { authRouter, decryptApiKey } = await import("./auth");
    const response = await authRouter.createCaller(context()).setLlmKey({ provider: "deepseek", apiKey: key });
    expect(mocks.chatJson).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
      llm: { apiKey: key, baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
    }));
    const stored = mocks.set.mock.calls[0][0];
    expect(stored.llmProvider).toBe("deepseek");
    expect(stored.llmApiKeyEnc).not.toContain(key);
    expect(decryptApiKey(stored.llmApiKeyEnc)).toBe(key);
    expect(response).toEqual({ ok: true });
    expect(JSON.stringify(response)).not.toContain(key);
  });

  it("clearing a model removes both provider and key", async () => {
    mocks.rows.push([session]);
    const { authRouter } = await import("./auth");
    await authRouter.createCaller(context()).clearLlmKey();
    expect(mocks.set).toHaveBeenCalledWith({ llmProvider: null, llmApiKeyEnc: null });
  });

  it.each(["damaged-ciphertext", "unsupported-provider", "empty-key"])("reports an unusable saved configuration as not ready: %s", async reason => {
    const { authRouter, encryptApiKey } = await import("./auth");
    mocks.rows.push([{ id: 1 }], [session], [{
      k: reason === "damaged-ciphertext" ? "broken" : encryptApiKey(reason === "empty-key" ? "" : key),
      p: reason === "unsupported-provider" ? "__proto__" : "deepseek",
    }]);
    const response = await authRouter.createCaller(context()).me();
    expect(response).toMatchObject({ hasLlmKey: false, llmProvider: null });
    expect(JSON.stringify(response)).not.toContain(key);
  });

  it("returns model readiness immediately after login without exposing the saved key", async () => {
    const { authRouter, encryptApiKey } = await import("./auth");
    const passwordHash = `salt:${scryptSync("test-password", "salt", 32).toString("hex")}`;
    mocks.rows.push([{ id: 1 }], [{ ...session, passwordHash, llmProvider: "qwen", llmApiKeyEnc: encryptApiKey(key) }]);
    const response = await authRouter.createCaller(context(false)).login({ username: "reader", password: "test-password" });
    expect(response.user).toMatchObject({ hasLlmKey: true, llmProvider: "qwen" });
    expect(JSON.stringify(response.user)).not.toContain(key);
  });

  it("reports configuration storage failures instead of showing a ready model", async () => {
    mocks.rows.push([{ id: 1 }], [session], new Error("database unavailable"));
    const { authRouter } = await import("./auth");
    await expect(authRouter.createCaller(context()).me()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
