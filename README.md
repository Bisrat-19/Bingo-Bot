# 🎲 Telegram Bingo — Next.js App

Multiplayer **75-ball Bingo** for Telegram: the **Mini App UI, the HTTP API, and the
Telegram bot all live in one Next.js app**, backed by PostgreSQL via Prisma.

Built with **Next.js (App Router) · React · TypeScript · Telegraf · Prisma · PostgreSQL**
(Redis optional), following clean architecture, SOLID, DI, the repository pattern, and a
service layer.

---

## ✨ Highlights

- **One deployable app** — UI + API routes + the bot, no separate frontend/backend servers.
- **Colorful, responsive Mini App** — a live 75-number board (called numbers light up and
  **blink**), an interactive colored card you tap, countdown, players panel, winner
  overlay, haptics, safe-area handling.
- **The mandatory rule:** completing a line doesn't win — the **first player to press
  BINGO with a valid pattern wins**, guaranteed by an in-process mutex **plus** an atomic
  conditional DB update (exactly one winner, even across processes).
- **Server-authoritative & anti-cheat** — a mark only counts if that number was actually
  called; identity always comes from validated Telegram `initData`.
- Statistics, leaderboard, crash recovery, structured logging, Docker.

---

## 🏗 Architecture

```
src/
├─ app/                     Next.js App Router
│  ├─ layout.tsx            root layout (loads Telegram runtime)
│  ├─ page.tsx              the Mini App (client component)
│  ├─ globals.css           responsive styles
│  └─ api/*/route.ts        JSON API: state · join · start · mark · bingo · leave
├─ components/              React UI (Ball, Dashboard, Card, Players, ActionBar, Winner)
├─ lib/                     client helpers (api, telegram, bingo, types)
├─ instrumentation.ts       boots the Telegram bot + game engine on server start
└─ server/                  all backend domain code
   ├─ config/  database/  repositories/  services/  game/  telegram/  controllers/
   ├─ container.ts          DI composition (getContainer singleton)
   ├─ webapi.ts             route-handler helpers (auth, BigInt-safe JSON)
   └─ auth.ts               Telegram initData HMAC verification
prisma/schema.prisma        data models
```

**How the pieces run in one process:** `instrumentation.ts` runs once on server
startup and launches the Telegram bot (long-polling) + the number-calling timers,
using the same `getContainer()` singleton the API route handlers use — so the bot,
timers, and HTTP API all share in-memory game state.

> ⚠️ **Deploy target:** because the bot polls and the game calls numbers on a timer, this
> app needs a **persistent Node server** (`next start`) — Docker, Railway, Render, Fly, or
> a VPS. It is **not** suited to serverless (Vercel functions), which would kill the
> timers/polling between requests.

---

## 🚀 Local development

### 1. Prerequisites
- Node.js ≥ 18, Docker (for PostgreSQL), a bot token from [@BotFather](https://t.me/BotFather)

### 2. Configure
```bash
cp .env.example .env       # set BOT_TOKEN (and WEBAPP_URL once you have a public URL)
```

### 3. Database (Docker)
```bash
docker compose up -d postgres redis
npm install
npm run prisma:migrate     # create tables
```

### 4. Run
```bash
npm run dev                # Next.js dev server on :3000 — also boots the bot
```

### 5. Expose for the Mini App (dev)
The Mini App must be reachable over HTTPS. For local testing use a tunnel, e.g.:
```bash
cloudflared tunnel --url http://localhost:3000
```
Put the resulting `https://…` URL in `.env` as `WEBAPP_URL`, restart, and in
**@BotFather → your bot → Bot Settings → Configure Mini App** set the same URL.

Then in Telegram: DM the bot `/start`, send `/create`, tap **🎮 Open Game Board**.

---

## 🐳 Production (Docker)

```bash
cp .env.example .env        # set BOT_TOKEN + WEBAPP_URL (your permanent https domain)
docker compose up --build
```

The `app` service runs `prisma migrate deploy` then `next start` (which boots the bot).
The image uses Next's `output: 'standalone'` for a small self-contained runtime. Any host
that runs a long-lived container works: **Railway, Render, Fly.io, a VPS**, etc.

---

## ⚙️ Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOT_TOKEN` | — | Telegram bot token (required) |
| `DATABASE_URL` | — | PostgreSQL connection string (required) |
| `WEBAPP_URL` | — | Public HTTPS URL of this app (enables the Mini App button) |
| `REDIS_URL` | *(empty)* | Optional; hook for cross-process locking/caching |
| `COUNTDOWN_SECONDS` | `60` | Pre-game countdown |
| `DRAW_INTERVAL_SECONDS` | `10` | Seconds between called numbers |
| `MIN_PLAYERS` / `MAX_PLAYERS` | `2` / `20` | Lobby bounds |
| `FALSE_BINGO_COOLDOWN_SECONDS` | `30` | Penalty after an invalid BINGO |

---

## 🎮 Commands (in Telegram)

`/start` · `/help` · `/create` · `/join` · `/card` · `/status` · `/players` ·
`/bingo` · `/end` · `/restart` · `/leaderboard` · `/stats`

In **private chats** the lobby shows a native **web_app** button; in **groups** it shows a
`t.me` deep link that opens the Mini App for every player (enable the Main Mini App in
BotFather to use group links).
