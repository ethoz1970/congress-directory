"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/AuthContext";
import { db } from "../../lib/firebase";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { useFavorites } from "../../lib/useFavorites";
import SlideOutPanel from "../components/SlideOutPanel";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://congress-api-370988201370.us-central1.run.app";

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
  news_sample_headlines?: Array<{
    title: string;
    source: string;
    date: string;
    url: string;
  }>;
  photo_url?: string;
  external_ids?: {
    youtube?: string;
    youtube_id?: string;
  };
}

interface YouTubeVideo {
  video_id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  published_at: string;
  legislator_name: string;
  legislator_id: string;
  party: string;
}

interface NewsItem {
  title: string;
  source: string;
  date: string;
  url: string;
  legislator_name: string;
  legislator_id: string;
  party: string;
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
  const [recentVideos, setRecentVideos] = useState<YouTubeVideo[]>([]);
  const [recentNews, setRecentNews] = useState<NewsItem[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(true);

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
            news_sample_headlines: data.news_sample_headlines,
            photo_url: data.photo_url,
            external_ids: data.external_ids,
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
        
        // Collect news from favorites
        const allNews: NewsItem[] = [];
        favLegislators.forEach((leg) => {
          if (leg.news_sample_headlines) {
            leg.news_sample_headlines.forEach((headline) => {
              allNews.push({
                ...headline,
                legislator_name: leg.full_name,
                legislator_id: leg.bioguide_id,
                party: leg.party,
              });
            });
          }
        });
        // Sort by date (newest first)
        allNews.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setRecentNews(allNews.slice(0, 20));
        
        // Fetch YouTube videos for favorites with channels
        const legislatorsWithYouTube = favLegislators.filter(
          (leg) => leg.external_ids?.youtube || leg.external_ids?.youtube_id
        );
        
        if (legislatorsWithYouTube.length > 0) {
          setUpdatesLoading(true);
          const videoPromises = legislatorsWithYouTube.slice(0, 10).map(async (leg) => {
            try {
              const res = await fetch(`${API_URL}/api/legislators/${leg.bioguide_id}/youtube-videos`);
              if (!res.ok) return [];
              const data = await res.json();
              return (data.videos || []).slice(0, 3).map((video: any) => ({
                ...video,
                legislator_name: leg.full_name,
                legislator_id: leg.bioguide_id,
                party: leg.party,
              }));
            } catch {
              return [];
            }
          });
          
          const videosArrays = await Promise.all(videoPromises);
          const allVideos = videosArrays.flat();
          // Sort by published date (newest first)
          allVideos.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
          setRecentVideos(allVideos.slice(0, 12));
          setUpdatesLoading(false);
        } else {
          setUpdatesLoading(false);
        }
        
      } catch (err) {
        console.error("Error fetching profile data:", err);
        setUpdatesLoading(false);
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

  function formatTimeAgo(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours === 0) return "Just now";
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else if (diffDays < 30) {
      return `${Math.floor(diffDays / 7)}w ago`;
    } else {
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
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

        {/* YouTube Videos Section */}
        {favorites.size > 0 && (
          <div className="bg-white rounded-lg shadow mb-8">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-600 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900">Latest Videos</h3>
              </div>
            </div>
            
            <div className="p-6">
              {updatesLoading ? (
                <div className="text-center py-8 text-gray-500">Loading videos...</div>
              ) : recentVideos.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No recent videos from your favorites
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {recentVideos.map((video) => (
                    <a
                      key={video.video_id}
                      href={`https://www.youtube.com/watch?v=${video.video_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block rounded-lg overflow-hidden bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <div className="relative aspect-video">
                        <img
                          src={video.thumbnail_url}
                          alt={video.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                          <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity">
                            <svg className="w-5 h-5 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        </div>
                      </div>
                      <div className="p-3">
                        <h4 className="text-sm font-medium text-gray-900 line-clamp-2 mb-1">
                          {video.title}
                        </h4>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span 
                            className="cursor-pointer hover:text-blue-600"
                            onClick={(e) => {
                              e.preventDefault();
                              setSelectedLegislator(video.legislator_id);
                            }}
                          >
                            <span className={`inline-block w-2 h-2 rounded-full mr-1 ${
                              video.party === "Republican" ? "bg-red-500" : 
                              video.party === "Democrat" ? "bg-blue-500" : "bg-purple-500"
                            }`} />
                            {video.legislator_name}
                          </span>
                          <span>{formatTimeAgo(video.published_at)}</span>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* News Headlines Section */}
        {favorites.size > 0 && recentNews.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-8">
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900">News Headlines</h3>
              </div>
            </div>
            
            <div className="p-6">
              <div className="space-y-3">
                {recentNews.map((news, idx) => (
                  <a
                    key={idx}
                    href={news.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-4 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <h4 className="text-sm font-medium text-gray-900 mb-2 line-clamp-2">
                      {news.title}
                    </h4>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <div className="flex items-center gap-3">
                        <span 
                          className="cursor-pointer hover:text-blue-600"
                          onClick={(e) => {
                            e.preventDefault();
                            setSelectedLegislator(news.legislator_id);
                          }}
                        >
                          <span className={`inline-block w-2 h-2 rounded-full mr-1 ${
                            news.party === "Republican" ? "bg-red-500" : 
                            news.party === "Democrat" ? "bg-blue-500" : "bg-purple-500"
                          }`} />
                          {news.legislator_name}
                        </span>
                        <span className="text-gray-400">•</span>
                        <span>{news.source}</span>
                      </div>
                      <span>{formatTimeAgo(news.date)}</span>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

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
                  src={legislator.photo_url || `https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                  alt={legislator.full_name}
                  className="absolute inset-0 w-full h-full object-cover"
                  referrerPolicy="no-referrer"
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
                  legislator.chamber === "Senate" ? "bg-amber-600" : legislator.chamber === "Governor" ? "bg-violet-600" : "bg-emerald-600"
                }`}>
                  {legislator.chamber === "Senate" ? "SEN" : legislator.chamber === "Governor" ? "GOV" : "REP"}
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
                    {legislator.chamber === "Governor"
                      ? `Governor of ${STATE_NAMES[legislator.state] || legislator.state}`
                      : STATE_NAMES[legislator.state] || legislator.state}
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
