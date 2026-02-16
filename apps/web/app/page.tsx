"use client";

import { useMemo, useState } from "react";
import type { FlamegraphAnalysis } from "@flamegraph-ai/shared";
import { API_ROUTES } from "@flamegraph-ai/shared";

type LoadingState = "idle" | "loading" | "done" | "error";

export default function UploadPage() {
  const [state, setState] = useState<LoadingState>("idle");
  const [error, setError] = useState<string>("");
  const [analysis, setAnalysis] = useState<FlamegraphAnalysis | null>(null);

  const apiBase = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
    []
  );

  const onSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setState("loading");
    setError("");

    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("profile") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!file) {
      setState("error");
      setError("Please choose a Speedscope JSON file.");
      return;
    }

    const body = new FormData();
    body.append("profile", file);

    try {
      const response = await fetch(`${apiBase}${API_ROUTES.analyze}`, {
        method: "POST",
        body
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Analyze request failed");
      }

      const json = (await response.json()) as FlamegraphAnalysis;
      setAnalysis(json);
      setState("done");
    } catch (submitError) {
      setState("error");
      setError(submitError instanceof Error ? submitError.message : "Unexpected error");
    }
  };

  return (
    <main className="page">
      <section className="panel">
        <h1>flamegraph-ai analyzer</h1>
        <p>Upload a Speedscope JSON profile to generate hotspot and recommendation insights.</p>

        <form onSubmit={onSubmit} className="upload-form">
          <input name="profile" type="file" accept="application/json,.json" />
          <button type="submit" disabled={state === "loading"}>
            {state === "loading" ? "Analyzing..." : "Analyze flamegraph"}
          </button>
        </form>

        {state === "error" && <p className="error">{error}</p>}
      </section>

      {analysis && (
        <section className="panel results">
          <h2>Analysis Results</h2>
          <p>
            <strong>Profile:</strong> {analysis.profileName}
          </p>
          <p>
            <strong>Total Samples:</strong> {analysis.summary.totalSamples}
          </p>

          <h3>Hotspots</h3>
          <ul>
            {analysis.hotspots.map((hotspot) => (
              <li key={`${hotspot.rank}-${hotspot.name}`}>
                #{hotspot.rank} <strong>{hotspot.name}</strong> in <code>{hotspot.file}</code> - self{" "}
                {hotspot.selfTimeMs}ms / total {hotspot.totalTimeMs}ms ({hotspot.sampleCount} samples)
              </li>
            ))}
          </ul>

          <h3>Quick Wins</h3>
          <ul>
            {analysis.recommendations.quickWins.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong> ({item.impact} impact, {item.effort} effort)
                <p>{item.rationale}</p>
              </li>
            ))}
          </ul>

          <h3>Deep Refactors</h3>
          <ul>
            {analysis.recommendations.deepRefactors.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong> ({item.impact} impact, {item.effort} effort)
                <p>{item.rationale}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
