# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start Vite dev server (localhost:5173)
npm run build      # Production build
npm run lint       # ESLint check
npm run preview    # Preview production build locally
```

No test suite exists — validation is done manually against the live Supabase project.

To deploy edge functions:
```bash
supabase functions deploy <function-name>
```

## Architecture

**leave-app-v2** is a Turkish-language employee leave management system for Terralab. Frontend is React + Vite deployed on Vercel; backend is Supabase (PostgreSQL + Auth + Edge Functions).

### Frontend

- **`src/App.jsx`** — root component; drives tab-based routing via `tab` state (no React Router). Role-based tab visibility: `user`, `manager`, `admin`.
- **`src/components/UserContext.jsx`** — global context providing `authUser` (Supabase auth session) and `dbUser` (row from `users` table). All components consume this via `useUser()`.
- **`src/supabaseClient.js`** — Supabase client initialized with hardcoded public anon key (standard practice; access controlled by RLS).

Authentication uses Azure OAuth via `supabase.auth.signInWithOAuth({ provider: "azure" })`. On login, `UserContext` fetches the matching row from the `users` table and checks `is_active`; archived users are blocked immediately.

### Edge Functions

All business logic lives in `supabase/functions/` as Deno/TypeScript. Every user-facing function:
1. Validates CORS headers
2. Verifies the Supabase JWT (`Authorization` header)
3. Checks that the calling user is `is_active` in the `users` table
4. Performs the operation and sends email notifications via Microsoft Graph API

The exception is `backup-leave-balances`, which uses the Supabase service role secret instead of user JWT.

Key functions:
- `create-leave` / `approve-leave` / `reject-leave` / `cancel-leave` — leave lifecycle
- `deduct-leave` / `reverse-leave` — manual balance adjustment (holiday-aware)
- `bulk-company-leave` — apply a company-wide leave day to all employees
- `reconcile-holiday-impact` — recalculates leave durations after holiday table changes
- `get-profile-photo` — proxies Microsoft Graph profile photos

Shared email helper: `supabase/functions/helpers/sendGraphEmail.ts`.

### Database (key tables)

| Table | Purpose |
|---|---|
| `users` | id, email, name, role (admin/manager/user), manager_email, is_active |
| `leave_requests` | leave request rows with status: Pending / Approved / Deducted / Rejected / Cancelled |
| `leave_balances` | annual/sick/other balance per user |
| `holidays` | public holiday dates (supports half-day with am/pm field) |
| `settings` | app-level flags (e.g., `allow_retroactive_leave`) |

### Roles

| Role | Can do |
|---|---|
| `user` | Submit/cancel own leave requests |
| `manager` | Approve/reject/deduct for subordinates (matched via `manager_email`) |
| `admin` | Everything + assign roles, assign managers, trigger backups, update user info |

### Email Notifications

Emails are sent via Microsoft Graph API from within edge functions. The shared helper in `helpers/sendGraphEmail.ts` is called after state-changing operations (create, approve, reject, deduct, reverse). The sender account credentials are stored as Supabase secrets.

### CI/CD

- `.github/workflows/backup-leave-balances.yml` runs monthly (1st of month, 01:00 UTC) to export leave balance snapshots.
- Admins can also trigger this manually from the AdminBackups UI, which calls the `dispatch-backup-workflow` edge function to invoke the GitHub Actions workflow via the GitHub API.
