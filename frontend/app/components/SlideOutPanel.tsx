"use client";

import { useEffect, useState } from "react";
import { API_URL } from "../../lib/api";

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
  first_term_start?: string;
  total_terms?: number;
  senate_terms?: number;
  house_terms?: number;
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
  enacted_count: number;
  recent_sponsored: Bill[];
  recent_enacted: Bill[];
}

interface SlideOutPanelProps {
  bioguideId: string | null;
  onClose: () => void;
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

function calculateTimeInOffice(termStart: string): string {
  const start = new Date(termStart);
  const today = new Date();
  const years = today.getFullYear() - start.getFullYear();
  const months = today.getMonth() - start.getMonth();
  
  let totalMonths = years * 12 + months;
  if (today.getDate() < start.getDate()) {
    totalMonths--;
  }
  
  const finalYears = Math.floor(totalMonths / 12);
  const finalMonths = totalMonths % 12;
  
  if (finalYears === 0) {
    return `${finalMonths} month${finalMonths !== 1 ? 's' : ''}`;
  } else if (finalMonths === 0) {
    return `${finalYears} year${finalYears !== 1 ? 's' : ''}`;
  } else {
    return `${finalYears}y ${finalMonths}m`;
  }
}

function calculateYearsOfService(firstTermStart: string): string {
  const start = new Date(firstTermStart);
  const today = new Date();
  const years = today.getFullYear() - start.getFullYear();
  const months = today.getMonth() - start.getMonth();
  
  let totalMonths = years * 12 + months;
  if (today.getDate() < start.getDate()) {
    totalMonths--;
  }
  
  const finalYears = Math.floor(totalMonths / 12);
  
  if (finalYears < 1) {
    return "< 1 year";
  } else {
    return `${finalYears} year${finalYears !== 1 ? 's' : ''}`;
  }
}

function formatTermCount(legislator: Legislator): string {
  if (!legislator.total_terms) return "1 term";
  
  const parts: string[] = [];
  
  if (legislator.senate_terms && legislator.senate_terms > 0) {
    parts.push(`${legislator.senate_terms} Senate`);
  }
  if (legislator.house_terms && legislator.house_terms > 0) {
    parts.push(`${legislator.house_terms} House`);
  }
  
  if (parts.length === 1) {
    return `${legislator.total_terms} term${legislator.total_terms !== 1 ? 's' : ''}`;
  }
  
  return `${legislator.total_terms} terms (${parts.join(', ')})`;
}

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
  if (!bill || !bill.type) return "#";
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

export default function SlideOutPanel({ bioguideId, onClose }: SlideOutPanelProps) {
  const [legislator, setLegislator] = useState<Legislator | null>(null);
  const [committees, setCommittees] = useState<CommitteesData | null>(null);
  const [legislation, setLegislation] = useState<LegislationSummary | null>(null);
  const [legislationLoading, setLegislationLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllSubcommittees, setShowAllSubcommittees] = useState(false);

  const isOpen = bioguideId !== null;

  useEffect(() => {
    if (!bioguideId) {
      setLegislator(null);
      setCommittees(null);
      setLegislation(null);
      return;
    }

    setLoading(true);
    setLegislationLoading(true);
    setError(null);
    setShowAllSubcommittees(false);

    fetch(`${API_URL}/api/legislators/${bioguideId}`)
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

    fetch(`${API_URL}/api/legislators/${bioguideId}/committees`)
      .then((res) => res.json())
      .then((data) => {
        setCommittees(data);
      })
      .catch(() => {
        setCommittees(null);
      });

    fetch(`${API_URL}/api/legislators/${bioguideId}/legislation-summary`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        setLegislation(data);
        setLegislationLoading(false);
      })
      .catch(() => {
        setLegislation(null);
        setLegislationLoading(false);
      });
  }, [bioguideId]);

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

  const position = legislator?.chamber === "Senate"
    ? `${legislator.state_rank?.charAt(0).toUpperCase()}${legislator.state_rank?.slice(1)} Senator from ${STATE_NAMES[legislator.state]}`
    : legislator ? `Representative from ${STATE_NAMES[legislator.state]}${legislator.district === 0 ? " (At-Large)" : `, District ${legislator.district}`}` : "";

  const visibleSubcommittees = showAllSubcommittees
    ? committees?.subcommittees || []
    : (committees?.subcommittees || []).slice(0, 5);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black transition-opacity duration-300 z-40 ${
          isOpen ? "opacity-50" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Slide-out panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-2xl bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full z-10"
        >
          ✕
        </button>

        {/* Content */}
        <div className="h-full overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xl text-gray-500">Loading...</p>
            </div>
          ) : error || !legislator ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xl text-red-600">{error || "Legislator not found"}</p>
            </div>
          ) : (
            <div>
              {/* Header with photo */}
              <div className="relative">
                <div className={`h-40 ${
                  legislator.party === "Republican" 
                    ? "bg-gradient-to-r from-red-600 to-red-700"
                    : legislator.party === "Democrat"
                      ? "bg-gradient-to-r from-blue-600 to-blue-700"
                      : "bg-gradient-to-r from-purple-600 to-purple-700"
                }`} />
                <div className="px-6 pb-4">
                  <div className="relative -mt-28 flex items-end gap-5">
                    <img
                      src={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                      alt={legislator.full_name}
                      className="w-64 h-80 object-cover rounded-lg border-4 border-white shadow-lg bg-gray-200 flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://via.placeholder.com/256x320?text=No+Photo";
                      }}
                    />
                    <div className="pb- flex-1">

                             {/* Tags */}
                      <div className="flex flex-wrap gap-2 mb-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${CHAMBER_COLORS[legislator.chamber]}`}>
                          {legislator.chamber}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${PARTY_COLORS[legislator.party]}`}>
                          {legislator.party}
                        </span>
                      </div>


                      {/* Contact info at top */}
                      <div className="mb-3 space-y-1">

                                              {/* Name and position */}
                      <h2 className="text-2xl font-bold text-gray-900">
                        {legislator.full_name}
                      </h2>
                      <p className="text-gray-600">{position}</p>

                        {legislator.phone && (
                          <a href={`tel:${legislator.phone}`} className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800">
                            📞 {legislator.phone}
                          </a>
                        )}
                        {legislator.office && (
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            🏛️ {legislator.office}
                          </div>
                        )}
                        {legislator.website && (
                          <a href={legislator.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800">
                            🌐 Official Website →
                          </a>
                        )}
                        {legislator.contact_form && (
                          <a href={legislator.contact_form} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800">
                            ✉️ Contact Form →
                          </a>
                        )}
                      </div>
                      
                 
                      

                    </div>
                  </div>
                </div>
              </div>

              {/* Details */}
              <div className="px-6 pb-6 space-y-6">
                {/* Quick Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 uppercase">State</div>
                    <div className="font-medium text-gray-900">{STATE_NAMES[legislator.state]}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 uppercase">
                      {legislator.chamber === "Senate" ? "Class" : "District"}
                    </div>
                    <div className="font-medium text-gray-900">
                      {legislator.chamber === "Senate"
                        ? `Class ${legislator.senate_class}`
                        : legislator.district === 0 ? "At-Large" : `District ${legislator.district}`}
                    </div>
                  </div>
                  {legislator.first_term_start && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 uppercase">Entered Congress</div>
                      <div className="font-medium text-gray-900">{new Date(legislator.first_term_start).getFullYear()}</div>
                    </div>
                  )}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 uppercase">Terms Served</div>
                    <div className="font-medium text-gray-900">{formatTermCount(legislator)}</div>
                  </div>
                  {legislator.first_term_start && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 uppercase">Years in Congress</div>
                      <div className="font-medium text-gray-900">{calculateYearsOfService(legislator.first_term_start)}</div>
                    </div>
                  )}
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="text-xs text-gray-500 uppercase">Term Ends</div>
                    <div className="font-medium text-gray-900">{formatDate(legislator.term_end)}</div>
                  </div>
                  {legislator.birthday && (
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-xs text-gray-500 uppercase">Age</div>
                      <div className="font-medium text-gray-900">{calculateAge(legislator.birthday)} years old</div>
                    </div>
                  )}
                </div>

                {/* Legislative Activity */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Legislative Activity
                    <span className="ml-2 text-xs font-normal normal-case bg-gray-100 px-2 py-0.5 rounded">
                      Live from Congress.gov
                    </span>
                  </h3>
                  
                  {legislationLoading ? (
                    <div className="text-gray-500 text-sm">Loading...</div>
                  ) : legislation ? (
                    <div>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-blue-50 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-blue-700">{legislation.sponsored_count}</div>
                          <div className="text-xs text-blue-600">Sponsored</div>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-green-700">{legislation.cosponsored_count}</div>
                          <div className="text-xs text-green-600">Cosponsored</div>
                        </div>
                        <div className="bg-amber-50 rounded-lg p-3 text-center">
                          <div className="text-2xl font-bold text-amber-700">{legislation.enacted_count || 0}</div>
                          <div className="text-xs text-amber-600">Signed into Law</div>
                        </div>
                      </div>

                      {legislation.recent_enacted && legislation.recent_enacted.length > 0 && (
                        <div className="mb-4">
                          <div className="text-xs text-gray-500 mb-2">Recent Bills Signed into Law</div>
                          <div className="space-y-2">
                            {legislation.recent_enacted.slice(0, 3).map((bill, idx) => (
                              <a
                                key={idx}
                                href={getBillUrl(bill)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block p-2 bg-amber-50 rounded hover:bg-amber-100 transition-colors text-sm border border-amber-200"
                              >
                                <span className="font-medium text-amber-800">{bill.type || "Bill"}.{bill.number || "?"}</span>
                                {bill.title && (
                                  <span className="text-gray-600 ml-1">— {bill.title.slice(0, 50)}...</span>
                                )}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {legislation.recent_sponsored.length > 0 && (
                        <div>
                          <div className="text-xs text-gray-500 mb-2">Recent Sponsored Bills</div>
                          <div className="space-y-2">
                            {legislation.recent_sponsored.slice(0, 3).map((bill, idx) => (
                              <a
                                key={idx}
                                href={getBillUrl(bill)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block p-2 bg-gray-50 rounded hover:bg-gray-100 transition-colors text-sm"
                              >
                                <span className="font-medium">{bill.type || "Bill"}.{bill.number || "?"}</span>
                                {bill.title && (
                                  <span className="text-gray-600 ml-1">— {bill.title.slice(0, 60)}...</span>
                                )}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-gray-500 text-sm">Unable to load legislation data</div>
                  )}
                </div>

                {/* Committees */}
                {committees && committees.committees.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                      Committees ({committees.committees.length})
                    </h3>
                    <div className="space-y-2">
                      {committees.committees.map((committee, idx) => (
                        <div key={idx} className="p-2 bg-gray-50 rounded-lg">
                          <span className="font-medium text-sm text-gray-900">{committee.committee_name}</span>
                          {committee.title && (
                            <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full">
                              {committee.title}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Subcommittees */}
                {committees && committees.subcommittees.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                      Subcommittees ({committees.subcommittees.length})
                    </h3>
                    <div className="space-y-2">
                      {visibleSubcommittees.map((sub, idx) => (
                        <div key={idx} className="p-2 bg-gray-50 rounded-lg">
                          <span className="font-medium text-sm text-gray-900">{sub.committee_name}</span>
                          {sub.title && (
                            <span className="ml-2 px-2 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full">
                              {sub.title}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    {committees.subcommittees.length > 5 && (
                      <button
                        onClick={() => setShowAllSubcommittees(!showAllSubcommittees)}
                        className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                      >
                        {showAllSubcommittees ? "Show fewer" : `Show all ${committees.subcommittees.length}`}
                      </button>
                    )}
                  </div>
                )}

                {/* External Links */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Research & Links</h3>
                  <div className="flex flex-wrap gap-2">
                    {legislator.external_ids?.govtrack && (
                      <a
                        href={`https://www.govtrack.us/congress/members/${legislator.external_ids.govtrack}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-sm hover:bg-indigo-200 transition-colors"
                      >
                        GovTrack
                      </a>
                    )}
                    {legislator.external_ids?.votesmart && (
                      <a
                        href={`https://justfacts.votesmart.org/candidate/${legislator.external_ids.votesmart}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-green-100 text-green-700 rounded-lg text-sm hover:bg-green-200 transition-colors"
                      >
                        VoteSmart
                      </a>
                    )}
                    {legislator.external_ids?.opensecrets && (
                      <a
                        href={`https://www.opensecrets.org/members-of-congress/summary?cid=${legislator.external_ids.opensecrets}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-sm hover:bg-amber-200 transition-colors"
                      >
                        OpenSecrets
                      </a>
                    )}
                    {legislator.external_ids?.wikipedia && (
                      <a
                        href={`https://en.wikipedia.org/wiki/${legislator.external_ids.wikipedia}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
                      >
                        Wikipedia
                      </a>
                    )}
                    <a
                      href={`https://www.congress.gov/member/${legislator.full_name.toLowerCase().replace(/[^a-z0-9]/g, '-')}/${legislator.bioguide_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors"
                    >
                      Congress.gov
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
