import {
  mysqlTable,
  serial,
  varchar,
  text,
  timestamp,
  int,
  json,
  bigint,
  index,
} from "drizzle-orm/mysql-core";

// 核查记录表
export const verifications = mysqlTable("verifications", {
  id: serial("id").primaryKey(),
  claim: text("claim").notNull(),
  verdict: varchar("verdict", { length: 32 }).notNull(),
  confidence: int("confidence").notNull(),
  credibilityScore: int("credibility_score").notNull(),
  summary: text("summary").notNull(),
  /** 完整结果 JSON：reasoning / sources / queries / coreClaims / stats */
  payload: json("payload").notNull(),
  /** 归属：注册用户 id（游客为 NULL） */
  userId: bigint("user_id", { mode: "number", unsigned: true }),
  /** 归属：游客标识（注册用户为 NULL） */
  guestId: varchar("guest_id", { length: 64 }),
  /** 旧游客记录的 IP 摘要；保留以兼容已有数据，新核查不使用此字段计数 */
  ipHash: varchar("ip_hash", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_verif_user").on(t.userId),
  index("idx_verif_guest").on(t.guestId),
  index("idx_verif_ip").on(t.ipHash),
]);

// 用户表
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  /** "admin" | "user" */
  role: varchar("role", { length: 16 }).notNull().default("user"),
  /** 用户自带的 LLM 平台（contracts LLM_PROVIDERS 的 key），未设置为 null */
  llmProvider: varchar("llm_provider", { length: 32 }),
  /** 用户自带 API Key 的 AES-256-GCM 密文（iv:tag:data 的 hex 拼接），不明文落库 */
  llmApiKeyEnc: varchar("llm_api_key_enc", { length: 512 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// 会话表（Bearer token 登录态）
export const sessions = mysqlTable("sessions", {
  token: varchar("token", { length: 64 }).primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});
