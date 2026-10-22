import { z } from "zod";

const shortText = z.string().trim().min(1).max(500);
export const analysisSchema = z.object({
  coreClaims: z.array(shortText).max(10).optional(),
  topic: z.string().trim().max(80).optional(),
  queries: z.array(shortText).max(10).optional(),
});

const assessmentSchema = z.object({
  id: z.string().max(80),
  stance: z.enum(["support", "contradict", "neutral"]),
  reliability: z.enum(["high", "medium", "low"]),
  note: z.string().max(1000).optional(),
});
export const assessmentsSchema = z.object({
  assessments: z.array(assessmentSchema).max(30).optional(),
  sourceAssessments: z.array(assessmentSchema).max(30).optional(),
});

export const judgmentSchema = z.object({
  verdict: z.enum([
    "true",
    "mostly_true",
    "mixed",
    "mostly_false",
    "false",
    "unverifiable",
  ]),
  confidence: z.number().finite().min(0).max(100),
  summary: z.string().trim().min(1).max(4000),
  reasoning: z.array(z.string().trim().min(1).max(2000)).min(1).max(10),
});

export type JudgeLLM = z.infer<typeof judgmentSchema>;
export type Assessment = z.infer<typeof assessmentSchema>;
