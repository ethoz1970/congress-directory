"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/AuthContext";
import { db } from "../../lib/firebase";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { useFavorites } from "../../lib/useFavorites";
import SlideOutPanel from "../components/SlideOutPanel";

interface Legislator {
  bioguide_id: string;
  full_name: string;
  party: string;
  state: string;
  chamber: string;
  district?: number;
  enacted_count?: number;
  first_term_start?: string;
  birthday?: string;
  ideology_score?: number;
  news_mentions?: number;
}

interface UserProfile {
  createdAt: Date | null;
  lastLogin: Date | null;
  displayName: string;
  email: string;
  photoURL: string | null;
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

function formatDate(date: Date | null): string {
  if (!date) return "N/A";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getTimeSince(date: Date | null): string {
  if (!date) return "N/A";
  
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins} minute${diffMins !== 1 ? "s" : ""}`;
    }
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""}`;
  } else if (diffDays < 30) {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""}`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months !== 1 ? "s" : ""}`;
  } else {
    const years = Math.floor(diffDays / 365);
    const remainingMonths = Math.floor((diffDays % 365) / 30);
    if (remainingMonths > 0) {
      return `${years} year${years !== 1 ? "s" : ""}, ${remainingMonths} month${remainingMonths !== 1 ? "s" : ""}`;
    }
    return `${years} year${years !== 1 ? "s" : ""}`;
  }
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

function calculateYearsInCongress(firstTermStart?: string): number {
  if (!firstTermStart) return 0;
  const start = new Date(firstTermStart);
  const today = new Date();
  return Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const router = useRouter();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [favoriteLegislators, setFavoriteLegislators] = useState<Legislator[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLegislator, setSelectedLegislator] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    
    if (!user) {
      router.push("/");
      return;
    }

    async function fetchProfileData() {
      try {
        setLoading(true);
        
        // Fetch user profile from Firestore
        const userDoc = await getDoc(doc(db, "users", user!.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserProfile({
            createdAt: data.createdAt?.toDate?.() || null,
            lastLogin: data.lastLogin?.toDate?.() || null,
            displayName: data.displayName || user!.displayName || "",
            email: data.email || user!.email || "",
            photoURL: data.photoURL || user!.photoURL || null,
          });
        }
        
        // Fetch all legislators to match with favorites
        const legislatorsSnapshot = await getDocs(collection(db, "legislators"));
        const allLegislators: Record<string, Legislator> = {};
        
        legislatorsSnapshot.forEach((doc) => {
          const data = doc.data();
          allLegislators[data.bioguide_id] = {
            bioguide_id: data.bioguide_id,
            full_name: data.full_name,
            party: data.party,
            state: data.state,
            chamber: data.chamber,
            district: data.district,
            enacted_count: data.enacted_count,
            first_term_start: data.first_term_start,
            birthday: data.birthday,
            ideology_score: data.ideology_score,
            news_mentions: data.news_mentions,
          };
        });
        
        // Match favorites with legislator data
        const favLegislators: Legislator[] = [];
        favorites.forEach((bioguideId) => {
          if (allLegislators[bioguideId]) {
            favLegislators.push(allLegislators[bioguideId]);
          }
        });
        
        // Sort by name
        favLegislators.sort((a, b) => a.full_name.localeCompare(b.full_name));
        setFavoriteLegislators(favLegislators);
        
      } catch (err) {
        console.error("Error fetching profile data:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchProfileData();
  }, [user, authLoading, router, favorites]);

  if (authLoading || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-xl text-gray-500">Loading...</p>
      </main>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">My Profile</h1>
            <button
              onClick={() => router.push("/")}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              ← Back to Directory
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Profile Card */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <div className="flex items-center gap-6">
            {userProfile?.photoURL ? (
              <img
                src={userProfile.photoURL}
                alt={userProfile.displayName}
                className="w-24 h-24 rounded-full"
              />
            ) : (
              <div className="w-24 h-24 rounded-full bg-blue-500 flex items-center justify-center text-white text-3xl font-bold">
                {userProfile?.displayName?.charAt(0) || userProfile?.email?.charAt(0) || "?"}
              </div>
            )}
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{userProfile?.displayName}</h2>
              <p className="text-gray-600">{userProfile?.email}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-500">
                <div>
                  <span className="font-medium">Joined:</span> {formatDate(userProfile?.createdAt || null)}
                </div>
                <div>
                  <span className="font-medium">Member for:</span> {getTimeSince(userProfile?.createdAt || null)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-4xl font-bold text-blue-600">{favorites.size}</p>
            <p className="text-gray-600">Favorites</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-4xl font-bold text-red-600">
              {favoriteLegislators.filter(l => l.party === "Republican").length}
            </p>
            <p className="text-gray-600">Republicans</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6 text-center">
            <p className="text-4xl font-bold text-blue-600">
              {favoriteLegislators.filter(l => l.party === "Democrat").length}
            </p>
            <p className="text-gray-600">Democrats</p>
          </div>
        </div>

        {/* Favorites Grid - Trading Cards */}
        <div className="mb-4">
          <h3 className="text-xl font-semibold text-gray-900">My Favorite Members</h3>
        </div>
        
        {favoriteLegislators.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            <p>You haven't favorited any members yet.</p>
            <button
              onClick={() => router.push("/")}
              className="mt-4 text-blue-600 hover:text-blue-800"
            >
              Browse members →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {favoriteLegislators.map((legislator) => (
              <div
                key={legislator.bioguide_id}
                className="relative rounded-xl shadow-lg overflow-hidden cursor-pointer transform transition-all duration-300 hover:scale-105 hover:shadow-2xl aspect-[3/4]"
                onClick={() => setSelectedLegislator(legislator.bioguide_id)}
              >
                {/* Full background image */}
                <img
                  src={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                  alt={legislator.full_name}
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "https://via.placeholder.com/300x400?text=No+Photo";
                  }}
                />
                
                {/* Party color bar at top */}
                <div className={`absolute top-0 left-0 right-0 h-2 ${
                  legislator.party === "Republican" 
                    ? "bg-red-600" 
                    : legislator.party === "Democrat"
                      ? "bg-blue-600"
                      : "bg-purple-600"
                }`} />
                
                {/* Chamber badge */}
                <div className={`absolute top-4 right-4 px-2 py-1 rounded text-xs font-bold text-white ${
                  legislator.chamber === "Senate" ? "bg-amber-600" : "bg-emerald-600"
                }`}>
                  {legislator.chamber === "Senate" ? "SEN" : "REP"}
                </div>
                
                {/* Favorite button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavorite(legislator.bioguide_id);
                  }}
                  className="absolute top-4 left-4 p-2 rounded-full bg-black/40 hover:bg-black/60 transition-colors"
                >
                  <svg
                    className="w-5 h-5 fill-red-500 stroke-red-500"
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
                
                {/* Gradient overlay for text readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                
                {/* Content overlay */}
                <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                  {/* Name and location */}
                  <h4 className="text-lg font-bold leading-tight mb-1">{legislator.full_name}</h4>
                  <p className="text-sm text-gray-300 mb-3">
                    {STATE_NAMES[legislator.state] || legislator.state}
                    {legislator.chamber === "House" && legislator.district !== undefined && 
                      ` • District ${legislator.district === 0 ? "At-Large" : legislator.district}`
                    }
                  </p>
                  
                  {/* Stats row */}
                  <div className="grid grid-cols-5 gap-1.5 text-center">
                    <div className="bg-black/40 rounded-lg py-2 px-1">
                      <div className="text-lg font-bold">{legislator.enacted_count || 0}</div>
                      <div className="text-[10px] text-gray-300 uppercase">Bills</div>
                    </div>
                    <div className="bg-black/40 rounded-lg py-2 px-1">
                      <div className="text-lg font-bold">{calculateYearsInCongress(legislator.first_term_start)}</div>
                      <div className="text-[10px] text-gray-300 uppercase">Years</div>
                    </div>
                    <div className="bg-black/40 rounded-lg py-2 px-1">
                      <div className="text-lg font-bold">{legislator.birthday ? calculateAge(legislator.birthday) : "—"}</div>
                      <div className="text-[10px] text-gray-300 uppercase">Age</div>
                    </div>
                    <div className="bg-black/40 rounded-lg py-2 px-1">
                      <div className="text-lg font-bold">{legislator.news_mentions ?? "—"}</div>
                      <div className="text-[10px] text-gray-300 uppercase">News</div>
                    </div>
                    <div className={`rounded-lg py-2 px-1 ${
                      legislator.ideology_score === undefined 
                        ? "bg-black/40"
                        : legislator.ideology_score < 0.35 
                          ? "bg-blue-600/80" 
                          : legislator.ideology_score > 0.65 
                            ? "bg-red-600/80" 
                            : "bg-purple-600/80"
                    }`}>
                      <div className="text-lg font-bold">
                        {legislator.ideology_score !== undefined 
                          ? legislator.ideology_score.toFixed(2)
                          : "—"
                        }
                      </div>
                      <div className="text-[10px] text-gray-300 uppercase">Ideo</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Slide-out Panel */}
      <SlideOutPanel
        bioguideId={selectedLegislator}
        onClose={() => setSelectedLegislator(null)}
      />
    </main>
  );
}
