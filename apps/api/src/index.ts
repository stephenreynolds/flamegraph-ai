import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { randomUUID } from "crypto";
import type { FlamegraphAnalysis, Hotspot } from "@flamegraph-ai/shared";

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

  const analysis = createMockAnalysis(payload, file.filename);
  return reply.send(analysis);
});

function createMockAnalysis(profileJson: unknown, filename: string): FlamegraphAnalysis {
  const obj = (profileJson as Record<string, unknown>) ?? {};
  const shared = (obj.shared as Record<string, unknown>) ?? {};
  const frames = (shared.frames as Array<Record<string, unknown>>) ?? [];
  const profiles = (obj.profiles as Array<Record<string, unknown>>) ?? [];

  const hotspots: Hotspot[] = frames.slice(0, 5).map((frame, idx) => {
    const frameName = String(frame.name ?? `frame_${idx + 1}`);
    const fileName = String(frame.file ?? "unknown");
    const sampleCount = Math.max(40 - idx * 7, 8);
    const totalTimeMs = sampleCount * 3;

    return {
      name: frameName,
      file: fileName,
      selfTimeMs: Math.round(totalTimeMs * 0.55),
      totalTimeMs,
      sampleCount,
      rank: idx + 1
    };
  });

  const fallbackHotspots: Hotspot[] = [
    {
      name: "renderFlamegraph",
      file: "src/render/flamegraph.ts",
      selfTimeMs: 124,
      totalTimeMs: 288,
      sampleCount: 96,
      rank: 1
    },
    {
      name: "aggregateStacks",
      file: "src/analysis/aggregate.ts",
      selfTimeMs: 88,
      totalTimeMs: 203,
      sampleCount: 68,
      rank: 2
    }
  ];

  const mergedHotspots = hotspots.length > 0 ? hotspots : fallbackHotspots;

  return {
    analysisId: randomUUID(),
    profileName: filename,
    generatedAt: new Date().toISOString(),
    summary: {
      totalSamples: mergedHotspots.reduce((sum, item) => sum + item.sampleCount, 0),
      profileCount: profiles.length || 1
    },
    hotspots: mergedHotspots,
    recommendations: {
      quickWins: [
        {
          id: "qw-1",
          tier: "quick_win",
          title: "Cache parsed frame lookups",
          rationale: "Repeated frame metadata access appears in the hottest call paths.",
          impact: "medium",
          effort: "small"
        },
        {
          id: "qw-2",
          tier: "quick_win",
          title: "Skip low-value stack expansion",
          rationale: "Avoiding expansion under a threshold reduces per-request CPU for noisy traces.",
          impact: "low",
          effort: "small"
        }
      ],
      deepRefactors: [
        {
          id: "dr-1",
          tier: "deep_refactor",
          title: "Move aggregation to streaming pipeline",
          rationale: "Chunked processing can prevent expensive full-profile in-memory aggregation.",
          impact: "high",
          effort: "large"
        },
        {
          id: "dr-2",
          tier: "deep_refactor",
          title: "Pre-index frame relationships",
          rationale: "An index structure would lower complexity of repeated parent-child traversals.",
          impact: "high",
          effort: "medium"
        }
      ]
    }
  };
}

const port = Number(process.env.API_PORT ?? 3001);

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
