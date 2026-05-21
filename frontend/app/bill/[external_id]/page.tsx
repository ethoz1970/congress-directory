"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_URL } from "../../../lib/api";
import PortalArt from "../../../lib/portalArt";
import { primaryPortal, getPortal } from "../../../lib/portals";

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BillDetailPage() {
  const params = useParams();
  const externalId = params.external_id as string;

  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!externalId) return;
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-4xl mx-auto px-4 py-12 text-center text-gray-500">
          Loading bill…
        </main>
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="max-w-4xl mx-auto px-4 py-12 text-center">
          <div className="text-red-600 font-medium mb-2">
            {error || "Bill not found"}
          </div>
          <Link href="/bills" className="text-sm text-blue-600 hover:text-blue-800">
            ← Back to all bills
          </Link>
        </main>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[bill.status] || "bg-gray-200 text-gray-700";
  const statusLabel = STATUS_LABELS[bill.status] || bill.status.replace(/_/g, " ");
  const partyColor = PARTY_COLORS[bill.sponsor_party] || "bg-gray-100 text-gray-700";

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-4xl mx-auto px-4 py-6">
        <Link href="/bills" className="text-sm text-blue-600 hover:text-blue-800">
          ← All bills
        </Link>

        {/* ============ Portal art banner ============ */}
        <div className="relative h-48 sm:h-56 rounded-lg overflow-hidden mt-4">
          <PortalArt
            portalId={bill.portal_tag?.[0] || null}
            className="absolute inset-0"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
          <div className="absolute top-4 right-4">
            <span
              className={`px-3 py-1 text-sm font-medium rounded ${statusColor}`}
            >
              {statusLabel}
            </span>
          </div>
          <div className="absolute bottom-4 left-6 right-6">
            {primaryPortal(bill.portal_tag) && (
              <div className="text-xs uppercase tracking-wide text-white/80 font-semibold mb-1">
                {primaryPortal(bill.portal_tag)!.name}
              </div>
            )}
            <div className="text-4xl font-bold text-white drop-shadow">
              {bill.bill_number}
            </div>
          </div>
        </div>

        {/* Title + secondary portals */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mt-4">
          <h1 className="text-xl text-gray-800 leading-snug">{bill.title}</h1>
          {bill.portal_tag && bill.portal_tag.length > 1 && (
            <div className="flex flex-wrap gap-2 mt-3">
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
        </div>

        {/* ============ Plain English ============ */}
        {bill.plain_english && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-6 mt-4">
            <div className="text-xs uppercase tracking-wide text-blue-700 font-semibold mb-2">
              What this bill does
            </div>
            <p className="text-gray-800 leading-relaxed">{bill.plain_english}</p>
          </div>
        )}

        {/* ============ Impact summary ============ */}
        {bill.impact_summary && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-6 mt-4">
            <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-2">
              If this passes
            </div>
            <p className="text-gray-800 leading-relaxed">{bill.impact_summary}</p>
          </div>
        )}

        {/* ============ Sponsor ============ */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mt-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
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

        {/* ============ Stats ============ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <Stat label="Cosponsors" value={bill.cosponsor_count.toLocaleString()} />
          <Stat
            label="Bipartisan"
            value={bill.bipartisan ? "Yes" : "No"}
            highlight={bill.bipartisan ? "emerald" : null}
          />
          <Stat
            label="Traction"
            value={bill.traction_score.toFixed(1)}
          />
          <Stat label="Chamber" value={bill.chamber || "—"} />
        </div>

        {/* ============ Action history ============ */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mt-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">
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

        {/* ============ Enrichment footer ============ */}
        {bill.plain_english_written_at && (
          <div className="text-xs text-gray-400 text-center mt-6">
            Plain-English summary written by Nia ({bill.enrichment_version}) on{" "}
            {fmtDate(bill.plain_english_written_at)}
          </div>
        )}
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">WhoIsOurGov</h1>
            <p className="text-gray-300 text-sm">Bill detail</p>
          </div>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
            >
              Members
            </Link>
            <Link
              href="/bills"
              className="px-3 py-1.5 rounded-lg bg-white/15 font-medium"
            >
              Bills
            </Link>
          </nav>
        </div>
      </div>
    </header>
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
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${valueColor}`}>{value}</div>
    </div>
  );
}
