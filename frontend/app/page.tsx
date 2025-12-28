"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { API_URL } from "../lib/api";
import SlideOutPanel from "./components/SlideOutPanel";
import UserMenu from "./components/UserMenu";
import { useFavorites } from "../lib/useFavorites";
import { useAuth } from "../lib/AuthContext";

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
  sponsored_count?: number;
  cosponsored_count?: number;
  enacted_count?: number;
  ideology_score?: number;
  leadership_score?: number;
}

interface Filters {
  chamber: string[];
  state: string[];
  party: string[];
  gender: string[];
  yearsInCongress: string[];
  billsEnacted: string[];
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

const BILLS_ENACTED_OPTIONS = [
  { key: "none", label: "No bills", min: 0, max: 0 },
  { key: "atLeast1", label: "At least 1 bill", min: 1 },
  { key: "moreThan5", label: "More than 5 bills", min: 6 },
  { key: "moreThan10", label: "More than 10 bills", min: 11 },
  { key: "moreThan25", label: "More than 25 bills", min: 26 },
];

const SORT_OPTIONS = [
  { key: "name", label: "Name" },
  { key: "age", label: "Age" },
  { key: "terms", label: "Terms Served" },
  { key: "years", label: "Time in Congress" },
  { key: "enacted", label: "Bills Enacted" },
  { key: "sponsored", label: "Bills Sponsored" },
  { key: "ideology", label: "Ideology" },
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

function getBillsEnactedBuckets(enactedCount?: number): string[] {
  const count = enactedCount || 0;
  const buckets: string[] = [];
  
  // Handle "none" case
  if (count === 0) {
    buckets.push("none");
    return buckets;
  }
  
  // Handle other cases (cumulative)
  for (const option of BILLS_ENACTED_OPTIONS) {
    if (option.key !== "none" && count >= option.min) {
      buckets.push(option.key);
    }
  }
  return buckets;
}

function getBillsTriangleColor(enactedCount?: number): string | null {
  const count = enactedCount || 0;
  if (count === 0) return null; // No triangle
  if (count >= 26) return "border-b-orange-500"; // 25+
  if (count >= 11) return "border-b-yellow-400"; // 10+
  if (count >= 6) return "border-b-gray-500"; // 5+
  return "border-b-gray-300"; // 1+
}

function HomeContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  
  const [legislators, setLegislators] = useState<Legislator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    chamber: [],
    state: [],
    party: [],
    gender: [],
    yearsInCongress: [],
    billsEnacted: [],
  });
  const [viewMode, setViewMode] = useState<"list" | "grid">("grid");
  const [gridSize, setGridSize] = useState<number>(2); // 1-4 scale, default 2
  const [selectedLegislator, setSelectedLegislator] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [heroVisible, setHeroVisible] = useState(true);
  const [heroSlide, setHeroSlide] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    sortSection: false,
    filtersSection: false,
    chamber: false,
    party: false,
    gender: false,
    yearsInCongress: false,
    billsEnacted: false,
    state: false,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [zipCode, setZipCode] = useState("");
  const [zipResults, setZipResults] = useState<Legislator[]>([]);
  const [zipLoading, setZipLoading] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  // Find Your Rep function
  const findYourRep = async () => {
    if (zipCode.length !== 5 || !/^\d+$/.test(zipCode)) {
      setZipError("Please enter a valid 5-digit zip code");
      return;
    }
    
    setZipLoading(true);
    setZipError(null);
    setZipResults([]);
    
    try {
      console.log(`Fetching: ${API_URL}/api/find-rep?zip=${zipCode}`);
      const response = await fetch(`${API_URL}/api/find-rep?zip=${zipCode}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("API Error:", response.status, errorText);
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log("API Response:", data);
      
      // Match bioguide_ids with our legislators
      const matchedBioguides = data.representatives.map((r: { bioguide_id: string }) => r.bioguide_id);
      const matched = legislators.filter(l => matchedBioguides.includes(l.bioguide_id));
      
      if (matched.length === 0 && data.raw_results?.length > 0) {
        // API returned results but we couldn't match them
        setZipError(`Found ${data.raw_results.length} reps but couldn't match to database`);
      } else if (matched.length === 0) {
        setZipError("No representatives found for this zip code");
      } else {
        setZipResults(matched);
      }
    } catch (err) {
      console.error("Find rep error:", err);
      setZipError("Error finding representatives. Please try again.");
    } finally {
      setZipLoading(false);
    }
  };

  // Hero slideshow data
  const heroSlides = [
    {
      title: "Explore Your Representatives",
      description: "Browse all 541 members of the U.S. Congress. Filter by party, state, chamber, and more.",
      image: "https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?w=1200&h=400&fit=crop",
    },
    {
      title: "Track Legislative Activity",
      description: "See bills sponsored, cosponsored, and signed into law. Live data from Congress.gov.",
      image: "https://images.unsplash.com/photo-1589262804704-c5aa9e6def89?w=1200&h=400&fit=crop",
    },
    {
      title: "Discover Ideology Scores",
      description: "Understand where members fall on the political spectrum with GovTrack ideology scores.",
      image: "https://images.unsplash.com/photo-1523995462485-3d171b5c8fa9?w=1200&h=400&fit=crop",
    },
    {
      title: "Save Your Favorites",
      description: "Sign in to save and track the representatives that matter most to you.",
      image: "https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=1200&h=400&fit=crop",
    },
  ];

  // Hero slideshow auto-advance
  useEffect(() => {
    if (!heroVisible || heroPaused) return;
    const timer = setInterval(() => {
      setHeroSlide((prev) => (prev + 1) % heroSlides.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [heroVisible, heroPaused, heroSlides.length]);

  // Initialize filters from URL on mount
  useEffect(() => {
    const chamber = searchParams.get("chamber")?.split(",").filter(Boolean) || [];
    const state = searchParams.get("state")?.split(",").filter(Boolean) || [];
    const party = searchParams.get("party")?.split(",").filter(Boolean) || [];
    const gender = searchParams.get("gender")?.split(",").filter(Boolean) || [];
    const yearsInCongress = searchParams.get("years")?.split(",").filter(Boolean) || [];
    const billsEnacted = searchParams.get("enacted")?.split(",").filter(Boolean) || [];
    
    setFilters({ chamber, state, party, gender, yearsInCongress, billsEnacted });
    
    // Check for member param to auto-open slide-out panel
    const member = searchParams.get("member");
    if (member) {
      setSelectedLegislator(member);
    }
  }, [searchParams]);

  // Update URL when filters change
  const updateURL = (newFilters: Filters) => {
    const params = new URLSearchParams();
    if (newFilters.chamber.length > 0) params.set("chamber", newFilters.chamber.join(","));
    if (newFilters.state.length > 0) params.set("state", newFilters.state.join(","));
    if (newFilters.party.length > 0) params.set("party", newFilters.party.join(","));
    if (newFilters.gender.length > 0) params.set("gender", newFilters.gender.join(","));
    if (newFilters.yearsInCongress.length > 0) params.set("years", newFilters.yearsInCongress.join(","));
    if (newFilters.billsEnacted.length > 0) params.set("enacted", newFilters.billsEnacted.join(","));
    
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
    let filtered = legislators.filter((legislator) => {
      const chamberMatch = filters.chamber.length === 0 || filters.chamber.includes(legislator.chamber);
      const stateMatch = filters.state.length === 0 || filters.state.includes(legislator.state);
      const partyMatch = filters.party.length === 0 || filters.party.includes(legislator.party);
      const genderMatch = filters.gender.length === 0 || filters.gender.includes(legislator.gender);
      const yearsMatch = filters.yearsInCongress.length === 0 || filters.yearsInCongress.includes(getYearsInCongressBucket(legislator.first_term_start));
      const billsMatch = filters.billsEnacted.length === 0 || filters.billsEnacted.some((bucket: string) => getBillsEnactedBuckets(legislator.enacted_count).includes(bucket));
      const favoritesMatch = !showFavoritesOnly || isFavorite(legislator.bioguide_id);
      return chamberMatch && stateMatch && partyMatch && genderMatch && yearsMatch && billsMatch && favoritesMatch;
    });

    // When sorting by ideology, exclude members without ideology scores
    if (sortBy === "ideology") {
      filtered = filtered.filter(l => l.ideology_score != null);
    }

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
        case "enacted":
          comparison = (b.enacted_count || 0) - (a.enacted_count || 0);
          break;
        case "sponsored":
          comparison = (b.sponsored_count || 0) - (a.sponsored_count || 0);
          break;
        case "ideology":
          // All members here have ideology scores (filtered above)
          comparison = a.ideology_score! - b.ideology_score!;
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
  }, [legislators, filters, sortBy, sortDirection, showFavoritesOnly, favorites]);

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
    const newFilters = { chamber: [], state: [], party: [], gender: [], yearsInCongress: [], billsEnacted: [] };
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
        if (key === "billsEnacted") {
          return values.some((bucket: string) => getBillsEnactedBuckets(legislator.enacted_count).includes(bucket));
        }
        return values.includes(legislator[key as keyof Legislator] as string);
      });
      if (passesOtherFilters) {
        if (filterType === "yearsInCongress") {
          const bucket = getYearsInCongressBucket(legislator.first_term_start);
          counts[bucket] = (counts[bucket] || 0) + 1;
        } else if (filterType === "billsEnacted") {
          const buckets = getBillsEnactedBuckets(legislator.enacted_count);
          buckets.forEach(bucket => {
            counts[bucket] = (counts[bucket] || 0) + 1;
          });
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
  const billsEnactedCounts = getCounts("billsEnacted");
  const hasActiveFilters = filters.chamber.length > 0 || filters.state.length > 0 || filters.party.length > 0 || filters.gender.length > 0 || filters.yearsInCongress.length > 0 || filters.billsEnacted.length > 0;

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
              <span>Filters {hasActiveFilters && `(${filters.chamber.length + filters.party.length + filters.gender.length + filters.state.length + filters.yearsInCongress.length + filters.billsEnacted.length})`}</span>
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

                {/* Bills Enacted Filter */}
                <div className="mb-4">
                  <button 
                    onClick={() => toggleCollapse('billsEnacted')}
                    className="flex items-center justify-between w-full font-medium text-gray-700 mb-2 hover:text-gray-900"
                  >
                    <span>Bills Enacted</span>
                    <span className={`text-gray-400 transition-transform duration-200 ${collapsed.billsEnacted ? '' : 'rotate-90'}`}>▶</span>
                  </button>
                  {!collapsed.billsEnacted && (
                    <div className="space-y-2 ml-2">
                      {BILLS_ENACTED_OPTIONS.map((option) => (
                        <label key={option.key} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={filters.billsEnacted.includes(option.key)}
                            onChange={() => toggleFilter("billsEnacted", option.key)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-700">{option.label}</span>
                          <span className="text-sm text-gray-400 ml-auto">
                            ({billsEnactedCounts[option.key] || 0})
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

      {/* Sticky Header */}
      <div className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
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
                        <div className="flex items-center gap-3">
              {user && (
                <button
                  onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    showFavoritesOnly
                      ? "bg-red-100 text-red-700"
                      : "bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <svg
                    className={`w-5 h-5 ${showFavoritesOnly ? "fill-red-500" : "fill-none stroke-current"}`}
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                    />
                  </svg>
                  {showFavoritesOnly ? "Showing Favorites" : "Favorites"}
                  {favorites.size > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                      showFavoritesOnly ? "bg-red-200" : "bg-gray-200"
                    }`}>
                      {favorites.size}
                    </span>
                  )}
                </button>
              )}
              <UserMenu />
            </div>
          </div>
        </div>
      </div>

      {/* Hero Slideshow */}
      {heroVisible && (
        <div className="relative bg-gray-900 overflow-hidden">
          {/* Slides */}
          <div className="relative h-48 sm:h-64 md:h-80">
            {heroSlides.map((slide, index) => (
              <div
                key={index}
                className={`absolute inset-0 transition-opacity duration-1000 ${
                  heroSlide === index ? "opacity-100" : "opacity-0"
                }`}
              >
                <img
                  src={slide.image}
                  alt={slide.title}
                  className="absolute inset-0 w-full h-full object-cover opacity-40"
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center px-6 max-w-3xl">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-3">
                      {slide.title}
                    </h2>
                    <p className="text-sm sm:text-base md:text-lg text-gray-200">
                      {slide.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-4">
            {/* Dots */}
            <div className="flex gap-2">
              {heroSlides.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setHeroSlide(index)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    heroSlide === index
                      ? "bg-white w-6"
                      : "bg-white/50 hover:bg-white/75"
                  }`}
                  aria-label={`Go to slide ${index + 1}`}
                />
              ))}
            </div>

            {/* Pause/Play */}
            <button
              onClick={() => setHeroPaused(!heroPaused)}
              className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              aria-label={heroPaused ? "Play slideshow" : "Pause slideshow"}
            >
              {heroPaused ? (
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              )}
            </button>
          </div>

          {/* Close button */}
          <button
            onClick={() => setHeroVisible(false)}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
            aria-label="Close hero"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div>
          {/* Find Your Rep */}
          <div className="mb-6 bg-white rounded-lg shadow p-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">📍</span>
                <span className="font-medium text-gray-700">Find Your Rep:</span>
              </div>
              <div className="flex flex-1 gap-2">
                <input
                  type="text"
                  placeholder="Enter zip code"
                  value={zipCode}
                  onChange={(e) => setZipCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  onKeyDown={(e) => e.key === "Enter" && findYourRep()}
                  className="flex-1 sm:flex-none sm:w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-gray-900"
                />
                <button
                  onClick={findYourRep}
                  disabled={zipLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400 transition-colors font-medium"
                >
                  {zipLoading ? "..." : "Go"}
                </button>
                {zipResults.length > 0 && (
                  <button
                    onClick={() => {
                      setZipResults([]);
                      setZipCode("");
                      setZipError(null);
                    }}
                    className="px-3 py-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            
            {zipError && (
              <p className="mt-2 text-sm text-red-600">{zipError}</p>
            )}
            
            {zipResults.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-gray-500 mb-3">Your representatives for zip code {zipCode}:</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {zipResults.map((legislator) => (
                    <div
                      key={legislator.bioguide_id}
                      onClick={() => setSelectedLegislator(legislator.bioguide_id)}
                      className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors border border-gray-200"
                    >
                      <img
                        src={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                        alt={legislator.full_name}
                        className="w-12 h-16 object-cover rounded bg-gray-200"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "https://via.placeholder.com/48x64?text=?";
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{legislator.full_name}</p>
                        <p className="text-sm text-gray-500">
                          {legislator.chamber === "Senate" ? "Senator" : `Rep. - District ${legislator.district}`}
                        </p>
                        <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium ${
                          legislator.party === "Republican" 
                            ? "bg-red-100 text-red-700" 
                            : legislator.party === "Democrat"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-purple-100 text-purple-700"
                        }`}>
                          {legislator.party}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

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
                      strokeDasharray={`${(filteredLegislators.length / (
                        filters.chamber.length === 1 
                          ? legislators.filter(l => l.chamber === filters.chamber[0]).length 
                          : legislators.length
                      )) * 100} 100`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-semibold text-gray-700">
                      {Math.round((filteredLegislators.length / (
                        filters.chamber.length === 1 
                          ? legislators.filter(l => l.chamber === filters.chamber[0]).length 
                          : legislators.length
                      )) * 100)}%
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-gray-600">
                    <span className="font-medium">{filteredLegislators.length}</span> of {
                      filters.chamber.length === 1 
                        ? legislators.filter(l => l.chamber === filters.chamber[0]).length 
                        : legislators.length
                    } {
                      filters.chamber.length === 1 
                        ? (filters.chamber[0] === "Senate" ? "senators" : "representatives")
                        : "members"
                    }
                    {hasActiveFilters && filters.chamber.length !== 1 && (
                      <span className="text-gray-400"> (filtered)</span>
                    )}
                    <span className="text-gray-400 mx-1">•</span>
                    <span className="text-sm">
                      sorted by <span className="font-medium">{SORT_OPTIONS.find(o => o.key === sortBy)?.label || sortBy}</span>
                      {sortDirection === "asc" ? " ↑" : " ↓"}
                    </span>
                  </div>
                  {hasActiveFilters && (
                    <div className="text-sm text-gray-500 mt-0.5">
                      {[
                        filters.party.length > 0 && filters.party.join(" & "),
                        filters.chamber.length > 0 && filters.chamber.map(c => c === "Senate" ? "Senators" : "Representatives").join(" & "),
                        filters.gender.length > 0 && filters.gender.map(g => g === "M" ? "Male" : g === "F" ? "Female" : g).join(" & "),
                        filters.state.length > 0 && (filters.state.length <= 2 ? filters.state.map(s => STATE_NAMES[s] || s).join(" & ") : `${filters.state.length} states`),
                        filters.yearsInCongress.length > 0 && YEARS_IN_CONGRESS_OPTIONS.filter(o => filters.yearsInCongress.includes(o.key)).map(o => o.label).join(" or "),
                        filters.billsEnacted.length > 0 && BILLS_ENACTED_OPTIONS.filter(o => filters.billsEnacted.includes(o.key)).map(o => o.label.toLowerCase()).join(" or "),
                      ].filter(Boolean).join(" • ")}
                    </div>
                  )}
                </div>
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
              
              {/* Grid Size Slider */}
              {viewMode === "grid" && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Size:</span>
                  <input
                    type="range"
                    min="1"
                    max="4"
                    value={gridSize}
                    onChange={(e) => setGridSize(Number(e.target.value))}
                    className="w-20 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <span className="text-xs text-gray-500 w-4">{gridSize}</span>
                </div>
              )}
            </div>

            {/* List View */}
            {viewMode === "list" && (
              <div className="space-y-4">
                {filteredLegislators.map((legislator) => (
                  <div
                    key={legislator.id}
                    className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow cursor-pointer relative"
                  >
                    {/* Favorite button */}
                    {user && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(legislator.bioguide_id);
                        }}
                        className="absolute top-2 right-2 p-2 rounded-full hover:bg-gray-100 transition-colors z-10"
                        aria-label={isFavorite(legislator.bioguide_id) ? "Remove from favorites" : "Add to favorites"}
                      >
                        <svg
                          className={`w-6 h-6 ${isFavorite(legislator.bioguide_id) ? "fill-red-500 stroke-red-500" : "fill-none stroke-gray-400 hover:stroke-red-400"}`}
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                          />
                        </svg>
                      </button>
                    )}
                    <div 
                      className="flex gap-4"
                      onClick={() => setSelectedLegislator(legislator.bioguide_id)}
                    >
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
                          <div className="flex gap-2 flex-shrink-0 mr-8">
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
              <div className={`grid gap-2 sm:gap-4 ${
                gridSize === 1 ? "grid-cols-2" :
                gridSize === 2 ? "grid-cols-3 md:grid-cols-4" :
                gridSize === 3 ? "grid-cols-4 md:grid-cols-6 lg:grid-cols-8" :
                gridSize === 4 ? "grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12" :
                "grid-cols-8 md:grid-cols-10 lg:grid-cols-12"
              }`}>
                {filteredLegislators.map((legislator) => (
                  <div
                    key={legislator.id}
                    className="relative rounded-lg shadow hover:shadow-lg transition-shadow overflow-hidden cursor-pointer aspect-[3/4]"
                  >
                    {/* Favorite button */}
                    {user && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(legislator.bioguide_id);
                        }}
                        className={`absolute top-1 left-1 rounded-full bg-black/30 hover:bg-black/50 transition-colors z-10 ${
                          gridSize >= 4 ? "p-0.5" : "p-1.5"
                        }`}
                        aria-label={isFavorite(legislator.bioguide_id) ? "Remove from favorites" : "Add to favorites"}
                      >
                        <svg
                          className={`${gridSize >= 4 ? "w-3 h-3" : "w-5 h-5"} ${isFavorite(legislator.bioguide_id) ? "fill-red-500 stroke-red-500" : "fill-none stroke-white hover:stroke-red-300"}`}
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                          />
                        </svg>
                      </button>
                    )}
                    
                    {/* Clickable area for opening panel */}
                    <div 
                      className="absolute inset-0"
                      onClick={() => setSelectedLegislator(legislator.bioguide_id)}
                    />
                    
                    {/* Full image background */}
                    <img
                      src={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                      alt={legislator.full_name}
                      className="absolute inset-0 w-full h-full object-cover bg-gray-200 pointer-events-none"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://via.placeholder.com/300x400?text=No+Photo";
                      }}
                    />
                    
                    {/* Party color triangle in upper right with chamber letter */}
                    <div 
                      className={`absolute top-0 right-0 w-0 h-0 border-l-transparent pointer-events-none ${
                        gridSize === 1 ? "border-t-[120px] border-l-[120px]" :
                        gridSize === 2 ? "border-t-[80px] border-l-[80px]" :
                        gridSize === 3 ? "border-t-[60px] border-l-[60px]" :
                        gridSize === 4 ? "border-t-[40px] border-l-[40px]" :
                        "border-t-[30px] border-l-[30px]"
                      } ${
                        legislator.party === "Republican" 
                          ? "border-t-red-600" 
                          : legislator.party === "Democrat" 
                            ? "border-t-blue-600" 
                            : "border-t-purple-600"
                      }`}
                    />
                    <span className={`absolute pointer-events-none text-white font-black ${
                      gridSize === 1 ? "top-2 right-3 text-3xl" :
                      gridSize === 2 ? "top-1 right-2 text-xl" :
                      gridSize === 3 ? "top-1 right-1.5 text-sm" :
                      gridSize === 4 ? "top-0.5 right-1 text-xs" :
                      "top-0 right-0.5 text-[8px]"
                    }`}>
                      {legislator.chamber === "Senate" ? "S" : "R"}
                    </span>
                    
                    {/* Bills enacted triangle in lower right with count */}
                    {getBillsTriangleColor(legislator.enacted_count) && (
                      <>
                        <div 
                          className={`absolute bottom-0 right-0 w-0 h-0 border-l-transparent pointer-events-none ${
                            gridSize === 1 ? "border-b-[120px] border-l-[120px]" :
                            gridSize === 2 ? "border-b-[80px] border-l-[80px]" :
                            gridSize === 3 ? "border-b-[60px] border-l-[60px]" :
                            gridSize === 4 ? "border-b-[40px] border-l-[40px]" :
                            "border-b-[30px] border-l-[30px]"
                          } ${getBillsTriangleColor(legislator.enacted_count)}`}
                        />
                        <span className={`absolute pointer-events-none text-white font-black drop-shadow-md ${
                          gridSize === 1 ? "bottom-2 right-3 text-3xl" :
                          gridSize === 2 ? "bottom-1 right-2 text-xl" :
                          gridSize === 3 ? "bottom-1 right-1.5 text-sm" :
                          gridSize === 4 ? "bottom-0.5 right-1 text-xs" :
                          "bottom-0 right-0.5 text-[8px]"
                        }`}>
                          {legislator.enacted_count}
                        </span>
                      </>
                    )}
                    
                    {/* Ideology indicator in bottom left */}
                    {legislator.ideology_score != null && gridSize <= 2 && (
                      <div className={`absolute bottom-2 left-2 rounded px-1.5 py-0.5 pointer-events-none ${
                        legislator.ideology_score < 0.35 
                          ? "bg-blue-600" 
                          : legislator.ideology_score > 0.65 
                            ? "bg-red-600" 
                            : "bg-purple-600"
                      }`}>
                        <span className={`font-bold text-white ${
                          gridSize === 1 ? "text-xs" : "text-[10px]"
                        }`}>
                          {legislator.ideology_score.toFixed(2)}
                        </span>
                      </div>
                    )}
                    
                    {/* Gradient overlay at bottom */}
                    <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pointer-events-none ${
                      gridSize === 1 ? "pt-16 pb-3 px-3" :
                      gridSize === 2 ? "pt-12 pb-2 px-2" :
                      gridSize === 3 ? "pt-8 pb-1.5 px-1.5" :
                      gridSize === 4 ? "pt-6 pb-1 px-1" :
                      "pt-4 pb-0.5 px-0.5"
                    }`}>
                      <h3 className={`font-semibold text-white truncate ${
                        gridSize === 1 ? "text-base" :
                        gridSize === 2 ? "text-sm" :
                        gridSize === 3 ? "text-xs" :
                        gridSize === 4 ? "text-[10px]" :
                        "text-[8px]"
                      }`}>{legislator.full_name}</h3>
                      {gridSize <= 3 && (
                        <p className={`text-gray-200 truncate ${
                          gridSize === 1 ? "text-sm" :
                          gridSize === 2 ? "text-xs" :
                          "text-[10px]"
                        }`}>{STATE_NAMES[legislator.state] || legislator.state}</p>
                      )}
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
