# WatchParty 🎬

A modern, full-stack real-time collaborative video watching web application where friends can gather in virtual rooms, watch YouTube videos in synchronized lockstep, manage roles, approve playback requests, and chat live.

**Live application:** https://watch-party-nine-pied.vercel.app/

---

## 1. System Architecture & Data Flow

```
   ┌──────────────────────────────────────────────────────────────┐
   │                     Host / Moderator Browser                 │
   │  [ Play / Pause / Seek / Load Video / Approve Requests ]    │
   └──────────────────────────────┬───────────────────────────────┘
                                  │ Sockets: play, pause, seek, approve
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                  Authoritative Express / Socket.IO Server     │
   │  - authoritatively tracks `currentTime` + elapsed time       │
   │  - enforces strict RBAC (Host, Moderator, Participant)       │
   │  - manages Room State, Requests Queue & Chat History         │
   │  - broadcasts `playback_sync`, `room_updated`, `new_message` │
   └──────────────────────────────┬───────────────────────────────┘
                                  │ Broadcast: playback_sync (action, time, state)
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                     Participant Browser                      │
   │  - YouTube Player synced with drift correction (< 3.0s)      │
   │  - Click interception prevents desyncs                       │
   │  - Action Request System: "Request Play", "Request Seek"     │
   └──────────────────────────────────────────────────────────────┘
```

### Authoritative Time Calculation
When videos are playing, `room.playback.currentTime` on the server does not freeze. Instead, the server records `lastUpdated = Date.now()`. At any instant:
$$\text{effectiveCurrentTime} = \text{currentTime} + \frac{\text{Date.now()} - \text{lastUpdated}}{1000}$$
When a new user joins or reconnects, they immediately jump to the exact broadcast second rather than restarting from zero.

### Loop Prevention & Drift Correction
1. **Loop Prevention:** Sockets only emit commands on explicit user button/slider interactions, never reflecting YouTube's internal state events back to the server.
2. **Drift Correction:** Client checks local player timestamp against server expectations every 500ms. If player drifts by $> 3.0$ seconds (e.g. slow buffering or browser tab throttling), it gently seeks to lockstep.
3. **Participant Protection:** A transparent overlay on non-host players prevents participants from accidentally clicking the YouTube iframe directly and desyncing their local player.

---

## 2. Core Features

### A. Room Management & Invite Links
- **Unique Room IDs:** 8-character unique alphanumeric identifiers.
- **Shareable Invite Links:** Links follow the structure `http://localhost:5173/room/ROOM_ID`. One-click "Copy Invite Link" with instant visual confirmation.
- **Direct Link Joining:** Navigating directly to an invite URL prompts the user to enter a username and immediately hops them into the room.
- **Session Persistence:** Active room sessions and usernames are cached in `sessionStorage` and `localStorage` to survive page refreshes.

### B. Real-Time Participant List
- Live participant counts and member rosters.
- Role badges:
  - 👑 **Host:** Full administrative and playback control.
  - 🛡️ **Moderator:** Playback control and request approval capabilities.
  - 👀 **Viewer / Participant:** Synchronized watching with action request capability.
- Host and current user `(You)` indicators with real-time connection status dots.

### C. Role-Based Access Control (RBAC)
- **Host Privileges:** Full room control, video playback control, promote/demote moderators, kick participants, transfer room ownership, approve/reject participant requests.
- **Moderator Privileges:** Play/pause, seek, load new videos, approve/reject participant playback requests.
- **Participant Restrictions:** Synchronized watching. Sensitive socket events (`play`, `pause`, `seek`, `change_video`) are rejected by backend RBAC validation if emitted directly.
- **Safe Host Departure:** If the host leaves or disconnects, the server automatically promotes the next eligible member (moderators first, or longest-standing participant).

### D. Action Approval Request System
- When Participants want to play, pause, seek to a specific time, or suggest a new YouTube video, they send an approval request to the room.
- Host and Moderators receive real-time notifications with pending badge counters.
- Actions can be approved with one click (which authoritatively executes the action across the room) or rejected (which notifies the requester).

### E. YouTube URL Validation & Parsing
Accepts any valid YouTube link or raw ID:
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- `https://www.youtube.com/live/VIDEO_ID`
- Direct 11-character video IDs.

### F. Real-Time Room Chat
- Integrated chat system with message history.
- Distinguishes between User messages (with role badges) and System events (joins, leaves, video changes, role promotions).

---

## 3. Technology Stack

- **Frontend:** React 19, Vite, JavaScript, CSS3 (responsive dark theme), `react-youtube`, `socket.io-client`.
- **Backend:** Node.js, Express 5, Socket.IO, `cors`, `dotenv`.
- **Storage:** In-memory state storage (fast, zero external database setup required for the MVP).

---

## 4. Setup & Local Development

### Prerequisites
- Node.js (v18+ recommended)
- npm or pnpm

### 1. Backend Server Setup
```bash
# Navigate to the server directory
cd server

# Install dependencies
npm install

# Start development server
npm run dev
# Server will listen on http://localhost:5000
```

### 2. Frontend Client Setup
```bash
# In a new terminal, navigate to client directory
cd client

# Install dependencies
npm install

# Start Vite dev server
npm run dev
# Frontend will be live on http://localhost:5173
```

---

## 5. Environment Variables

### Backend (`server/.env`)
| Variable | Default | Description |
|---|---|---|
| `MONGODB_URI` | (required) | MongoDB connection string for room data |
| `PORT` | `5000` | Port for the Express and Socket.IO server |
| `CLIENT_ORIGIN` | Local Vite origins | Comma-separated frontend origins allowed by HTTP and Socket.IO CORS |

### Frontend (`client/.env`)
| Variable | Default | Description |
|---|---|---|
| `VITE_BACKEND_URL` | `http://localhost:5000` | Base URL for REST API endpoints |
| `VITE_SOCKET_URL` | `http://localhost:5000` | Socket.IO server connection URL |

---

## 6. Testing & Verification

### Automated Integration Test Suite
The project includes a 19-assertion automated end-to-end integration test validating:
- Server health check & room creation
- Room code formatting & host assignment
- Multi-client join & Socket.IO handshakes
- Synchronized video changing & playback
- Backend RBAC enforcement (rejection of unauthorized participant controls)
- Participant action request lifecycle (Request -> Host Approve -> Shared Playback Execution)
- Role promotion to Moderator & Moderator control verification
- Real-time room chat
- Participant kicking & ban verification (HTTP 403 prevention on rejoin)
- Host transfer to another participant

To run the automated test suite:
```bash
cd server
npm test
```

### Manual Testing Guide
1. Open `http://localhost:5173` in a browser window.
2. Enter username `Alice` and click **Create Room**.
3. Copy the invite link from the header (`http://localhost:5173/room/ROOM_ID`).
4. Open an Incognito window (or secondary browser), paste the link, enter username `Bob`, and join.
5. In Alice's window, paste a YouTube link (e.g. `https://www.youtube.com/watch?v=dQw4w9WgXcQ`) and click **Load Video**.
6. Verify that Bob's window loads the video in sync.
7. Click **Play** and **Pause** in Alice's window; verify Bob's video plays and pauses synchronously.
8. In Bob's window, click **Request Play** or **Request Seek**; observe the badge and approval card in Alice's **Requests** tab.
9. Click **Approve** in Alice's tab; verify that Bob receives a notification and the video executes the action.
10. In Alice's **People** tab, click **Make Mod** on Bob; verify Bob can now directly control playback.

---

## 7. MVP Limitations & Production Considerations

- **Room Storage:** Room documents are stored in MongoDB and empty rooms expire after 24 hours. Live room broadcasts are handled by Socket.IO instances.
- **Participant Identity:** Identity is tracked via unique participant IDs generated upon room joining and saved in session storage. For production with persistent accounts, OAuth / JWT auth can replace session tokens.
- **Horizontal Scaling:** Socket.IO broadcasts are local to the Function instance. For reliable room broadcasts across multiple instances, add a shared Socket.IO adapter/pub-sub service and shared presence coordination.

---

## 8. Deployment Guide

### Deploy Backend to Vercel
1. Create or open the Vercel project connected to this repository.
2. Set **Root Directory** to `server` and select the Express framework preset (or let Vercel detect it).
3. Leave the Vercel build and output settings at their detected defaults; Vercel imports `server/index.js` as the Function entrypoint. Do not set a `node server.js` start command on Vercel.
4. Add these environment variables to each Vercel environment you deploy:
   - `MONGODB_URI`: your MongoDB connection string
   - `CLIENT_ORIGIN`: `https://watch-party-nine-pied.vercel.app`
5. Redeploy after changing environment variables.

For a traditional long-running Node host such as Render or Railway, use `npm install` and `npm start` from the `server` directory instead.

### Deploy Frontend to Vercel (or Netlify)
1. Create a new project in Vercel or Netlify.
2. Set **Root Directory** to `client`.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Set environment variables:
   - `VITE_BACKEND_URL`: `https://watch-party-b95g.vercel.app`
   - `VITE_SOCKET_URL`: `https://watch-party-b95g.vercel.app`
6. Rebuild and redeploy after changing either Vite variable. The app handles `/room/*` routes through its client-side router.

