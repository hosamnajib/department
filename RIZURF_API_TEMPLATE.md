# Rizurf API Template

**Audience: the coding agent building a Rizurf microservice.**

This file is the whole template. There is no starter repo to clone and no
package to install — copying a repo means every service inherits a snapshot
that starts drifting the moment it is copied. What follows is the contract, in
full, plus the exact steps to attach the finished service to the gateway.

Build the service in whatever language and framework the team already uses.
The gateway only ever sees HTTP.

**You owe a specific answer at the end.** Section 5 defines exactly what to
print when the service is running — the address a human pastes into the
gateway. Do not finish without it.

> **Do not add a conformance test runner to the service.** The gateway runs the
> checks now, at `/conformance`. A checker living inside the thing it tests can
> be edited by the thing it tests, and N copies drift apart. There is one
> implementation and the service cannot alter it.

---

## 0. The short version

A service is connectable when it serves two documents, publicly, in under a
second:

| Path | Purpose |
|---|---|
| `GET /health` | Who this is, and whether it is well |
| `GET /openapi.json` | Everything it can do |

Everything the developer hub displays — name, domain, owner, endpoints,
methods, parameters, scopes — is read out of those two documents. Nothing is
typed into the gateway by hand, so nothing can disagree with the service.

---

## 1. The contract

Rules are numbered `SS-n` so a conformance report can point at one. **MUST** is
enforced; **SHOULD** is advice that shows as advisory.

### SS-1 — HTTP + JSON

Request and response bodies are JSON. Responses carry
`content-type: application/json`.

### SS-2 — `GET /health`

**MUST** return `200` with a JSON object. **MUST NOT** require authentication.
**SHOULD** answer in under 1s.

```json
{
  "status": "ok",
  "service": "maintenance-api",
  "version": "1.0.0",
  "checks": { "database": true, "scheduler": true }
}
```

- `status` — **MUST** be exactly `ok`, `degraded`, or `down`. Anything else is
  read as `down`.
- `service` — **MUST** be present. **This is the service's identity.** The
  gateway takes the id from here and from nowhere else, so a registration
  request cannot claim to be a service it does not run.
- `version` — SHOULD.
- `checks` — SHOULD. A map of dependency → reachable. This is what makes
  `degraded` meaningful rather than a guess.

Report `degraded` when the service is up but a dependency is not. A service
that returns `ok` while its database is unreachable has made its own health
endpoint worthless.

### SS-3 — `GET /openapi.json`

**MUST** return `200`, a valid OpenAPI **3.x** document, public, with a
non-empty `paths`, an `info.title` and an `info.description`. Every operation
**MUST** carry a `summary`.

`info.description` is one or two plain sentences saying what the service is
for, aimed at someone deciding whether to use it — not at someone already
reading your code. It is what the catalogue shows under the name. A service
that ships without one appears in the estate as a name and nothing else, which
is the same as not appearing at all.

`summary` was advisory and is now a **MUST** for the same reason: it becomes
the endpoint's line in the catalogue, and an endpoint with no description is
one nobody adopts.

### SS-23 — Catalog metadata

Two facts cannot be derived from any document, so declare them under
`x-rizurf` in `info`:

```json
"info": {
  "title": "Maintenance API",
  "version": "1.0.0",
  "x-rizurf": { "domain": "Operations", "owner": "operations-team" }
}
```

- `domain` — which part of the business this belongs to. Groups the catalog.
- `owner` — the team to contact when it breaks.
- `app_url` — **optional.** Where a human opens this micro app, if it has a
  face as well as an API. The catalog shows an "Open app" button for it.

Most Rizurf services are micro apps: a small UI plus the API behind it. Declare
`app_url` relative — `"/"` or `"/console"` — and the gateway resolves it
against the address it already knows, so your service never has to be told its
own public hostname. An absolute URL is honoured if the UI lives elsewhere.

```json
"x-rizurf": { "domain": "Operations", "owner": "operations-team", "app_url": "/" }
```

Omit it for an API-only service. A button that 404s is worse than no button, so
nothing is inferred — a missing `app_url` simply means no link.

**If you serve a UI, add its path to your public list.** A browser cannot send
a bearer token before the user has signed in, so the page itself is public even
though the API behind it is not:

```js
const PUBLIC_PATHS = new Set(["/health", "/openapi.json", "/"]);
```

`x-` keys keep the document valid OpenAPI, and riding inside a document the
service already publishes means this can never drift from the API it labels.
Omit it and the service lands under **Uncategorised** with no owner.

### SS-27 — Discovery metadata

The catalogue is not a list of endpoints. It is meant to answer *"what can this
platform do, and which call do I need?"* for someone who does not know your
service exists and cannot guess your route names. Everything in this rule
exists so that question can be answered — by a person browsing, and by the AI
that searches on their behalf.

None of it can be derived from an OpenAPI document. A path and a schema say
*how* to call something; they never say *when you should*, *when you should
not*, or *what you would call next*. So it is declared, and it is a **MUST**.

#### Service level — `info.x-rizurf`

```json
"info": {
  "title": "Payment Service",
  "description": "Manage payments, transactions and refunds across the platform.",
  "version": "1.0.0",
  "x-rizurf": {
    "domain": "Finance",
    "owner": "payments-team",
    "app_url": "/",
    "category": "Finance & Payments",
    "industries": ["Finance", "Operations"],
    "use_cases": [
      "Customer checkout",
      "Bill payments",
      "Subscription payments",
      "Refund processing"
    ],
    "capabilities": [
      {
        "name": "Take Payments",
        "icon": "💳",
        "description": "Start a payment and follow it through to a result.",
        "does": ["Create a payment", "Check whether a payment succeeded"],
        "best_for": "Applications that need to charge a customer and know the outcome.",
        "endpoints": ["POST /payments", "GET /payments/{id}"]
      },
      {
        "name": "Review Transactions",
        "icon": "📄",
        "description": "Look up what has already been charged.",
        "does": ["Retrieve a transaction"],
        "best_for": "Applications that need a record of past activity.",
        "endpoints": ["GET /transactions/{id}"]
      },
      {
        "name": "Refund Payments",
        "icon": "↩️",
        "description": "Return money for a payment that already went through.",
        "does": ["Refund a payment"],
        "best_for": "Support and finance flows that reverse a charge.",
        "endpoints": ["POST /payments/{id}/refund"]
      }
    ],
    "workflows": [
      {
        "name": "Typical payment flow",
        "steps": ["POST /payments", "GET /payments/{id}", "GET /payments/{id}/receipt"]
      }
    ],
    "related_services": ["customer-api", "billing-api", "notification-api"]
  }
}
```

| Field | Required | What it is for |
|---|---|---|
| `category` | **MUST** | One of the catalogue's browse categories (below). Groups the service for someone browsing rather than searching. |
| `industries` | **MUST**, non-empty | Which of the platform's industry groupings this service serves — see the list below. Most services serve more than one; declare all that apply, not just the primary one. This is what /explore's own sections are organised by — a service that leaves it undeclared still shows up (grouped by a best-effort guess from its id), but under a heading nobody actually chose for it. |
| `use_cases` | **MUST**, non-empty | The situations this service is normally reached for, in a user's words. This is the single strongest signal the AI has for *when to recommend you*. |
| `capabilities` | **MUST**, non-empty | Endpoints grouped by what they accomplish. A flat list of twelve routes tells nobody what the service *does*; three named groups do. Each group carries `name`, `icon`, `description`, `does` and `best_for` as well as `endpoints` — see below. |
| `workflows` | **MUST**, non-empty | The orders these endpoints are actually called in. Most tasks need several calls, and the order is not guessable from the document. |
| `related_services` | **MUST**, may be `[]` | Service ids this one depends on or is normally used with. Empty is a real answer; a missing key is not. |

Categories: `Identity & Authentication`, `Finance & Payments`, `Billing`,
`Commerce`, `Customer Management`, `Notifications`, `Documents`, `Analytics`,
`Reporting`, `Utilities`, `Operations`.

Industries: `Main Database`, `Human Resources`, `Marketing`, `Sales`,
`Finance`, `IT`, `Operations`, `Legal`, `Support`. Exactly these — an entry
that doesn't match one of them (a typo, a made-up name, the wrong case) is
dropped rather than shown as a section nobody asked for, and is exactly what
`/conformance` checks for. `Main Database` is for foundational data services
other services build on — a core record store, an identity/records-of-truth
system — not for something that merely uses one; most services still belong
under the business function they serve, not this one.

##### Inside one `capabilities` entry

| Field | Required | What it is for |
|---|---|---|
| `name` | **MUST** | Two or three words for what the group accomplishes — `Take Payments`, not `Payments API`. |
| `icon` | **MUST** | A single emoji. The catalogue prints the groups as a list, and an icon is what makes one findable again after scrolling past it. |
| `description` | **MUST** | One sentence on what this group is for. |
| `does` | **MUST**, non-empty | What the group lets somebody *do*, one short phrase each, in their words — `Refund a payment`, not `POST /payments/{id}/refund`. The route is already in `endpoints`; this is the same thing said to a person. |
| `best_for` | **MUST** | Who reaches for this group and why. Write the words that follow "Best for:" — the catalogue prints the label itself. |
| `endpoints` | **MUST**, non-empty | The operations in the group, as `"METHOD /path"`, matching the document exactly. |

A group of only a name and a list of routes is a heading over some paths,
which is the flat endpoint list again with an extra step. The catalogue
renders every field above, so a service that declares the grouping *without*
the words gets a worse page than one that declares nothing and is grouped by
AI instead. Declare all six.

#### Endpoint level — `x-rizurf` on each operation

```json
"post": {
  "summary": "Create a new payment transaction for a customer.",
  "x-rizurf": {
    "name": "Create Payment",
    "purpose": "Initiate a payment",
    "use_when": [
      "A customer needs to pay a bill",
      "An application needs to start a transaction"
    ],
    "do_not_use_when": [
      "Checking whether an existing payment succeeded",
      "Retrieving transaction history"
    ],
    "inputs": ["customer_id", "amount", "currency"],
    "outputs": ["payment_id", "status", "transaction_reference"],
    "requires": ["Authenticated caller", "Customer must exist"],
    "related_endpoints": ["GET /payments/{id}", "POST /payments/{id}/refund"],
    "tags": ["payment", "pay", "checkout", "transaction", "billing"]
  }
}
```

| Field | Required | What it is for |
|---|---|---|
| `name` | **MUST** | A short label, two to four words, title case — `Create Payment`, `Open Signing Page`. This is a *name*, not a sentence: it heads the endpoint in the catalogue and fills the boxes of a workflow diagram, where a route is unreadable and a summary is too long. `summary` stays a sentence; this is not a duplicate of it. |
| `purpose` | **MUST** | One line: what calling this accomplishes, in a user's words. |
| `use_when` | **MUST**, non-empty | The situations this is the right call for. |
| `do_not_use_when` | **MUST**, may be `[]` | The situations it is the *wrong* call for. Stops the AI recommending "create a payment" to somebody who only wanted to check one. |
| `inputs` / `outputs` | **MUST**, may be `[]` | The fields that matter, by name. Lets a search match on the data someone already holds, or the data they need to end up with. |
| `requires` | **MUST**, may be `[]` | What must already be true before this call can work. |
| `related_endpoints` | **MUST**, may be `[]` | What is normally called before or after this. |
| `tags` | **MUST**, non-empty | Synonyms a user might search by — `pay`, `checkout`, `purchase` all pointing at the same endpoint. The AI matches intent against these, not against your route name. |

Where an array may be `[]`, the **key** is still required. "This endpoint has no
preconditions" and "nobody thought about the preconditions" are different
answers, and only one of them should be trusted by something making
recommendations.

#### Why this is enforced rather than encouraged

It was advisory, and the result was services connecting with an empty
description and no metadata at all — a catalogue entry with a name, and nothing
to search, sort, group or recommend on. Advice that is skipped produces exactly
the catalogue this standard exists to prevent, so this is checked at
`/conformance` and a service missing it does not reach the approval queue.

### SS-4 — `X-Correlation-ID`

**MUST** reuse the caller's `X-Correlation-ID` when present, mint one when
absent, and **MUST** echo it on every response including errors. Forward it on
outbound calls. Without this, one user-visible failure cannot be traced across
the services that produced it.

### SS-5 — The error envelope

**Every** non-2xx response **MUST** have this body and nothing else:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "No job with that id.",
    "correlation_id": "7f3c…",
    "details": null
  }
}
```

- `code` — `UPPER_SNAKE_CASE`, stable, machine-readable. Callers branch on
  this, so never change what a code means; add a new one.
- `message` — safe to show a developer. **MUST NOT** contain SQL, stack
  traces, connection strings or secrets. The checker fails this on sight.
- `correlation_id` — the id from SS-4, so a bug report can quote it.

Reserved codes, used identically by every service:

| Code | Status |
|---|---|
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `RESOURCE_NOT_FOUND` | 404 |
| `METHOD_NOT_ALLOWED` | 405 |
| `CONFLICT` | 409 |
| `VALIDATION_ERROR` | 422 |
| `INTERNAL_ERROR` | 500 |

Add domain-specific codes freely (`JOB_ALREADY_CLOSED`). Never redefine the
ones above.

### SS-6 — Authentication

Every endpoint that is not public **MUST** require
`Authorization: Bearer <token>` and **MUST** answer `401` with the envelope
when it is missing.

**Declaring a scope is not the same as enforcing one.** The most common real
failure is an endpoint that advertises `maintenance:read` in its document and
serves data to anyone who asks. The gateway probes exactly this before
approval, and a `200` to an anonymous caller is a hard fail.

**Presence is not verification.** Checking that a header *looks like* a bearer
token — `/^Bearer\s+\S+/` and nothing more — accepts the string `Bearer x`.
Your service **MUST** verify the token cryptographically (SS-25) and **MUST**
check it carries the scope the operation declares. The gateway issues real
access tokens for exactly this; there is no longer any excuse for a presence
check.

**Read the required scope from your own OpenAPI document**, rather than
hardcoding it beside the handler. The failure this rule exists to catch is a
service that declares `maintenance:read` and never checks it — and that can
only happen when the declaration and the enforcement are two separate pieces
of text that can drift apart. Derive one from the other and they cannot.

Return **`401`** when the token is missing, malformed, or unverifiable, and
**`403`** when it verifies but lacks the scope — the caller needs to know
whether to fix their credential or ask for more access.

### SS-24 — Do not build your own login

> **Building a UI a human signs into? Stop reading this file after SS-25 and
> switch to `MICROAPP_AUTH.md`.** It is the complete, proven implementation of
> everything SS-24 and SS-25 require — token verification, the sign-in flow,
> auto-lock, session expiry, the `no-store` header, and the exact bugs that
> shipped from getting each of those subtly wrong. This file states the
> rules; that one is the code.

**Your micro app MUST NOT have its own user table, its own password storage,
or its own sign-in screen.** This is the rule most likely to be broken by
accident, because every web framework makes a login page easy and it feels like
the app's own business.

It is not. Split the two things that look like one:

| | Who owns it | Why |
|---|---|---|
| **Authentication** — *who is this person?* | **The gateway. Always.** | One password, one place to revoke |
| **Authorization** — *what may they do in THIS app?* | **Your app, if it needs to** | Only your app knows what "scheduler" means |

So: your app may absolutely keep a table of local roles — `alice@rizurf is a
scheduler here` — keyed by the identity the gateway asserts. What it must never
keep is `alice@rizurf, password hash, ...`.

**Why this is not negotiable.** Ten micro apps with their own logins means ten
password databases, ten breach surfaces, and ten places to remember when
someone leaves the company. The one you forget is the one that matters. It also
means every employee juggles ten passwords, which in practice means one
password reused ten times.

The gateway is the issuer, and this is a real, working flow — not a future
plan. Three endpoints, all served by the gateway:

| Endpoint | Purpose |
|---|---|
| `GET /oauth/authorize?redirect_uri=...` | Send an unauthenticated visitor here |
| `POST /oauth/token` | Your app's own backend trades a code for an identity token |
| `GET /.well-known/jwks.json` | The public key you verify that token against |

**The flow:**

1. Visitor hits your app with no session. Redirect them to
   `${GATEWAY_URL}/oauth/authorize?redirect_uri=${PUBLIC_URL}/`. The
   `redirect_uri` **must** be an address the gateway already knows you at —
   your registered `baseUrl` or the `app_url` you declared. Anything else is
   refused; the gateway will not send an identity code to a stranger.
2. If they are not signed in to the gateway, they see its login page, then
   land back at step 1 automatically.
3. The gateway redirects them to `your-redirect_uri?code=...` — a one-time
   code, not the identity token. Nothing sensitive sits in a URL, browser
   history, or an access log.
4. **Your app's own backend** — never the browser — `POST`s that code to
   `${GATEWAY_URL}/oauth/token` with `{ code, redirect_uri }` and gets back a
   short-lived signed token.
5. Your app verifies the signature itself against the gateway's published
   public key (SS-25, below), checks `iss`/`aud`/`exp`/`token_use`, and only
   then starts its **own** session — a cookie your app controls, signed or encrypted the
   same way this gateway signs its own (see `lib/auth/session.ts` in the
   gateway's codebase for the pattern to copy: HMAC-signed, `HttpOnly`,
   short-lived).

**Config your app needs**, per SS-20 — from the environment, not guessed:

```
GATEWAY_URL=http://127.0.0.1:4301   # where the gateway is
PUBLIC_URL=http://127.0.0.1:3400    # your own address, as the gateway knows it
```

`iss` on the token is checked against your own `GATEWAY_URL` — **not** derived
from the incoming request. Do not read your own origin from request headers
for anything security-sensitive; a client can set a `Host` header to whatever
it likes.

**Give your session an expiry, and treat an expired one as absent.** This is
the number that decides how long your app can keep letting someone in after
their access was taken away at the gateway. Fifteen minutes is a reasonable
default: short enough that revoked access closes quickly, long enough not to
redirect on every page view. On expiry, silently re-run the flow from step 1 —
if the gateway session is still good the user notices nothing.

A session with **no** expiry never re-checks anything, so a gateway sign-out
never reaches it. That is not a small bug; it is an account that stays open.

**The gateway is the only place anyone signs out.** Do not put a sign-out
button in your app. One place to sign in, one place to sign out — an app that
signs someone out of itself but not the gateway (or the reverse) creates a
state where the two disagree, and that confusion is worse than the missing
button.

**Check the gateway session on every request.** Keep the `sid` from the
identity token in your session and ask:

```js
const { active } = await fetch(`${GATEWAY_URL}/oauth/introspect`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sid: session.sid, sub: session.sub }),
}).then((r) => r.json());

if (!active) { /* clear your cookie, redirect to /oauth/authorize */ }
```

This is what makes the rule simple and true at every moment: **signed in at
the gateway means access here, signed out means none.** It also catches a
suspended account, not just a sign-out.

**Do not cache the answer.** A cache is exactly a window in which your app and
the gateway disagree about whether someone still has access. The cost of
checking is one request on the internal network returning one bit — cheap
enough that buying a stale-access window with it is a bad trade.

**Fail open** on a network error, though: a gateway that is briefly
unreachable must not sign everyone out of every app at once. Your session
expiry is the backstop for a gateway that stays down.

**Send `Cache-Control: no-store` on every authenticated page and auth
redirect.** This is not a detail — without it, none of the above works.

A browser is free to keep its own copy of a page that says nothing about
caching. Refresh, or press Back, and it serves that copy **without asking your
server at all** — so the check above never runs, and someone who signed out
still sees their page. It looks exactly like broken sign-out, and it is
invisible to `curl`, which never caches. If you test only with `curl`, you
will not find this.

```js
const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
  pragma: "no-cache",
  expires: "0",
};
```

`no-store` is the one that matters (it also keeps the page out of the
back/forward cache); the others are for older browsers and proxies. Most
full-stack frameworks already do this for dynamically-rendered pages — Next.js
does — but if you are writing responses by hand, nothing sets it for you.

**No client secret.** The trust boundary is the code itself — single-use,
expires in under a minute, and bound to the exact `redirect_uri` it was issued
for. That is proportionate for a first-party service inside one company's
network; do not copy this pattern for anything a stranger can call.

If you think your app genuinely needs its own login, it almost certainly needs
a local *role* instead. Ask before building one.

### SS-25 — Verify the token, never the route it arrived by

Assume every request reached you **directly**, with no gateway in front of it.
Someone on the network, a misconfigured firewall, a port left open in
development — any of these puts a caller at your door without passing anything
on the way.

So your app **MUST** decide who a caller is from **the token they present**,
verified cryptographically, and **MUST NOT** infer anything from how the
request arrived.

**The anti-pattern that gets built by accident:**

```js
// CATASTROPHIC. Anyone who can reach this app directly just sets the header.
const user = req.headers["x-authenticated-user"];
if (user) { /* trusted! */ }
```

A header is not proof. The gateway setting it does not stop anyone else
setting it. If your app is reachable at all — and one day it will be, by
accident — that line is a complete authentication bypass with no password
required.

**What to do instead.** The gateway signs its tokens (RS256) with a private
key and publishes the matching public key at its JWKS endpoint. Verify every
token yourself — do not trust that a request came through the gateway just
because it looks like it did.

If your stack has a maintained JWT/JWKS library (`jose` in Node, `pyjwt` +
`cryptography` in Python, most languages have one), use it — this is exactly
the kind of code not worth hand-rolling. If you want zero dependencies, your
runtime's own crypto primitives are enough; do not hand-roll the RSA math
itself, only the JWT plumbing around a real `verify` call. This is the whole
thing, dependency-free, proven working against this gateway:

```js
const { createPublicKey, verify: cryptoVerify } = require("node:crypto");

let jwksCache = null;   // fetched once; the key only changes on a gateway redeploy

async function verifyToken(token, expectedUse, gatewayUrl, thisServiceId) {
  const [headerB64, payloadB64, sigB64] = token.split(".");
  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString());
  if (header.alg !== "RS256") throw new Error(`Unexpected algorithm "${header.alg}".`);

  if (!jwksCache) jwksCache = await (await fetch(`${gatewayUrl}/.well-known/jwks.json`)).json();
  const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error(`No key "${header.kid}" in the gateway's JWKS.`);
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });

  // RS256 = RSASSA-PKCS1-v1_5 with SHA-256 — Node's default for an RSA key.
  // The cryptography is Node's; nothing here re-implements RSA.
  const signingInput = `${headerB64}.${payloadB64}`;
  const ok = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(signingInput),
    publicKey,
    Buffer.from(sigB64, "base64url"),
  );
  if (!ok) throw new Error("Signature does not verify.");

  const claims = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  if (claims.exp * 1000 < Date.now()) throw new Error("Token has expired.");
  if (claims.iss !== gatewayUrl) throw new Error(`Unexpected issuer "${claims.iss}".`);
  if (claims.aud !== thisServiceId) throw new Error(`Token was not minted for "${thisServiceId}".`);

  // NOT optional. The gateway signs two kinds of token with the same key,
  // both carrying aud = your service: a five-minute "identity" assertion
  // proving a human signed in, and an "access" token issued to a program.
  // Without this check either can be presented where the other is expected —
  // a human's sign-in assertion replayed as a machine credential.
  if (claims.token_use !== expectedUse) {
    throw new Error(`Expected a "${expectedUse}" token, got "${claims.token_use ?? "none"}".`);
  }

  return claims;
}
```

Call it as `verifyToken(token, "identity")` on the sign-in leg and
`verifyToken(token, "access")` on your API.

Then check, in this order, and reject with `401` on any failure:

| Claim | Check | Why |
|---|---|---|
| signature | verifies against the gateway's public key | proves the gateway issued it |
| `iss` | is your gateway | a token from elsewhere is not yours |
| `aud` | names your service | stops a token for another service being replayed at you |
| `exp` | not in the past | a leaked token stops working |

This identity token is deliberately thin — `sub`, `email`, `name`, `role`, and
nothing else. It proves who is signed in, once, to bootstrap your app's own
session; it does not carry scopes and is not meant to be held onto as an API
credential. `role` is the gateway's console role (admin/platform/developer/
viewer) — a hint, not an instruction, since it describes access to the
*gateway*, not to your app. What a caller may do inside your app, per SS-6 and
SS-7, is your app's own decision from here (SS-24) — usually a local role
table keyed to `sub` or `email`.

Your app holds **only the public key**. There is nothing secret in it to leak,
and it needs no shared password with the gateway — which is exactly why RS256
was chosen over a shared secret.

**This is defence in depth, not belt-and-braces.** The gateway being in the
request path is one control; the signature check is another; the private
network is a third. Bypassing any single one must not be enough. A service that
is safe only because it is hard to reach is not safe — it is undiscovered.

### SS-26 — Calling another service (programs, not people)

Everything above is about *receiving* a call. This is how your service, a
scheduled job, or a script *makes* one.

A program has no browser and no password, so it does not use the sign-in flow.
It gets an **API client** — a `client_id` and `client_secret` an administrator
issues in the console — and trades them for a scoped access token:

```bash
curl -u "$CLIENT_ID:$CLIENT_SECRET"      -H "content-type: application/json"      -d '{"grant_type":"client_credentials","audience":"maintenance-api"}'      "$GATEWAY_URL/oauth/token"
```

```json
{ "access_token": "eyJ…", "token_type": "Bearer",
  "expires_in": 3600, "scope": "maintenance:read" }
```

Then call with `Authorization: Bearer <access_token>`.

- **`audience` is required and is a service id**, not a URL — the `service`
  field from its `/health`. One token, one target service, so a token handed
  to one service can never be replayed against another.
- **Ask for less than you hold.** Omit `scope` and you get everything granted
  for that audience; pass `scope` to narrow it. A job that only reads should
  request only `:read`, so a bug in it cannot write.
- **Requesting an ungranted scope is a `403`, not a silent narrowing.** You
  find out at the door, not halfway through a run.
- **Cache the token until it expires** — roughly an hour. Fetching a new one
  per request is pointless load on the gateway.
- **The secret is shown once**, at creation. Nothing stores the plaintext, so
  it cannot be recovered — if it is lost, revoke the credential and issue
  another. Keep it in your environment (SS-20), never in the repo.

**Forward the correlation id** (SS-4) on these calls, or a failure that
crosses two services cannot be traced through both.

### SS-7 — Scopes

Name them `resource:action` — `maintenance:read`, `maintenance:write`. Declare
per operation, so the gateway can build the endpoint→scope map:

```json
"security": [{ "bearerAuth": ["maintenance:read"] }]
```

### SS-8 — What is public

`/health`, `/openapi.json`, and `/docs` if you serve it. **Nothing else.**

### SS-9 to SS-12 — Resources, methods, validation, pagination

- Plural nouns, no verbs: `/jobs`, `/jobs/{id}`. Never `/getJobs`.
- `POST` → `201`; `GET` → `200`; `PATCH` → `200`; `DELETE` → `204` with an
  empty body.
- `PATCH` leaves absent fields alone; an explicit `null` clears.
- `DELETE` on a missing id is `404`, **never** a silent `204`.
- Invalid body → `422` + `VALIDATION_ERROR`, with the offending fields in
  `details`.
- Lists accept `?limit=` and `?offset=`. An oversized `limit` is **clamped to
  the maximum, not rejected**. `limit=0` or `offset=-1` are `422`.

### SS-13 — A service's database is private. The one hard rule.

Never read or write another service's tables. Call its API. Break this and the
estate is a distributed monolith with none of a monolith's advantages —
you will not be able to deploy, migrate or reason about anything separately.

### SS-15 — Data access layer

Database access goes through a module that does **not** import the web
framework, so it is equally usable from a worker or a CLI. Parameterised SQL
only. Reads return (a missing row is an ordinary answer); writes raise (a write
that affects zero rows is a bug worth surfacing).

### SS-20 — Configuration

From the environment, never from a file in the repo. Fail at startup with a
message naming the missing variable — not on the first request that needs it.

---

## 2. Reference implementation

Below is a complete, conformant service in one dependency-free file — the exact
shape that scores **45 checks passed, 0 failed**. It is deliberately not a
framework example, so every rule above is visible as ordinary code rather than
hidden in middleware. Port it to whatever stack you are using; keep the
structure.

The four things most services get wrong, all visible here:

1. **Unrouted paths must return the envelope, not framework HTML.** Every
   framework ships an HTML 404 by default. You must override it.
2. **A wrong method on a real path is 405**, and the framework will answer
   first unless you handle it.
3. **Declaring `security` is not enforcing it.** The check calls your endpoint
   with no token and fails on a 200.
4. **The correlation id** must be echoed on *every* response, errors included.

```js
const http = require("node:http");
const { randomUUID } = require("node:crypto");

const PORT = Number(process.env.PORT ?? 3400);
const SERVICE_ID = "example-api";
const VERSION = "1.0.0";
const CORRELATION_HEADER = "x-correlation-id";

// SS-8 — the only paths that answer without a token.
const PUBLIC_PATHS = new Set(["/health", "/openapi.json"]);

const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Example API",
    version: VERSION,
    description: "What this service is for.",
    "x-rizurf": { domain: "Operations", owner: "your-team" },   // SS-23
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
  },
  paths: {
    "/health": { get: { summary: "Liveness and dependency checks" } },
    "/openapi.json": { get: { summary: "This document" } },
    "/things": {
      get: { summary: "List things", security: [{ bearerAuth: ["thing:read"] }] },
      post: { summary: "Create a thing", security: [{ bearerAuth: ["thing:write"] }] },
    },
    "/things/{id}": {
      get: { summary: "Fetch one thing", security: [{ bearerAuth: ["thing:read"] }] },
    },
  },
};

const started = Date.now();

function sendJson(res, cid, status, body) {
  res.writeHead(status, { "content-type": "application/json", [CORRELATION_HEADER]: cid });
  res.end(JSON.stringify(body));
}

// SS-5 — one error path, used for every non-2xx response.
function sendError(res, cid, status, code, message, details = null) {
  res.writeHead(status, { "content-type": "application/json", [CORRELATION_HEADER]: cid });
  res.end(JSON.stringify({ error: { code, message, correlation_id: cid, details } }));
}

function matchRoute(pathname) {
  if (openapi.paths[pathname]) return pathname;
  if (/^\/things\/[^/]+$/.test(pathname)) return "/things/{id}";
  return null;
}

http.createServer((req, res) => {
  // SS-4 — reuse the caller's id, mint one when absent.
  const supplied = req.headers[CORRELATION_HEADER];
  const cid = typeof supplied === "string" && supplied.trim() ? supplied : randomUUID();

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = (req.method ?? "GET").toUpperCase();
  const route = matchRoute(pathname);

  // SS-5 — unrouted path. NOT framework HTML.
  if (!route) return sendError(res, cid, 404, "RESOURCE_NOT_FOUND", `No route for ${pathname}.`);

  // SS-5 — path exists, verb does not. Before auth, so a wrong method on a
  // public path is not reported as an auth problem.
  const allowed = Object.keys(openapi.paths[route]).map((m) => m.toUpperCase());
  if (!allowed.includes(method)) {
    res.setHeader("allow", allowed.join(", "));
    return sendError(res, cid, 405, "METHOD_NOT_ALLOWED", `${method} is not allowed on ${pathname}.`);
  }

  // SS-6/SS-7 — a REAL token: signed by the gateway, minted for this service,
  // of the right kind, carrying the scope this operation declares. The
  // required scope is read from the OpenAPI document above, never hardcoded
  // here, so the declaration and the enforcement cannot drift apart.
  if (!PUBLIC_PATHS.has(route)) {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
    if (!match) return sendError(res, cid, 401, "UNAUTHORIZED", "A bearer token is required.");

    return void (async () => {
      let claims;
      try {
        claims = await verifyToken(match[1], "access");   // see SS-25
      } catch (error) {
        return sendError(res, cid, 401, "UNAUTHORIZED", String(error.message ?? error));
      }

      const required = (openapi.paths[route][method.toLowerCase()]?.security ?? [])
        .flatMap((requirement) => Object.values(requirement))
        .flat();
      const held = new Set(String(claims.scope ?? "").split(/\s+/).filter(Boolean));
      const missing = required.filter((scope) => !held.has(scope));

      // 403, not 401: the token is valid, it simply does not carry enough.
      if (missing.length > 0) {
        return sendError(res, cid, 403, "FORBIDDEN", `This endpoint needs ${missing.join(", ")}.`,
          { required, granted: [...held] });
      }

      handleApiRoute(req, res, cid, route, method, claims);
    })().catch(() => sendError(res, cid, 500, "INTERNAL_ERROR", "Unexpected error."));
  }
  // verifyToken() is in SS-25 above — paste it in alongside this.

  if (route === "/health") {
    // SS-2 — `service` is the identity the gateway records.
    return sendJson(res, cid, 200, {
      status: "ok",
      service: SERVICE_ID,
      version: VERSION,
      uptime_seconds: Math.floor((Date.now() - started) / 1000),
      checks: { database: true },
    });
  }
  if (route === "/openapi.json") return sendJson(res, cid, 200, openapi);

  return sendError(res, cid, 501, "NOT_IMPLEMENTED", "Not implemented.");
}).listen(PORT, () => console.log(`${SERVICE_ID} listening on http://127.0.0.1:${PORT}`));

/**
 * The authenticated surface. Only reached after the token verified and its
 * scopes checked, so `claims` here is proven rather than assumed.
 */
function handleApiRoute(req, res, cid, route, method, claims) {
  if (route === "/things" && method === "GET") {
    return sendJson(res, cid, 200, { things: [], called_by: claims.sub });
  }
  if (route === "/things/{id}" && method === "GET") {
    // SS-10 — a missing id is 404, never a silent empty success.
    return sendError(res, cid, 404, "RESOURCE_NOT_FOUND", "No thing with that id.");
  }
  return sendError(res, cid, 501, "NOT_IMPLEMENTED", "Not implemented.");
}
```

### The pieces that matter, restated

```js
// SS-4 — reuse the caller's id, or mint one.
const correlationId = req.headers["x-correlation-id"]?.trim() || randomUUID();

// SS-5 — one error path, used everywhere.
function sendError(res, correlationId, status, code, message, details = null) {
  res.writeHead(status, {
    "content-type": "application/json",
    "x-correlation-id": correlationId,
  });
  res.end(JSON.stringify({ error: { code, message, correlation_id: correlationId, details } }));
}

// SS-5 — unrouted paths get the envelope, never framework HTML.
if (!route) return sendError(res, correlationId, 404, "RESOURCE_NOT_FOUND", `No route for ${pathname}.`);

// SS-5 — the path exists, the verb does not. Checked BEFORE auth, so a wrong
// method on a public path is not mistaken for an auth problem.
if (!allowed.includes(method)) {
  res.setHeader("allow", allowed.join(", "));
  return sendError(res, correlationId, 405, "METHOD_NOT_ALLOWED", `${method} is not allowed on ${pathname}.`);
}

// SS-6 — anything not explicitly public needs a token.
if (!PUBLIC_PATHS.has(route) && !/^Bearer\s+\S+/i.test(req.headers.authorization ?? "")) {
  return sendError(res, correlationId, 401, "UNAUTHORIZED", "A bearer token is required.");
}
```

---

## 3. Check it before asking to connect

Open the hub, go to **Conformance**, paste the service's address, run it.

**This is not optional.** The gateway runs the same checks when you request a
connection, and a service with any failure is refused before it reaches the
approval queue — an administrator never sees it. Running it here first just
means finding out on your own terms.

Every request the checker makes is a read — it never creates, changes or
deletes anything — so it is safe against a live service. Run it again after
every deploy; a refactor can silently break a rule.

**Fix every `FAIL` before requesting a connection.** Advisories are advice.

### What the checker cannot prove

A clean report means *everything checkable from outside passed*. It is not a
statement about the code behind the API.

| Rule | Why not |
|---|---|
| SS-13 | Database ownership — needs a look at the code. |
| SS-15 | A DAL exists — internal structure. |
| SS-17 | Migrations — internal structure. |
| SS-21 | Logging — invisible to a caller. |
| SS-10 / SS-11 / SS-12 | Write behaviour, validation and pagination need `POST`, `PATCH` and `DELETE` against real data. **The gateway will not mutate a live service to test it.** Verify these yourself. |

That last row is the agent's job. Write tests that create a resource, patch one
field and confirm the others are untouched, delete it, confirm it is gone, and
confirm a second delete is `404` rather than `204`.

---

## 4. Connect it to the gateway

Two routes. Both land in the same approval queue, and both run through the same
checks — the gateway verifies by calling the service itself, so the request
body is a hint, never a fact.

### Route A — from the console (preferred)

1. Sign in to the hub.
2. **Connect a service** → paste the base URL → **Request connection**.
3. Confirm the details it read back describe the service you meant.
4. An administrator approves it in **Connections**.

Nothing is added to the service. **No token, no registration call, no
gateway-specific code** — it serves its two documents and stays unaware the
gateway exists.

### Route B — the service asks on startup

For anything deployed automatically, where nobody is present to paste a URL:

```http
POST ${GATEWAY_URL}/api/registry/register
authorization: Bearer ${GATEWAY_REGISTRATION_TOKEN}
content-type: application/json

{ "base_url": "http://maintenance-api:3320" }
```

- `201` — registered, awaiting approval.
- `200` — already approved at this address; a redeploy needs no new approval.
- `422` — refused. The body says why.

Send it once at startup and **do not fail startup if it fails**. A service that
will not boot because the gateway is unreachable has made the gateway a
dependency of everything, which is the coupling this design exists to avoid.

### Rules the gateway applies either way

- **Identity comes from your `/health`.** Claiming another service's id in the
  body does nothing.
- **The address must be reachable from the gateway.** Public addresses are
  refused unless allowlisted.
- **Same id from a different address returns to pending** with a warning. That
  is the service-hijack shape and is never applied silently.
- **Rejected and revoked services cannot re-register.** An administrator must
  clear the record first — otherwise switching a misbehaving service off would
  achieve nothing.

---

## 5. Hand back the address

When the service is running, **verify it yourself first**, then print the block
below. The person who asked for this service is going to paste the base URL
straight into the gateway, so it has to be the address the service is actually
answering on — not the one you intended to use.

Check these three things before reporting anything:

```bash
curl -i http://127.0.0.1:PORT/health
curl -i http://127.0.0.1:PORT/openapi.json
curl http://127.0.0.1:PORT/nonexistent
```

The first two must be `200`. The third must be a `404` carrying the error
envelope — not framework HTML, which is the single most common reason a
service is refused.

And check the `service` field in `/health` is the id you intended. **If the
port was already in use, your process died and something else is answering on
it.** That field is how you catch it, and it looks exactly like your own code
misbehaving if you do not.

Then print exactly this, filled in:

```
SERVICE READY

  Base URL     http://127.0.0.1:3400
  Service id   example-api
  Domain       Operations
  Owner        your-team
  Endpoints    4
  Start it     node server.js   (from <folder>)

Next: open the gateway console -> Connect a service -> paste the Base URL.
```

Leave the service running. The gateway calls it back during registration and
keeps polling it afterwards, so a service that has exited cannot connect and
will drop out of the catalog if it stops later.

If the gateway rejects the registration, it returns the exact rules that
failed. Paste them back to me and I will fix them — every one of them maps to a
numbered rule in section 1.

---

## 6. Definition of done

- [ ] `GET /health` — public, `service` and `status` present, under 1s
- [ ] `GET /openapi.json` — public, OpenAPI 3.x, non-empty `paths`
- [ ] `info.x-rizurf` declares `domain` and `owner`
- [ ] `X-Correlation-ID` reused when sent, minted when not, echoed always
- [ ] Every non-2xx response uses the error envelope, including unrouted paths
- [ ] Error messages leak no SQL, stack traces or connection strings
- [ ] Every non-public operation declares `security` **and enforces it** — an
      anonymous call gets `401`, not `200`
- [ ] Scopes named `resource:action`
- [ ] `DELETE` on a missing id is `404`, not `204`
- [ ] Oversized `limit` is clamped, not rejected
- [ ] No other service's database is touched
- [ ] **No login screen, no user table, no password storage** (SS-24) — local
      roles keyed to a gateway identity are fine
- [ ] **Identity comes from a verified token signature, never a header or the
      request's origin** (SS-25) — the app is safe when reached directly
- [ ] Protected endpoints verify the token cryptographically and check
      `token_use`, not just that a bearer string is present (SS-6)
- [ ] Required scopes are read from the OpenAPI document, not hardcoded — so
      what is declared and what is enforced cannot drift (SS-6)
- [ ] `401` for a missing/unverifiable token, `403` for a valid token without
      the scope
- [ ] The app's own session has an expiry, and an expired one is treated as
      absent — otherwise a gateway sign-out never reaches this app
- [ ] The app keeps `sid` and checks `/oauth/introspect` on every request (no
      cache, failing open) so gateway sign-out and suspension close it at once
- [ ] No sign-out button in the app — the gateway is the only place
- [ ] Authenticated pages and auth redirects send `Cache-Control: no-store` —
      otherwise the browser serves a cached page after sign-out and the
      liveness check never runs
- [ ] Config from the environment, failing loudly at startup
- [ ] **Conformance run against the hub shows 0 failures**
- [ ] Write-path behaviour (SS-10/11/12) verified by your own tests
- [ ] `/health` and `/openapi.json` both curl'd and returning 200
- [ ] The `service` field matches the intended id (proves the port was free)
- [ ] **Base URL reported back in the section 5 block, service left running**
