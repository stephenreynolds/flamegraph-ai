import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { randomUUID } from "crypto";
import type { FlamegraphAnalysis, Recommendation } from "@flamegraph-ai/shared";
import { isSpeedscopeParseError, parseSpeedscopeProfile } from "./parser/speedscope";

const app = Fastify({ logger: true });

app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? true
});

app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

app.get("/health", async () => ({ status: "ok" }));

app.post("/api/analyze", async (request, reply) => {
  const file = await request.file();

  if (!file) {
    return reply.status(400).send({ error: "No file uploaded" });
  }

  if (!file.mimetype.includes("json")) {
    return reply.status(400).send({ error: "Expected a JSON file upload" });
  }

  const raw = await file.toBuffer();
  let payload: unknown;

  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return reply.status(400).send({ error: "Uploaded file is not valid JSON" });
  }

  try {
    const parsed = parseSpeedscopeProfile(payload);
    const recommendations = buildRecommendations(parsed.hotspots);

    const analysis: FlamegraphAnalysis = {
      analysisId: randomUUID(),
      profileName: file.filename,
      generatedAt: new Date().toISOString(),
      summary: {
        totalSamples: parsed.totalSamples,
        profileCount: parsed.profileCount
      },
      hotspots: parsed.hotspots,
      recommendations
    };

    return reply.send(analysis);
  } catch (error) {
    if (isSpeedscopeParseError(error)) {
      return reply.status(400).send({ error: (error as Error).message });
    }

    request.log.error(error);
    return reply.status(500).send({ error: "Failed to analyze profile" });
  }
});

function buildRecommendations(hotspots: FlamegraphAnalysis["hotspots"]): FlamegraphAnalysis["recommendations"] {
  const top = hotspots[0];
  const second = hotspots[1];
  const third = hotspots[2];

  const quickWins: Recommendation[] = [
    {
      id: "qw-1",
      tier: "quick_win",
      title: `Reduce self-time in ${top?.name ?? "top hotspot"}`,
      rationale: top
        ? `${top.name} has ${top.exclusivePct}% exclusive time, suggesting isolated compute that can be memoized or cached first.`
        : "Focus on the highest exclusive-time hotspot first.",
      impact: top && top.exclusivePct >= 20 ? "high" : "medium",
      effort: "small",
      confidence: confidenceFromPct(top?.exclusivePct ?? 10, 30)
    },
    {
      id: "qw-2",
      tier: "quick_win",
      title: `Trim call-path overhead around ${second?.name ?? "secondary hotspot"}`,
      rationale: second
        ? `${second.name} appears in ${second.inclusivePct}% of total time, so reducing invocation count should cut overall latency.`
        : "Target the second-ranked hotspot and reduce frequency of execution.",
      impact: second && second.inclusivePct >= 20 ? "medium" : "low",
      effort: "small",
      confidence: confidenceFromPct(second?.inclusivePct ?? 8, 35)
    }
  ];

  const deepRefactors: Recommendation[] = [
    {
      id: "dr-1",
      tier: "deep_refactor",
      title: `Refactor hotspot pipeline led by ${top?.name ?? "top hotspot"}`,
      rationale: top
        ? `${top.name} dominates with ${top.inclusivePct}% inclusive time, indicating architectural pressure in this path.`
        : "Restructure the highest inclusive-time path to reduce total work.",
      impact: "high",
      effort: "large",
      confidence: confidenceFromPct(top?.inclusivePct ?? 15, 40)
    },
    {
      id: "dr-2",
      tier: "deep_refactor",
      title: `Revisit interactions between ${second?.name ?? "hotspot 2"} and ${third?.name ?? "hotspot 3"}`,
      rationale:
        second && third
          ? `These hotspots jointly account for ${(second.inclusivePct + third.inclusivePct).toFixed(2)}% inclusive time and likely share avoidable repeated work.`
          : "Investigate top hotspot interactions to remove redundant stack depth and repeated computation.",
      impact: "high",
      effort: "medium",
      confidence: confidenceFromPct((second?.inclusivePct ?? 8) + (third?.inclusivePct ?? 6), 50)
    }
  ];

  return { quickWins, deepRefactors };
}

function confidenceFromPct(value: number, max: number): number {
  const bounded = Math.max(0, Math.min(value / max, 1));
  return Number((0.4 + bounded * 0.6).toFixed(2));
}

const port = Number(process.env.API_PORT ?? 3001);

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
