import type { Hotspot } from "@flamegraph-ai/shared";

interface SpeedscopeFrame {
  name?: unknown;
  file?: unknown;
}

interface ParsedProfileSummary {
  hotspots: Hotspot[];
  totalSamples: number;
  profileCount: number;
}

interface FrameMetrics {
  name: string;
  file: string;
  selfTime: number;
  totalTime: number;
  sampleCount: number;
  hotspotScore: number;
}

class SpeedscopeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeedscopeParseError";
  }
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SpeedscopeParseError(message);
  }

  return value as Record<string, unknown>;
}

function asNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new SpeedscopeParseError(message);
  }

  return value;
}

function asIndex(value: unknown, max: number, message: string): number {
  const index = asNumber(value, message);

  if (!Number.isInteger(index) || index < 0 || index >= max) {
    throw new SpeedscopeParseError(message);
  }

  return index;
}

export function parseSpeedscopeProfile(payload: unknown): ParsedProfileSummary {
  const root = asRecord(payload, "Profile must be a JSON object");
  const shared = asRecord(root.shared, "Profile is missing shared frames");

  if (!Array.isArray(shared.frames) || shared.frames.length === 0) {
    throw new SpeedscopeParseError("Profile shared.frames must be a non-empty array");
  }

  const frames = shared.frames as SpeedscopeFrame[];

  if (!Array.isArray(root.profiles) || root.profiles.length === 0) {
    throw new SpeedscopeParseError("Profile must include at least one profile entry");
  }

  const profileEntries = root.profiles as unknown[];
  const metricsByFrame = new Map<number, FrameMetrics>();

  for (let idx = 0; idx < frames.length; idx += 1) {
    const frame = asRecord(frames[idx], `Invalid frame entry at index ${idx}`);
    metricsByFrame.set(idx, {
      name: String(frame.name ?? `frame_${idx}`),
      file: String(frame.file ?? "unknown"),
      selfTime: 0,
      totalTime: 0,
      sampleCount: 0,
      hotspotScore: 0
    });
  }

  let totalObserved = 0;

  for (let profileIndex = 0; profileIndex < profileEntries.length; profileIndex += 1) {
    const profile = asRecord(profileEntries[profileIndex], `Invalid profile at index ${profileIndex}`);
    const profileType = String(profile.type ?? "");

    if (profileType === "sampled") {
      const { observed } = parseSampledProfile(profile, frames.length, metricsByFrame, profileIndex);
      totalObserved += observed;
      continue;
    }

    if (profileType === "evented") {
      const { observed } = parseEventedProfile(profile, frames.length, metricsByFrame, profileIndex);
      totalObserved += observed;
      continue;
    }

    throw new SpeedscopeParseError(`Unsupported profile type at index ${profileIndex}: ${profileType}`);
  }

  if (totalObserved <= 0) {
    throw new SpeedscopeParseError("Profile contains no measurable samples or durations");
  }

  const hotspots: Hotspot[] = [...metricsByFrame.values()]
    .filter((metric) => metric.totalTime > 0 || metric.selfTime > 0)
    .map((metric) => {
      const inclusivePct = (metric.totalTime / totalObserved) * 100;
      const exclusivePct = (metric.selfTime / totalObserved) * 100;
      metric.hotspotScore = inclusivePct * 0.6 + exclusivePct * 0.4;

      return {
        name: metric.name,
        file: metric.file,
        selfTimeMs: Number(metric.selfTime.toFixed(3)),
        totalTimeMs: Number(metric.totalTime.toFixed(3)),
        sampleCount: metric.sampleCount,
        inclusivePct: Number(inclusivePct.toFixed(2)),
        exclusivePct: Number(exclusivePct.toFixed(2)),
        rank: 0
      };
    })
    .sort((a, b) => {
      const aScore = a.inclusivePct * 0.6 + a.exclusivePct * 0.4;
      const bScore = b.inclusivePct * 0.6 + b.exclusivePct * 0.4;
      return bScore - aScore;
    })
    .map((item, idx) => ({
      ...item,
      rank: idx + 1
    }));

  return {
    hotspots,
    totalSamples: Math.round(totalObserved),
    profileCount: profileEntries.length
  };
}

function parseSampledProfile(
  profile: Record<string, unknown>,
  frameCount: number,
  metricsByFrame: Map<number, FrameMetrics>,
  profileIndex: number
): { observed: number } {
  if (!Array.isArray(profile.samples)) {
    throw new SpeedscopeParseError(`Sampled profile ${profileIndex} is missing samples array`);
  }

  const samples = profile.samples as unknown[];
  const weights = Array.isArray(profile.weights) ? (profile.weights as unknown[]) : [];
  let observed = 0;

  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const sampleStack = samples[sampleIndex];

    if (!Array.isArray(sampleStack) || sampleStack.length === 0) {
      continue;
    }

    const weightValue = weights.length > 0 ? asNumber(weights[sampleIndex], `Invalid weight at sampled profile ${profileIndex}, index ${sampleIndex}`) : 1;

    if (weightValue <= 0) {
      continue;
    }

    observed += weightValue;

    for (let i = 0; i < sampleStack.length; i += 1) {
      const frameIndex = asIndex(
        sampleStack[i],
        frameCount,
        `Invalid frame reference in sampled profile ${profileIndex}, sample ${sampleIndex}`
      );
      const metric = metricsByFrame.get(frameIndex);

      if (!metric) {
        throw new SpeedscopeParseError(`Missing metrics entry for frame ${frameIndex}`);
      }

      metric.totalTime += weightValue;
      metric.sampleCount += 1;
    }

    const topIndex = asIndex(
      sampleStack[sampleStack.length - 1],
      frameCount,
      `Invalid leaf frame in sampled profile ${profileIndex}, sample ${sampleIndex}`
    );
    const topMetric = metricsByFrame.get(topIndex);

    if (!topMetric) {
      throw new SpeedscopeParseError(`Missing top frame metrics for frame ${topIndex}`);
    }

    topMetric.selfTime += weightValue;
  }

  return { observed };
}

function parseEventedProfile(
  profile: Record<string, unknown>,
  frameCount: number,
  metricsByFrame: Map<number, FrameMetrics>,
  profileIndex: number
): { observed: number } {
  if (!Array.isArray(profile.events) || profile.events.length < 2) {
    throw new SpeedscopeParseError(`Evented profile ${profileIndex} must include at least two events`);
  }

  const events = profile.events as Array<Record<string, unknown>>;
  const stack: number[] = [];
  let observed = 0;

  for (let i = 0; i < events.length; i += 1) {
    const event = asRecord(events[i], `Invalid event entry at profile ${profileIndex}, index ${i}`);
    const eventType = String(event.type ?? "");
    const frame = asIndex(event.frame, frameCount, `Invalid event frame at profile ${profileIndex}, index ${i}`);
    const at = asNumber(event.at, `Invalid event timestamp at profile ${profileIndex}, index ${i}`);

    if (i < events.length - 1) {
      const next = asRecord(events[i + 1], `Invalid event entry at profile ${profileIndex}, index ${i + 1}`);
      const nextAt = asNumber(next.at, `Invalid event timestamp at profile ${profileIndex}, index ${i + 1}`);
      const delta = nextAt - at;

      if (delta < 0) {
        throw new SpeedscopeParseError(`Event timestamps must be non-decreasing in profile ${profileIndex}`);
      }

      if (delta > 0 && stack.length > 0) {
        observed += delta;

        for (let s = 0; s < stack.length; s += 1) {
          const metric = metricsByFrame.get(stack[s]);

          if (!metric) {
            throw new SpeedscopeParseError(`Missing metrics for frame ${stack[s]}`);
          }

          metric.totalTime += delta;
          metric.sampleCount += 1;
        }

        const topMetric = metricsByFrame.get(stack[stack.length - 1]);

        if (!topMetric) {
          throw new SpeedscopeParseError(`Missing top metrics for frame ${stack[stack.length - 1]}`);
        }

        topMetric.selfTime += delta;
      }
    }

    if (eventType === "O") {
      stack.push(frame);
      continue;
    }

    if (eventType === "C") {
      const closing = stack.pop();

      if (closing !== frame) {
        throw new SpeedscopeParseError(
          `Unbalanced event stack in profile ${profileIndex} at event ${i} (expected ${closing}, got ${frame})`
        );
      }

      continue;
    }

    throw new SpeedscopeParseError(`Invalid event type at profile ${profileIndex}, index ${i}: ${eventType}`);
  }

  if (stack.length > 0) {
    throw new SpeedscopeParseError(`Unclosed frames in evented profile ${profileIndex}`);
  }

  return { observed };
}

export function isSpeedscopeParseError(error: unknown): boolean {
  return error instanceof SpeedscopeParseError;
}
