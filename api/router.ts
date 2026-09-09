import { createRouter, publicQuery } from "./middleware";
import { verifyRouter } from "./verify";
import { authRouter } from "./auth";
import { adminRouter } from "./admin";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  verify: verifyRouter,
  auth: authRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
