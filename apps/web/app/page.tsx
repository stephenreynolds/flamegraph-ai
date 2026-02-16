"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalysisListItem, FlamegraphAnalysis, Hotspot, Recommendation } from "@flamegraph-ai/shared";
import { API_ROUTES } from "@flamegraph-ai/shared";

type LoadingState = "idle" | "loading" | "done" | "error";

export default function UploadPage() {
  const [state, setState] = useState<LoadingState>("idle");
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<FlamegraphAnalysis | null>(null);
  const [analyses, setAnalyses] = useState<AnalysisListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const apiBase = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
    []
  );

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);

    try {
      const response = await fetch(`${apiBase}${API_ROUTES.analyses}`);
      if (!response.ok) {
        throw new Error("Unable to load past analyses");
      }

      const json = (await response.json()) as AnalysisListItem[];
      setAnalyses(json);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "Failed to load analysis history");
    } finally {
      setHistoryLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const onSubmit: React.FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    setState("loading");
    setError("");

    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("profile") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!file) {
      setState("error");
      setError("Choose a Speedscope JSON profile first.");
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
      await fetchHistory();
    } catch (submitError) {
      setState("error");
      setError(submitError instanceof Error ? submitError.message : "Unexpected error");
    }
  };

  const loadAnalysis = async (analysisId: string) => {
    setError("");

    try {
      const response = await fetch(`${apiBase}${API_ROUTES.analyses}/${analysisId}`);
      if (!response.ok) {
        throw new Error("Unable to load selected analysis");
      }

      const json = (await response.json()) as FlamegraphAnalysis;
      setAnalysis(json);
      setState("done");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load selected analysis");
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-4 md:p-8">
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-panel backdrop-blur">
          <h2 className="text-lg font-semibold text-cyan-200">Analysis History</h2>
          <p className="mt-1 text-xs text-slate-400">Stored analyses from the API database.</p>

          <div className="mt-4 space-y-2">
            {historyLoading && <p className="text-sm text-slate-400">Loading history...</p>}
            {!historyLoading && analyses.length === 0 && (
              <p className="text-sm text-slate-500">No analyses yet. Upload a profile to create one.</p>
            )}

            {analyses.map((item) => (
              <button
                key={item.analysisId}
                type="button"
                onClick={() => void loadAnalysis(item.analysisId)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900/80 p-3 text-left transition hover:border-cyan-400 hover:bg-slate-800"
              >
                <p className="truncate text-sm font-semibold text-slate-100">{item.profileName}</p>
                <p className="mt-1 text-xs text-slate-400">{new Date(item.generatedAt).toLocaleString()}</p>
                <p className="mt-2 text-xs text-slate-300">
                  {item.totalSamples} samples • {item.profileCount} profile{item.profileCount === 1 ? "" : "s"}
                </p>
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-6 shadow-panel backdrop-blur">
            <h1 className="text-3xl font-semibold tracking-tight text-white">flamegraph-ai</h1>
            <p className="mt-2 text-sm text-slate-300">
              Upload a Speedscope profile and inspect ranked hotspots, metric evidence, and optimization recommendations.
            </p>

            <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                name="profile"
                type="file"
                accept="application/json,.json"
                className="block w-full rounded-xl border border-slate-700 bg-slate-950/80 p-2 text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-600 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-cyan-500"
              />
              <button
                type="submit"
                disabled={state === "loading"}
                className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {state === "loading" ? "Analyzing..." : "Analyze"}
              </button>
            </form>

            {state === "error" && <p className="mt-4 rounded-lg bg-red-950/60 p-3 text-sm text-red-300">{error}</p>}
          </div>

          {analysis && (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/70 p-6 shadow-panel backdrop-blur">
              <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-xl font-semibold text-slate-100">{analysis.profileName}</h2>
                  <p className="mt-1 text-xs text-slate-400">Generated {new Date(analysis.generatedAt).toLocaleString()}</p>
                </div>
                <p className="text-sm text-slate-300">
                  {analysis.summary.totalSamples} samples • {analysis.summary.profileCount} profile
                  {analysis.summary.profileCount === 1 ? "" : "s"}
                </p>
              </header>

              <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-cyan-200">Hotspots</h3>
                  <div className="mt-3 space-y-3">
                    {analysis.hotspots.map((hotspot) => (
                      <HotspotCard key={`${hotspot.rank}-${hotspot.name}`} hotspot={hotspot} />
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-cyan-200">Recommendations</h3>
                  <div className="mt-3 space-y-4">
                    <RecommendationList title="Quick Wins" items={analysis.recommendations.quickWins} />
                    <RecommendationList title="Deep Refactors" items={analysis.recommendations.deepRefactors} />
                  </div>
                </section>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function HotspotCard({ hotspot }: { hotspot: Hotspot }) {
  return (
    <details className="rounded-xl border border-slate-700 bg-slate-900/70 p-3" open={hotspot.rank <= 2}>
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-100">
              #{hotspot.rank} {hotspot.name}
            </p>
            <p className="mt-1 font-mono text-xs text-slate-400">{hotspot.file}</p>
          </div>
          <div className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-cyan-200">
            {hotspot.sampleCount} obs
          </div>
        </div>
      </summary>

      <div className="mt-3 space-y-3 border-t border-slate-800 pt-3 text-xs text-slate-300">
        <p>
          self {hotspot.selfTimeMs}ms / total {hotspot.totalTimeMs}ms
        </p>
        <MetricBar label="Inclusive" value={hotspot.inclusivePct} color="bg-cyan-500" />
        <MetricBar label="Exclusive" value={hotspot.exclusivePct} color="bg-emerald-500" />
      </div>
    </details>
  );
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span>{label}</span>
        <span className="font-mono">{value.toFixed(2)}%</span>
      </div>
      <div className="h-2 rounded-full bg-slate-800">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.max(2, Math.min(value, 100))}%` }} />
      </div>
    </div>
  );
}

function RecommendationList({ title, items }: { title: string; items: Recommendation[] }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
      <h4 className="text-sm font-semibold text-slate-100">{title}</h4>
      <ul className="mt-3 space-y-3 text-sm">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-slate-100">{item.title}</p>
              <span className="shrink-0 rounded-full bg-cyan-900/60 px-2 py-0.5 text-xs text-cyan-200">
                confidence {Math.round(item.confidence * 100)}%
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-300">{item.rationale}</p>
            <p className="mt-2 text-xs text-slate-500">
              {item.impact} impact • {item.effort} effort
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
