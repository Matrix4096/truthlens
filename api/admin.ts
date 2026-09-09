import { z } from "zod";
import { count, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter } from "./middleware";
import { adminQuery } from "./auth";
import { getDb } from "./queries/connection";
import { sessions, users, verifications } from "@db/schema";
import type { AdminUserItem } from "@contracts/types";

export const adminRouter = createRouter({
  /** 总览统计 */
  overview: adminQuery.query(async () => {
    const db = getDb();
    const [u] = await db.select({ n: count() }).from(users);
    const [v] = await db.select({ n: count() }).from(verifications);
    const [g] = await db
      .select({ n: count() })
      .from(verifications)
      .where(isNull(verifications.userId));
    return { userCount: u?.n ?? 0, verificationCount: v?.n ?? 0, guestCount: g?.n ?? 0 };
  }),

  /** 用户列表（含每人核查数） */
  listUsers: adminQuery.query(async (): Promise<AdminUserItem[]> => {
    const db = getDb();
    const rows = await db
      .select({ id: users.id, username: users.username, role: users.role, createdAt: users.createdAt })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(200);
    const counts = await db
      .select({ userId: verifications.userId, n: count() })
      .from(verifications)
      .groupBy(verifications.userId);
    const map = new Map(counts.map((c) => [c.userId, c.n]));
    return rows.map((r) => ({ ...r, verificationCount: map.get(r.id) ?? 0 }));
  }),

  /** 删除用户（连同其历史与会话；不能删除管理员与自身） */
  deleteUser: adminQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      if (input.id === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能删除当前登录的账号" });
      }
      const db = getDb();
      const rows = await db.select({ role: users.role }).from(users).where(eq(users.id, input.id)).limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      if (rows[0].role === "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "不能删除管理员账号" });
      }
      await db.delete(verifications).where(eq(verifications.userId, input.id));
      await db.delete(sessions).where(eq(sessions.userId, input.id));
      await db.delete(users).where(eq(users.id, input.id));
      return { ok: true };
    }),
});
