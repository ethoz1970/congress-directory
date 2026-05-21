// PortalArt — 12 abstract SVG headers (+ a neutral default) for bill
// cards. Each takes the portal's brand color + a lighter accent from
// portals.ts and composes a distinct geometric motif. Full-bleed,
// viewBox 400x120 (≈10:3 banner). The component uses preserveAspectRatio
// "xMidYMid slice" via the wrapping div so it crops cleanly at any
// aspect when stretched.

import { getPortal, Portal } from "./portals";

interface PortalArtProps {
  portalId: string | null | undefined;
  className?: string;
}

const VIEW_W = 400;
const VIEW_H = 120;

function frame(children: React.ReactNode, bg: string, className?: string) {
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid slice"
      className={className}
      style={{ display: "block", width: "100%", height: "100%", background: bg }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

// ============ Individual motifs ============

function PlanetArt({ p }: { p: Portal }) {
  // Horizon + rising orb + layered organic curves
  return frame(
    <>
      <defs>
        <linearGradient id="planet-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.color} />
          <stop offset="100%" stopColor={p.accent} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect width={VIEW_W} height={VIEW_H} fill="url(#planet-sky)" />
      <circle cx="300" cy="80" r="55" fill={p.accent} opacity="0.85" />
      <path d={`M0 90 Q 100 60 200 95 T 400 85 L 400 120 L 0 120 Z`} fill={p.color} opacity="0.7" />
      <path d={`M0 105 Q 120 85 240 110 T 400 100 L 400 120 L 0 120 Z`} fill="#0b3a2a" opacity="0.55" />
    </>,
    p.color
  );
}

function MoneyArt({ p }: { p: Portal }) {
  // Ascending bar chart with subtle grid lines
  const bars = [50, 30, 70, 45, 85, 60, 95, 75, 100];
  const barW = VIEW_W / (bars.length * 1.5);
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      {[20, 40, 60, 80, 100].map((y) => (
        <line key={y} x1="0" y1={y} x2={VIEW_W} y2={y} stroke="#ffffff" strokeWidth="0.5" opacity="0.08" />
      ))}
      {bars.map((h, i) => (
        <rect
          key={i}
          x={20 + i * (barW * 1.5)}
          y={VIEW_H - h}
          width={barW}
          height={h}
          fill={p.accent}
          opacity={0.5 + i * 0.05}
        />
      ))}
    </>,
    p.color
  );
}

function HousingArt({ p }: { p: Portal }) {
  // Layered rooflines / skyline of triangles + rectangles
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      <polygon points="0,120 60,40 120,120" fill={p.accent} opacity="0.8" />
      <polygon points="80,120 140,55 200,120" fill={p.accent} opacity="0.65" />
      <polygon points="170,120 240,30 310,120" fill={p.accent} opacity="0.9" />
      <polygon points="280,120 340,60 400,120" fill={p.accent} opacity="0.7" />
      <rect x="40" y="80" width="20" height="40" fill="#3a1f0d" opacity="0.5" />
      <rect x="160" y="85" width="20" height="35" fill="#3a1f0d" opacity="0.5" />
      <rect x="220" y="70" width="22" height="50" fill="#3a1f0d" opacity="0.5" />
      <rect x="310" y="85" width="20" height="35" fill="#3a1f0d" opacity="0.5" />
    </>,
    p.color
  );
}

function HealthArt({ p }: { p: Portal }) {
  // Pulse line crossing overlapping cell circles
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      <circle cx="80" cy="40" r="35" fill={p.accent} opacity="0.5" />
      <circle cx="140" cy="80" r="28" fill={p.accent} opacity="0.45" />
      <circle cx="310" cy="50" r="40" fill={p.accent} opacity="0.55" />
      <circle cx="360" cy="90" r="22" fill={p.accent} opacity="0.4" />
      <path
        d="M0 60 L 100 60 L 120 30 L 140 90 L 160 20 L 180 60 L 400 60"
        stroke="#ffffff"
        strokeWidth="3"
        fill="none"
        opacity="0.95"
      />
    </>,
    p.color
  );
}

function TechArt({ p }: { p: Portal }) {
  // Networked nodes — circles connected by lines, circuit-board feel
  const nodes = [
    [50, 40], [130, 70], [180, 30], [240, 80], [300, 35], [360, 75],
    [90, 95], [220, 20], [350, 25],
  ] as const;
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      {nodes.map(([x1, y1], i) =>
        nodes.slice(i + 1).map(([x2, y2], j) => {
          const dist = Math.hypot(x2 - x1, y2 - y1);
          if (dist > 90) return null;
          return (
            <line
              key={`${i}-${j}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={p.accent}
              strokeWidth="1"
              opacity="0.45"
            />
          );
        })
      )}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 6 : 4} fill={p.accent} opacity="0.95" />
      ))}
    </>,
    p.color
  );
}

function EduArt({ p }: { p: Portal }) {
  // Stacked book spines with one open at center
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={i}
          x={20 + i * 20}
          y={30 + (i % 2) * 8}
          width="14"
          height={70 - (i % 2) * 8}
          fill={p.accent}
          opacity={0.5 + i * 0.08}
        />
      ))}
      {/* open book at center */}
      <polygon points="180,40 200,30 200,100 180,90" fill={p.accent} opacity="0.95" />
      <polygon points="200,30 220,40 220,90 200,100" fill="#ffffff" opacity="0.95" />
      <line x1="200" y1="30" x2="200" y2="100" stroke={p.color} strokeWidth="1.5" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect
          key={`r${i}`}
          x={250 + i * 20}
          y={30 + (i % 2) * 12}
          width="14"
          height={70 - (i % 2) * 12}
          fill={p.accent}
          opacity={0.8 - i * 0.1}
        />
      ))}
    </>,
    p.color
  );
}

function SafetyArt({ p }: { p: Portal }) {
  // Single bold shield silhouette + light from above
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      <defs>
        <radialGradient id="safety-glow" cx="0.5" cy="0" r="0.8">
          <stop offset="0%" stopColor={p.accent} stopOpacity="0.5" />
          <stop offset="100%" stopColor={p.accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={VIEW_W} height={VIEW_H} fill="url(#safety-glow)" />
      <path
        d="M200 15 L 270 35 L 270 70 Q 270 100 200 115 Q 130 100 130 70 L 130 35 Z"
        fill={p.accent}
        opacity="0.85"
      />
      <line x1="200" y1="15" x2="200" y2="115" stroke={p.color} strokeWidth="1.5" opacity="0.6" />
      <line x1="130" y1="55" x2="270" y2="55" stroke={p.color} strokeWidth="1" opacity="0.5" />
    </>,
    p.color
  );
}

function CultureArt({ p }: { p: Portal }) {
  // Overlapping spotlight cones / radial gradients
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      <defs>
        <radialGradient id="culture-spot1" cx="0.2" cy="0" r="0.8">
          <stop offset="0%" stopColor={p.accent} stopOpacity="0.7" />
          <stop offset="100%" stopColor={p.accent} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="culture-spot2" cx="0.5" cy="0" r="0.7">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="culture-spot3" cx="0.8" cy="0" r="0.8">
          <stop offset="0%" stopColor={p.accent} stopOpacity="0.7" />
          <stop offset="100%" stopColor={p.accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={VIEW_W} height={VIEW_H} fill="url(#culture-spot1)" />
      <rect width={VIEW_W} height={VIEW_H} fill="url(#culture-spot2)" />
      <rect width={VIEW_W} height={VIEW_H} fill="url(#culture-spot3)" />
      <circle cx="80" cy="100" r="6" fill="#ffffff" opacity="0.9" />
      <circle cx="200" cy="105" r="6" fill="#ffffff" opacity="0.9" />
      <circle cx="320" cy="100" r="6" fill="#ffffff" opacity="0.9" />
    </>,
    p.color
  );
}

function FoodArt({ p }: { p: Portal }) {
  // Wheat stalks fanning from a base + grain dots
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      {[-30, -15, 0, 15, 30].map((angle, i) => (
        <g key={i} transform={`rotate(${angle} 200 120)`}>
          <line x1="200" y1="120" x2="200" y2="20" stroke={p.accent} strokeWidth="2" opacity="0.7" />
          {[40, 60, 80].map((y) => (
            <ellipse
              key={y}
              cx="200"
              cy={y}
              rx="6"
              ry="3"
              transform={`rotate(${i % 2 ? 25 : -25} 200 ${y})`}
              fill={p.accent}
              opacity="0.85"
            />
          ))}
        </g>
      ))}
    </>,
    p.color
  );
}

function RightsArt({ p }: { p: Portal }) {
  // Scales of justice abstracted — central pillar with two hanging arms
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      <line x1="200" y1="20" x2="200" y2="110" stroke={p.accent} strokeWidth="3" opacity="0.9" />
      <line x1="110" y1="35" x2="290" y2="35" stroke={p.accent} strokeWidth="3" opacity="0.9" />
      <line x1="110" y1="35" x2="110" y2="65" stroke={p.accent} strokeWidth="1.5" opacity="0.7" />
      <line x1="290" y1="35" x2="290" y2="65" stroke={p.accent} strokeWidth="1.5" opacity="0.7" />
      <ellipse cx="110" cy="75" rx="45" ry="8" fill={p.accent} opacity="0.7" />
      <ellipse cx="290" cy="75" rx="45" ry="8" fill={p.accent} opacity="0.7" />
      <circle cx="200" cy="20" r="6" fill={p.accent} opacity="0.95" />
      <rect x="170" y="110" width="60" height="10" fill={p.accent} opacity="0.85" />
    </>,
    p.color
  );
}

function MilitaryArt({ p }: { p: Portal }) {
  // Compass star with directional lines + offset geometric blocks
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      {/* offset blocks */}
      <rect x="20" y="20" width="50" height="50" fill={p.accent} opacity="0.4" />
      <rect x="60" y="55" width="40" height="50" fill={p.accent} opacity="0.55" />
      <rect x="310" y="15" width="55" height="40" fill={p.accent} opacity="0.45" />
      <rect x="340" y="50" width="45" height="55" fill={p.accent} opacity="0.6" />
      {/* compass star centered */}
      <polygon
        points="200,30 215,60 250,60 222,80 232,115 200,95 168,115 178,80 150,60 185,60"
        fill={p.accent}
        opacity="0.9"
      />
      <line x1="200" y1="10" x2="200" y2="115" stroke={p.accent} strokeWidth="1" opacity="0.5" />
      <line x1="140" y1="60" x2="260" y2="60" stroke={p.accent} strokeWidth="1" opacity="0.5" />
    </>,
    p.color
  );
}

function ShopArt({ p }: { p: Portal }) {
  // Stacked package boxes with handles suggesting shopping bag
  return frame(
    <>
      <rect width={VIEW_W} height={VIEW_H} fill={p.color} />
      {/* stacked boxes */}
      <rect x="40" y="60" width="80" height="50" fill={p.accent} opacity="0.7" />
      <rect x="50" y="40" width="60" height="25" fill={p.accent} opacity="0.85" />
      <rect x="160" y="50" width="90" height="60" fill={p.accent} opacity="0.75" />
      <rect x="175" y="35" width="60" height="20" fill={p.accent} opacity="0.9" />
      {/* shopping bag */}
      <rect x="280" y="45" width="80" height="65" fill={p.accent} opacity="0.8" />
      <path d="M295 45 Q 295 25 320 25 Q 345 25 345 45" fill="none" stroke={p.accent} strokeWidth="3" opacity="0.85" />
      <line x1="280" y1="65" x2="360" y2="65" stroke={p.color} strokeWidth="1" opacity="0.4" />
    </>,
    p.color
  );
}

function DefaultArt() {
  // Neutral fallback — soft gradient + scattered circles
  return frame(
    <>
      <defs>
        <linearGradient id="default-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
      </defs>
      <rect width={VIEW_W} height={VIEW_H} fill="url(#default-grad)" />
      <circle cx="80" cy="40" r="30" fill="#ffffff" opacity="0.12" />
      <circle cx="200" cy="80" r="45" fill="#ffffff" opacity="0.1" />
      <circle cx="330" cy="50" r="25" fill="#ffffff" opacity="0.15" />
      <circle cx="280" cy="100" r="18" fill="#ffffff" opacity="0.1" />
    </>,
    "#475569"
  );
}

// ============ Dispatcher ============

const ART_BY_ID: Record<string, (props: { p: Portal }) => React.JSX.Element> = {
  planet: PlanetArt,
  money: MoneyArt,
  housing: HousingArt,
  health: HealthArt,
  tech: TechArt,
  edu: EduArt,
  safety: SafetyArt,
  culture: CultureArt,
  food: FoodArt,
  rights: RightsArt,
  military: MilitaryArt,
  shop: ShopArt,
};

export default function PortalArt({ portalId, className }: PortalArtProps) {
  const portal = getPortal(portalId);
  if (!portal) {
    return <div className={className}><DefaultArt /></div>;
  }
  const Art = ART_BY_ID[portal.id];
  if (!Art) {
    return <div className={className}><DefaultArt /></div>;
  }
  return (
    <div className={className}>
      <Art p={portal} />
    </div>
  );
}
