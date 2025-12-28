"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_URL } from "../../../lib/api";
import Link from "next/link";

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

export default function MemberCardPage() {
  const params = useParams();
  const bioguideId = params.bioguide_id as string;
  
  const [legislator, setLegislator] = useState<Legislator | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!bioguideId) return;

    fetch(`${API_URL}/api/legislators/${bioguideId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Member not found");
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
  }, [bioguideId]);

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-900">
        <p className="text-xl text-gray-400">Loading...</p>
      </main>
    );
  }

  if (error || !legislator) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900">
        <p className="text-xl text-red-400 mb-4">Member not found</p>
        <Link href="/" className="text-blue-400 hover:text-blue-300">
          ← Back to Directory
        </Link>
      </main>
    );
  }

  return (
    <>
      {/* Dynamic meta tags for social sharing */}
      <head>
        <title>{legislator.full_name} | Congress Directory</title>
        <meta name="description" content={`${legislator.full_name} - ${legislator.party} ${legislator.chamber === "Senate" ? "Senator" : "Representative"} from ${STATE_NAMES[legislator.state]}`} />
        <meta property="og:title" content={`${legislator.full_name} | Congress Directory`} />
        <meta property="og:description" content={`${legislator.party} ${legislator.chamber === "Senate" ? "Senator" : "Representative"} from ${STATE_NAMES[legislator.state]}`} />
        <meta property="og:image" content={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`} />
        <meta property="og:type" content="profile" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${legislator.full_name} | Congress Directory`} />
        <meta name="twitter:description" content={`${legislator.party} ${legislator.chamber === "Senate" ? "Senator" : "Representative"} from ${STATE_NAMES[legislator.state]}`} />
        <meta name="twitter:image" content={`https://bioguide.congress.gov/bioguide/photo/${legislator.bioguide_id.charAt(0)}/${legislator.bioguide_id}.jpg`} />
      </head>

      <main className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
        {/* Trading Card */}
        <div className="relative rounded-xl shadow-2xl overflow-hidden w-full max-w-sm aspect-[3/4]">
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
          <div className={`absolute top-4 right-4 px-3 py-1.5 rounded text-sm font-bold text-white ${
            legislator.chamber === "Senate" ? "bg-amber-600" : "bg-emerald-600"
          }`}>
            {legislator.chamber === "Senate" ? "SENATOR" : "REPRESENTATIVE"}
          </div>
          
          {/* Party badge */}
          <div className={`absolute top-4 left-4 px-3 py-1.5 rounded text-sm font-bold text-white ${
            legislator.party === "Republican" 
              ? "bg-red-600" 
              : legislator.party === "Democrat"
                ? "bg-blue-600"
                : "bg-purple-600"
          }`}>
            {legislator.party === "Republican" ? "R" : legislator.party === "Democrat" ? "D" : "I"}
          </div>
          
          {/* Gradient overlay for text readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
          
          {/* Content overlay */}
          <div className="absolute inset-x-0 bottom-0 p-5 text-white">
            {/* Name and location */}
            <h1 className="text-2xl font-bold leading-tight mb-1">{legislator.full_name}</h1>
            <p className="text-base text-gray-300 mb-4">
              {STATE_NAMES[legislator.state] || legislator.state}
              {legislator.chamber === "House" && legislator.district !== undefined && 
                ` • District ${legislator.district === 0 ? "At-Large" : legislator.district}`
              }
            </p>
            
            {/* Stats row */}
            <div className="grid grid-cols-5 gap-1.5 text-center">
              <div className="bg-black/50 rounded-lg py-2 px-1">
                <div className="text-xl font-bold">{legislator.enacted_count || 0}</div>
                <div className="text-[10px] text-gray-300 uppercase tracking-wide">Bills</div>
              </div>
              <div className="bg-black/50 rounded-lg py-2 px-1">
                <div className="text-xl font-bold">{calculateYearsInCongress(legislator.first_term_start)}</div>
                <div className="text-[10px] text-gray-300 uppercase tracking-wide">Years</div>
              </div>
              <div className="bg-black/50 rounded-lg py-2 px-1">
                <div className="text-xl font-bold">{legislator.birthday ? calculateAge(legislator.birthday) : "—"}</div>
                <div className="text-[10px] text-gray-300 uppercase tracking-wide">Age</div>
              </div>
              <div className="bg-black/50 rounded-lg py-2 px-1">
                <div className="text-xl font-bold">{legislator.news_mentions ?? "—"}</div>
                <div className="text-[10px] text-gray-300 uppercase tracking-wide">News</div>
              </div>
              <div className={`rounded-lg py-2 px-1 ${
                legislator.ideology_score === undefined 
                  ? "bg-black/50"
                  : legislator.ideology_score < 0.35 
                    ? "bg-blue-600/80" 
                    : legislator.ideology_score > 0.65 
                      ? "bg-red-600/80" 
                      : "bg-purple-600/80"
              }`}>
                <div className="text-xl font-bold">
                  {legislator.ideology_score !== undefined 
                    ? legislator.ideology_score.toFixed(2)
                    : "—"
                  }
                </div>
                <div className="text-[10px] text-gray-300 uppercase tracking-wide">Ideo</div>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <button
            onClick={copyToClipboard}
            className="px-6 py-2.5 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share Link
              </>
            )}
          </button>
          <Link
            href={`/?member=${legislator.bioguide_id}`}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-center"
          >
            View Full Profile →
          </Link>
        </div>

        {/* Branding */}
        <p className="mt-8 text-gray-500 text-sm">
          <Link href="/" className="hover:text-gray-400">
            Congress Directory
          </Link>
        </p>
      </main>
    </>
  );
}
