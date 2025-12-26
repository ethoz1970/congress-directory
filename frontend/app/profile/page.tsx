"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/AuthContext";
import { db } from "../../lib/firebase";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { useFavorites } from "../../lib/useFavorites";

interface Legislator {
  bioguide_id: string;
  full_name: string;
  party: string;
  state: string;
  chamber: string;
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

const PARTY_COLORS: Record<string, string> = {
  Democrat: "bg-blue-100 text-blue-800",
  Republican: "bg-red-100 text-red-800",
  Independent: "bg-purple-100 text-purple-800",
};

const CHAMBER_COLORS: Record<string, string> = {
  Senate: "bg-amber-100 text-amber-800",
  House: "bg-emerald-100 text-emerald-800",
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

export default function ProfilePage() {
  const { user, loading: authLoading } = useAuth();
  const { favorites, toggleFavorite } = useFavorites();
  const router = useRouter();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [favoriteLegislators, setFavoriteLegislators] = useState<Legislator[]>([]);
  const [loading, setLoading] = useState(true);

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
        <div className="max-w-4xl mx-auto px-4 py-6">
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

      <div className="max-w-4xl mx-auto px-4 py-8">
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

        {/* Favorites List */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-xl font-semibold text-gray-900">My Favorite Members</h3>
          </div>
          
          {favoriteLegislators.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>You haven't favorited any members yet.</p>
              <button
                onClick={() => router.push("/")}
                className="mt-4 text-blue-600 hover:text-blue-800"
              >
                Browse members →
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {favoriteLegislators.map((legislator) => (
                <div
                  key={legislator.bioguide_id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-gray-50"
                >
                  <div className="flex items-center gap-4">
                    <img
                      src={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                      alt={legislator.full_name}
                      className="w-12 h-14 object-cover rounded bg-gray-200"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "https://via.placeholder.com/48x56?text=?";
                      }}
                    />
                    <div>
                      <p className="font-medium text-gray-900">{legislator.full_name}</p>
                      <p className="text-sm text-gray-500">
                        {STATE_NAMES[legislator.state] || legislator.state}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${CHAMBER_COLORS[legislator.chamber]}`}>
                      {legislator.chamber}
                    </span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${PARTY_COLORS[legislator.party]}`}>
                      {legislator.party}
                    </span>
                    <button
                      onClick={() => toggleFavorite(legislator.bioguide_id)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-full transition-colors"
                      title="Remove from favorites"
                    >
                      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                        <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
