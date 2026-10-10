# MediPulse — Medical Supply Intelligence Platform

> **Predict before it happens.** A deployable, AI-powered web platform that forecasts medicine demand, calculates deterministic stock-out and expiry risks, and recommends procurement + redistribution actions across a hospital network — before shortages occur.

---

## 1. What This Project Is

MediPulse (formerly "MedPredict" in early docs) is a **decision-support intelligence layer** for hospital supply chains. It does not replace existing HIS/ERP/pharmacy systems — it sits on top of operational data and answers:

> **What stock exists, where will it be needed, when will it be needed, what is likely to expire, and what action should be taken?**

The pipeline follows **Predict → Understand → Optimize → Recommend → Explain**:

```text
Supply Network → Central Database → Demand Forecasting (LightGBM)
  → Stock-out Prediction → Expiry / Wastage Detection → Usable Surplus
  → Criticality Prioritisation → Redistribution Optimization
  → Action Recommendations → Web Dashboard → AI Helpdesk
```

It is a **decision-support tool, not a clinical system**: it never prescribes treatment, determines dosage, or executes physical stock transfers.

---

## 2. Features

### Frontend pages (`frontend/src/pages/`)

| Route | Page | What it does |
|---|---|---|
| `/` | **Dashboard** | Facility-scoped KPI cards (critical shortages, stock units, expiry risk, active transfers, priority score), emergency stock-out banner, inventory watchlist, peer redistribution pipeline |
| `/inventory` | **Inventory** | Batch-level stock table with search, filters (risk band, critical-only, expiry-risk, stock status), sorting, CSV export, row expansion |
| `/forecast` | **Forecast** | LightGBM demand projections per hospital + medicine (7/14/30-day horizons), history-vs-forecast chart, inventory outlook, procurement recommendation, surge scenario runner with before/after comparison |
| `/shortage-risk` | **Shortages** | Medicines with ≤ 14 days of cover, sorted by urgency, with lead-time feasibility (can the supplier deliver before stock-out?) |
| `/expiry-risk` | **Expiry** | Batches expiring soon with expected consumption vs. quantity → potential wastage, plus transfer-candidate flagging |
| `/redistribution` | **Transfers** | Suggested peer-to-peer transfers (source → destination, quantity, score, reasons), scope filters (my org / incoming / outgoing / all), approve flow, manual planned transfers |
| `/priority` | **Priority** | Network-wide hospital ranking by urgency score (0–100) with transparent dimension breakdowns (patient load, emergency, stockout, criticality, alternatives) |
| `/requests` | **Requests** | Network requirement board (demo data): post needs, browse offers from donor hospitals with traffic-aware routing, cost estimates, coverage progress, Leaflet donor-route map |
| `/helpdesk` | **Helpdesk** | Grounded AI chat (Groq LLM) that answers questions using live hospital data — stock-out risks, expiry, reorder advice — with evidence cards and suggested follow-ups |
| `/login`, `/signup` | **Auth** | Supabase email/password sign-in/sign-up with facility + role capture; offline demo fallback credentials |

Shared UI: risk badges, forecast alert banners, demo badges, user profile menu, facility-scoped navigation.

### Backend capabilities (`backend/app/`)

- **Demand forecasting** — LightGBM time-series model (lags, rolling stats, calendar, patient load, emergency, outbreak signals); 7/14/30-day horizons with confidence context; 7-day moving-average baseline for comparison (WAPE 6.70% vs 7.01% on the held-out test split).
- **Deterministic stock-out simulation** — daily walk of `projected_stock(t+1) = stock(t) + incoming(t) − demand(t)` down to a 2-day safety buffer → days-until-stockout, projected stock-out date, CRITICAL/HIGH/MEDIUM/LOW bands.
- **Expiry-risk engine** — per-batch `potential_wastage = max(0, quantity − expected consumption before expiry)`.
- **Procurement recommendations** — lead-time demand + safety stock − usable stock − incoming POs, floored at supplier MOQ, with urgency + reason.
- **Priority engine** — deterministic 0–100 hospital urgency score from five 20-point dimensions.
- **Redistribution engine** — usable-surplus detection with expiry/reserved/transport constraints; donor→recipient suggestions with scores and human-readable reasons.
- **What-if simulation** — demand-surge scenarios (`POST /api/v1/simulation/run`, `/api/simulation/run`) returning baseline-vs-scenario comparison (demand, stock-out window, risk level, recommended order).
- **AI Helpdesk** — Groq LLM grounded on live MedPredict data (`POST /api/v1/helpdesk/query`), hospital-scoped on the backend; capabilities endpoint for starter questions.
- **Auth + RBAC** — Supabase JWT verification (HS256 via `SUPABASE_JWT_SECRET`, plus ES256/RS256 via JWKS) with three roles: `ADMIN` (everything, incl. runs/writes), `FACILITY_MANAGER` (facility-scoped reads), `ANALYST` (network analytics). Helpdesk scope resolves JWT-first, `X-Hospital-Id` header fallback.
- **Frozen core contract** — convenience routes under `/api/*` (`/state`, `/network`, `/forecast/{facility}/{medicine}`, `/redistribution/optimize`, `/transfers/{id}/explain`, `/copilot`) for dashboard consumers.

---

## 3. Architecture

```text
                          PUBLIC INTERNET
                                 │
                ┌────────────────┴────────────────┐
                ▼                                 ▼
   ┌────────────────────────┐        ┌────────────────────────┐
   │        FRONTEND        │        │        SUPABASE        │
   │ React 19 + TypeScript  │        │ Auth (JWT sessions)    │
   │ Vite + Tailwind CSS    │──auth──│ PostgreSQL + PostGIS   │
   │ Recharts + Leaflet     │        │ RLS + PostgREST        │
   └───────────┬────────────┘        └───────────┬────────────┘
               │ HTTPS (Bearer JWT / X-Hospital-Id) │ service role
               ▼                                 │
   ┌────────────────────────┐                    │
   │     FASTAPI BACKEND    │◄───────────────────┘
   │  api/ → services/ → db │
   │  ┌─────┴──────┬───────┴─────┐
   │  ▼            ▼             ▼
   │ ML services  Decision    Scenario
   │ (LightGBM)   engines     engine
   │  └─────┬──────┴───────┬─────┘
   │        ▼              ▼
   │  Groq Helpdesk   (mock) Copilot
   └────────────────────────┘
```

**Design principles** (from `project.md`):

- **Modular monolith** — one deployable FastAPI app (`api/` routers → `services/` → `core/` + `models/`), no microservices. Modules can be split out later.
- **Supabase owns identity + data** — Auth issues JWTs; RLS policies scope facility rows; FastAPI verifies tokens, enforces RBAC in code, and uses the service role as the single trusted writer. No Supabase Edge Functions.
- **ML predicts, engines interpret, UI explains** — LightGBM predicts demand only; stock-out/expiry/priority are deterministic and auditable; the LLM is an interface over computed results, never the source of truth.
- **Local-first dev fallback** — when `DATABASE_URL` is unset, the backend uses the seeded SQLite DB (`data/medpredict.db`); auth can be bypassed with dev flags (see §8).

### Request flows

**Authenticated data request (e.g. Dashboard → inventory):**

```text
React page (api/medpredict.ts) ──GET /api/v1/inventory?hospital_id=H01──▶ FastAPI
   Authorization: Bearer <supabase-jwt>            │ Depends(require_read)
                                                   ▼
                                   security.verify_token → CurrentUser(role, facility_id)
                                                   ▼
                                   inventory_service.list_hospital_inventory(db, H01)
                                                   ▼
                                   SQLAlchemy → Postgres (Supabase pooler) or SQLite
                                                   ▼
                                   JSON: stock, DOS, stock-out date, risk, batches
```

**Helpdesk question:**

```text
Helpdesk page ──POST /api/v1/helpdesk/query + X-Hospital-Id──▶ get_helpdesk_scope
   (JWT authoritative, header fallback)  → hospital validated in DB
                                           ▼
                              helpdesk_service: gather live evidence
                              (risks, inventory, forecasts, procurement)
                                           ▼
                              Groq LLM (backend-side key) drafts grounded answer
                                           ▼
                              { answer, intent, evidence[], limitations, suggestions }
```

**Forecast + scenario:**

```text
Forecast page ──GET /api/v1/forecast/...──▶ forecast_service → LightGBM artifact → predictions
              ──POST /api/v1/simulation/run──▶ simulation_service → baseline vs surge comparison
```

---

## 4. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, react-router-dom, Recharts, Leaflet/react-leaflet, lucide-react, `@supabase/supabase-js` |
| Backend | Python 3.11+, FastAPI, Pydantic, SQLAlchemy, psycopg, supabase-py, `uv` |
| Database | Supabase PostgreSQL (+ PostGIS, RLS); local SQLite fallback (`data/medpredict.db`) |
| Auth | Supabase Auth (JWT: HS256 + ES256/RS256 via JWKS), FastAPI RBAC |
| ML | pandas, NumPy, scikit-learn, LightGBM, joblib (artifacts in `backend/ml/artifacts/`) |
| AI assistant | Groq LLM (`GROQ_API_KEY`, backend-only) |
| Testing | pytest (backend), `tsc --noEmit` + oxlint (frontend) |
| Ops | Docker/Compose (planned), Supabase CLI for local stack + migrations |

---

## 5. Project Structure

```text
Supply_Intelligence/
├── frontend/src/
│   ├── pages/        Dashboard, Inventory, Forecast, Shortage, Expiry,
│   │                 Redistribution, Priority, Requests, Helpdesk, Login, SignUp
│   ├── api/          medpredict.ts (typed API layer), forecast.ts, helpdesk.ts,
│   │                 client.ts (row shapes + risk bands), authToken.ts,
│   │                 supabase.ts, mockData.ts, plannedTransfers.ts
│   ├── context/      AuthContext.tsx (session, facility profile)
│   └── components/   RiskBadge, ForecastAlerts, OfferMap, UserProfileMenu, ...
├── backend/
│   ├── app/
│   │   ├── api/      auth, facilities, hospitals, medicines, inventory, demand,
│   │   │            forecasts, risks, procurement, simulation, dashboard,
│   │   │            redistribution, scenarios, assistant (mock), helpdesk, core_routes
│   │   ├── services/ inventory, forecast, risk, expiry, priority, procurement,
│   │   │            optimization, scenario, simulation, dashboard, helpdesk, assistant
│   │   ├── core/     config, security (JWT+RBAC), database (PG/SQLite), logging
│   │   ├── models/   7-table SQLAlchemy entities + schemas/
│   │   └── main.py   FastAPI entrypoint (GET /health)
│   ├── ml/           forecaster, train, artifacts (model + metrics.json)
│   ├── tests/        test_auth, test_contract, test_helpdesk, test_health, ...
│   └── scripts/ ...  (repo-root scripts/)
├── scripts/          seed_data.py, generate_data.py, load_synthetic_postgres.py,
│                     load_supabase.py, setup_postgres.py, mint_demo_token.py
├── data/             medpredict.db (seeded SQLite), synthetic/ dataset
├── supabase/         config.toml, migrations/, seed.sql, validation.sql
├── project.md        Full product + architecture specification (§1–§42)
├── PLAN.md / WORKPLAN.md  Frozen API contract + workstream plan
└── .env.example      All required environment variables
```

### Database schema (7 MVP tables)

`hospitals`, `medicines`, `supply_sources`, `supplier_medicines` (lead time, price, MOQ), `demand_history` (consumption, patient load, emergency, outbreak signal), `inventory_batches` (quantity, reserved, received/expiry dates), `purchase_orders` (ordered/received, status, expected delivery).

---

## 6. How to Run

### Prerequisites

- Python 3.11+ with [`uv`](https://docs.astral.sh/uv/), Node 18+, Docker Desktop (only for the full Supabase stack).

### Option A — quick local run (SQLite, no Docker)

```bash
# 1. Backend (uses data/medpredict.db when DATABASE_URL is empty)
cd /Users/skandaprasadk/Documents/Supply_Intelligence
DATABASE_URL="" uv run --project backend uvicorn app.main:app \
  --app-dir backend --port 8000 --host 127.0.0.1 --reload

# 2. Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173
```

### Option B — full stack (Supabase Postgres + Auth)

```bash
supabase start                    # local Postgres + Auth + PostGIS (needs Docker)
# set DATABASE_URL + SUPABASE_* in .env (see .env.example)
uv run --project backend uvicorn app.main:app --app-dir backend --port 8000 --reload
cd frontend && npm run dev
```

API docs: [http://localhost:8000/docs](http://localhost:8000/docs) · Liveness: `GET /health`

### Seed / train / test

```bash
python scripts/seed_data.py            # seed SQLite/Postgres with synthetic dataset
cd backend && uv run python -m ml.train  # train LightGBM, save artifacts + metrics
uv run pytest                          # backend test suite
cd ../frontend && npx tsc --noEmit     # frontend typecheck
```

Demo login (backend `/api/v1/auth/login` or offline fallback): `hospital-a@medipulse.health` / `supplyPass2026!` (facilities H01–H04).

---

## 7. Key API Reference

All `/api/v1/*` routes require auth unless the dev bypass is on. Convenience aliases exist under `/api/*` (see `app/api/__init__.py`).

```http
GET  /health                                              liveness probe (public)
POST /api/v1/auth/login        {email, password}          mint backend JWT
GET  /api/v1/auth/me                                      current caller
GET  /api/v1/hospitals | /api/v1/medicines               catalogs
GET  /api/v1/inventory?hospital_id=H01                   batch-level inventory + DOS
GET  /api/v1/risks/stockout?hospital_id=H01              shortage risks
GET  /api/v1/risks/expiry?hospital_id=H01                expiry/wastage risks
GET  /api/v1/procurement/recommendations?hospital_id=H01 order suggestions
GET  /api/v1/procurement/redistribution?hospital_id=H01  transfer suggestions
GET  /api/v1/dashboard?hospital_id=H01                   KPIs + alerts bundle
POST /api/v1/forecast/... | GET /api/forecast/{fac}/{med} demand forecast
POST /api/v1/simulation/run   {hospital_id, medicine_id, demand_increase_pct}
POST /api/v1/helpdesk/query   {question}  (+ X-Hospital-Id header)
GET  /api/v1/helpdesk/capabilities
GET  /api/state | /api/network | POST /api/redistribution/optimize
GET  /api/transfers/{id}/explain | POST /api/copilot     (frozen core contract)
```

---

## 8. Development Notes & Known Limitations

- **Testing-only auth bypass (never merge to `main`)** — `DEV_BYPASS_AUTH` in `backend/app/core/security.py` and `frontend/src/context/AuthContext.tsx`, plus the commented login gate in `frontend/src/App.tsx`, live only on the `dev/bypass-auth-for-testing` branch for local testing. `tests/test_auth.py` fails while bypassed (expects 401s).
- **SQLite fallback** is for local development; expiry-risk data may be sparse for some facilities (e.g. H01 currently returns `[]`) — a dataset property, not a bug.
- **Assistant copilot** (`/assistant/query`, `/api/copilot`) is still a mock fixture; the grounded Groq path lives in **Helpdesk**.
- **Prototype scope**: operational decision support only — no clinical/prescription use; no automatic execution of transfers; Supabase Edge Functions intentionally unused.
- Full spec: [`project.md`](project.md) (§1–§42). Frozen API contract: [`PLAN.md`](PLAN.md) §5.
