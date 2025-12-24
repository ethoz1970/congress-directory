"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { API_URL } from "../lib/api";
import SlideOutPanel from "./components/SlideOutPanel";

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
}

interface Filters {
  chamber: string[];
  state: string[];
  party: string[];
  gender: string[];
  yearsInCongress: string[];
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

const GENDER_LABELS: Record<string, string> = {
  M: "Male",
  F: "Female",
};

const PARTY_COLORS: Record<string, string> = {
  Democrat: "bg-blue-100 text-blue-800",
  Republican: "bg-red-100 text-red-800",
  Independent: "bg-purple-100 text-purple-800",
};

const CHAMBER_COLORS: Record<string, string> = {
  Senate: "bg-amber-100 text-amber-800",
  House: "bg-emerald-100 text-emerald-800",
};

const YEARS_IN_CONGRESS_OPTIONS = [
  { key: "under2", label: "Under 2 years", min: 0, max: 2 },
  { key: "under5", label: "2-5 years", min: 2, max: 5 },
  { key: "under10", label: "5-10 years", min: 5, max: 10 },
  { key: "under20", label: "10-20 years", min: 10, max: 20 },
  { key: "under30", label: "20-30 years", min: 20, max: 30 },
  { key: "under40", label: "30-40 years", min: 30, max: 40 },
  { key: "over40", label: "40+ years", min: 40, max: 999 },
];

const SORT_OPTIONS = [
  { key: "name", label: "Name" },
  { key: "age", label: "Age" },
  { key: "terms", label: "Terms Served" },
  { key: "years", label: "Time in Congress" },
  { key: "state", label: "State" },
];

function getYearsInCongress(firstTermStart?: string): number {
  if (!firstTermStart) return 0;
  const start = new Date(firstTermStart);
  const today = new Date();
  const years = (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return years;
}

function getYearsInCongressBucket(firstTermStart?: string): string {
  const years = getYearsInCongress(firstTermStart);
  for (const option of YEARS_IN_CONGRESS_OPTIONS) {
    if (years >= option.min && years < option.max) {
      return option.key;
    }
  }
  return "under2";
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  const [legislators, setLegislators] = useState<Legislator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    chamber: [],
    state: [],
    party: [],
    gender: [],
    yearsInCongress: [],
  });
  const [viewMode, setViewMode] = useState<"list" | "grid">("grid");
  const [selectedLegislator, setSelectedLegislator] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    sortSection: false,
    filtersSection: false,
    chamber: false,
    party: false,
    gender: false,
    yearsInCongress: false,
    state: false,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Initialize filters from URL on mount
  useEffect(() => {
    const chamber = searchParams.get("chamber")?.split(",").filter(Boolean) || [];
    const state = searchParams.get("state")?.split(",").filter(Boolean) || [];
    const party = searchParams.get("party")?.split(",").filter(Boolean) || [];
    const gender = searchParams.get("gender")?.split(",").filter(Boolean) || [];
    const yearsInCongress = searchParams.get("years")?.split(",").filter(Boolean) || [];
    
    setFilters({ chamber, state, party, gender, yearsInCongress });
  }, [searchParams]);

  // Update URL when filters change
  const updateURL = (newFilters: Filters) => {
    const params = new URLSearchParams();
    if (newFilters.chamber.length > 0) params.set("chamber", newFilters.chamber.join(","));
    if (newFilters.state.length > 0) params.set("state", newFilters.state.join(","));
    if (newFilters.party.length > 0) params.set("party", newFilters.party.join(","));
    if (newFilters.gender.length > 0) params.set("gender", newFilters.gender.join(","));
    if (newFilters.yearsInCongress.length > 0) params.set("years", newFilters.yearsInCongress.join(","));
    
    const queryString = params.toString();
    router.push(queryString ? `?${queryString}` : "/", { scroll: false });
  };

  const toggleCollapse = (section: string) => {
    setCollapsed(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Close filters on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && filtersOpen) setFiltersOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [filtersOpen]);

  // Prevent body scroll when filters open
  useEffect(() => {
    if (filtersOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [filtersOpen]);

  useEffect(() => {
    fetch(`${API_URL}/api/legislators`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch legislators");
        return res.json();
      })
      .then((data) => {
        setLegislators(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const filterOptions = useMemo(() => {
    const chambers = [...new Set(legislators.map((l) => l.chamber))].sort();
    const states = [...new Set(legislators.map((l) => l.state))].sort();
    const parties = [...new Set(legislators.map((l) => l.party))].sort();
    const genders = [...new Set(legislators.map((l) => l.gender))].sort();
    return { chambers, states, parties, genders };
  }, [legislators]);

  const filteredLegislators = useMemo(() => {
    const filtered = legislators.filter((legislator) => {
      const chamberMatch = filters.chamber.length === 0 || filters.chamber.includes(legislator.chamber);
      const stateMatch = filters.state.length === 0 || filters.state.includes(legislator.state);
      const partyMatch = filters.party.length === 0 || filters.party.includes(legislator.party);
      const genderMatch = filters.gender.length === 0 || filters.gender.includes(legislator.gender);
      const yearsMatch = filters.yearsInCongress.length === 0 || filters.yearsInCongress.includes(getYearsInCongressBucket(legislator.first_term_start));
      return chamberMatch && stateMatch && partyMatch && genderMatch && yearsMatch;
    });

    // Sort the filtered results
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case "name":
          comparison = a.last_name.localeCompare(b.last_name);
          break;
        case "age":
          const ageA = a.birthday ? new Date(a.birthday).getTime() : 0;
          const ageB = b.birthday ? new Date(b.birthday).getTime() : 0;
          comparison = ageA - ageB; // Earlier birthday = older
          break;
        case "terms":
          comparison = (b.total_terms || 1) - (a.total_terms || 1);
          break;
        case "years":
          const yearsA = getYearsInCongress(a.first_term_start);
          const yearsB = getYearsInCongress(b.first_term_start);
          comparison = yearsB - yearsA;
          break;
        case "state":
          comparison = a.state.localeCompare(b.state);
          break;
        default:
          comparison = 0;
      }
      
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [legislators, filters, sortBy, sortDirection]);

  const toggleFilter = (filterType: keyof Filters, value: string) => {
    const current = filters[filterType];
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    const newFilters = { ...filters, [filterType]: updated };
    setFilters(newFilters);
    updateURL(newFilters);
  };

  const clearFilters = () => {
    const newFilters = { chamber: [], state: [], party: [], gender: [], yearsInCongress: [] };
    setFilters(newFilters);
    updateURL(newFilters);
  };

  const getCounts = (filterType: keyof Filters) => {
    const counts: Record<string, number> = {};
    legislators.forEach((legislator) => {
      const passesOtherFilters = Object.entries(filters).every(([key, values]) => {
        if (key === filterType) return true;
        if (values.length === 0) return true;
        if (key === "yearsInCongress") {
          return values.includes(getYearsInCongressBucket(legislator.first_term_start));
        }
        return values.includes(legislator[key as keyof Legislator] as string);
      });
      if (passesOtherFilters) {
        if (filterType === "yearsInCongress") {
          const bucket = getYearsInCongressBucket(legislator.first_term_start);
          counts[bucket] = (counts[bucket] || 0) + 1;
        } else {
          const value = legislator[filterType as keyof Legislator] as string;
          counts[value] = (counts[value] || 0) + 1;
        }
      }
    });
    return counts;
  };

  const getSubtitle = (legislator: Legislator) => {
    if (legislator.chamber === "Senate") {
      return `${STATE_NAMES[legislator.state] || legislator.state} • ${legislator.state_rank || ""} Senator`;
    } else {
      const district = legislator.district === 0 ? "At-Large" : `District ${legislator.district}`;
      return `${STATE_NAMES[legislator.state] || legislator.state} • ${district}`;
    }
  };

  const getFilterDescription = () => {
    if (!hasActiveFilters) return "All Members of Congress";
    
    const parts: string[] = [];
    
    // Gender
    if (filters.gender.length === 1) {
      parts.push(filters.gender[0] === "F" ? "Female" : "Male");
    }
    
    // Party
    if (filters.party.length === 1) {
      parts.push(filters.party[0] === "Democrat" ? "Democratic" : filters.party[0]);
    } else if (filters.party.length > 1) {
      parts.push(filters.party.join(" & "));
    }
    
    // Chamber
    if (filters.chamber.length === 1) {
      parts.push(filters.chamber[0] === "Senate" ? "Senators" : "Representatives");
    } else {
      parts.push("Members");
    }
    
    // State
    if (filters.state.length === 1) {
      parts.push(`from ${STATE_NAMES[filters.state[0]] || filters.state[0]}`);
    } else if (filters.state.length > 1 && filters.state.length <= 3) {
      const stateNames = filters.state.map(s => STATE_NAMES[s] || s);
      parts.push(`from ${stateNames.join(", ")}`);
    } else if (filters.state.length > 3) {
      parts.push(`from ${filters.state.length} states`);
    }
    
    // Years in Congress
    if (filters.yearsInCongress.length === 1) {
      const option = YEARS_IN_CONGRESS_OPTIONS.find(o => o.key === filters.yearsInCongress[0]);
      if (option) {
        parts.push(`with ${option.label.toLowerCase()} in Congress`);
      }
    }
    
    return parts.join(" ") || "Filtered Members";
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-xl">Loading legislators...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-xl text-red-600">Error: {error}</p>
      </main>
    );
  }

  const chamberCounts = getCounts("chamber");
  const stateCounts = getCounts("state");
  const partyCounts = getCounts("party");
  const genderCounts = getCounts("gender");
  const yearsCounts = getCounts("yearsInCongress");
  const hasActiveFilters = filters.chamber.length > 0 || filters.state.length > 0 || filters.party.length > 0 || filters.gender.length > 0 || filters.yearsInCongress.length > 0;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Filter slide-out backdrop */}
      <div
        className={`fixed inset-0 bg-black transition-opacity duration-300 z-30 ${
          filtersOpen ? "opacity-50" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setFiltersOpen(false)}
      />

      {/* Filter slide-out panel */}
      <div
        className={`fixed top-0 left-0 h-full w-80 bg-white shadow-2xl z-40 transform transition-transform duration-300 ease-in-out overflow-y-auto ${
          filtersOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Options</h2>
            <button
              onClick={() => setFiltersOpen(false)}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full"
            >
              ✕
            </button>
          </div>

          {/* SORT BY - Main Collapsible Section */}
          <div className="mb-4">
            <button 
              onClick={() => toggleCollapse('sortSection')}
              className="flex items-center justify-between w-full p-3 bg-gray-100 rounded-lg font-semibold text-gray-800 hover:bg-gray-200"
            >
              <span>Sort By</span>
              <span className={`text-gray-500 transition-transform duration-200 ${collapsed.sortSection ? '' : 'rotate-90'}`}>▶</span>
            </button>
            {!collapsed.sortSection && (
              <div className="mt-2 ml-2 space-y-2">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => {
                      if (sortBy === option.key) {
                        setSortDirection(sortDirection === "asc" ? "desc" : "asc");
                      } else {
                        setSortBy(option.key);
                        setSortDirection("asc");
                      }
                    }}
                    className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                      sortBy === option.key
                        ? "bg-blue-100 text-blue-800"
                        : "hover:bg-gray-100 text-gray-700"
                    }`}
                  >
                    <span>{option.label}</span>
                    {sortBy === option.key && (
                      <span className="text-blue-600">
                        {sortDirection === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* FILTERS - Main Collapsible Section */}
          <div className="mb-4">
            <button 
              onClick={() => toggleCollapse('filtersSection')}
              className="flex items-center justify-between w-full p-3 bg-gray-100 rounded-lg font-semibold text-gray-800 hover:bg-gray-200"
            >
              <span>Filters {hasActiveFilters && `(${filters.chamber.length + filters.party.length + filters.gender.length + filters.state.length + filters.yearsInCongress.length})`}</span>
              <span className={`text-gray-500 transition-transform duration-200 ${collapsed.filtersSection ? '' : 'rotate-90'}`}>▶</span>
            </button>
            {!collapsed.filtersSection && (
              <div className="mt-2 ml-2">
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="text-sm text-blue-600 hover:text-blue-800 mb-4"
                  >
                    Clear all filters
                  </button>
                )}

                {/* Chamber Filter */}
                <div className="mb-4">
                  <button 
                    onClick={() => toggleCollapse('chamber')}
                    className="flex items-center justify-between w-full font-medium text-gray-700 mb-2 hover:text-gray-900"
                  >
                    <span>Chamber</span>
                    <span className={`text-gray-400 transition-transform duration-200 ${collapsed.chamber ? '' : 'rotate-90'}`}>▶</span>
                  </button>
                  {!collapsed.chamber && (
                    <div className="space-y-2 ml-2">
                      {filterOptions.chambers.map((chamber) => (
                        <label key={chamber} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.chamber.includes(chamber)}
                            onChange={() => toggleFilter("chamber", chamber)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">{chamber}</span>
                          <span className="text-sm text-gray-400 ml-auto">
                            ({chamberCounts[chamber] || 0})
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Party Filter */}
                <div className="mb-4">
                  <button 
                    onClick={() => toggleCollapse('party')}
                    className="flex items-center justify-between w-full font-medium text-gray-700 mb-2 hover:text-gray-900"
                  >
                    <span>Party</span>
                    <span className={`text-gray-400 transition-transform duration-200 ${collapsed.party ? '' : 'rotate-90'}`}>▶</span>
                  </button>
                  {!collapsed.party && (
                    <div className="space-y-2 ml-2">
                      {filterOptions.parties.map((party) => (
                        <label key={party} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.party.includes(party)}
                            onChange={() => toggleFilter("party", party)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">{party}</span>
                          <span className="text-sm text-gray-400 ml-auto">
                            ({partyCounts[party] || 0})
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Gender Filter */}
                <div className="mb-4">
                  <button 
                    onClick={() => toggleCollapse('gender')}
                    className="flex items-center justify-between w-full font-medium text-gray-700 mb-2 hover:text-gray-900"
                  >
                    <span>Gender</span>
                    <span className={`text-gray-400 transition-transform duration-200 ${collapsed.gender ? '' : 'rotate-90'}`}>▶</span>
                  </button>
                  {!collapsed.gender && (
                    <div className="space-y-2 ml-2">
                      {filterOptions.genders.map((gender) => (
                        <label key={gender} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.gender.includes(gender)}
                            onChange={() => toggleFilter("gender", gender)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">{GENDER_LABELS[gender] || gender}</span>
                          <span className="text-sm text-gray-400 ml-auto">
                            ({genderCounts[gender] || 0})
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Years in Congress Filter */}
                <div className="mb-4">
                  <button 
                    onClick={() => toggleCollapse('yearsInCongress')}
                    className="flex items-center justify-between w-full font-medium text-gray-700 mb-2 hover:text-gray-900"
                  >
                    <span>Years in Congress</span>
                    <span className={`text-gray-400 transition-transform duration-200 ${collapsed.yearsInCongress ? '' : 'rotate-90'}`}>▶</span>
                  </button>
                  {!collapsed.yearsInCongress && (
                    <div className="space-y-2 ml-2">
                      {YEARS_IN_CONGRESS_OPTIONS.map((option) => (
                        <label key={option.key} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.yearsInCongress.includes(option.key)}
                            onChange={() => toggleFilter("yearsInCongress", option.key)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">{option.label}</span>
                          <span className="text-sm text-gray-400 ml-auto">
                            ({yearsCounts[option.key] || 0})
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* State Filter */}
                <div className="mb-4">
                  <button 
                    onClick={() => toggleCollapse('state')}
                    className="flex items-center justify-between w-full font-medium text-gray-700 mb-2 hover:text-gray-900"
                  >
                    <span>State</span>
                    <span className={`text-gray-400 transition-transform duration-200 ${collapsed.state ? '' : 'rotate-90'}`}>▶</span>
                  </button>
                  {!collapsed.state && (
                    <div className="space-y-2 max-h-96 overflow-y-auto ml-2">
                      {filterOptions.states.map((state) => (
                        <label key={state} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.state.includes(state)}
                            onChange={() => toggleFilter("state", state)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">{STATE_NAMES[state] || state}</span>
                          <span className="text-sm text-gray-400 ml-auto">
                            ({stateCounts[state] || 0})
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          {/* Hamburger menu button */}
          <button
            onClick={() => setFiltersOpen(true)}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg"
            aria-label="Open filters"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Poly Sci Fi</h1>
            <p className="text-gray-600">
              {getFilterDescription()} 
              <span className="text-gray-400 ml-1">({filteredLegislators.length})</span>
            </p>
          </div>
        </div>

        <div>
          {/* Results */}
          <div className="flex-1">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* Mini pie chart */}
                <div className="relative w-12 h-12">
                  <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
                    {/* Background circle */}
                    <circle
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke="#e5e7eb"
                      strokeWidth="3"
                    />
                    {/* Filled portion */}
                    <circle
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="3"
                      strokeDasharray={`${(filteredLegislators.length / legislators.length) * 100} 100`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-semibold text-gray-700">
                      {Math.round((filteredLegislators.length / legislators.length) * 100)}%
                    </span>
                  </div>
                </div>
                <span className="text-gray-600">
                  Showing {filteredLegislators.length} of {legislators.length} members
                </span>
              </div>
              
              {/* View Toggle */}
              <div className="flex items-center gap-1 bg-white rounded-lg shadow px-1 py-1">
                <button
                  onClick={() => setViewMode("list")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === "list"
                      ? "bg-blue-600 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  List
                </button>
                <button
                  onClick={() => setViewMode("grid")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    viewMode === "grid"
                      ? "bg-blue-600 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Grid
                </button>
              </div>
            </div>

            {/* List View */}
            {viewMode === "list" && (
              <div className="space-y-4">
                {filteredLegislators.map((legislator) => (
                  <div
                    key={legislator.id}
                    onClick={() => setSelectedLegislator(legislator.bioguide_id)}
                    className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow cursor-pointer"
                  >
                    <div className="flex gap-4">
                      <div className="flex-shrink-0">
                        <img
                          src={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                          alt={legislator.full_name}
                          className="w-20 h-24 object-cover rounded bg-gray-200"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = "https://via.placeholder.com/80x96?text=No+Photo";
                          }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-lg font-semibold text-gray-900">
                              {legislator.full_name}
                            </h3>
                            <p className="text-gray-600">{getSubtitle(legislator)}</p>
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${CHAMBER_COLORS[legislator.chamber] || "bg-gray-100 text-gray-800"}`}>
                              {legislator.chamber}
                            </span>
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${PARTY_COLORS[legislator.party] || "bg-gray-100 text-gray-800"}`}>
                              {legislator.party}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-gray-500">
                          {legislator.phone && <span className="mr-4">📞 {legislator.phone}</span>}
                          {legislator.office && <span>🏛️ {legislator.office}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Grid View */}
            {viewMode === "grid" && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {filteredLegislators.map((legislator) => (
                  <div
                    key={legislator.id}
                    onClick={() => setSelectedLegislator(legislator.bioguide_id)}
                    className="relative rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden cursor-pointer aspect-[3/4]"
                  >
                    {/* Full image background */}
                    <img
                      src={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                      alt={legislator.full_name}
                      className="absolute inset-0 w-full h-full object-cover bg-gray-200"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://via.placeholder.com/300x400?text=No+Photo";
                      }}
                    />
                    
                    {/* Party color triangle in upper right with chamber letter */}
                    <div 
                      className={`absolute top-0 right-0 w-0 h-0 border-t-[60px] border-l-[60px] border-l-transparent ${
                        legislator.party === "Republican" 
                          ? "border-t-red-600" 
                          : legislator.party === "Democrat" 
                            ? "border-t-blue-600" 
                            : "border-t-purple-600"
                      }`}
                    />
                    <span className="absolute top-1 right-1 text-white text-xs font-bold">
                      {legislator.chamber === "Senate" ? "S" : "R"}
                    </span>
                    
                    {/* Gradient overlay at bottom */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-16 pb-3 px-3">
                      <h3 className="font-semibold text-white truncate">{legislator.full_name}</h3>
                      <p className="text-sm text-gray-200">{STATE_NAMES[legislator.state] || legislator.state}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {filteredLegislators.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                No members match your filters.
                <button
                  onClick={clearFilters}
                  className="block mx-auto mt-2 text-blue-600 hover:text-blue-800"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Slide-out Panel */}
      <SlideOutPanel
        bioguideId={selectedLegislator}
        onClose={() => setSelectedLegislator(null)}
      />
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-xl">Loading...</p></div>}>
      <HomeContent />
    </Suspense>
  );
}
