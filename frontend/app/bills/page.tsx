"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { API_URL } from "../../lib/api";
import BillSlideOutPanel from "../components/BillSlideOutPanel";
import PortalArt from "../../lib/portalArt";
import { primaryPortal, PORTALS } from "../../lib/portals";

// ============ Types ============

interface Bill {
  id: string;
  external_id: string;
  chamber: string;
  bill_number: string;
  title: string;
  plain_english: string | null;
  impact_summary: string | null;
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

interface BillsResponse {
  items: Bill[];
  total: number;
  limit: number;
  offset: number;
}

type Sort = "recent" | "traction" | "cosponsors" | "oldest";

interface Filters {
  chamber: string;   // "" | "house" | "senate"
  status: string;    // "" | "introduced" | "committee" | ...
  party: string;     // "" | "Democrat" | "Republican" | "Independent"
  bipartisan: boolean;
  portal: string;    // "" | "planet" | "money" | ... (portal id)
}

const PAGE_SIZE = 50;

// ============ Static lookups ============

const STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: "introduced", label: "Introduced" },
  { key: "committee", label: "In Committee" },
  { key: "floor", label: "On Floor" },
  { key: "passed_one", label: "Passed One Chamber" },
  { key: "passed_both", label: "Passed Both Chambers" },
  { key: "enrolled", label: "Enrolled" },
  { key: "signed", label: "Signed Into Law" },
  { key: "vetoed", label: "Vetoed" },
  { key: "dead", label: "Dead" },
];

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

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((o) => [o.key, o.label])
);

const PARTY_COLORS: Record<string, string> = {
  Democrat: "bg-blue-100 text-blue-800",
  Republican: "bg-red-100 text-red-800",
  Independent: "bg-purple-100 text-purple-800",
};

const SORT_OPTIONS: { key: Sort; label: string }[] = [
  { key: "recent", label: "Most Recent Action" },
  { key: "traction", label: "Highest Traction" },
  { key: "cosponsors", label: "Most Cosponsors" },
  { key: "oldest", label: "Oldest First" },
];

// ============ Helpers ============

function fmtStatus(status: string): string {
  return STATUS_LABELS[status] || status.replace(/_/g, " ");
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// ============ Page ============

function BillsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [bills, setBills] = useState<Bill[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({
    chamber: searchParams.get("chamber") || "",
    status: searchParams.get("status") || "",
    party: searchParams.get("party") || "",
    bipartisan: searchParams.get("bipartisan") === "true",
    portal: searchParams.get("portal") || "",
  });
  const [sort, setSort] = useState<Sort>(
    (searchParams.get("sort") as Sort) || "recent"
  );

  // Build the API URL for a given offset.
  const buildUrl = useCallback(
    (off: number) => {
      const p = new URLSearchParams();
      p.set("limit", String(PAGE_SIZE));
      p.set("offset", String(off));
      p.set("sort", sort);
      if (filters.chamber) p.set("chamber", filters.chamber);
      if (filters.status) p.set("status", filters.status);
      if (filters.party) p.set("party", filters.party);
      if (filters.bipartisan) p.set("bipartisan", "true");
      if (filters.portal) p.set("portal", filters.portal);
      return `${API_URL}/api/bills?${p.toString()}`;
    },
    [sort, filters]
  );

  // Push current filters/sort into the URL for shareable links.
  const syncUrl = useCallback(() => {
    const p = new URLSearchParams();
    if (filters.chamber) p.set("chamber", filters.chamber);
    if (filters.status) p.set("status", filters.status);
    if (filters.party) p.set("party", filters.party);
    if (filters.bipartisan) p.set("bipartisan", "true");
    if (filters.portal) p.set("portal", filters.portal);
    if (sort !== "recent") p.set("sort", sort);
    const qs = p.toString();
    router.replace(qs ? `/bills?${qs}` : "/bills", { scroll: false });
  }, [filters, sort, router]);

  // Initial + filter-change fetch — always starts from offset 0 and
  // replaces the list. Load More is a separate path.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOffset(0);
    fetch(buildUrl(0))
      .then(async (res) => {
        if (!res.ok) {
          // Surface the FastAPI HTTPException detail so we can tell
          // "not configured" from "unreachable" from a real 500.
          let detail = `Failed to load bills (${res.status})`;
          try {
            const body = await res.json();
            if (body?.detail) detail = body.detail;
          } catch {
            /* response wasn't JSON; keep the generic message */
          }
          throw new Error(detail);
        }
        return (await res.json()) as BillsResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setBills(data.items);
        setTotal(data.total);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || "Failed to load bills");
        setLoading(false);
      });
    syncUrl();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, sort]);

  const loadMore = async () => {
    const nextOffset = offset + PAGE_SIZE;
    setLoadingMore(true);
    try {
      const res = await fetch(buildUrl(nextOffset));
      if (!res.ok) throw new Error(`Failed to load more (${res.status})`);
      const data = (await res.json()) as BillsResponse;
      setBills((prev) => [...prev, ...data.items]);
      setOffset(nextOffset);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const clearFilters = () => {
    setFilters({ chamber: "", status: "", party: "", bipartisan: false, portal: "" });
    setSort("recent");
  };

  const hasMore = bills.length < total;
  const activeFilterCount =
    (filters.chamber ? 1 : 0) +
    (filters.status ? 1 : 0) +
    (filters.party ? 1 : 0) +
    (filters.bipartisan ? 1 : 0) +
    (filters.portal ? 1 : 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ============ Header ============ */}
      <header className="bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">WhoIsOurGov</h1>
              <p className="text-gray-300 text-sm">
                Bills
                <span className="text-gray-400 ml-1">
                  ({total.toLocaleString()})
                </span>
              </p>
            </div>
            <nav className="flex items-center gap-2 text-sm">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                Members
              </Link>
              <span className="px-3 py-1.5 rounded-lg bg-white/15 font-medium">
                Bills
              </span>
            </nav>
          </div>
        </div>
      </header>

      {/* ============ Filter bar ============ */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <select
            value={filters.portal}
            onChange={(e) => updateFilter("portal", e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Topics</option>
            {PORTALS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={filters.chamber}
            onChange={(e) => updateFilter("chamber", e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Chambers</option>
            <option value="house">House</option>
            <option value="senate">Senate</option>
          </select>

          <select
            value={filters.status}
            onChange={(e) => updateFilter("status", e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            value={filters.party}
            onChange={(e) => updateFilter("party", e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Parties</option>
            <option value="Democrat">Democrat</option>
            <option value="Republican">Republican</option>
            <option value="Independent">Independent</option>
          </select>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.bipartisan}
              onChange={(e) => updateFilter("bipartisan", e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Bipartisan only
          </label>

          <div className="flex-1" />

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                Sort: {o.label}
              </option>
            ))}
          </select>

          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Clear ({activeFilterCount})
            </button>
          )}
        </div>
      </div>

      {/* ============ Results ============ */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {loading && (
          <div className="text-center py-12 text-gray-500">Loading bills…</div>
        )}

        {error && !loading && (
          <div className="text-center py-12">
            <div className="text-red-600 font-medium">{error}</div>
            <button
              onClick={() => setFilters({ ...filters })}
              className="mt-2 text-sm text-blue-600 hover:text-blue-800"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && bills.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No bills match these filters.
          </div>
        )}

        {!loading && !error && bills.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {bills.map((bill) => (
                <BillCard
                  key={bill.id}
                  bill={bill}
                  onClick={() => setSelectedBillId(bill.external_id)}
                />
              ))}
            </div>

            {hasMore && (
              <div className="text-center mt-8">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors font-medium"
                >
                  {loadingMore
                    ? "Loading…"
                    : `Load more (${(total - bills.length).toLocaleString()} remaining)`}
                </button>
              </div>
            )}

            {!hasMore && bills.length > PAGE_SIZE && (
              <div className="text-center mt-8 text-sm text-gray-500">
                Showing all {bills.length.toLocaleString()} bills.
              </div>
            )}
          </>
        )}
      </main>

      {/* Slide-out detail panel */}
      <BillSlideOutPanel
        externalId={selectedBillId}
        onClose={() => setSelectedBillId(null)}
      />
    </div>
  );
}

// ============ Bill card ============

function BillCard({ bill, onClick }: { bill: Bill; onClick: () => void }) {
  const statusColor = STATUS_COLORS[bill.status] || "bg-gray-200 text-gray-700";
  const partyColor = PARTY_COLORS[bill.sponsor_party] || "bg-gray-100 text-gray-700";
  const portal = primaryPortal(bill.portal_tag);
  const primaryPortalId = bill.portal_tag?.[0] || null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left bg-white rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-md transition-all overflow-hidden"
    >
      {/* Portal art header — upper third of card */}
      <div className="relative h-24">
        <PortalArt portalId={primaryPortalId} className="absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        <div className="absolute top-2 right-2">
          <span
            className={`px-2 py-0.5 text-xs font-medium rounded ${statusColor}`}
          >
            {fmtStatus(bill.status)}
          </span>
        </div>
        {portal && (
          <div className="absolute bottom-2 left-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-white drop-shadow">
              {portal.name}
            </span>
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="font-semibold text-gray-900 mb-1">
          {bill.bill_number}
        </div>
        <div className="text-sm text-gray-900 mb-2 line-clamp-2">
          {bill.title}
        </div>

        {bill.plain_english && (
          <p className="text-sm text-gray-600 mb-3 line-clamp-3">
            {bill.plain_english}
          </p>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
          <span>Sponsored by</span>
          <span className="font-medium text-gray-900">{bill.sponsor_name}</span>
          <span className={`px-1.5 py-0.5 rounded ${partyColor}`}>
            {bill.sponsor_party?.[0] || "?"}
          </span>
          <span>{bill.sponsor_state}</span>
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-500 pt-2 border-t border-gray-100">
          <span>{bill.cosponsor_count} cosponsors</span>
          {bill.bipartisan && (
            <span className="text-emerald-700 font-medium">Bipartisan</span>
          )}
          <div className="flex-1" />
          <span>{fmtDate(bill.last_action_at)}</span>
        </div>
      </div>
    </button>
  );
}

export default function BillsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <BillsContent />
    </Suspense>
  );
}
