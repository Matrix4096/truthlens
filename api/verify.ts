import { z } from "zod";
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery } from "./middleware";
import { getSessionUser, decryptApiKey } from "./auth";
import {
  webSearch,
  fetchPage,
  chatJson,
  isNetworkError,
} from "./services/agentgw";
import type { LlmConfig } from "./services/agentgw";
import { getDb } from "./queries/connection";
import { users, verifications } from "@db/schema";
import { desc, eq } from "drizzle-orm";
import type {
  ClaimAnalysis,
  SearchMode,
  SourceItem,
  SourceStats,
  Verdict,
  VerificationResult,
  HistoryItem,
  Reliability,
} from "@contracts/types";
import { LLM_PROVIDERS } from "@contracts/types";
import type { LlmProviderId } from "@contracts/types";
import type { TrpcContext } from "./context";
import { toJobProgress, publicSource } from "./services/verification-state";
import type {
  JobState,
  JobProgress,
  RawSource,
} from "./services/verification-state";
import { createKeyedLock } from "./services/keyed-lock";
import {
  analysisSchema,
  assessmentsSchema,
  judgmentSchema,
} from "./services/verification-schema";
import type { JudgeLLM, Assessment } from "./services/verification-schema";
export type {
  JobStage,
  JobState,
  JobProgress,
} from "./services/verification-state";

// ---------- 类型 ----------

// ---------- 任务存储（内存，30 分钟 TTL） ----------

const jobs = new Map<string, JobState>();
const withOwnerLock = createKeyedLock();
const GUEST_COOKIE = "tl-guest";
const GUEST_HEADER = "x-guest-token";
// 开发环境允许未配置密钥，但进程重启后会使游客身份失效；生产环境应始终设置 APP_SECRET。
const guestSigningSecret =
  process.env.GUEST_TOKEN_SECRET ||
  process.env.APP_SECRET ||
  randomBytes(32).toString("hex");

function sweepJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) {
    if (j.createdAt < cutoff && !isActiveJob(j)) jobs.delete(id);
  }
}
setInterval(sweepJobs, 5 * 60 * 1000).unref();

/** Only the signed-in user's saved, decryptable key may fund a verification. */
async function userLlmConfig(userId: number): Promise<LlmConfig> {
  let row: { p: string | null; k: string | null } | undefined;
  try {
    const rows = await getDb()
      .select({ p: users.llmProvider, k: users.llmApiKeyEnc })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    row = rows[0];
  } catch {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "暂时无法读取已保存的 API 密钥，请稍后重试",
    });
  }
  if (!row?.p || !row.k) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "请先在「API 密钥设置」中选择平台并保存自己的 API Key，再开始核查",
    });
  }
  if (!Object.hasOwn(LLM_PROVIDERS, row.p)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "已保存的模型平台无效，请在「API 密钥设置」中重新选择平台并保存 Key",
    });
  }
  let apiKey: string;
  try {
    apiKey = decryptApiKey(row.k).trim();
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "已保存的 API 密钥无法解密，请在「API 密钥设置」中重新保存自己的 Key",
    });
  }
  if (
    apiKey.length < 10 ||
    apiKey.length > 200 ||
    !/^[\x21-\x7e]+$/.test(apiKey)
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "已保存的 API 密钥格式无效，请在「API 密钥设置」中重新保存自己的 Key",
    });
  }
  const preset = LLM_PROVIDERS[row.p as LlmProviderId];
  return { apiKey, baseUrl: preset.baseUrl, model: preset.model };
}

function isActiveJob(job: JobState) {
  return job.stage !== "done" && job.stage !== "error";
}

function isSameOwner(
  job: JobState,
  userId: number | null,
  guestId: string | null
) {
  return job.userId === userId && job.guestId === guestId;
}

function cookieValue(ctx: TrpcContext, name: string): string | null {
  const cookie = ctx.req.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function signGuestId(id: string): string {
  return createHmac("sha256", guestSigningSecret).update(id).digest("hex");
}

/** 校验签名令牌（Cookie 值与 x-guest-token 头共用同一格式），伪造或格式错误返回 null。 */
function verifyGuestToken(signed: string | null): string | null {
  if (!signed) return null;
  const [id, signature, ...rest] = signed.split(".");
  if (rest.length || !id || !signature || !/^[0-9a-f-]{36}$/i.test(id))
    return null;
  const expected = signGuestId(id);
  const received = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return received.length === expectedBuffer.length &&
    timingSafeEqual(received, expectedBuffer)
    ? id
    : null;
}

function guestIdFromCookie(ctx: TrpcContext): string | null {
  return verifyGuestToken(cookieValue(ctx, GUEST_COOKIE));
}

/** Cookie + 请求头双通道：嵌入预览等第三方上下文会拦截 Cookie 写入，前端此时经 x-guest-token 头回传同一签名令牌。 */
function guestTokenFrom(ctx: TrpcContext): string | null {
  return (
    guestIdFromCookie(ctx) ??
    verifyGuestToken(ctx.req.headers.get(GUEST_HEADER))
  );
}

// ---------- 工具 ----------

function sourceId(url: string) {
  return createHash("md5").update(url).digest("hex").slice(0, 10);
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function reliabilityFromAuthority(a?: string): Reliability {
  if (!a) return "medium";
  const up = a.toUpperCase();
  if (up.startsWith("A")) return "high";
  if (up.startsWith("C") || up.startsWith("D")) return "low";
  return "medium";
}

function clampScore(n: number) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---------- 步骤一：主张拆解 ----------

/** 模板检索式：快速模式与 LLM 拆解失败时的回退策略（原句核查/质疑/辟谣/权威数据） */
function templateQueries(claim: string): ClaimAnalysis {
  const short = claim.length > 60 ? claim.slice(0, 60) : claim;
  return {
    coreClaims: [claim.slice(0, 200)],
    topic: "其他",
    queries: [
      short,
      `${short} 是真的吗`,
      `${short} 辟谣`,
      `${short} 权威 数据`,
    ],
  };
}

function todayText() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

async function analyzeClaim(
  claim: string,
  llm: LlmConfig
): Promise<ClaimAnalysis> {
  const sys =
    "你是专业事实核查专家，擅长把一段待核查信息拆解为可验证的事实主张，并设计检索策略。只输出 JSON，不要输出任何其他文字。";
  const usr = `今天是${todayText()}。\n【待核查信息】\n${claim}\n\n请完成：\n1. 提炼 1-3 个可核查的核心事实主张 coreClaims（若原文是观点/问题，提炼其隐含的事实前提）\n2. 给出主题分类 topic（如 健康/科技/历史/财经/社会/科学/国际/其他）\n3. 生成 4 条中文搜索检索式 queries，每条不超过 22 字、去掉口语化表述：第1条直接核查原始说法，第2条偏向权威来源（政府/学术/主流媒体），第3条偏向查证辟谣/反方证据，第4条补充背景与数据；若信息有时效性，在检索式中加入当前年份限定。\n\n严格输出 JSON：{"coreClaims":["..."],"topic":"...","queries":["...","...","...","..."]}`;
  const response = await chatJson<unknown>(sys, usr, {
    maxTokens: 3000,
    timeoutMs: 60_000,
    llm,
  });
  const checked = analysisSchema.safeParse(response);
  if (!checked.success) return templateQueries(claim);
  const parsed = checked.data;
  const coreClaims = (parsed.coreClaims ?? [])
    .map(s => String(s).trim())
    .filter(Boolean)
    .slice(0, 3);
  const queries = (parsed.queries ?? [])
    .map(s => String(s).trim())
    .filter(Boolean)
    .slice(0, 4);
  const fallback = templateQueries(claim);
  return {
    coreClaims: coreClaims.length ? coreClaims : fallback.coreClaims,
    topic: parsed.topic?.trim() || "其他",
    queries: queries.length ? queries : fallback.queries,
  };
}

// ---------- 步骤二：深度搜索 ----------

interface RoundOutcome {
  items: Awaited<ReturnType<typeof webSearch>>;
  error?: string;
}

function collectItems(
  byUrl: Map<string, RawSource>,
  items: RoundOutcome["items"]
) {
  for (const item of items) {
    const url = (item.url ?? "").trim();
    if (!url || byUrl.has(url)) continue;
    try {
      const parsedUrl = new URL(url);
      if (
        !["http:", "https:"].includes(parsedUrl.protocol) ||
        parsedUrl.username ||
        parsedUrl.password
      )
        continue;
    } catch {
      continue;
    }
    const snippet = (item.snippet || item.content || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!snippet && !item.title) continue;
    byUrl.set(url, {
      id: sourceId(url),
      title: (item.title ?? "").trim() || hostOf(url) || url,
      url,
      siteName: (item.site_name ?? "").trim() || hostOf(url),
      date: item.date,
      authority: item.authority,
      snippet: snippet.slice(0, 800),
      stance: "neutral",
      reliability: reliabilityFromAuthority(item.authority),
    });
  }
}

/** 单轮检索：并发度 2 + 250ms 错峰启动（重试机制兜底限流）；返回来源与失败数 */
async function searchRound(
  qs: string[]
): Promise<{ sources: RawSource[]; failures: number; errors: string[] }> {
  const byUrl = new Map<string, RawSource>();
  const errors: string[] = [];
  let failures = 0;
  let firstNetworkError: string | null = null;

  // 并发度 2 的简单信号量调度
  let idx = 0;
  const worker = async () => {
    while (idx < qs.length) {
      const i = idx++;
      const q = qs[i];
      try {
        const items = await webSearch(q, i === 0 ? 2 : 1);
        collectItems(byUrl, items);
      } catch (e) {
        failures++;
        const msg = (e as Error).message;
        if (errors.length < 2 && !errors.some(x => x === msg)) errors.push(msg);
        console.error(`[verify] 检索失败（${q.slice(0, 30)}…）:`, msg);
        if (i === 0 && isNetworkError(msg)) firstNetworkError = msg;
      }
    }
  };
  const w1 = worker();
  await new Promise(r => setTimeout(r, 250));
  const w2 = worker();
  await Promise.all([w1, w2]);

  // 首路即网络层失败 → 网关整体不可达，本轮视为整体故障
  if (firstNetworkError && byUrl.size === 0) {
    return { sources: [], failures, errors };
  }
  return { sources: [...byUrl.values()], failures, errors };
}

async function deepSearch(
  claim: string,
  queries: string[],
  mode: SearchMode,
  headRound: RoundOutcome
): Promise<RawSource[]> {
  const quick = mode === "quick";
  const byUrl = new Map<string, RawSource>();
  let headFailed = false;
  if (headRound.error) {
    headFailed = true;
    console.error(`[verify] 并行首轮检索失败:`, headRound.error);
  } else {
    collectItems(byUrl, headRound.items);
  }

  // claim 原文已在分析阶段并行检索，本轮只跑 LLM 生成的检索式
  const qs = [...new Set(queries)]
    .filter(q => q !== claim.slice(0, 80))
    .slice(0, quick ? 2 : 4);
  const { sources: roundSources, failures, errors } = await searchRound(qs);
  for (const src of roundSources)
    if (!byUrl.has(src.url)) byUrl.set(src.url, src);
  let merged = [...byUrl.values()];

  // 一条来源都没有：首轮或本轮调用失败所致 → 搜索服务故障（抛出，任务进入 error 态）
  if (merged.length === 0) {
    if (failures > 0 || headFailed) {
      const detail = errors[0] ?? headRound.error ?? "";
      throw new Error(
        `搜索服务暂时不可用（多路检索均失败：${detail.slice(0, 140)}），请稍后重新提交`
      );
    }
    if (!quick) {
      console.warn("[verify] 首轮检索 0 结果，2.5s 后补一轮");
      await new Promise(r => setTimeout(r, 2500));
      const retry = await searchRound(qs);
      merged = retry.sources;
    }
  }

  // 加权排序：权威度为主，有日期、摘要信息量大者加分
  const weight = (s: RawSource) => {
    const rank = { high: 100, medium: 60, low: 30 }[s.reliability];
    return rank + (s.date ? 18 : 0) + Math.min(20, s.snippet.length / 40);
  };
  merged = merged
    .sort((a, b) => weight(b) - weight(a))
    .slice(0, quick ? 6 : 10);
  const sources = merged;

  return sources;
}

/** 深度抓取正文（原地填充 content）：与逐源评估并行执行，不阻塞彼此 */
async function enrichSources(sources: RawSource[]): Promise<void> {
  const deepTargets = sources.filter(s => s.reliability !== "low").slice(0, 3);
  const contents = await Promise.all(deepTargets.map(s => fetchPage(s.url)));
  deepTargets.forEach((s, i) => {
    const text = (contents[i] ?? "").replace(/\s+/g, " ").trim();
    if (text) s.content = text.slice(0, 2500);
  });
}

// ---------- 步骤三：交叉验证与置信度判定 ----------

function computeStats(sources: SourceItem[]): SourceStats {
  return {
    total: sources.length,
    support: sources.filter(s => s.stance === "support").length,
    contradict: sources.filter(s => s.stance === "contradict").length,
    neutral: sources.filter(s => s.stance === "neutral").length,
    highReliability: sources.filter(s => s.reliability === "high").length,
  };
}

function computeScore(
  verdict: Verdict,
  stats: SourceStats,
  sources: SourceItem[]
): number {
  const base: Record<Verdict, number> = {
    true: 90,
    mostly_true: 74,
    mixed: 50,
    mostly_false: 26,
    false: 8,
    unverifiable: 40,
  };
  let score = base[verdict];
  if (stats.total >= 8) score += 3;
  else if (stats.total <= 3) score -= 6;
  score += Math.min(5, stats.highReliability * 1.2);
  if (verdict !== "mixed" && stats.support > 0 && stats.contradict > 0) {
    score -= Math.min(10, Math.min(stats.support, stats.contradict) * 4);
  }
  // 可靠度加权支持比：高权威支持/反对权重 3，中 2，低 1
  const w = (s: SourceItem) => ({ high: 3, medium: 2, low: 1 })[s.reliability];
  const wSupport = sources
    .filter(s => s.stance === "support")
    .reduce((a, s) => a + w(s), 0);
  const wContra = sources
    .filter(s => s.stance === "contradict")
    .reduce((a, s) => a + w(s), 0);
  const wTotal = wSupport + wContra;
  if (wTotal > 0 && verdict !== "unverifiable" && verdict !== "mixed") {
    const ratio =
      verdict === "true" || verdict === "mostly_true"
        ? wSupport / wTotal
        : wContra / wTotal;
    score += Math.round((ratio - 0.5) * 10); // 加权立场一致性 ±5
  }
  if (verdict === "unverifiable") score = Math.min(score, 50);
  return clampScore(score);
}

function buildEvidence(sources: RawSource[], withContent: boolean): string {
  return sources
    .map(s => {
      const body =
        withContent && s.content
          ? `\n  正文摘录: ${s.content.slice(0, 800)}`
          : "";
      return `[${s.id}] ${s.title}\n  来源: ${s.siteName} (${hostOf(s.url)})${s.date ? ` 日期: ${s.date}` : ""} 权威等级: ${s.authority ?? "未知"}\n  摘要: ${s.snippet.slice(0, 350)}${body}`;
    })
    .join("\n\n");
}

/** 逐源立场评估：仅依据标题/摘要（输入短、生成快），失败返回 null（降级为 neutral） */
async function assessSources(
  claim: string,
  sources: RawSource[],
  mode: SearchMode,
  llm: LlmConfig
): Promise<Assessment[] | null> {
  if (sources.length === 0) return null;
  const sys =
    "你是资深事实核查编辑，基于给定证据做客观评估。只输出 JSON，不要输出任何其他文字。";
  const usr = `【待核查信息】\n${claim}\n\n【检索到的证据】\n${buildEvidence(sources, false)}\n\n请逐条评估每个证据与该信息的关系，输出 JSON：\n{\n  "assessments": [{"id": "证据编号", "stance": "support|contradict|neutral", "reliability": "high|medium|low", "note": "一句话评价，不超过 20 字"}]\n}\n\n口径：support=支持该信息；contradict=反驳/证伪；neutral=仅相关背景。reliability 按来源权威性评定（政府/学术/主流媒体多为 high，自媒体多为 low）。`;
  const res = await chatJson<unknown>(sys, usr, {
    maxTokens: mode === "quick" ? 4500 : 6000,
    retries: 1,
    llm,
  });
  const checked = assessmentsSchema.safeParse(res);
  return checked.success
    ? (checked.data.assessments ?? checked.data.sourceAssessments ?? [])
    : null;
}

/** 综合判定：依据完整证据（含正文摘录）输出判定/置信度/结论/要点 */
async function verdictOnEvidence(
  claim: string,
  coreClaims: string[],
  sources: RawSource[],
  mode: SearchMode,
  llm: LlmConfig
): Promise<JudgeLLM | null> {
  const quick = mode === "quick";
  const sys =
    "你是资深事实核查编辑，基于给定证据做客观判定。只输出 JSON，不要输出任何其他文字。";
  const claimsText = coreClaims.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const usr = `今天是${todayText()}，判定时请注意信息的时效性。\n【待核查信息】\n${claim}\n\n【核心主张】\n${claimsText}\n\n【检索到的证据】\n${buildEvidence(sources, true) || "（未检索到有效证据）"}\n\n请完成交叉验证并输出 JSON：\n{\n  "verdict": "true | mostly_true | mixed | mostly_false | false | unverifiable",\n  "confidence": 0-100 的整数,\n  "summary": "2-3 句中文综合结论，直接回答该信息是否可靠",\n  "reasoning": ["3 条中文分析要点，每条不超过 60 字且必须注明依据的来源标题"]\n}\n\n判定口径：\n- true=证据充分且一致支持；mostly_true=主干属实但细节有出入；mixed=部分属实或证据严重分歧；mostly_false=主干基本不成立；false=明确失实/谣言；unverifiable=证据不足无法判断。\n- 高权威来源（政府/学术/主流媒体）权重大于普通来源；自媒体孤证不足为据。\n- confidence 校准：≥2 个高权威来源一致方可 ≥85；仅有普通来源一致时 ≤75；证据分歧明显时 ≤60；证据不足时 ≤40。`;
  const response = await chatJson<unknown>(sys, usr, {
    maxTokens: quick ? 6000 : 8000,
    llm,
  });
  const checked = judgmentSchema.safeParse(response);
  return checked.success ? checked.data : null;
}

/** 合并判定与逐源评估，计算统计与可靠度评分 */
function mergeJudgment(
  claim: string,
  coreClaims: string[],
  sources: RawSource[],
  parsed: JudgeLLM | null,
  assessments: Assessment[] | null
): Omit<VerificationResult, "id" | "createdAt" | "queries"> {
  // 有证据但判定服务多次未返回有效结果 → 明确报错，不伪装成"无法判定"
  if (!parsed && sources.length > 0) {
    throw new Error(
      "判定服务暂时不可用（分析结果多次生成失败），请稍后重新提交"
    );
  }

  // 网页正文仅服务于本次 LLM 判定，避免返回给客户端或写入 JSON 历史记录。
  const merged: SourceItem[] = sources.map(publicSource);
  let verdict: Verdict = "unverifiable";
  let confidence = 40;
  let summary =
    "证据不足，无法对该信息做出可靠判定。建议提供更多背景或稍后重试。";
  let reasoning: string[] = ["未能形成有效分析，请重试。"];

  const byId = new Map<string, Assessment>();
  for (const a of assessments ?? []) {
    const id = String(a.id ?? "");
    if (id) byId.set(id, a);
  }
  for (const src of merged) {
    const a = byId.get(src.id) ?? byId.get(src.id.replace(/^s/i, ""));
    if (!a) continue;
    if (
      a.stance === "support" ||
      a.stance === "contradict" ||
      a.stance === "neutral"
    )
      src.stance = a.stance;
    if (
      a.reliability === "high" ||
      a.reliability === "medium" ||
      a.reliability === "low"
    )
      src.reliability = a.reliability;
    if (a.note) src.note = String(a.note).slice(0, 120);
  }

  if (parsed) {
    const v = String(parsed.verdict ?? "").toLowerCase();
    if (
      [
        "true",
        "mostly_true",
        "mixed",
        "mostly_false",
        "false",
        "unverifiable",
      ].includes(v)
    )
      verdict = v as Verdict;
    confidence = Math.max(5, Math.min(98, Math.round(parsed.confidence)));
    if (parsed.summary) summary = String(parsed.summary);
    const rs = (parsed.reasoning ?? [])
      .map(r => String(r).trim())
      .filter(Boolean)
      .slice(0, 5);
    if (rs.length) reasoning = rs;
  }

  // 无任何证据时强制无法判定
  if (merged.length === 0) {
    verdict = "unverifiable";
    confidence = Math.min(confidence, 30);
    summary =
      "本次未能从互联网检索到与该信息相关的有效证据（可能受检索服务波动影响），无法判断其真实性，建议稍后重新核查。";
    reasoning = [
      "多路检索均未返回可用来源：可能是检索服务短时波动，也可能该说法过于冷门、时效性太强或表述不清。建议稍后重试或换个表述。",
    ];
  }

  const stats = computeStats(merged);
  const credibilityScore = computeScore(verdict, stats, merged);

  return {
    claim,
    verdict,
    confidence,
    credibilityScore,
    summary,
    reasoning,
    sources: merged,
    coreClaims,
    stats,
  };
}

// ---------- 任务执行 ----------

async function runJob(job: JobState, mode: SearchMode) {
  try {
    // Keep this guard even though start validates BYOK, so a future internal caller
    // cannot accidentally invoke chatJson's site-level fallback.
    const llm = job.llm;
    if (!llm?.apiKey)
      throw new Error("核查任务缺少个人 API 密钥，请重新配置后提交");
    job.stage = "analyzing";
    // 提速：LLM 拆解与原文首轮检索并行启动，分析完成时首路证据通常已就位
    // 快速模式跳过 LLM 拆解，直接使用模板检索式（仅一次判定调用，显著更快）
    const quick = mode === "quick";
    const analysisP = quick
      ? Promise.resolve(templateQueries(job.claim))
      : analyzeClaim(job.claim, llm);
    const headP: Promise<RoundOutcome> = webSearch(job.claim.slice(0, 80), 2)
      .then(items => ({ items }))
      .catch(e => ({ items: [], error: (e as Error).message }));
    const analysis = await analysisP;
    job.analysis = analysis;

    job.stage = "searching";
    const headRound = await headP;
    const sources = await deepSearch(
      job.claim,
      analysis.queries,
      mode,
      headRound
    );
    job.sources = sources;

    job.stage = "judging";
    // 提速：逐源评估（短输入）与正文抓取并行；综合判定待正文就绪后进行
    const assessP: Promise<Assessment[] | null> = assessSources(
      job.claim,
      sources,
      mode,
      llm
    ).catch(() => null);
    if (mode !== "quick") await enrichSources(sources);
    const parsed = await verdictOnEvidence(
      job.claim,
      analysis.coreClaims,
      sources,
      mode,
      llm
    );
    const assessments = await assessP;
    const judged = mergeJudgment(
      job.claim,
      analysis.coreClaims,
      sources,
      parsed,
      assessments
    );

    const result: VerificationResult = {
      ...judged,
      queries: analysis.queries,
      mode,
      id: 0,
      createdAt: new Date(),
    };

    // Keep a reservation active until persistence and result publication finish.
    // Completed history is never consulted when accepting a new task.
    try {
      const payload = {
        reasoning: result.reasoning,
        sources: result.sources,
        queries: result.queries,
        coreClaims: result.coreClaims,
        stats: result.stats,
        mode: result.mode ?? "deep",
      };
      const inserted = await getDb()
        .insert(verifications)
        .values({
          claim: result.claim,
          verdict: result.verdict,
          confidence: result.confidence,
          credibilityScore: result.credibilityScore,
          summary: result.summary,
          payload,
          userId: job.userId ?? null,
          guestId: job.guestId ?? null,
          ipHash: job.ipHash ?? null,
        });
      result.id = Number(
        (inserted as unknown as Array<{ insertId: number | string }>)[0]
          ?.insertId ?? 0
      );
    } catch (e) {
      console.error(
        "[verify] 历史记录写入失败（不影响本次结果）:",
        (e as Error).message
      );
    }
    job.result = result;
    job.stage = "done";
  } catch (e) {
    console.error("[verify] 任务失败:", (e as Error).message);
    job.error = (e as Error).message || "核查过程中出现错误";
    job.stage = "error";
  } finally {
    // Credentials and scraped bodies are needed only while the task is executing.
    job.llm = null;
    job.sources = job.sources?.map(publicSource);
  }
}

// ---------- 路由 ----------

export const verifyRouter = createRouter({
  /** 登录用户使用自己的已保存 API Key 提交核查任务。 */
  start: publicQuery
    .input(
      z.object({
        claim: z.string().trim().min(4).max(2000),
        mode: z.enum(["deep", "quick"]).optional().default("deep"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await getSessionUser(ctx);
      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "请先登录，并在「API 密钥设置」中保存自己的 API Key 后再核查",
        });
      }
      sweepJobs();
      return withOwnerLock([`user:${user.id}`], async () => {
        // Re-read credentials before deduplication as well: deleting a saved key
        // must prevent new starts, including repeated submissions by an admin.
        const llm = await userLlmConfig(user.id);
        const activeJobs = [...jobs.values()].filter(isActiveJob);
        const runningJob = activeJobs.find(
          job =>
            job.claim === input.claim &&
            job.mode === input.mode &&
            isSameOwner(job, user.id, null)
        );
        if (runningJob) return { jobId: runningJob.id };
        if (
          activeJobs.length >= 100 ||
          activeJobs.filter(job => job.userId === user.id).length >= 2
        ) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "正在处理的核查任务较多，请等待已有任务完成后再试",
          });
        }
        // No await between the global capacity snapshot and Map insertion:
        // different user locks cannot overbook the process-wide limit.
        const job: JobState = {
          id: randomUUID(),
          stage: "analyzing",
          mode: input.mode,
          claim: input.claim,
          userId: user.id,
          guestId: null,
          createdAt: Date.now(),
          llm,
          ipHash: null,
        };
        jobs.set(job.id, job);
        void runJob(job, input.mode);
        return { jobId: job.id };
      });
    }),

  /** 轮询任务状态 */
  status: publicQuery
    .input(z.object({ jobId: z.string().min(1).max(40) }))
    .query(async ({ input, ctx }): Promise<JobProgress> => {
      const job = jobs.get(input.jobId);
      if (!job) {
        return {
          id: input.jobId,
          stage: "error",
          claim: "",
          error: "任务不存在或已过期，请重新提交",
          createdAt: 0,
        };
      }
      const user = await getSessionUser(ctx);
      const guestId = guestTokenFrom(ctx);
      const allowed =
        (user !== null &&
          (job.userId === user.id ||
            (job.guestId !== null && job.guestId === guestId))) ||
        (user === null && job.guestId !== null && job.guestId === guestId);
      if (!allowed) {
        return {
          id: input.jobId,
          stage: "error",
          claim: "",
          error: "任务不存在、已过期或无权访问",
          createdAt: 0,
        };
      }
      return toJobProgress(job);
    }),

  history: publicQuery
    .input(
      z.object({ userId: z.number().int().positive().optional() }).optional()
    )
    .query(async ({ input, ctx }): Promise<HistoryItem[]> => {
      const user = await getSessionUser(ctx);
      if (!user) return []; // 未登录：前端展示登录引导
      // 普通用户仅见自己的记录；管理员可见全部或指定用户的记录
      const filter =
        user.role === "admin"
          ? input?.userId
            ? eq(verifications.userId, input.userId)
            : undefined
          : eq(verifications.userId, user.id);
      try {
        const db = getDb();
        const rows = await db
          .select({
            id: verifications.id,
            claim: verifications.claim,
            verdict: verifications.verdict,
            confidence: verifications.confidence,
            credibilityScore: verifications.credibilityScore,
            summary: verifications.summary,
            createdAt: verifications.createdAt,
          })
          .from(verifications)
          .where(filter)
          .orderBy(desc(verifications.createdAt))
          .limit(50);
        return rows.map(r => ({ ...r, verdict: r.verdict as Verdict }));
      } catch (e) {
        console.error("[verify] 历史记录读取失败:", (e as Error).message);
        return [];
      }
    }),

  byId: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }): Promise<VerificationResult | null> => {
      try {
        const db = getDb();
        const rows = await db
          .select()
          .from(verifications)
          .where(eq(verifications.id, input.id))
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        const user = await getSessionUser(ctx);
        const guestId = guestTokenFrom(ctx);
        const allowed =
          (user && (user.role === "admin" || row.userId === user.id)) ||
          (row.guestId !== null && row.guestId === guestId);
        if (!allowed) return null;
        const p = row.payload as {
          reasoning: string[];
          sources: SourceItem[];
          queries: string[];
          coreClaims: string[];
          stats: SourceStats;
          mode?: SearchMode;
        };
        return {
          id: row.id,
          claim: row.claim,
          verdict: row.verdict as Verdict,
          confidence: row.confidence,
          credibilityScore: row.credibilityScore,
          summary: row.summary,
          reasoning: p.reasoning ?? [],
          sources: p.sources ?? [],
          queries: p.queries ?? [],
          coreClaims: p.coreClaims ?? [],
          stats: p.stats ?? {
            total: 0,
            support: 0,
            contradict: 0,
            neutral: 0,
            highReliability: 0,
          },
          mode: p.mode ?? "deep",
          createdAt: row.createdAt,
        };
      } catch (e) {
        console.error("[verify] 记录读取失败:", (e as Error).message);
        return null;
      }
    }),

  remove: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const user = await getSessionUser(ctx);
      if (!user)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
      try {
        const db = getDb();
        const rows = await db
          .select({ userId: verifications.userId })
          .from(verifications)
          .where(eq(verifications.id, input.id))
          .limit(1);
        if (!rows[0]) return { ok: false };
        if (user.role !== "admin" && rows[0].userId !== user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "只能删除自己的核查记录",
          });
        }
        await db.delete(verifications).where(eq(verifications.id, input.id));
        return { ok: true };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        return { ok: false };
      }
    }),
});
