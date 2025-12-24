"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Legislator {
  id: string;
  bioguide_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  nickname?: string;
  party: string;
  caucus?: string;
  state: string;
  chamber: string;
  term_start: string;
  term_end: string;
  birthday: string;
  gender: string;
  phone: string;
  office: string;
  website: string;
  contact_form: string;
  state_rank?: string;
  senate_class?: number;
  district?: number;
  external_ids: {
    thomas?: string;
    govtrack?: number;
    opensecrets?: string;
    votesmart?: number;
    wikipedia?: string;
    ballotpedia?: string;
  };
}

interface CommitteeAssignment {
  committee_id: string;
  committee_name: string;
  is_subcommittee: boolean;
  parent_committee_id?: string;
  parent_committee_name?: string;
  rank?: number;
  title?: string;
  party?: string;
}

interface CommitteesData {
  bioguide_id: string;
  committees: CommitteeAssignment[];
  subcommittees: CommitteeAssignment[];
}

interface Bill {
  congress: number;
  type: string;
  number: number;
  title?: string;
  latestAction?: {
    actionDate: string;
    text: string;
  };
  introducedDate?: string;
  url?: string;
}

interface LegislationSummary {
  bioguide_id: string;
  sponsored_count: number;
  cosponsored_count: number;
  recent_sponsored: Bill[];
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  AS: "American Samoa", DC: "District of Columbia", GU: "Guam", MP: "Northern Mariana Islands",
  PR: "Puerto Rico", VI: "Virgin Islands"
};

const PARTY_COLORS: Record<string, string> = {
  Democrat: "bg-blue-100 text-blue-800 border-blue-200",
  Republican: "bg-red-100 text-red-800 border-red-200",
  Independent: "bg-purple-100 text-purple-800 border-purple-200",
};

const CHAMBER_COLORS: Record<string, string> = {
  Senate: "bg-amber-100 text-amber-800 border-amber-200",
  House: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

function calculateAge(birthday: string): number {
  const birth = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getBillUrl(bill: Bill): string {
  const typeMap: Record<string, string> = {
    HR: "house-bill",
    S: "senate-bill",
    HJRES: "house-joint-resolution",
    SJRES: "senate-joint-resolution",
    HCONRES: "house-concurrent-resolution",
    SCONRES: "senate-concurrent-resolution",
    HRES: "house-resolution",
    SRES: "senate-resolution",
  };
  const billType = typeMap[bill.type] || bill.type.toLowerCase();
  return `https://www.congress.gov/bill/${bill.congress}th-congress/${billType}/${bill.number}`;
}

export default function LegislatorDetail() {
  const params = useParams();
  const [legislator, setLegislator] = useState<Legislator | null>(null);
  const [committees, setCommittees] = useState<CommitteesData | null>(null);
  const [legislation, setLegislation] = useState<LegislationSummary | null>(null);
  const [legislationLoading, setLegislationLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllSubcommittees, setShowAllSubcommittees] = useState(false);

  useEffect(() => {
    if (!params.id) return;

    fetch(`http://localhost:8000/api/legislators/${params.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Legislator not found");
        return res.json();
      })
      .then((data) => {
        setLegislator(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });

    fetch(`http://localhost:8000/api/legislators/${params.id}/committees`)
      .then((res) => res.json())
      .then((data) => {
        setCommittees(data);
      })
      .catch(() => {
        setCommittees(null);
      });

    fetch(`http://localhost:8000/api/legislators/${params.id}/legislation-summary`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        setLegislation(data);
        setLegislationLoading(false);
      })
      .catch((err) => {
        console.error("Legislation fetch error:", err);
        setLegislation(null);
        setLegislationLoading(false);
      });
  }, [params.id]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-xl">Loading...</p>
      </main>
    );
  }

  if (error || !legislator) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <p className="text-xl text-red-600 mb-4">Error: {error || "Legislator not found"}</p>
        <Link href="/" className="text-blue-600 hover:text-blue-800">
          ← Back to directory
        </Link>
      </main>
    );
  }

  const position = legislator.chamber === "Senate"
    ? `${legislator.state_rank?.charAt(0).toUpperCase()}${legislator.state_rank?.slice(1)} Senator from ${STATE_NAMES[legislator.state]}`
    : `Representative from ${STATE_NAMES[legislator.state]}${legislator.district === 0 ? " (At-Large)" : `, District ${legislator.district}`}`;

  const visibleSubcommittees = showAllSubcommittees 
    ? committees?.subcommittees || []
    : (committees?.subcommittees || []).slice(0, 5);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link 
          href="/" 
          className="inline-flex items-center text-blue-600 hover:text-blue-800 mb-6"
        >
          ← Back to directory
        </Link>

        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Header with photo */}
          <div className="md:flex">
            <div className="md:flex-shrink-0">
              <img
                src={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                alt={legislator.full_name}
                className="h-64 w-full md:w-48 object-cover bg-gray-200"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "https://via.placeholder.com/192x256?text=No+Photo";
                }}
              />
            </div>
            <div className="p-6 flex-1">
              <div className="flex flex-wrap gap-2 mb-3">
                <span className={`px-3 py-1 rounded-full text-sm font-medium border ${CHAMBER_COLORS[legislator.chamber]}`}>
                  {legislator.chamber}
                </span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium border ${PARTY_COLORS[legislator.party]}`}>
                  {legislator.party}
                </span>
                {legislator.caucus && legislator.caucus !== legislator.party && (
                  <span className="px-3 py-1 rounded-full text-sm font-medium border bg-gray-100 text-gray-800 border-gray-200">
                    Caucuses with {legislator.caucus}s
                  </span>
                )}
              </div>
              
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                {legislator.full_name}
                {legislator.nickname && (
                  <span className="text-gray-500 font-normal text-xl"> "{legislator.nickname}"</span>
                )}
              </h1>
              
              <p className="text-lg text-gray-600 mt-1">{position}</p>

              {legislator.birthday && (
                <p className="text-gray-500 mt-2">
                  Born {formatDate(legislator.birthday)} (age {calculateAge(legislator.birthday)})
                </p>
              )}
            </div>
          </div>

          {/* Details sections */}
          <div className="border-t border-gray-200">
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200">
              {/* Term Information */}
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Term Information</h2>
                <dl className="space-y-3">
                  {legislator.chamber === "Senate" && (
                    <div>
                      <dt className="text-sm text-gray-500">Senate Class</dt>
                      <dd className="text-gray-900">Class {legislator.senate_class}</dd>
                    </div>
                  )}
                  {legislator.chamber === "House" && (
                    <div>
                      <dt className="text-sm text-gray-500">District</dt>
                      <dd className="text-gray-900">
                        {legislator.district === 0 ? "At-Large" : `District ${legislator.district}`}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-sm text-gray-500">Current Term</dt>
                    <dd className="text-gray-900">
                      {formatDate(legislator.term_start)} — {formatDate(legislator.term_end)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500">State</dt>
                    <dd className="text-gray-900">{STATE_NAMES[legislator.state]} ({legislator.state})</dd>
                  </div>
                </dl>
              </div>

              {/* Contact Information */}
              <div className="p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h2>
                <dl className="space-y-3">
                  {legislator.phone && (
                    <div>
                      <dt className="text-sm text-gray-500">Phone</dt>
                      <dd className="text-gray-900">
                        <a href={`tel:${legislator.phone}`} className="text-blue-600 hover:text-blue-800">
                          {legislator.phone}
                        </a>
                      </dd>
                    </div>
                  )}
                  {legislator.office && (
                    <div>
                      <dt className="text-sm text-gray-500">Office</dt>
                      <dd className="text-gray-900">{legislator.office}</dd>
                    </div>
                  )}
                  {legislator.website && (
                    <div>
                      <dt className="text-sm text-gray-500">Website</dt>
                      <dd>
                        <a 
                          href={legislator.website} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {legislator.website.replace(/^https?:\/\/(www\.)?/, '')}
                        </a>
                      </dd>
                    </div>
                  )}
                  {legislator.contact_form && (
                    <div>
                      <dt className="text-sm text-gray-500">Contact Form</dt>
                      <dd>
                        <a 
                          href={legislator.contact_form} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Send a message →
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </div>

          {/* Sponsored Legislation - Live from Congress.gov */}
          <div className="border-t border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Legislative Activity
              <span className="ml-2 text-xs font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                Live from Congress.gov
              </span>
            </h2>
            
            {legislationLoading ? (
              <div className="text-gray-500 text-sm">Loading legislation data...</div>
            ) : legislation ? (
              <div>
                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-3xl font-bold text-blue-700">{legislation.sponsored_count}</div>
                    <div className="text-sm text-blue-600">Bills Sponsored</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="text-3xl font-bold text-green-700">{legislation.cosponsored_count}</div>
                    <div className="text-sm text-green-600">Bills Cosponsored</div>
                  </div>
                </div>

                {/* Recent Sponsored Bills */}
                {legislation.recent_sponsored.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                      Recent Sponsored Bills
                    </h3>
                    <div className="space-y-3">
                      {legislation.recent_sponsored.map((bill, idx) => (
                        <a
                          key={idx}
                          href={getBillUrl(bill)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <span className="font-medium text-gray-900">
                                {bill.type}.{bill.number}
                              </span>
                              <span className="text-gray-500 text-sm ml-2">
                                {bill.congress}th Congress
                              </span>
                              {bill.title && (
                                <p className="text-sm text-gray-600 mt-1">
                                  {bill.title}
                                </p>
                              )}
                              {bill.latestAction && (
                                <p className="text-xs text-gray-500 mt-1">
                                  Latest: {bill.latestAction.text} ({bill.latestAction.actionDate})
                                </p>
                              )}
                            </div>
                            <span className="text-gray-400 ml-2">↗</span>
                          </div>
                        </a>
                      ))}
                    </div>
                    <a
                      href={`https://www.congress.gov/member/${legislator.full_name.toLowerCase().replace(/[^a-z0-9]/g, '-')}/${legislator.bioguide_id}?q=%7B%22sponsorship%22%3A%22sponsored%22%7D`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-4 text-sm text-blue-600 hover:text-blue-800"
                    >
                      View all {legislation.sponsored_count} sponsored bills on Congress.gov →
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-gray-500 text-sm">Unable to load legislation data. Make sure your Congress.gov API key is configured.</div>
            )}
          </div>

          {/* Committee Assignments */}
          {committees && (committees.committees.length > 0 || committees.subcommittees.length > 0) && (
            <div className="border-t border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Committee Assignments</h2>
              
              {committees.committees.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                    Committees ({committees.committees.length})
                  </h3>
                  <div className="space-y-2">
                    {committees.committees.map((committee, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex-1">
                          <span className="font-medium text-gray-900">
                            {committee.committee_name}
                          </span>
                          {committee.title && (
                            <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full font-medium">
                              {committee.title}
                            </span>
                          )}
                        </div>
                        {committee.rank && (
                          <span className="text-sm text-gray-500">
                            Rank #{committee.rank}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {committees.subcommittees.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                    Subcommittees ({committees.subcommittees.length})
                  </h3>
                  <div className="space-y-2">
                    {visibleSubcommittees.map((sub, idx) => (
                      <div 
                        key={idx}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex-1">
                          <span className="font-medium text-gray-900">
                            {sub.committee_name}
                          </span>
                          {sub.title && (
                            <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full font-medium">
                              {sub.title}
                            </span>
                          )}
                          {sub.parent_committee_name && (
                            <div className="text-sm text-gray-500 mt-0.5">
                              {sub.parent_committee_name}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {committees.subcommittees.length > 5 && (
                    <button
                      onClick={() => setShowAllSubcommittees(!showAllSubcommittees)}
                      className="mt-3 text-sm text-blue-600 hover:text-blue-800"
                    >
                      {showAllSubcommittees 
                        ? "Show fewer" 
                        : `Show all ${committees.subcommittees.length} subcommittees`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* External Research Links */}
          <div className="border-t border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Research & Analysis</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {legislator.external_ids?.govtrack && (
                <a
                  href={`https://www.govtrack.us/congress/members/${legislator.external_ids.govtrack}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center p-4 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-100 transition-colors"
                >
                  <div className="flex-shrink-0 w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
                    GT
                  </div>
                  <div className="ml-3">
                    <div className="font-medium text-gray-900">GovTrack</div>
                    <div className="text-xs text-gray-500">Voting analysis</div>
                  </div>
                </a>
              )}
              
              {legislator.external_ids?.votesmart && (
                <a
                  href={`https://justfacts.votesmart.org/candidate/${legislator.external_ids.votesmart}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center p-4 bg-green-50 hover:bg-green-100 rounded-lg border border-green-100 transition-colors"
                >
                  <div className="flex-shrink-0 w-10 h-10 bg-green-600 rounded-lg flex items-center justify-center text-white font-bold">
                    VS
                  </div>
                  <div className="ml-3">
                    <div className="font-medium text-gray-900">VoteSmart</div>
                    <div className="text-xs text-gray-500">Positions & ratings</div>
                  </div>
                </a>
              )}

              {legislator.external_ids?.opensecrets && (
                <a
                  href={`https://www.opensecrets.org/members-of-congress/summary?cid=${legislator.external_ids.opensecrets}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center p-4 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-100 transition-colors"
                >
                  <div className="flex-shrink-0 w-10 h-10 bg-amber-600 rounded-lg flex items-center justify-center text-white font-bold">
                    OS
                  </div>
                  <div className="ml-3">
                    <div className="font-medium text-gray-900">OpenSecrets</div>
                    <div className="text-xs text-gray-500">Campaign finance</div>
                  </div>
                </a>
              )}
            </div>
          </div>

          {/* External Links */}
          {legislator.external_ids && (
            <div className="border-t border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Learn More</h2>
              <div className="flex flex-wrap gap-3">
                {legislator.external_ids.wikipedia && (
                  <a
                    href={`https://en.wikipedia.org/wiki/${legislator.external_ids.wikipedia}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
                  >
                    Wikipedia
                  </a>
                )}
                {legislator.external_ids.ballotpedia && (
                  <a
                    href={`https://ballotpedia.org/${legislator.external_ids.ballotpedia}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
                  >
                    Ballotpedia
                  </a>
                )}
                <a
                  href={`https://www.congress.gov/member/${legislator.full_name.toLowerCase().replace(/[^a-z0-9]/g, '-')}/${legislator.bioguide_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium text-gray-700 transition-colors"
                >
                  Congress.gov Profile
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
