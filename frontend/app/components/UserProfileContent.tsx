"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../lib/AuthContext";
import { db } from "../../lib/firebase";
import { collection, getDocs, doc, getDoc } from "firebase/firestore";
import { useFavorites } from "../../lib/useFavorites";
import { cachedFetch, CACHE_TTL } from "../../lib/fetchCache";
import SlideOutPanel from "./SlideOutPanel";
import { useRouter } from "next/navigation";

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

interface CollapsibleSectionProps {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

function CollapsibleSection({ title, icon, children, defaultOpen = false }: CollapsibleSectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-6 py-4 flex items-center justify-between bg-white hover:bg-gray-50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    {icon}
                    <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
                </div>
                <svg
                    className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {isOpen && <div className="p-6 pt-0 border-t border-gray-100">{children}</div>}
        </div>
    );
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

export default function UserProfileContent({ onCloseMenu }: { onCloseMenu?: () => void }) {
    const { user, loading: authLoading } = useAuth();
    const { favorites, toggleFavorite } = useFavorites();
    const router = useRouter();

    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [favoriteLegislators, setFavoriteLegislators] = useState<Legislator[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedLegislator, setSelectedLegislator] = useState<string | null>(null);
    const [recentVideos, setRecentVideos] = useState<YouTubeVideo[]>([]);
    const [recentNews, setRecentNews] = useState<NewsItem[]>([]);
    const [updatesLoading, setUpdatesLoading] = useState(true);

    useEffect(() => {
        if (authLoading || !user) return;

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

                // Fetch all legislators via API to match with favorites
                const allLegislatorsArray = await cachedFetch<Legislator[]>(`${API_URL}/api/legislators`);
                const allLegislators: Record<string, Legislator> = {};

                allLegislatorsArray.forEach((data) => {
                    allLegislators[data.bioguide_id] = data;
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

                // Fetch YouTube videos for favorites with channels using batch endpoint
                const legislatorsWithYouTube = favLegislators.filter(
                    (leg) => leg.external_ids?.youtube || leg.external_ids?.youtube_id
                );

                if (legislatorsWithYouTube.length > 0) {
                    setUpdatesLoading(true);
                    try {
                        const ids = legislatorsWithYouTube.slice(0, 10).map(l => l.bioguide_id).join(",");
                        const batchData = await cachedFetch<Record<string, { videos?: Array<{ video_id: string; title: string; description: string; thumbnail_url: string; published_at: string }> }>>(
                            `${API_URL}/api/youtube-videos/batch?ids=${ids}`,
                            CACHE_TTL.YOUTUBE
                        );

                        const allVideos: YouTubeVideo[] = [];
                        for (const leg of legislatorsWithYouTube.slice(0, 10)) {
                            const entry = batchData[leg.bioguide_id];
                            if (entry?.videos) {
                                for (const video of entry.videos.slice(0, 3)) {
                                    allVideos.push({
                                        ...video,
                                        legislator_name: leg.full_name,
                                        legislator_id: leg.bioguide_id,
                                        party: leg.party,
                                    });
                                }
                            }
                        }
                        allVideos.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
                        setRecentVideos(allVideos.slice(0, 12));
                    } catch {
                        setRecentVideos([]);
                    }
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
    }, [user, authLoading, favorites]);

    if (authLoading || loading) {
        return (
            <div className="flex-1 flex justify-center py-12">
                <p className="text-gray-500">Loading your profile...</p>
            </div>
        );
    }

    if (!user) return null;

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
        <div className="flex-1 w-full bg-gray-50/50">
            {/* Profile Header & Stats */}
            <div className="px-6 py-8 md:px-8 border-b border-gray-100 bg-white">
                <div className="flex items-center gap-6 mb-8">
                    {userProfile?.photoURL ? (
                        <img
                            src={userProfile.photoURL}
                            alt={userProfile.displayName}
                            className="w-20 h-20 rounded-full border-4 border-gray-50 shadow-sm"
                        />
                    ) : (
                        <div className="w-20 h-20 rounded-full bg-blue-500 flex items-center justify-center text-white text-3xl font-bold border-4 border-gray-50 shadow-sm">
                            {userProfile?.displayName?.charAt(0) || userProfile?.email?.charAt(0) || "U"}
                        </div>
                    )}
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 leading-tight">{userProfile?.displayName}</h2>
                        <p className="text-gray-500">{userProfile?.email}</p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                            <span className="flex items-center gap-1.5">
                                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                Joined {formatDate(userProfile?.createdAt || null)}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Active for {getTimeSince(userProfile?.createdAt || null)}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                    <div className="bg-gray-50 rounded-xl p-4 text-center border border-gray-100/60">
                        <p className="text-3xl font-bold text-blue-600">{favorites.size}</p>
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mt-1">Favorites</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 text-center border border-gray-100/60">
                        <p className="text-3xl font-bold text-red-600">
                            {favoriteLegislators.filter(l => l.party === "Republican").length}
                        </p>
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mt-1">Republicans</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4 text-center border border-gray-100/60">
                        <p className="text-3xl font-bold text-blue-600">
                            {favoriteLegislators.filter(l => l.party === "Democrat").length}
                        </p>
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mt-1">Democrats</p>
                    </div>
                </div>
            </div>

            <div className="px-6 py-6 md:px-8 space-y-6">
                {/* Latest Videos Section */}
                {favorites.size > 0 && (
                    <CollapsibleSection
                        title="Latest Videos"
                        defaultOpen={recentVideos.length > 0}
                        icon={
                            <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                                <svg className="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                                </svg>
                            </div>
                        }
                    >
                        {updatesLoading ? (
                            <div className="text-center py-8 text-gray-500 text-sm">Loading videos...</div>
                        ) : recentVideos.length === 0 ? (
                            <div className="text-center py-8 text-gray-500 text-sm">
                                No recent videos from your favorites
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                                {recentVideos.map((video) => (
                                    <a
                                        key={video.video_id}
                                        href={`https://www.youtube.com/watch?v=${video.video_id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="group flex gap-3 rounded-lg overflow-hidden bg-gray-50 hover:bg-gray-100 transition-colors p-2"
                                    >
                                        <div className="relative w-24 h-16 rounded overflow-hidden flex-shrink-0">
                                            <img
                                                src={video.thumbnail_url}
                                                alt={video.title}
                                                className="w-full h-full object-cover"
                                            />
                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                                <svg className="w-5 h-5 text-white opacity-80 group-hover:opacity-100" fill="currentColor" viewBox="0 0 24 24">
                                                    <path d="M8 5v14l11-7z" />
                                                </svg>
                                            </div>
                                        </div>
                                        <div className="flex flex-col justify-center overflow-hidden">
                                            <h4 className="text-sm font-medium text-gray-900 line-clamp-2 mb-1 leading-snug">
                                                {video.title}
                                            </h4>
                                            <div className="flex items-center gap-1.5 text-xs text-gray-500">
                                                <span className={`inline-block w-1.5 h-1.5 rounded-full ${video.party === "Republican" ? "bg-red-500" :
                                                    video.party === "Democrat" ? "bg-blue-500" : "bg-purple-500"
                                                    }`} />
                                                <span className="truncate">{video.legislator_name}</span>
                                                <span>•</span>
                                                <span>{formatTimeAgo(video.published_at)}</span>
                                            </div>
                                        </div>
                                    </a>
                                ))}
                            </div>
                        )}
                    </CollapsibleSection>
                )}

                {/* News Headlines Section */}
                {favorites.size > 0 && recentNews.length > 0 && (
                    <CollapsibleSection
                        title="News Headlines"
                        defaultOpen={false}
                        icon={
                            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                                </svg>
                            </div>
                        }
                    >
                        <div className="space-y-2 mt-2">
                            {recentNews.map((news, idx) => (
                                <a
                                    key={idx}
                                    href={news.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block p-3 rounded-lg hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                                >
                                    <h4 className="text-sm font-medium text-gray-900 mb-1.5 leading-snug">
                                        {news.title}
                                    </h4>
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${news.party === "Republican" ? "bg-red-500" :
                                            news.party === "Democrat" ? "bg-blue-500" : "bg-purple-500"
                                            }`} />
                                        <span>{news.legislator_name}</span>
                                        <span>•</span>
                                        <span className="font-medium">{news.source}</span>
                                        <span>•</span>
                                        <span>{formatTimeAgo(news.date)}</span>
                                    </div>
                                </a>
                            ))}
                        </div>
                    </CollapsibleSection>
                )}

                {/* Favorite Members Grid */}
                <CollapsibleSection
                    title={`My Favorite Members (${favorites.size})`}
                    defaultOpen={true}
                    icon={
                        <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                            <svg className="w-4 h-4 text-red-500 fill-current" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                            </svg>
                        </div>
                    }
                >
                    {favoriteLegislators.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-gray-500 text-sm mb-3">You haven't favorited any members yet.</p>
                            <button
                                onClick={() => {
                                    if (onCloseMenu) onCloseMenu();
                                    router.push("/");
                                }}
                                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                            >
                                Browse members →
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                            {favoriteLegislators.map((legislator) => (
                                <div
                                    key={legislator.bioguide_id}
                                    className="flex items-center gap-4 p-3 rounded-xl border border-gray-100 bg-white hover:bg-gray-50 transition-colors shadow-sm cursor-pointer"
                                    onClick={() => setSelectedLegislator(legislator.bioguide_id)}
                                >
                                    <div className="relative w-12 h-12 rounded-full overflow-hidden flex-shrink-0 border-2 border-gray-50">
                                        <img
                                            src={legislator.photo_url || `https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                                            alt={legislator.full_name}
                                            className="w-full h-full object-cover"
                                            referrerPolicy="no-referrer"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).src = "https://via.placeholder.com/150?text=Photo";
                                            }}
                                        />
                                        <div className={`absolute bottom-0 inset-x-0 h-1.5 ${legislator.party === "Republican" ? "bg-red-500" : legislator.party === "Democrat" ? "bg-blue-500" : "bg-purple-500"}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-semibold text-gray-900 truncate">{legislator.full_name}</h4>
                                        <p className="text-xs text-gray-500 truncate">
                                            {legislator.chamber === "Governor"
                                                ? `Gov, ${legislator.state}`
                                                : `${legislator.chamber === "Senate" ? "Sen" : "Rep"}, ${legislator.state}`}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CollapsibleSection>
            </div>

            {/* Slide-out Panel for selected legislator */}
            <SlideOutPanel
                bioguideId={selectedLegislator}
                onClose={() => setSelectedLegislator(null)}
            />
        </div>
    );
}
