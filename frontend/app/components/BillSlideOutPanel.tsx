"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { API_URL } from "../../lib/api";
import PortalArt from "../../lib/portalArt";
import { primaryPortal, getPortal } from "../../lib/portals";

interface Bill {
  id: string;
  external_id: string;
  chamber: string;
  bill_number: string;
  title: string;
  plain_english: string | null;
  impact_summary: string | null;
  plain_english_model?: string | null;
  plain_english_written_at?: string | null;
  enrichment_version?: string | null;
  introduced_at: string;
  status: string;
  last_action: string;
  last_action_at: string;
  sponsor_id: string;
  portal_tag: string[];
  scope: string;
  state_code: string | null;
  session: string;
  cosponsor_count: number;
  bipartisan: boolean;
  racial_equity_flag: boolean;
  traction_score: number;
  sponsor_bioguide_id: string;
  sponsor_name: string;
  sponsor_party: string;
  sponsor_state: string;
  sponsor_chamber: string;
}

interface BillSlideOutPanelProps {
  externalId: string | null;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  introduced: "bg-blue-100 text-blue-800",
  committee: "bg-amber-100 text-amber-800",
  floor: "bg-orange-100 text-orange-800",
  passed_one: "bg-indigo-100 text-indigo-800",
  passed_both: "bg-purple-100 text-purple-800",
  enrolled: "bg-pink-100 text-pink-800",
  signed: "bg-emerald-100 text-emerald-800",
  vetoed: "bg-red-100 text-red-800",
  dead: "bg-gray-200 text-gray-700",
};

const STATUS_STRIPES: Record<string, string> = {
  introduced: "from-blue-500 to-blue-600",
  committee: "from-amber-500 to-amber-600",
  floor: "from-orange-500 to-orange-600",
  passed_one: "from-indigo-500 to-indigo-600",
  passed_both: "from-purple-500 to-purple-600",
  enrolled: "from-pink-500 to-pink-600",
  signed: "from-emerald-500 to-emerald-600",
  vetoed: "from-red-500 to-red-600",
  dead: "from-gray-400 to-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  introduced: "Introduced",
  committee: "In Committee",
  floor: "On Floor",
  passed_one: "Passed One Chamber",
  passed_both: "Passed Both Chambers",
  enrolled: "Enrolled",
  signed: "Signed Into Law",
  vetoed: "Vetoed",
  dead: "Dead",
};

const PARTY_COLORS: Record<string, string> = {
  Democrat: "bg-blue-100 text-blue-800",
  Republican: "bg-red-100 text-red-800",
  Independent: "bg-purple-100 text-purple-800",
};

function fmtStatus(s: string): string {
  return STATUS_LABELS[s] || s.replace(/_/g, " ");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BillSlideOutPanel({ externalId, onClose }: BillSlideOutPanelProps) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isOpen = externalId !== null;

  useEffect(() => {
    if (!externalId) {
      setBill(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`${API_URL}/api/bills/${encodeURIComponent(externalId)}`)
      .then(async (res) => {
        if (!res.ok) {
          let detail = res.status === 404 ? "Bill not found" : `Failed to load (${res.status})`;
          try {
            const body = await res.json();
            if (body?.detail) detail = body.detail;
          } catch {
            /* keep default */
          }
          throw new Error(detail);
        }
        return (await res.json()) as Bill;
      })
      .then((data) => {
        setBill(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load bill");
        setLoading(false);
      });
  }, [externalId]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const statusColor = bill ? STATUS_COLORS[bill.status] || "bg-gray-200 text-gray-700" : "";
  const statusStripe = bill ? STATUS_STRIPES[bill.status] || "from-gray-400 to-gray-500" : "from-gray-400 to-gray-500";
  const partyColor = bill ? PARTY_COLORS[bill.sponsor_party] || "bg-gray-100 text-gray-700" : "";

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 z-40 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Slide-out panel */}
      <div
        className={`fixed top-0 right-0 h-full w-[95%] sm:max-w-2xl bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out rounded-l-2xl sm:rounded-none overflow-hidden ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Status-tinted color strip at the very top */}
        {bill && (
          <div
            className={`absolute top-0 left-0 right-0 h-2 z-[101] bg-gradient-to-r ${statusStripe}`}
          />
        )}

        {/* Top action buttons */}
        <div className="absolute top-4 left-4 flex items-center gap-2 z-[100]">
          {/* Close */}
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full shadow-lg border border-gray-200 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* Open full page */}
          {bill && (
            <a
              href={`/bill/${bill.external_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 flex items-center justify-center bg-white text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-full shadow-lg border border-gray-200 transition-colors"
              title="Open full page"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </a>
          )}
        </div>

        {/* Content */}
        <div className="h-full overflow-y-auto overflow-x-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xl text-gray-500">Loading…</p>
            </div>
          ) : error || !bill ? (
            <div className="flex items-center justify-center h-full px-6 text-center">
              <p className="text-lg text-red-600">{error || "Bill not found"}</p>
            </div>
          ) : (
            <div>
              {/* Portal art banner */}
              <div className="relative h-40 w-full">
                <PortalArt
                  portalId={bill.portal_tag?.[0] || null}
                  className="absolute inset-0"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
                <div className="absolute top-3 right-4">
                  <span
                    className={`px-3 py-1 text-sm font-medium rounded ${statusColor}`}
                  >
                    {fmtStatus(bill.status)}
                  </span>
                </div>
                <div className="absolute bottom-3 left-6 right-6">
                  {primaryPortal(bill.portal_tag) && (
                    <div className="text-xs uppercase tracking-wide text-white/80 font-semibold">
                      {primaryPortal(bill.portal_tag)!.name}
                    </div>
                  )}
                  <div className="text-3xl font-bold text-white drop-shadow">
                    {bill.bill_number}
                  </div>
                </div>
              </div>

              <div className="px-6 sm:px-8 pb-8 pt-5 space-y-4">
                {/* Title */}
                <h2 className="text-xl text-gray-800 leading-snug">{bill.title}</h2>

                {/* Secondary portals if present */}
                {bill.portal_tag && bill.portal_tag.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {bill.portal_tag.slice(1).map((tag) => {
                      const p = getPortal(tag);
                      return (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700 rounded"
                        >
                          {p?.short || tag}
                        </span>
                      );
                    })}
                  </div>
                )}

              {/* Plain English */}
              {bill.plain_english && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-5">
                  <div className="text-xs uppercase tracking-wide text-blue-700 font-semibold mb-2">
                    What this bill does
                  </div>
                  <p className="text-gray-800 leading-relaxed">{bill.plain_english}</p>
                </div>
              )}

              {/* Impact */}
              {bill.impact_summary && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-5">
                  <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-2">
                    If this passes
                  </div>
                  <p className="text-gray-800 leading-relaxed">{bill.impact_summary}</p>
                </div>
              )}

              {/* Sponsor */}
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
                  Sponsor
                </div>
                <Link
                  href={`/card/${bill.sponsor_bioguide_id}`}
                  className="inline-flex items-center gap-3 group"
                >
                  <div>
                    <div className="font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                      {bill.sponsor_name}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600 mt-0.5">
                      <span className={`px-1.5 py-0.5 text-xs rounded ${partyColor}`}>
                        {bill.sponsor_party}
                      </span>
                      <span>·</span>
                      <span>
                        {bill.sponsor_state}
                        {bill.sponsor_chamber ? ` ${bill.sponsor_chamber}` : ""}
                      </span>
                    </div>
                  </div>
                </Link>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Cosponsors" value={bill.cosponsor_count.toLocaleString()} />
                <Stat
                  label="Bipartisan"
                  value={bill.bipartisan ? "Yes" : "No"}
                  highlight={bill.bipartisan ? "emerald" : null}
                />
                <Stat label="Traction" value={bill.traction_score.toFixed(1)} />
                <Stat label="Chamber" value={bill.chamber || "—"} />
              </div>

              {/* Latest action */}
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
                  Latest action
                </div>
                <div className="text-sm text-gray-800">{bill.last_action}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {fmtDate(bill.last_action_at)}
                </div>
                <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
                  Introduced {fmtDate(bill.introduced_at)} · Session {bill.session} ·{" "}
                  {bill.scope === "federal" ? "Federal" : `State (${bill.state_code})`}
                </div>
              </div>

              {/* Enrichment footer */}
              {bill.plain_english_written_at && (
                <div className="text-xs text-gray-400 text-center pt-2">
                  Plain-English summary written by Nia ({bill.enrichment_version}) on{" "}
                  {fmtDate(bill.plain_english_written_at)}
                </div>
              )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "emerald" | null;
}) {
  const valueColor =
    highlight === "emerald" ? "text-emerald-700" : "text-gray-900";
  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
        {label}
      </div>
      <div className={`text-xl font-bold mt-1 ${valueColor}`}>{value}</div>
    </div>
  );
}
