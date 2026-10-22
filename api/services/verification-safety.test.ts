import { describe, expect, it } from "vitest";
import { createKeyedLock } from "./keyed-lock";
import { toJobProgress, type JobState } from "./verification-state";
import {
  analysisSchema,
  assessmentsSchema,
  judgmentSchema,
} from "./verification-schema";

describe("public job progress", () => {
  it("never serializes credentials, owner identifiers, IP hashes, or scraped content", () => {
    const job: JobState = {
      id: "job",
      stage: "judging",
      mode: "deep",
      claim: "a test claim",
      createdAt: 1,
      userId: 42,
      guestId: "private-guest",
      ipHash: "private-ip",
      llm: {
        apiKey: "secret-api-key",
        baseUrl: "https://example.test",
        model: "test",
      },
      sources: [
        {
          id: "source",
          title: "title",
          url: "https://example.test",
          siteName: "Example",
          snippet: "public excerpt",
          stance: "neutral",
          reliability: "medium",
          content: "private-full-body",
        },
      ],
    };
    const result = toJobProgress(
      Object.assign(job, { futureSecret: "private-future" })
    );
    const json = JSON.stringify(result);
    for (const secret of [
      "secret-api-key",
      "private-guest",
      "private-ip",
      "private-full-body",
      "private-future",
    ]) {
      expect(json).not.toContain(secret);
    }
    expect(result.sources?.[0].snippet).toBe("public excerpt");
    expect(Object.keys(result)).toEqual([
      "id",
      "stage",
      "claim",
      "analysis",
      "sources",
      "result",
      "error",
      "createdAt",
    ]);
  });
});

describe("model output validation", () => {
  it.each([
    null,
    [],
    { coreClaims: "a string" },
    { queries: {} },
    { topic: 42 },
  ])(
    "rejects malformed analysis without invoking array/string methods: %j",
    input => {
      expect(analysisSchema.safeParse(input).success).toBe(false);
    }
  );
  it("rejects malformed source assessments", () => {
    expect(assessmentsSchema.safeParse({ assessments: {} }).success).toBe(
      false
    );
    expect(assessmentsSchema.safeParse({ assessments: [null] }).success).toBe(
      false
    );
  });
  it("requires a complete judgment, bounded finite confidence, and reasoning array", () => {
    const valid = {
      verdict: "true",
      confidence: 80,
      summary: "summary",
      reasoning: ["evidence"],
    };
    expect(judgmentSchema.safeParse(valid).success).toBe(true);
    for (const patch of [
      { verdict: "unknown" },
      { confidence: Infinity },
      { confidence: "80" },
      { confidence: -1 },
      { summary: "" },
      { reasoning: "reason" },
      { reasoning: [] },
    ]) {
      expect(judgmentSchema.safeParse({ ...valid, ...patch }).success).toBe(
        false
      );
    }
  });
});

describe("task reservation locking", () => {
  it("reserves the final active slot once across concurrent requests", async () => {
    const lock = createKeyedLock();
    let active = 1;
    const reserve = () =>
      lock(["user:1"], async () => {
        const previous = active;
        await Promise.resolve();
        if (previous >= 2) return false;
        active++;
        return true;
      });
    expect(await Promise.all([reserve(), reserve(), reserve()])).toEqual([
      true,
      false,
      false,
    ]);
    expect(active).toBe(2);
    active--; // Completion releases a slot without a daily counter or reset.
    expect(await reserve()).toBe(true);
  });
  it("serializes overlapping resource locks regardless of key ordering", async () => {
    const lock = createKeyedLock();
    let running = 0;
    const action = async () => {
      expect(running).toBe(0);
      running++;
      await Promise.resolve();
      running--;
    };
    await Promise.all([
      lock(["owner:a", "shared-resource"], action),
      lock(["shared-resource", "owner:b"], action),
    ]);
  });
  it("releases locks after failure and does not block unrelated owners", async () => {
    const lock = createKeyedLock();
    let release!: () => void;
    const pending = lock(
      ["a"],
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    await expect(lock(["b"], async () => "independent")).resolves.toBe(
      "independent"
    );
    release();
    await pending;
    await expect(
      lock(["a"], async () => {
        throw new Error("failure");
      })
    ).rejects.toThrow("failure");
    await expect(lock(["a"], async () => "recovered")).resolves.toBe(
      "recovered"
    );
  });
});
