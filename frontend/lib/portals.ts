// Portal taxonomy — mirrors feeder/feeder/topics.py PORTALS list.
// Keep in sync with the backend classifier. The Oracle stores the
// short ID in bills.portal_tag[]; this module is the canonical source
// of human-readable names and brand colors for the frontend.

export interface Portal {
  id: string;
  name: string;
  color: string;       // primary hex, matches topics.py
  accent: string;      // lighter accent tone used by PortalArt
  short: string;       // 1-2 word version for compact pills
}

export const PORTALS: Portal[] = [
  { id: "planet",   name: "Planet & Climate",        short: "Planet",   color: "#2d6a4f", accent: "#74c69d" },
  { id: "money",    name: "Money & Economy",         short: "Money",    color: "#0d6e4f", accent: "#52b788" },
  { id: "housing",  name: "Housing",                 short: "Housing",  color: "#8a4a1a", accent: "#d4a574" },
  { id: "health",   name: "Health",                  short: "Health",   color: "#8b2a3e", accent: "#e07a93" },
  { id: "tech",     name: "Tech & Platforms",        short: "Tech",     color: "#2a4a8b", accent: "#7a9be0" },
  { id: "edu",      name: "Education",               short: "Education", color: "#5e3a8b", accent: "#a685d6" },
  { id: "safety",   name: "Safety & Crime",          short: "Safety",   color: "#8b0a0a", accent: "#d65555" },
  { id: "culture",  name: "Media & Culture",         short: "Culture",  color: "#2a6a8b", accent: "#7ab6d6" },
  { id: "food",     name: "Food & Agriculture",      short: "Food",     color: "#7a5a1a", accent: "#d4b06a" },
  { id: "rights",   name: "Rights & Representation", short: "Rights",   color: "#6a1a6a", accent: "#c075c0" },
  { id: "military", name: "Military & Foreign",      short: "Military", color: "#3a4a2a", accent: "#8aa070" },
  { id: "shop",     name: "Consumer & Retail",       short: "Retail",   color: "#8b5a2a", accent: "#d4a880" },
];

const PORTAL_MAP: Record<string, Portal> = Object.fromEntries(
  PORTALS.map((p) => [p.id, p])
);

export function getPortal(id: string | undefined | null): Portal | null {
  if (!id) return null;
  return PORTAL_MAP[id] || null;
}

// First portal in a bill's portal_tag array — treated as the primary
// classification. Used to drive the PortalArt header on bill cards.
// Returns null when the bill has no tags.
export function primaryPortal(portalTags: string[] | undefined | null): Portal | null {
  if (!portalTags || portalTags.length === 0) return null;
  return getPortal(portalTags[0]);
}
