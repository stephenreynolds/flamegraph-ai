import { describe, expect, it } from "vitest";
import { parseSpeedscopeProfile } from "../speedscope";

describe("parseSpeedscopeProfile", () => {
  it("parses sampled profiles and computes metrics", () => {
    const parsed = parseSpeedscopeProfile({
      shared: {
        frames: [{ name: "root", file: "app.ts" }, { name: "render", file: "render.ts" }, { name: "diff", file: "diff.ts" }]
      },
      profiles: [
        {
          type: "sampled",
          samples: [
            [0, 1],
            [0, 1],
            [0, 2],
            [0, 1]
          ],
          weights: [5, 3, 2, 4]
        }
      ]
    });

    expect(parsed.totalSamples).toBe(14);
    expect(parsed.profileCount).toBe(1);
    expect(parsed.hotspots[0].name).toBe("root");
    expect(parsed.hotspots[0].inclusivePct).toBe(100);
    expect(parsed.hotspots.find((h) => h.name === "render")?.exclusivePct).toBeCloseTo(85.71, 1);
  });

  it("parses evented profiles and computes inclusive/exclusive time", () => {
    const parsed = parseSpeedscopeProfile({
      shared: {
        frames: [{ name: "main", file: "main.ts" }, { name: "work", file: "work.ts" }]
      },
      profiles: [
        {
          type: "evented",
          events: [
            { type: "O", frame: 0, at: 0 },
            { type: "O", frame: 1, at: 2 },
            { type: "C", frame: 1, at: 6 },
            { type: "C", frame: 0, at: 10 }
          ]
        }
      ]
    });

    expect(parsed.totalSamples).toBe(10);

    const main = parsed.hotspots.find((h) => h.name === "main");
    const work = parsed.hotspots.find((h) => h.name === "work");

    expect(main?.totalTimeMs).toBe(10);
    expect(main?.selfTimeMs).toBe(6);
    expect(main?.inclusivePct).toBe(100);
    expect(work?.totalTimeMs).toBe(4);
    expect(work?.exclusivePct).toBe(40);
  });

  it("throws for malformed profiles", () => {
    expect(() =>
      parseSpeedscopeProfile({
        shared: { frames: [{ name: "x" }] },
        profiles: [{ type: "evented", events: [{ type: "C", frame: 0, at: 10 }] }]
      })
    ).toThrow(/at least two events/);
  });
});
