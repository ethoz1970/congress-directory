"use client";

import { useEffect, useState } from "react";
import { API_URL } from "../../lib/api";
import { useFavorites } from "../../lib/useFavorites";
import { useAuth } from "../../lib/AuthContext";

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
  ideology_score?: number;
  leadership_score?: number;
  sponsored_count?: number;
  cosponsored_count?: number;
  enacted_count?: number;
  news_mentions?: number;
  news_sample_headlines?: Array<{
    title: string;
    source: string;
    date: string;
    url: string;
  }>;
  external_ids: {
    thomas?: string;
    govtrack?: number;
    opensecrets?: string;
    votesmart?: number;
    wikipedia?: string;
    ballotpedia?: string;
    twitter?: string;
    youtube?: string;
    youtube_id?: string;
    facebook?: string;
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

interface YouTubeVideo {
  video_id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  published_at: string;
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

export default function SlideOutPanel({ bioguideId, onClose }: SlideOutPanelProps) {
  const { user } = useAuth();
  const { toggleFavorite, isFavorite } = useFavorites();
  const [legislator, setLegislator] = useState<Legislator | null>(null);
  const [committees, setCommittees] = useState<CommitteesData | null>(null);
  const [youtubeVideos, setYoutubeVideos] = useState<YouTubeVideo[]>([]);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllSubcommittees, setShowAllSubcommittees] = useState(false);

  const isOpen = bioguideId !== null;

  useEffect(() => {
    if (!bioguideId) {
      setLegislator(null);
      setCommittees(null);
      setYoutubeVideos([]);
      setSelectedVideo(null);
      return;
    }

    setLoading(true);
    setYoutubeLoading(true);
    setError(null);
    setShowAllSubcommittees(false);
    setSelectedVideo(null);

    fetch(`${API_URL}/api/legislators/${bioguideId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Legislator not found");
        return res.json();
      })
      .then((data) => {
        setLegislator(data);
        setLoading(false);
        
        // Fetch YouTube videos if they have a channel
        if (data.external_ids?.youtube || data.external_ids?.youtube_id) {
          fetch(`${API_URL}/api/legislators/${bioguideId}/youtube-videos`)
            .then((res) => res.json())
            .then((videos) => {
              setYoutubeVideos(videos.videos || []);
              setYoutubeLoading(false);
            })
            .catch(() => {
              setYoutubeVideos([]);
              setYoutubeLoading(false);
            });
        } else {
          setYoutubeVideos([]);
          setYoutubeLoading(false);
        }
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
        setYoutubeLoading(false);
      });

    fetch(`${API_URL}/api/legislators/${bioguideId}/committees`)
      .then((res) => res.json())
      .then((data) => {
        setCommittees(data);
      })
      .catch(() => {
        setCommittees(null);
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
        className={`fixed top-0 right-0 h-full w-full sm:max-w-2xl bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Color strip at very top - above everything */}
        {legislator && (
          <div className={`absolute top-0 left-0 right-0 h-2 z-[101] ${
            legislator.party === "Republican" 
              ? "bg-gradient-to-r from-red-500 to-red-600"
              : legislator.party === "Democrat"
                ? "bg-gradient-to-r from-blue-500 to-blue-600"
                : "bg-gradient-to-r from-purple-500 to-purple-600"
          }`} />
        )}
        
        {/* Top action buttons - fixed position within panel */}
        <div className="fixed top-4 right-4 sm:absolute flex items-center gap-2 z-[100]">
          {/* Share Card button */}
          {legislator && (
            <a
              href={`/card/${legislator.bioguide_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 flex items-center justify-center bg-white text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-full shadow-lg border border-gray-200 transition-colors"
              title="Share Card"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
            </a>
          )}
          {/* Close button */}
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full shadow-lg border border-gray-200 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

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
              {/* Small color strip at very top */}
              <div className={`h-3 ${
                legislator.party === "Republican" 
                  ? "bg-gradient-to-r from-red-600 to-red-700"
                  : legislator.party === "Democrat"
                    ? "bg-gradient-to-r from-blue-600 to-blue-700"
                    : "bg-gradient-to-r from-purple-600 to-purple-700"
              }`} />
              
              {/* Header with photo */}
              <div className="px-4 sm:px-6 pb-4 pt-16">
                {/* Mobile: Stack photo and info | Desktop: Side by side */}
                <div className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-5">
                  <img
                    src={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`}
                    alt={legislator.full_name}
                    className="w-32 h-40 sm:w-48 sm:h-60 object-cover rounded-lg border-2 border-gray-200 shadow-lg bg-gray-200 flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "https://via.placeholder.com/192x240?text=No+Photo";
                    }}
                  />
                  <div className="flex-1">
                    {/* Tags */}
                    <div className="flex flex-wrap gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        legislator.party === "Republican" 
                          ? "bg-red-100 text-red-700"
                          : legislator.party === "Democrat"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-purple-100 text-purple-700"
                      }`}>
                        {legislator.party}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        legislator.chamber === "Senate" 
                          ? "bg-amber-100 text-amber-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}>
                        {legislator.chamber}
                      </span>
                    </div>
                    
                    {/* Name and favorite */}
                    <div className="flex items-center gap-2 sm:gap-3 mb-1">
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-900">
                        {legislator.full_name}
                      </h2>
                      {user && (
                        <button
                          onClick={() => toggleFavorite(legislator.bioguide_id)}
                          className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
                          aria-label={isFavorite(legislator.bioguide_id) ? "Remove from favorites" : "Add to favorites"}
                        >
                          <svg
                            className={`w-5 h-5 sm:w-6 sm:h-6 ${isFavorite(legislator.bioguide_id) ? "fill-red-500 stroke-red-500" : "fill-none stroke-gray-400"}`}
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
                    </div>
                    
                    {/* Position */}
                    <p className="text-sm sm:text-base text-gray-600">{position}</p>
                    
                    {/* Age and Term Ends */}
                    <p className="text-sm text-gray-500 mb-3">
                      {legislator.birthday && <span>{calculateAge(legislator.birthday)} years old</span>}
                      {legislator.birthday && legislator.term_end && <span> · </span>}
                      {legislator.term_end && <span>Term ends {formatDate(legislator.term_end)}</span>}
                    </p>
                    
                    {/* Contact info */}
                    <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm">
                      {legislator.phone && (
                        <a href={`tel:${legislator.phone}`} className="flex items-center gap-1.5 text-gray-600 hover:text-blue-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          {legislator.phone}
                        </a>
                      )}
                      {legislator.office && (
                        <span className="flex items-center gap-1.5 text-gray-500">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {legislator.office}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm mt-2">
                      {legislator.website && (
                        <a href={legislator.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                          </svg>
                          Website
                        </a>
                      )}
                      {legislator.contact_form && (
                        <a href={legislator.contact_form} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          Contact Form
                        </a>
                      )}
                    </div>
                    
                    {/* Quick stats row */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 pt-4 border-t border-gray-200 text-sm">
                      <div>
                        <span className="text-gray-500">{legislator.chamber === "Senate" ? "Class:" : "District:"}</span>{" "}
                        <span className="font-medium text-gray-900">
                          {legislator.chamber === "Senate" 
                            ? legislator.senate_class 
                            : legislator.district === 0 ? "At-Large" : legislator.district}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Terms:</span>{" "}
                        <span className="font-medium text-gray-900">{formatTermCount(legislator)}</span>
                      </div>
                      {legislator.first_term_start && (
                        <div>
                          <span className="text-gray-500">Years:</span>{" "}
                          <span className="font-medium text-gray-900">{calculateYearsOfService(legislator.first_term_start)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Details */}
              <div className="px-4 sm:px-6 pb-6 space-y-4 sm:space-y-6">

                {/* Ideology Score */}
                {legislator.ideology_score !== undefined && legislator.ideology_score !== null && (
                  <div className="bg-gray-50 rounded-lg p-4">
                    {/* Ideology spectrum bar */}
                    <div className="relative h-3 rounded-full bg-gradient-to-r from-blue-600 via-purple-400 to-red-600 mb-2">
                      {/* Marker for this legislator */}
                      <div 
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-2 border-gray-800 rounded-full shadow-lg"
                        style={{ 
                          left: `${Math.min(Math.max(legislator.ideology_score * 100, 2), 98)}%`,
                          transform: 'translate(-50%, -50%)'
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mb-2">
                      <span>← Progressive</span>
                      <span>Conservative →</span>
                    </div>
                    <div className="flex items-center justify-center gap-6">
                      <div className="text-center">
                        <span className="text-lg font-bold text-gray-900">
                          {legislator.ideology_score.toFixed(2)}
                        </span>
                        <span className="text-xs text-gray-500 ml-1">ideology</span>
                      </div>
                      {legislator.leadership_score !== undefined && (
                        <div className="text-center border-l border-gray-300 pl-6">
                          <span className="text-lg font-bold text-gray-900">
                            {legislator.leadership_score.toFixed(2)}
                          </span>
                          <span className="text-xs text-gray-500 ml-1">leadership</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Legislative Activity */}
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 sm:mb-3">
                    Legislative Activity
                  </h3>
                  
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className="bg-blue-50 rounded-lg p-2 sm:p-3 text-center">
                      <div className="text-xl sm:text-2xl font-bold text-blue-700">{legislator.sponsored_count || 0}</div>
                      <div className="text-xs text-blue-600">Sponsored</div>
                    </div>
                    <div className="bg-green-50 rounded-lg p-2 sm:p-3 text-center">
                      <div className="text-xl sm:text-2xl font-bold text-green-700">{legislator.cosponsored_count || 0}</div>
                      <div className="text-xs text-green-600">Cosponsored</div>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2 sm:p-3 text-center">
                      <div className="text-xl sm:text-2xl font-bold text-amber-700">{legislator.enacted_count || 0}</div>
                      <div className="text-xs text-amber-600">Signed into Law</div>
                    </div>
                  </div>
                </div>

                {/* News Mentions */}
                {legislator.news_mentions !== undefined && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 sm:mb-3">
                      Media Presence
                      <span className="ml-2 text-xs font-normal normal-case bg-gray-100 px-2 py-0.5 rounded">
                        Last 30 days
                      </span>
                    </h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-3xl font-bold text-gray-900">{legislator.news_mentions}</div>
                          <div className="text-xs text-gray-500">News Articles</div>
                        </div>
                        {legislator.news_sample_headlines && legislator.news_sample_headlines.length > 0 && (
                          <div className="flex-1 border-l border-gray-200 pl-4">
                            <div className="text-xs text-gray-500 mb-1">Recent Headlines</div>
                            <div className="space-y-1">
                              {legislator.news_sample_headlines.slice(0, 2).map((headline: { title: string; source: string; url: string }, idx: number) => (
                                <a 
                                  key={idx}
                                  href={headline.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block text-xs text-blue-600 hover:text-blue-800 truncate"
                                  title={headline.title}
                                >
                                  {headline.source}: {headline.title}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

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

                {/* Social Media */}
                {(legislator.external_ids?.twitter || legislator.external_ids?.youtube || legislator.external_ids?.facebook) && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Social Media</h3>
                    <div className="flex flex-wrap gap-2">
                      {legislator.external_ids?.twitter && (
                        <a
                          href={`https://twitter.com/${legislator.external_ids.twitter}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-sky-100 text-sky-700 rounded-lg text-sm hover:bg-sky-200 transition-colors"
                        >
                          𝕏 / Twitter
                        </a>
                      )}
                      {legislator.external_ids?.youtube && (
                        <a
                          href={`https://www.youtube.com/${legislator.external_ids.youtube}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm hover:bg-red-200 transition-colors"
                        >
                          YouTube
                        </a>
                      )}
                      {legislator.external_ids?.facebook && (
                        <a
                          href={`https://www.facebook.com/${legislator.external_ids.facebook}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200 transition-colors"
                        >
                          Facebook
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* YouTube Videos */}
                {(youtubeLoading || youtubeVideos.length > 0) && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Recent Videos</h3>
                    {youtubeLoading ? (
                      <p className="text-sm text-gray-400">Loading videos...</p>
                    ) : (
                      <div className="space-y-3">
                        {/* Video Embed */}
                        {selectedVideo && (
                          <div className="mb-4">
                            <div className="relative pb-[56.25%] h-0 overflow-hidden rounded-lg">
                              <iframe
                                className="absolute top-0 left-0 w-full h-full"
                                src={`https://www.youtube.com/embed/${selectedVideo}`}
                                title="YouTube video player"
                                frameBorder="0"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                              />
                            </div>
                            <button
                              onClick={() => setSelectedVideo(null)}
                              className="mt-2 text-sm text-gray-500 hover:text-gray-700"
                            >
                              ✕ Close video
                            </button>
                          </div>
                        )}
                        
                        {/* Video Thumbnails */}
                        {youtubeVideos.map((video) => (
                          <div
                            key={video.video_id}
                            className={`flex gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                              selectedVideo === video.video_id
                                ? "bg-red-50 border border-red-200"
                                : "hover:bg-gray-50"
                            }`}
                            onClick={() => setSelectedVideo(video.video_id)}
                          >
                            <img
                              src={video.thumbnail_url}
                              alt={video.title}
                              className="w-32 h-20 object-cover rounded flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-medium text-gray-900 line-clamp-2">
                                {video.title}
                              </h4>
                              <p className="text-xs text-gray-500 mt-1">
                                {new Date(video.published_at).toLocaleDateString()}
                              </p>
                              <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                                {video.description}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
