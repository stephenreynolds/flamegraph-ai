import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { AnalysisListItem, FlamegraphAnalysis, Recommendation } from "@flamegraph-ai/shared";
import { prisma } from "./lib/prisma";
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
    const orderedRecommendations = [...recommendations.quickWins, ...recommendations.deepRefactors];

    const created = await prisma.profile.create({
      data: {
        filename: file.filename,
        rawJson: payload as object,
        analyses: {
          create: {
            totalSamples: parsed.totalSamples,
            profileCount: parsed.profileCount,
            hotspots: {
              create: parsed.hotspots.map((hotspot) => ({
                name: hotspot.name,
                file: hotspot.file,
                selfTimeMs: hotspot.selfTimeMs,
                totalTimeMs: hotspot.totalTimeMs,
                sampleCount: hotspot.sampleCount,
                inclusivePct: hotspot.inclusivePct,
                exclusivePct: hotspot.exclusivePct,
                rank: hotspot.rank
              }))
            },
            recommendations: {
              create: orderedRecommendations.map((item, idx) => ({
                tier: item.tier,
                title: item.title,
                rationale: item.rationale,
                impact: item.impact,
                effort: item.effort,
                confidence: item.confidence,
                sortOrder: idx
              }))
            }
          }
        }
      },
      include: {
        analyses: {
          take: 1,
          include: {
            hotspots: {
              orderBy: {
                rank: "asc"
              }
            },
            recommendations: {
              orderBy: {
                sortOrder: "asc"
              }
            }
          }
        }
      }
    });

    const analysis = created.analyses[0];

    return reply.send({
      analysisId: analysis.id,
      profileName: created.filename,
      generatedAt: analysis.createdAt.toISOString(),
      summary: {
        totalSamples: analysis.totalSamples,
        profileCount: analysis.profileCount
      },
      hotspots: analysis.hotspots.map((hotspot) => ({
        name: hotspot.name,
        file: hotspot.file,
        selfTimeMs: hotspot.selfTimeMs,
        totalTimeMs: hotspot.totalTimeMs,
        sampleCount: hotspot.sampleCount,
        inclusivePct: hotspot.inclusivePct,
        exclusivePct: hotspot.exclusivePct,
        rank: hotspot.rank
      })),
      recommendations: splitRecommendations(
        analysis.recommendations.map((item) => ({
          id: item.id,
          tier: item.tier,
          title: item.title,
          rationale: item.rationale,
          impact: item.impact as Recommendation["impact"],
          effort: item.effort as Recommendation["effort"],
          confidence: item.confidence
        }))
      )
    } satisfies FlamegraphAnalysis);
  } catch (error) {
    if (isSpeedscopeParseError(error)) {
      return reply.status(400).send({ error: (error as Error).message });
    }

    request.log.error(error);
    return reply.status(500).send({ error: "Failed to analyze profile" });
  }
});

app.get("/api/analyses", async (request, reply) => {
  try {
    const analyses = await prisma.analysis.findMany({
      orderBy: {
        createdAt: "desc"
      },
      include: {
        profile: true,
        hotspots: {
          orderBy: {
            rank: "asc"
          },
          take: 3
        }
      }
    });

    const results: AnalysisListItem[] = analyses.map((analysis) => ({
      analysisId: analysis.id,
      profileName: analysis.profile.filename,
      generatedAt: analysis.createdAt.toISOString(),
      totalSamples: analysis.totalSamples,
      profileCount: analysis.profileCount,
      topHotspots: analysis.hotspots.map((hotspot) => ({
        name: hotspot.name,
        file: hotspot.file,
        selfTimeMs: hotspot.selfTimeMs,
        totalTimeMs: hotspot.totalTimeMs,
        sampleCount: hotspot.sampleCount,
        inclusivePct: hotspot.inclusivePct,
        exclusivePct: hotspot.exclusivePct,
        rank: hotspot.rank
      }))
    }));

    return reply.send(results);
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: "Failed to fetch analyses" });
  }
});

app.get("/api/analyses/:id", async (request, reply) => {
  const { id } = request.params as { id: string };

  try {
    const analysis = await prisma.analysis.findUnique({
      where: { id },
      include: {
        profile: true,
        hotspots: {
          orderBy: {
            rank: "asc"
          }
        },
        recommendations: {
          orderBy: {
            sortOrder: "asc"
          }
        }
      }
    });

    if (!analysis) {
      return reply.status(404).send({ error: "Analysis not found" });
    }

    return reply.send({
      analysisId: analysis.id,
      profileName: analysis.profile.filename,
      generatedAt: analysis.createdAt.toISOString(),
      summary: {
        totalSamples: analysis.totalSamples,
        profileCount: analysis.profileCount
      },
      hotspots: analysis.hotspots.map((hotspot) => ({
        name: hotspot.name,
        file: hotspot.file,
        selfTimeMs: hotspot.selfTimeMs,
        totalTimeMs: hotspot.totalTimeMs,
        sampleCount: hotspot.sampleCount,
        inclusivePct: hotspot.inclusivePct,
        exclusivePct: hotspot.exclusivePct,
        rank: hotspot.rank
      })),
      recommendations: splitRecommendations(
        analysis.recommendations.map((item) => ({
          id: item.id,
          tier: item.tier,
          title: item.title,
          rationale: item.rationale,
          impact: item.impact as Recommendation["impact"],
          effort: item.effort as Recommendation["effort"],
          confidence: item.confidence
        }))
      )
    } satisfies FlamegraphAnalysis);
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: "Failed to fetch analysis" });
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

function splitRecommendations(items: Recommendation[]): FlamegraphAnalysis["recommendations"] {
  return {
    quickWins: items.filter((item) => item.tier === "quick_win"),
    deepRefactors: items.filter((item) => item.tier === "deep_refactor")
  };
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
