import { z } from "zod";
import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import type { TrpcContext } from "./context";
import { getDb } from "./queries/connection";
import { sessions, users } from "@db/schema";
import type { SessionUser } from "@contracts/types";
import { LLM_PROVIDERS } from "@contracts/types";
import type { LlmProviderId } from "@contracts/types";
import { chatJson } from "./services/agentgw";

const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 天

// ---------- 用户自带 API Key 的落库加密（AES-256-GCM，密钥由 APP_SECRET 派生） ----------

const keyCipherSecret = scryptSync(process.env.APP_SECRET || "truthlens-dev-secret", "tl-llm-key-v1", 32);

export function encryptApiKey(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyCipherSecret, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptApiKey(stored: string): string {
  const [ivHex, tagHex, encHex] = stored.split(":");
  if (!ivHex || !tagHex || !encHex) throw new Error("密钥密文格式损坏");
  const decipher = createDecipheriv("aes-256-gcm", keyCipherSecret, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(encHex, "hex")), decipher.final()]).toString("utf-8");
}

// ---------- 密码散列（scrypt + 随机盐） ----------

function deriveKey(pw: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pw, salt, 32, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await deriveKey(pw, salt)).toString("hex");
  return `${salt}:${hash}`;
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const calc = await deriveKey(pw, salt);
  const expect = Buffer.from(hash, "hex");
  return calc.length === expect.length && timingSafeEqual(calc, expect);
}

// ---------- 会话 ----------

function tokenFrom(ctx: TrpcContext): string {
  const auth = ctx.req.headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export async function getSessionUser(ctx: TrpcContext): Promise<SessionUser | null> {
  const token = tokenFrom(ctx);
  if (!token) return null;
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.token, token))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    if (r.expiresAt.getTime() < Date.now()) {
      await db.delete(sessions).where(eq(sessions.token, token));
      return null;
    }
    return { id: r.id, username: r.username, role: r.role === "admin" ? "admin" : "user" };
  } catch {
    return null;
  }
}

async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await getDb()
    .insert(sessions)
    .values({ token, userId, expiresAt: new Date(Date.now() + SESSION_TTL) });
  return token;
}

// ---------- 管理员引导：无管理员时按环境变量创建 ----------

let adminEnsured = false;
let adminEnsuring: Promise<void> | null = null;
async function ensureAdmin() {
  if (adminEnsured) return;
  if (!adminEnsuring) {
    adminEnsuring = (async () => {
      const db = getDb();
      const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
      if (rows.length > 0) {
        adminEnsured = true;
        return;
      }

      const password = process.env.ADMIN_PASSWORD;
      if (!password) {
        // 绝不以固定密码创建管理员；请通过部署环境显式提供一次性初始密码。
        console.warn("[auth] 未配置 ADMIN_PASSWORD，跳过管理员账号引导");
        adminEnsured = true;
        return;
      }
      if (password.length < 12) {
        throw new Error("ADMIN_PASSWORD 至少应为 12 个字符");
      }

      const username = process.env.ADMIN_USERNAME?.trim() || "admin";
      if (!/^[\w\u4e00-\u9fa5-]{2,32}$/.test(username)) {
        throw new Error("ADMIN_USERNAME 仅支持中英文、数字、下划线与短横线，且长度为 2-32 个字符");
      }
      await db.insert(users).values({ username, passwordHash: await hashPassword(password), role: "admin" });
      adminEnsured = true;
      console.log(`[auth] 已创建管理员账号 ${username}`);
    })()
      .catch((e) => {
        // 数据库尚不可用时允许后续请求重试，而不是永久标记为已初始化。
        console.error("[auth] 管理员引导失败:", (e as Error).message);
      })
      .finally(() => {
        adminEnsuring = null;
      });
  }
  await adminEnsuring;
}

// ---------- 鉴权 procedure（在框架 middleware 之上扩展，不改动框架文件） ----------

export const authedQuery = publicQuery.use(async ({ ctx, next }) => {
  const user = await getSessionUser(ctx);
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  return next({ ctx: { ...ctx, user } });
});

export const adminQuery = publicQuery.use(async ({ ctx, next }) => {
  const user = await getSessionUser(ctx);
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  if (user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
  return next({ ctx: { ...ctx, user } });
});

// ---------- 路由 ----------

const credSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "用户名至少 2 个字符")
    .max(32, "用户名最多 32 个字符")
    .regex(/^[\w\u4e00-\u9fa5-]+$/, "用户名仅支持中英文、数字、下划线与短横线"),
  password: z.string().min(6, "密码至少 6 位").max(64, "密码最多 64 位"),
});

export const authRouter = createRouter({
  register: publicQuery.input(credSchema).mutation(async ({ input }) => {
    await ensureAdmin();
    const db = getDb();
    const exists = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, input.username))
      .limit(1);
    if (exists.length) throw new TRPCError({ code: "CONFLICT", message: "用户名已被占用" });
    const inserted = await db
      .insert(users)
      .values({
        username: input.username,
        passwordHash: await hashPassword(input.password),
        role: "user",
      });
    const id = Number((inserted as unknown as Array<{ insertId: number | string }>)[0]?.insertId ?? 0);
    const token = await createSession(id);
    const user: SessionUser = { id, username: input.username, role: "user" };
    return { token, user };
  }),

  login: publicQuery.input(credSchema).mutation(async ({ input }) => {
    await ensureAdmin();
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.username, input.username)).limit(1);
    const u = rows[0];
    if (!u || !(await verifyPassword(input.password, u.passwordHash))) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "用户名或密码错误" });
    }
    const token = await createSession(u.id);
    const user: SessionUser = { id: u.id, username: u.username, role: u.role === "admin" ? "admin" : "user" };
    return { token, user };
  }),

  logout: publicQuery.mutation(async ({ ctx }) => {
    const token = tokenFrom(ctx);
    if (token) {
      try {
        await getDb().delete(sessions).where(eq(sessions.token, token));
      } catch {
        /* 忽略 */
      }
    }
    return { ok: true };
  }),

  me: publicQuery.query(async ({ ctx }): Promise<SessionUser | null> => {
    await ensureAdmin();
    const user = await getSessionUser(ctx);
    if (!user) return null;
    let hasLlmKey = false;
    let llmProvider: string | null = null;
    try {
      const db = getDb();
      const rows = await db
        .select({ k: users.llmApiKeyEnc, p: users.llmProvider })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      hasLlmKey = !!rows[0]?.k;
      llmProvider = rows[0]?.p ?? null;
    } catch {
      /* 忽略，按未设置计 */
    }
    return { ...user, hasLlmKey, llmProvider };
  }),

  /** 设置/更新自带 LLM Key：先真实调用一次该平台验证有效，再加密落库 */
  setLlmKey: authedQuery
    .input(
      z.object({
        provider: z.enum(["deepseek", "kimi", "zhipu", "qwen"]),
        apiKey: z.string().trim().min(10).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const preset = LLM_PROVIDERS[input.provider as LlmProviderId];
      const probe = await chatJson<{ ok?: boolean }>(
        "只输出 JSON，不要输出任何其他文字。",
        '请输出 JSON：{"ok": true}',
        {
          maxTokens: 200,
          retries: 0,
          timeoutMs: 30_000,
          llm: { apiKey: input.apiKey, baseUrl: preset.baseUrl, model: preset.model },
        },
      );
      if (!probe) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `无法通过 ${preset.label} 的模型调用验证，请检查 Key 是否正确、账户是否有余额`,
        });
      }
      await getDb()
        .update(users)
        .set({ llmProvider: input.provider, llmApiKeyEnc: encryptApiKey(input.apiKey) })
        .where(eq(users.id, ctx.user.id));
      return { ok: true as const };
    }),

  /** 清除自带 Key，回到平台每日免费额度 */
  clearLlmKey: authedQuery.mutation(async ({ ctx }) => {
    await getDb()
      .update(users)
      .set({ llmProvider: null, llmApiKeyEnc: null })
      .where(eq(users.id, ctx.user.id));
    return { ok: true as const };
  }),
});
