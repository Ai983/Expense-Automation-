# Login Failure Diagnosis — "Could not reach the server"

*Investigated: 2026-07-09 · Investigator: Claude Code (full-system diagnosis)*

---

## 1. Executive Summary

**Some employees (e.g. Shubham Rajput) intermittently cannot log in to the mobile
expense app because Jio and some other Indian ISPs block all `*.up.railway.app`
domains — and the app on their phones calls the Railway backend URL directly.**
The request is dropped by the ISP before it ever reaches the server, so the app
correctly reports "Could not reach the server."

Nothing is wrong with the backend, the database, the user's account, or his
password. The failure is 100% in the network path between certain ISPs and
Railway's domain.

A bypass for exactly this problem was already built in April 2026 (commit
`a64cb7e` — a Vercel proxy that forwards `/api/*` to Railway), **but it has never
carried a single request**, because the deployed app bundles have the absolute
Railway URL baked in, so phones talk to Railway directly and skip the proxy.

---

## 2. The Symptom

- Error shown: *"Could not reach the server. Check your internet connection (try
  switching Wi-Fi / mobile data) and try again."*
- Affects **some** employees, **some** of the time (network-dependent).
- Example: `rajputshubham19191@gmail.com` — saw the error, yet Supabase records a
  **successful login the same day at 12:20 PM IST** (2026-07-08 06:50 UTC). Same
  phone, same app, same server — works on one network, fails on another.

---

## 3. Evidence Chain (what was verified, and how)

### 3.1 The error means "no HTTP response at all" — proven from code
[`mobile-app/app/(auth)/login.jsx:67-75`](mobile-app/app/(auth)/login.jsx#L67-L75)
shows this exact message is only displayed when the request produced **no
response whatsoever**:
- Wrong password → server responds 401 → *"Invalid email or password"* (different message)
- Slow/cold server → timeout → *"server took too long … may be waking up"* (different message)
- **No response at all → "Could not reach the server"** ← the screenshot

So the request died at DNS/TCP level, before reaching any server.

### 3.2 Backend is healthy — verified live
- `GET https://expense-automation-production.up.railway.app/health` → **HTTP 200**
  (first hit 4.2s = cold wake, subsequent hits 0.15s).
- GitHub Actions keepalive (`.github/workflows/keepalive.yml`) is **active**; all
  recent runs succeeded (verified via GitHub API on repo `Ai983/Expense-Automation-`).

### 3.3 Account is healthy — verified in Supabase (project `tpfvnerrjhqwipyonngf`)
- `public.employees`: `rajputshubham19191@gmail.com` exists, `is_active = true`,
  role `site_engineer`, auth user linked.
- `auth.users.last_sign_in_at` = 2026-07-08 06:50 UTC — **he logged in successfully that day**.
- System-wide: **15 of 88 users signed in within the last 24h**, 26 within 7 days —
  the platform works for most users; failures are network-specific, not systemic.

### 3.4 The deployed app calls Railway directly — proven from the live bundle
Downloaded the exact JavaScript bundle served to phones by
`https://expense-automation-mobile.vercel.app` (Vercel project
`expense-automation-mobile`, production deployment of **2026-07-06 16:24 IST** —
current, not stale):

```
baseURL: "https://expense-automation-production.up.railway.app", timeout: 6e4
```

- The Railway URL is **hard-baked** into the bundle (via `EXPO_PUBLIC_API_BASE_URL`
  at build time — see [`mobile-app/src/constants/index.js:46`](mobile-app/src/constants/index.js#L46)).
- The newer resilience code (60s timeout + 2 retries + honest error copy) **is**
  deployed — it just can't help when the ISP drops the connection outright.

The finance dashboard (`expense-automation-three.vercel.app`, Vercel project
`expense-automation`, also deployed 2026-07-06) has the **same defect**: Railway
URL and `wss://…railway.app` WebSocket hard-baked.

### 3.5 The ISP block is documented — externally and in this repo's own history
- Railway's official help forum confirms **"a known issue with Jio reaching
  workloads on Railway"** and Indian ISPs blocking Railway domains; threads run
  from Aug 2025 into 2026 with no resolution. Railway's recommended workaround:
  put a custom domain / Cloudflare in front.
  - https://station.railway.com/questions/my-website-users-are-facing-issues-with-def37561
  - https://station.railway.com/questions/why-server-not-reachable-with-mobile-net-b1c32b80
  - https://station.railway.com/questions/my-service-is-not-working-all-the-time-w-e634daf5
- This repo already hit it: commit `a64cb7e` (2026-04-02), message
  *"fix: proxy /api/* through Vercel to bypass ISP blocks on Railway"*.

### 3.6 Why that April fix never worked — proven by diff + bundle
Commit `a64cb7e` only added a rewrite to [`mobile-app/vercel.json`](mobile-app/vercel.json):
`/api/* → https://expense-automation-production.up.railway.app/api/*`.
For that proxy to be used, the app must make **same-origin relative** requests
(`/api/...`). It doesn't — the bundle uses the absolute Railway URL (§3.4), so
every request bypasses Vercel and goes straight to the blocked domain. The fix
is dead code.

---

## 4. Proven vs. Inferred

| Claim | Status |
| --- | --- |
| Request dies with no server response (not a credential/server error) | **Proven** (code path + screenshot message) |
| Backend, account, password all fine | **Proven** (live probes + Supabase) |
| App calls `*.up.railway.app` directly; Vercel proxy unused | **Proven** (deployed bundle inspected) |
| Indian ISPs (Jio confirmed by Railway) block `*.up.railway.app` | **Proven** (Railway staff statements; repo's own April commit) |
| Shubham's failing moments were specifically on **Jio** | **Inferred** — cannot see his SIM remotely; see field test below |

**Field test to make it 100%** — when the error next appears, on that same phone,
same minute, in the browser:
1. Open `https://expense-automation-production.up.railway.app/health` → expected: *fails* ("site can't be reached")
2. Open `https://expense-automation-mobile.vercel.app` → expected: *loads normally*
3. Note the network (Jio SIM / JioFiber?) — then switch to another network and watch login succeed.

If (1) loads while the app still errors, this diagnosis is falsified — report back.

---

## 5. Ruled Out

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| Wrong password / account missing / deactivated | ❌ | Active account, auth linked, successful same-day sign-in |
| Backend down or crashing | ❌ | /health 200; keepalive green |
| Railway cold-start timeouts | ❌ (mitigated) | Keepalive every ~2h all green; 60s timeout + 2 retries deployed; cold wake measured at only ~4s |
| Stale deployment missing recent fixes | ❌ | Both Vercel prods deployed 2026-07-06; new retry/error code present in bundle |
| Supabase outage / auth failure | ❌ | Supabase reachable; sign-ins flowing (15 users in last 24h) |
| CORS misconfiguration | ❌ | Backend allows `*.vercel.app` / `*.railway.app` origins ([backend/src/index.js:69-73](backend/src/index.js#L69-L73)); CORS failures wouldn't be intermittent per-user |
| Bug in recent commits | ❌ | Login code path is correct; recent commits improved error honesty and retries |

---

## 6. Additional Defects Found During Investigation

1. **`mobile-app/eas.json` still has placeholder URLs** —
   `"EXPO_PUBLIC_API_BASE_URL": "https://YOUR-RAILWAY-URL.railway.app"` in both
   build profiles. Any APK built with `eas build` can **never** connect, for anyone.
2. **Finance dashboard has the same direct-Railway exposure** (§3.4) — finance
   users on a blocking ISP will fail the same way, and its WebSocket
   (`wss://…railway.app/ws`) is equally exposed. Note: Vercel rewrites **cannot**
   proxy WebSockets, so the dashboard needs the custom-domain fix, not the proxy.
3. **Empty-string env trap** — `process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000'`:
   setting the var to `""` on Vercel silently falls back to `localhost:4000` and
   breaks everyone. The same-origin fix must be an explicit platform check in code.

---

## 7. Recommended Fix

### Option A — proper fix (recommended): custom domain in front of Railway
1. Add a subdomain, e.g. `api.hagerstone.com`, DNS on Cloudflare (free plan, proxy/orange-cloud ON).
2. Attach it as a custom domain to the Railway service.
3. Point mobile app, dashboard (`VITE_API_BASE_URL`), and dashboard WebSocket at it.
4. ISPs don't block `hagerstone.com`; also fixes the WebSocket and removes Vercel as a single point of failure.

### Option B — quick fix (no domain purchase): actually use the existing Vercel proxy
1. In `mobile-app/src/constants/index.js`: on web builds use same-origin (`''`)
   explicitly (`Platform.OS === 'web'` check — not an empty env var, see §6.3),
   so requests become `/api/...` and Vercel's rewrite carries them via Vercel's
   edge, which is not blocked.
2. Remove `EXPO_PUBLIC_API_BASE_URL` from the `expense-automation-mobile` Vercel
   project env and redeploy.
3. Fix `eas.json`: point APK builds at `https://expense-automation-mobile.vercel.app`
   (proxied) instead of any railway.app URL.
4. Dashboard: add the same `/api` rewrite to its `vercel.json` + relative base URL.
   (WebSocket still needs Option A eventually.)

**Interim workaround for affected employees:** switch off the blocking network —
use Wi-Fi or another carrier's hotspot — exactly why the error sometimes clears.

### Verification after deploying
1. Re-download the served bundle; confirm **no** `up.railway.app` string remains.
2. Login from a Jio connection (the previous failure case).
3. Confirm `/api/auth/login` requests appear in Vercel (proxy) or custom-domain logs.

---

## 8. Tooling Gaps Hit During Investigation

- **Railway MCP not connected** — could not read backend request logs to show the
  *absence* of failed users' requests (supporting evidence, not required).
  Connect: `claude mcp add railway -- npx -y @railway/mcp-server` (+ Railway API token).
- **Vercel MCP** (connected mid-investigation) exposes projects/deployments/logs
  but not env-var values; the baked bundle inspection stands as the authoritative
  runtime evidence regardless.
- `auth.audit_log_entries` in Supabase is empty — no per-attempt login history
  exists server-side; only `last_sign_in_at` is available.
