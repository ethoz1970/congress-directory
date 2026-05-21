"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { API_URL, authenticatedFetch } from "../../lib/api";
import { useAuth } from "../../lib/AuthContext";

interface ImportRecord {
  type: string;
  status: "success" | "error" | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  log_lines: number;
}

interface ImportHistory {
  legislators: ImportRecord | null;
  ideology: ImportRecord | null;
  governors: ImportRecord | null;
  news_senators: ImportRecord | null;
  news_house: ImportRecord | null;
  news_governors: ImportRecord | null;
}

interface LogState {
  type: string;
  lines: string[];
  status: "success" | "error" | null;
}

const IMPORT_CONFIGS = [
  {
    type: "legislators",
    title: "Legislators",
    icon: "🏛️",
    description:
      "Pulls all current members of Congress from the @unitedstates project. Uses merge-write so existing ideology scores and news counts are preserved.",
    source: "unitedstates/congress-legislators (GitHub)",
    duration: "~30 seconds",
  },
  {
    type: "ideology",
    title: "Ideology & Leadership Scores",
    icon: "📊",
    description:
      "Fetches left–right ideology and leadership scores from GovTrack's public sponsorship analysis CSVs. Run once per Congress session.",
    source: "GovTrack.us public data API",
    duration: "~1–2 minutes",
  },
  {
    type: "governors",
    title: "Governors",
    icon: "🏛️",
    description:
      "Imports governor data from the local governors-current.json file. Edit that file first when a new governor takes office, then run this to push the changes to Firestore. Uses merge-write so news mentions are preserved.",
    source: "backend/governors-current.json (manually maintained)",
    duration: "~5 seconds",
  },
  {
    type: "news_senators",
    title: "News Mentions — Senate",
    icon: "📰",
    description:
      "Counts recent news articles mentioning each of the 100 Senators (last 30 days). Covers all senators in one run.",
    source: "GNews API (requires GNEWS_API_KEY env var on server)",
    duration: "~2 minutes (100 senators)",
  },
  {
    type: "news_house",
    title: "News Mentions — House",
    icon: "📰",
    description:
      "Counts recent news articles mentioning House Representatives (last 30 days). 435 members — run multiple times to cycle through all of them.",
    source: "GNews API (requires GNEWS_API_KEY env var on server)",
    duration: "~2 minutes (100 reps per run)",
  },
  {
    type: "news_governors",
    title: "News Mentions — Governors",
    icon: "🗳️",
    description:
      "Counts recent news articles mentioning all 50 governors (last 30 days). Covers all governors in one run.",
    source: "GNews API (requires GNEWS_API_KEY env var on server)",
    duration: "~1 minute (50 governors)",
  },
];

function formatDate(str: string | null): string {
  if (!str) return "Never";
  return new Date(str).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeSince(str: string | null): string {
  if (!str) return "";
  const diff = Date.now() - new Date(str).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

export default function DataTab() {
  const { user } = useAuth();
  const [history, setHistory] = useState<ImportHistory>({
    legislators: null,
    ideology: null,
    governors: null,
    news_senators: null,
    news_house: null,
    news_governors: null,
  });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [runningType, setRunningType] = useState<string | null>(null);
  const [log, setLog] = useState<LogState | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await authenticatedFetch("/api/admin/import-history");
      setHistory(data);
    } catch (e) {
      console.error("Failed to load import history", e);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Auto-scroll log to bottom when new lines arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log?.lines.length]);

  async function triggerImport(importType: string) {
    if (runningType) return;

    setRunningType(importType);
    setLog({ type: importType, lines: ["⏳ Starting import…"], status: null });

    try {
      // Kick off the import job
      const { job_id } = await authenticatedFetch(
        `/api/admin/import/${importType}`,
        { method: "POST" }
      );

      // Stream the logs back using fetch + ReadableStream (supports auth headers)
      const token = await user?.getIdToken();
      const response = await fetch(
        `${API_URL}/api/admin/import/${job_id}/stream`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.body) throw new Error("No response body from stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // SSE messages are separated by double newlines
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.log !== undefined) {
              setLog((prev) =>
                prev ? { ...prev, lines: [...prev.lines, data.log] } : prev
              );
            }
            if (data.done) {
              setLog((prev) =>
                prev ? { ...prev, status: data.status ?? (data.error ? "error" : "success") } : prev
              );
            }
          } catch {
            // malformed SSE frame — ignore
          }
        }
      }
    } catch (e: any) {
      setLog((prev) =>
        prev
          ? {
              ...prev,
              lines: [...prev.lines, `❌ Error: ${e.message}`],
              status: "error",
            }
          : prev
      );
    } finally {
      setRunningType(null);
      fetchHistory(); // refresh last-run timestamps
    }
  }

  function statusBadge(record: ImportRecord | null, type: string) {
    if (runningType === type) {
      return (
        <span className="inline-flex items-center gap-1.5 text-blue-600 text-xs font-medium">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          Running…
        </span>
      );
    }
    if (!record) {
      return <span className="text-gray-400 text-xs">Never run</span>;
    }
    if (record.status === "success") {
      return (
        <span className="inline-flex items-center gap-1.5 text-green-700 text-xs font-medium">
          <span className="w-2 h-2 bg-green-500 rounded-full" />
          Success
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-red-600 text-xs font-medium">
        <span className="w-2 h-2 bg-red-500 rounded-full" />
        Failed
      </span>
    );
  }

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>Heads up:</strong> These imports run scripts directly on the server. They require valid Firebase credentials and (for News) a <code className="bg-amber-100 px-1 rounded">GNEWS_API_KEY</code> environment variable. Running in local-data mode will cause imports to fail.
      </div>

      {/* Import Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {IMPORT_CONFIGS.map((config) => {
          const record = history[config.type as keyof ImportHistory];
          const isThisRunning = runningType === config.type;
          const anyRunning = !!runningType;

          return (
            <div
              key={config.type}
              className={`bg-white rounded-xl shadow p-5 flex flex-col gap-3 transition-opacity ${
                anyRunning && !isThisRunning ? "opacity-60" : ""
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{config.icon}</span>
                  <h3 className="text-base font-semibold text-gray-900">
                    {config.title}
                  </h3>
                </div>
                {!historyLoading && statusBadge(record, config.type)}
              </div>

              {/* Description */}
              <p className="text-sm text-gray-500 flex-1 leading-relaxed">
                {config.description}
              </p>

              {/* Meta */}
              <div className="space-y-0.5">
                <p className="text-xs text-gray-400 font-mono">{config.source}</p>
                <p className="text-xs text-gray-400">⏱ Est. {config.duration}</p>
              </div>

              {/* Last run info */}
              {record && !historyLoading && (
                <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 space-y-0.5">
                  <p>
                    Last run:{" "}
                    <span className="text-gray-600 font-medium">
                      {formatDate(record.started_at)}
                    </span>{" "}
                    <span className="text-gray-400">({timeSince(record.started_at)})</span>
                  </p>
                  {record.log_lines > 0 && (
                    <p>{record.log_lines} log lines captured</p>
                  )}
                  {record.error && (
                    <p className="text-red-500 truncate" title={record.error}>
                      Error: {record.error}
                    </p>
                  )}
                </div>
              )}

              {/* Trigger button */}
              <button
                onClick={() => triggerImport(config.type)}
                disabled={anyRunning}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isThisRunning
                    ? "bg-blue-50 text-blue-500 cursor-not-allowed"
                    : anyRunning
                    ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800"
                }`}
              >
                {isThisRunning ? "Running…" : `Run ${config.title} Import`}
              </button>
            </div>
          );
        })}
      </div>

      {/* Live Log Output */}
      {log && (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base">
                {IMPORT_CONFIGS.find((c) => c.type === log.type)?.icon}
              </span>
              <h3 className="font-semibold text-gray-900 text-sm">
                {IMPORT_CONFIGS.find((c) => c.type === log.type)?.title} — Import Log
              </h3>
            </div>
            <div className="flex items-center gap-3">
              {log.status === "success" && (
                <span className="text-green-700 text-xs font-medium">
                  ✓ Completed successfully
                </span>
              )}
              {log.status === "error" && (
                <span className="text-red-600 text-xs font-medium">
                  ✗ Completed with errors
                </span>
              )}
              {!log.status && runningType === log.type && (
                <span className="text-blue-500 text-xs animate-pulse">
                  Streaming…
                </span>
              )}
              <button
                onClick={() => setLog(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                title="Close log"
              >
                ×
              </button>
            </div>
          </div>

          <div
            ref={logRef}
            className="bg-gray-950 p-4 font-mono text-xs leading-relaxed overflow-y-auto"
            style={{ maxHeight: "22rem" }}
          >
            {log.lines.map((line, i) => {
              const isError =
                line.startsWith("ERROR") ||
                line.startsWith("❌") ||
                line.includes("Error") ||
                line.includes("error:");
              const isSuccess =
                line.startsWith("✓") ||
                line.includes("Successfully") ||
                line.includes("Success");
              const isHeading = line.startsWith("=");
              return (
                <div
                  key={i}
                  className={
                    isError
                      ? "text-red-400"
                      : isSuccess
                      ? "text-green-300 font-bold"
                      : isHeading
                      ? "text-yellow-300 font-semibold"
                      : "text-green-400"
                  }
                >
                  {line || "\u00a0"}
                </div>
              );
            })}
            {runningType === log.type && (
              <span className="text-yellow-400 animate-pulse">▌</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
