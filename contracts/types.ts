export * from "./errors";

// ============ 信息可信度核查：前后端共享类型 ============

/** 判定结论 */
export type Verdict =
  | "true" // 属实
  | "mostly_true" // 基本属实
  | "mixed" // 部分属实 / 有争议
  | "mostly_false" // 基本失实
  | "false" // 失实 / 谣言
  | "unverifiable"; // 无法判定

export type Stance = "support" | "contradict" | "neutral";
export type Reliability = "high" | "medium" | "low";

/** 主张拆解结果 */
export interface ClaimAnalysis {
  coreClaims: string[];
  queries: string[];
  topic: string;
}

/** 一条证据来源 */
export interface SourceItem {
  id: string;
  title: string;
  url: string;
  siteName: string;
  date?: string;
  authority?: string;
  snippet: string;
  stance: Stance;
  reliability: Reliability;
  note?: string;
}

export interface SourceStats {
  total: number;
  support: number;
  contradict: number;
  neutral: number;
  highReliability: number;
}

/** 完整核查结果 */
/** 搜索模式：deep=深度核查（多路检索+正文抓取），quick=快速核查（精简检索） */
export type SearchMode = "deep" | "quick";

export interface VerificationResult {
  id: number;
  claim: string;
  /** 本次核查使用的搜索模式 */
  mode?: SearchMode;
  verdict: Verdict;
  /** 对本次判定的把握 0-100 */
  confidence: number;
  /** 信息可靠度评分 0-100 */
  credibilityScore: number;
  summary: string;
  reasoning: string[];
  sources: SourceItem[];
  coreClaims: string[];
  queries: string[];
  stats: SourceStats;
  createdAt: Date;
}

/** 历史记录列表项 */
export interface HistoryItem {
  id: number;
  claim: string;
  verdict: Verdict;
  confidence: number;
  credibilityScore: number;
  summary: string;
  createdAt: Date;
}

export const VERDICT_META: Record<
  Verdict,
  { label: string; tone: "emerald" | "lime" | "amber" | "orange" | "red" | "slate" }
> = {
  true: { label: "属实", tone: "emerald" },
  mostly_true: { label: "基本属实", tone: "lime" },
  mixed: { label: "部分属实", tone: "amber" },
  mostly_false: { label: "基本失实", tone: "orange" },
  false: { label: "失实", tone: "red" },
  unverifiable: { label: "无法判定", tone: "slate" },
};

/** 登录用户信息（会话） */
export interface SessionUser {
  id: number;
  username: string;
  role: "admin" | "user";
  /** 是否已设置自带 LLM Key（设置后不占平台每日额度） */
  hasLlmKey?: boolean;
  /** 已设置的自带 Key 平台（LLM_PROVIDERS 的 key），用于界面展示，不暴露 Key 本体 */
  llmProvider?: string | null;
}

/** 未注册游客的免费核查次数上限（按游客身份与访问 IP 的并集计数，清除浏览器数据不重置） */
export const GUEST_LIMIT = 1;

/** 注册用户每日免费核查次数上限（按 UTC+8 自然日重置；管理员与自带 Key 用户不限） */
export const USER_DAILY_LIMIT = 5;

/** 自带 Key 支持的 OpenAI 兼容平台预设（用户只需选平台 + 填 Key） */
export const LLM_PROVIDERS = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  kimi: { label: "Kimi 开放平台", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k2.5" },
  zhipu: { label: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4.5-flash" },
  qwen: { label: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
} as const;
export type LlmProviderId = keyof typeof LLM_PROVIDERS;

/** 管理后台用户列表项 */
export interface AdminUserItem {
  id: number;
  username: string;
  role: string;
  verificationCount: number;
  createdAt: Date;
}
