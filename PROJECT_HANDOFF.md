# Congress Directory App - Project Documentation

## Overview

A full-stack web application for exploring members of the U.S. Congress with filters, sorting, favorites, and detailed member information.

**Live URLs:**
- Frontend: https://congress-directory.vercel.app
- Backend API: https://congress-api-370988201370.us-central1.run.app
- GitHub: https://github.com/ethoz1970/congress-directory

---

## Tech Stack

### Frontend
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **Authentication:** Firebase Auth (Google Sign-in)
- **Hosting:** Vercel

### Backend
- **Framework:** FastAPI (Python)
- **Database:** Google Firestore
- **Hosting:** Google Cloud Run
- **APIs Used:**
  - Congress.gov API (legislation data)
  - GNews API (news mentions)
  - YouTube Data API (member videos)
  - whoismyrepresentative.com (zip code lookup)

---

## Project Structure

```
congress-directory/
├── frontend/                    # Next.js app
│   ├── app/
│   │   ├── page.tsx            # Main directory grid page
│   │   ├── layout.tsx          # Root layout with analytics
│   │   ├── profile/
│   │   │   └── page.tsx        # User profile with favorites
│   │   ├── admin/
│   │   │   └── page.tsx        # Admin dashboard
│   │   ├── card/
│   │   │   └── [bioguide_id]/
│   │   │       └── page.tsx    # Shareable member cards
│   │   └── components/
│   │       ├── SlideOutPanel.tsx    # Member detail panel
│   │       ├── UserMenu.tsx         # Avatar dropdown menu
│   │       └── GoogleAnalytics.tsx  # GA4 tracking
│   ├── lib/
│   │   ├── AuthContext.tsx     # Firebase auth context
│   │   ├── useFavorites.ts     # Favorites hook
│   │   └── firebase.ts         # Firebase config
│   └── types/
│       └── gtag.d.ts           # Google Analytics types
│
├── backend/                     # FastAPI app
│   ├── main.py                 # API endpoints
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── Procfile
│   ├── firebase-credentials.json  # (not in git)
│   ├── import_legislators.py   # Import members from Congress.gov
│   ├── import_ideology.py      # Import ideology scores
│   ├── import_legislation.py   # Import bill counts
│   ├── import_news_mentions.py # Import news data (manual)
│   ├── import_committees.py    # Import committee assignments
│   └── jobs/
│       └── news-import/        # Cloud Run Job for scheduled news import
│           ├── main.py
│           ├── Dockerfile
│           ├── requirements.txt
│           └── setup.sh
```

---

## Key Features

### Main Directory (page.tsx)
- **Grid display** with adjustable size (1-5 columns)
- **Filters:** Chamber, Party, State, Gender, Bills Enacted, News Mentions
- **Sort options:** Bills Enacted, News Mentions, Ideology, Terms, Years, Age, State, Name
- **Search:** Weighted OR search across name, party, state
- **Visual indicators:**
  - Party color triangle (upper right) - red/blue/purple
  - News mentions triangle (upper left) - yellow to red heat scale
  - Bills enacted triangle (lower right) - green shades
  - Ideology badge (lower left)
- **Hero slideshow** with 3 rotating slides
- **Find Your Rep** by zip code (returns 2 senators + 1 rep)

### Slide-Out Panel (SlideOutPanel.tsx)
- Member photo with party color strip
- Contact info (phone, office, website, contact form)
- Quick stats (district/class, terms, years in congress)
- Age and term end date
- Ideology spectrum visualization
- Legislative activity (sponsored, cosponsored, enacted counts)
- News mentions with sample headlines
- Committee assignments
- YouTube videos (if available)
- Share card button

### Profile Page (profile/page.tsx)
- User info card
- Stats (favorites count, party breakdown)
- **Latest Videos** section - YouTube videos from favorites
- **News Headlines** section - News from favorites
- Trading card grid of favorite members

### Shareable Cards (card/[bioguide_id]/page.tsx)
- Public trading card view for any member
- 5 stats: Bills, Years, Age, News, Ideology
- Shareable URL for social media

---

## Database Schema (Firestore)

### Collection: `legislators`
```typescript
{
  bioguide_id: string,        // Primary key (e.g., "P000197")
  full_name: string,
  first_name: string,
  last_name: string,
  party: "Republican" | "Democrat" | "Independent",
  state: string,              // 2-letter code
  chamber: "Senate" | "House",
  district?: number,          // House only
  senate_class?: number,      // Senate only (1, 2, or 3)
  term_start: string,
  term_end: string,
  birthday: string,
  gender: "M" | "F",
  phone: string,
  office: string,
  website: string,
  contact_form: string,
  first_term_start?: string,
  total_terms?: number,
  senate_terms?: number,
  house_terms?: number,
  
  // Ideology (from VoteView)
  ideology_score?: number,    // 0-1 scale (0=liberal, 1=conservative)
  leadership_score?: number,
  
  // Legislation counts
  sponsored_count?: number,
  cosponsored_count?: number,
  enacted_count?: number,
  
  // News (from GNews API)
  news_mentions?: number,
  news_sample_headlines?: Array<{
    title: string,
    source: string,
    date: string,
    url: string
  }>,
  news_updated_at?: Timestamp,
  
  // External IDs
  external_ids: {
    thomas?: string,
    govtrack?: number,
    opensecrets?: string,
    votesmart?: number,
    wikipedia?: string,
    ballotpedia?: string,
    twitter?: string,
    youtube?: string,
    youtube_id?: string,
    facebook?: string
  }
}
```

### Collection: `users`
```typescript
{
  uid: string,                // Firebase Auth UID
  email: string,
  displayName: string,
  photoURL?: string,
  createdAt: Timestamp,
  lastLogin: Timestamp,
  favorites: string[]         // Array of bioguide_ids
}
```

---

## API Endpoints (backend/main.py)

### Legislators
- `GET /api/legislators` - List all (with 24hr cache)
- `GET /api/legislators/{bioguide_id}` - Single member details
- `GET /api/legislators/{bioguide_id}/committees` - Committee assignments
- `GET /api/legislators/{bioguide_id}/youtube-videos` - YouTube videos

### Utilities
- `GET /api/find-rep?zip={zipcode}` - Find reps by zip (returns 2 senators + 1 rep)
- `POST /api/cache/clear` - Clear backend cache
- `GET /api/cache/status` - Cache status

---

## Environment Variables

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=https://congress-api-370988201370.us-central1.run.app
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=congress-api-441519
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_GA_MEASUREMENT_ID=G-ZGC0J391BV
```

### Backend
- `GOOGLE_CLOUD_PROJECT=congress-api-441519`
- `GNEWS_API_KEY` - For news import (stored in Secret Manager)
- `CONGRESS_API_KEY` - For Congress.gov API
- `YOUTUBE_API_KEY` - For YouTube Data API

---

## Deployment

### Frontend (Vercel)
```bash
cd frontend
git push  # Auto-deploys via Vercel GitHub integration
```

### Backend (Google Cloud Run)
```bash
cd backend
gcloud run deploy congress-api --source . --region=us-central1
```

### News Import Job (Cloud Run Jobs)
```bash
cd backend/jobs/news-import
gcloud run jobs deploy news-import-job --source . --region=us-central1
```

---

## Import Scripts

Run from `backend/` directory with `firebase-credentials.json` present:

```bash
# Import/update legislators from Congress.gov
python import_legislators.py

# Import ideology scores from VoteView
python import_ideology.py

# Import legislation counts
python import_legislation.py --api-key YOUR_CONGRESS_API_KEY

# Import news mentions (manual, or use Cloud Run Job)
python import_news_mentions.py --api-key YOUR_GNEWS_API_KEY --limit 100

# Import committee assignments
python import_committees.py
```

---

## Scheduled Jobs

### News Import (Cloud Run Job)
- **Schedule:** Daily at 6:00 AM Eastern
- **Limit:** 100 members per run (cycles through all 541 over ~6 days)
- **API:** GNews (key stored in Secret Manager)

**Manual execution:**
```bash
gcloud run jobs execute news-import-job --region=us-central1
```

**View logs:**
```bash
gcloud run jobs logs news-import-job --region=us-central1
```

---

## Key Design Decisions

1. **24-hour backend cache** - Reduces Firestore reads, cleared manually after imports
2. **Stored legislation counts** - No live Congress.gov API calls in slide-out panel
3. **News data stored in Firestore** - Updated daily via Cloud Run Job
4. **Triangles for visual indicators** - Party (right), news (left), bills (bottom right)
5. **Mobile responsive** - Triangles 50% smaller on mobile, stacked layouts
6. **Favorites in avatar menu** - Cleaner header design

---

## Analytics

Google Analytics 4 is integrated:
- **Measurement ID:** G-ZGC0J391BV
- **Tracks:** Page views, route changes
- **Component:** `frontend/app/components/GoogleAnalytics.tsx`

---

## Admin Features

Admin emails (hardcoded in UserMenu.tsx):
- marioguzman1970@gmail.com
- blackskymedia@gmail.com

Admin dashboard at `/admin` shows:
- User statistics
- Database stats
- Quick actions

---

## Common Tasks

### Add a new filter
1. Add filter state in `page.tsx`
2. Add UI in the sidebar filters section
3. Add to `filteredLegislators` useMemo
4. Add to URL params handling
5. Add to `clearFilters` function

### Add a new sort option
1. Add to `SORT_OPTIONS` array in `page.tsx`
2. Add case to sort switch statement in `filteredLegislators`

### Update member data
1. Run appropriate import script
2. Clear backend cache: `curl -X POST https://congress-api-370988201370.us-central1.run.app/api/cache/clear`

### Add a new field to legislators
1. Update Firestore document (via import script)
2. Update `Legislator` interface in frontend components
3. Update backend cache if needed

---

## Troubleshooting

### "No representatives found" for zip code
- The whoismyrepresentative.com API may be down
- Backend now always adds both senators from the state as fallback

### Stale data after import
- Clear the backend cache: `POST /api/cache/clear`
- Or redeploy backend to reset cache

### Build failures on Cloud Run
- Make sure you're in the correct directory (`backend/` not root)
- Check that `Procfile` exists for Python apps

---

## Future Enhancements (Ideas)

- [ ] Bill detail pages
- [ ] Voting record integration
- [ ] Campaign finance data (OpenSecrets)
- [ ] District maps
- [ ] Comparison tool for multiple members
- [ ] Push notifications for news about favorites
- [ ] Export favorites to CSV
- [ ] Social sharing previews (Open Graph images)
