# Department & Supervisor Directory: handover guide

For the next developer. It explains what this microapp does, how it is built, how a request flows through it,
how it plugs into the Rizurf API Gateway, and how to run and change it. Last updated: 10 Nov 2026.

The Rizurf rules this app follows are in the files next to this one:
[RIZURF_API_TEMPLATE.md](RIZURF_API_TEMPLATE.md) (the service contract, rules "SS-1" to "SS-28"),
[MICROAPP_AUTH.md](MICROAPP_AUTH.md) (sign-in), [MICROAPP_PERFORMANCE.md](MICROAPP_PERFORMANCE.md) (speed) and
[MICROAPP_GATEWAY_BUTTON.md](MICROAPP_GATEWAY_BUTTON.md) (the gateway dock).

---

## 1. What it is

A small HR microapp for managing the company's **departments** and the **supervisors** who lead them.
People open it from the **Rizurf API Gateway** ("Your apps"), and other Rizurf services can call its API.

| Screen / feature | What it does |
|---|---|
| Departments tab | List, search, filter (by supervisor and status), sort, add, edit, delete departments |
| Supervisors tab | List, search, filter by status, sort, add, edit, delete supervisors |
| IDs | Created automatically: `DEP-0001`, `SUP-0001`, ... |
| Department ↔ supervisor | Each department points to one supervisor (`supervisorId`); deleting a supervisor leaves the department unassigned |
| Gateway dock | A small tab at the bottom-right that returns to the gateway's "Your apps" page |

Gateway listing (from `openapiSpec.js`): service id `department-api`, domain *Human Resources*, owner `hr-team`,
category *Operations*.

---

## 2. Architecture

```mermaid
flowchart LR
    U[Browser] -->|opens app_url '/'| S[Department microapp<br/>Express, server.js]
    U -->|sign in| G[Rizurf API Gateway]
    G -->|code -> identity token| S
    S -->|introspect session, JWKS keys| G
    O[Other Rizurf services] -->|Bearer access token<br/>department:* / supervisor:* scopes| S
    S -->|mysql2, TLS| DB[(MySQL<br/>department_db)]
```

One Node.js process serves both the web page and the JSON API. It holds no passwords of its own: people sign in
at the gateway, and the app only keeps a short signed cookie.

---

## 3. Technical stack

| Layer | Technology | File |
|---|---|---|
| Frontend | Plain HTML, CSS and JavaScript (no framework) | `index.html`, `styles.css`, `app.js` |
| Server | Node.js + Express 4 | `server.js` |
| API description | OpenAPI 3.0.3 with the `x-rizurf` gateway block | `openapiSpec.js` (served at `/openapi.json`) |
| Data access | Repository layer, parameterised SQL only, typed errors, 30 s read cache | `repository.js` |
| Database connection | mysql2 pool (small, reused, rebuilt after a fault), optional TLS | `db.js` |
| Schema | Tables created and seeded on first start if missing | `schema.js` (`schema.sql` is a reference copy) |
| Auth | Rizurf gateway OAuth code flow; RS256 tokens checked against the gateway's JWKS; HMAC-signed session cookie | `server.js` |
| Hosting | Vercel, Singapore region (`sin1`) | `vercel.json` |

---

## 4. Files

```
server.js         Express app: routes, auth, error envelope, /health, /openapi.json, boot
openapiSpec.js    the API contract + x-rizurf metadata the gateway reads
repository.js     all SQL for departments and supervisors; validation; error types
db.js             MySQL connection pool, query(), ping(), reset(), describe()
schema.js         CREATE TABLE IF NOT EXISTS + seed data when tables are empty
schema.sql        the same schema as plain SQL (reference / manual setup)
index.html        page layout, modals, gateway button script
app.js            frontend logic: load, render, search, sort, save, delete
styles.css        styling
.env.example      settings template
vercel.json       Vercel region
*.md              Rizurf rules this app follows (see top of this file)
```

---

## 5. Data model

| Table | Columns | Notes |
|---|---|---|
| `supervisors` | `id` (PK, e.g. `SUP-0001`), `firstName`, `lastName`, `email`, `status` (`Active`/`Inactive`), `created_at`, `updated_at` | |
| `departments` | `id` (PK, e.g. `DEP-0001`), `name`, `supervisorId` (FK → `supervisors.id`), `status`, `created_at`, `updated_at` | `ON DELETE SET NULL`, `ON UPDATE CASCADE`. If the database refuses foreign keys, a plain index is used instead |

Seed data (5 supervisors, 5 departments) is inserted only when a table is empty; existing data is never touched.

---

## 6. API

| Method | Path | Scope needed (service callers) | Result |
|---|---|---|---|
| GET | `/health` | none | `{status, service, version, uptime_seconds, checks.database}` |
| GET | `/openapi.json` | none | the contract |
| GET | `/api/departments` | `department:read` | list |
| POST | `/api/departments` | `department:write` | 201 + the new department |
| GET | `/api/departments/{id}` | `department:read` | one, or 404 |
| PUT | `/api/departments/{id}` | `department:write` | the updated department |
| DELETE | `/api/departments/{id}` | `department:write` | 204 |
| GET / POST / GET {id} / PUT {id} / DELETE {id} | `/api/supervisors...` | `supervisor:read` / `supervisor:write` | same pattern |

Every error uses one shape, with a correlation id that is also returned in the `x-correlation-id` header:

```json
{ "error": { "code": "RESOURCE_NOT_FOUND", "message": "...", "correlation_id": "...", "details": null } }
```

Codes: `UNAUTHORIZED` (401), `FORBIDDEN` (403), `RESOURCE_NOT_FOUND` (404), `METHOD_NOT_ALLOWED` (405),
`CONFLICT` (409: duplicate id, or supervisor still assigned), `VALIDATION_ERROR` (422),
`SERVICE_UNAVAILABLE` (503: database unreachable), `INTERNAL_ERROR` (500, never shows SQL or a stack trace).

---

## 7. End-to-end flows

### 7.1 A person opens the app from the gateway

```mermaid
sequenceDiagram
    participant B as Browser
    participant S as Department app
    participant G as Rizurf Gateway
    B->>S: GET /
    S-->>B: index.html
    B->>S: GET /auth/me
    S-->>B: authenticated: false
    B->>S: GET /auth/login
    S-->>B: redirect to gateway /oauth/authorize
    B->>G: sign in
    G-->>B: redirect to / ?code=...
    B->>S: GET /?code=...
    S->>G: POST /oauth/token (code)
    G-->>S: identity token (RS256)
    S->>G: GET /.well-known/jwks.json (cached)
    S-->>B: signed session cookie (15 min), redirect to /
```

Checks on the token: algorithm RS256, valid signature, `token_use = identity`, not expired,
`iss` = the gateway, `aud` = `department-api`.

### 7.2 Loading and saving data in the browser

1. `app.js` calls `GET /api/departments` and `GET /api/supervisors` with the session cookie.
2. For every API call the server asks the gateway `POST /oauth/introspect` whether the person's gateway session
   is still live (no cache). If the gateway can't be reached it **fails open** so a short outage doesn't lock
   everyone out. A dead session gets the cookie cleared and a 401, and the page sends the person back to sign in.
3. The `/api` gate pings the database (800 ms limit) and makes sure the tables exist; if not, it answers 503.
4. Saves (`POST`/`PUT`/`DELETE`) go through `repository.js`, which validates, runs parameterised SQL, clears the
   cache, and returns the saved row. The page then reloads from the database, the source of truth.
5. If the API is unreachable on first load, the page shows the last copy saved in the browser (`localStorage`)
   or the built-in sample data; open with `?local=1` to skip sign-in for local testing.

### 7.3 Another service calls the API

The caller sends `Authorization: Bearer <access token>` issued by the gateway. The app checks the token
(`token_use = access`) and that its `scope` includes the scope listed for that path in `openapiSpec.js`;
otherwise 401 or 403. Order of checks: wrong method (405), then auth (401/403), then not found (404).

---

## 8. Run it locally

```bash
npm install
```

```bash
npm start
```

Then open http://127.0.0.1:3000 (add `?local=1` to skip the gateway sign-in).

Settings go in `.env` (copy `.env.example`; never commit `.env`):

| Variable | Meaning |
|---|---|
| `PORT` | Port (default 3000) |
| `DATABASE_URL` | Optional single connection string `mysql://user:pass@host:3306/department_db`; wins over `DB_*` |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Database settings |
| `DB_SSL` | `require` (encrypt), `strict` (encrypt + verify), `false` (off) |
| `DB_POOL_LIMIT` | Max connections per process (keep small on Vercel; default 3) |
| `GATEWAY_URL` | The Rizurf gateway's base URL |
| `PUBLIC_URL` | This app's own public base URL (used for the sign-in redirect) |
| `SESSION_SECRET` | Long random text that signs the session cookie (must be set in production) |

The database user needs permission to create tables on first start (or run `schema.sql` once by hand).

---

## 9. Deploying

The app runs on **Vercel** (region `sin1`). Set the variables above in the Vercel project, deploy, then in the
gateway console choose **Connect a service** and paste the app's base URL. The gateway reads `/health` and
`/openapi.json` to check that the service follows the Rizurf contract.

Repositories: `Rizurf/department` (official) and `hosamnajib/department` (same code). Push to both.

---

## 10. Rules when changing it

- Add or change an endpoint in **both** `server.js` and `openapiSpec.js` (with its scope); the auth guard reads
  the scopes from the spec.
- Keep all SQL in `repository.js` and always use `?` placeholders.
- Every non-2xx response must use `sendError` (the error envelope), never HTML.
- Pages and auth redirects must stay `no-store` (`setNoStore`).
- Follow `RIZURF_API_TEMPLATE.md`, `MICROAPP_AUTH.md` and `MICROAPP_PERFORMANCE.md`.

---

## 11. Known limits

| Item | Detail |
|---|---|
| No automated tests | Check by hand: `/health`, `/openapi.json`, and add/edit/delete in both tabs |
| Fail-open session check | If the gateway is down, existing sessions keep working until the 15-minute cookie expires (by design) |
| 30-second read cache | Per server instance; another instance may show older data for up to 30 s |
| Sample data | The seed contains example names and emails; replace them for real use |

---

## 12. History

| Date | Change |
|---|---|
| 2 Oct 2026 | Gateway button (SS-28); performance work: `sin1` region, pool reuse, cheap health check, read cache, timeouts |
| 9 Sep 2026 | Database layer rebuilt as a proper data-access layer (SS-15) |
| 8 Sep 2026 | Gateway conformance fixes (405, bearer tokens, x-rizurf metadata), managed MySQL with TLS, gateway sign-in, frontend error handling |
| 8 Sep 2026 | First version: Department & Supervisor app with Rizurf API and MySQL |
