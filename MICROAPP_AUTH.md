# Microapp Authentication Template

**Audience: the coding agent building a Rizurf microapp's sign-in flow.**

This is the complete, proven pattern for token handling and auto-lock. Every
line of code below has run against the live gateway and been verified — not
theoretical. If you are building a Rizurf microapp with a UI a human signs
into, follow this file exactly. It is a companion to `RIZURF_API_TEMPLATE.md`
(SS-24 and SS-25 there state the rules; this file is the implementation),
pulled out on its own because this pattern gets copied into every microapp
this company builds, and it has to be right every time — an ERP made of
services that each get authentication slightly wrong is not secure services,
it is a pile of individually-broken doors.

**You owe two things at the end:** a sign-in flow that verifies the gateway's
signature itself (never trusts that a request merely arrived looking
legitimate), and an auto-lock that closes within one request of the person
signing out at the gateway — not eventually, not on next expiry.

---

## 0. The model, in one paragraph

The gateway is the only place anyone authenticates (SS-24) — your app has no
password, no login screen, no user table. A human signs in there once; your
app is handed a **short-lived identity token**, proves it's genuine by
checking its signature against the gateway's public key, and starts its own
session. From that point on, on **every single request**, your app asks the
gateway "is the session behind this still alive?" If the answer is ever no —
because the person signed out, or was suspended — your app locks immediately.
No caching that question is what makes "immediately" true.

---

## 1. The three endpoints you talk to

| Endpoint | When | Who calls it |
|---|---|---|
| `GET {GATEWAY_URL}/.well-known/jwks.json` | Once, cached for the process lifetime | Your server |
| `GET {GATEWAY_URL}/oauth/authorize?redirect_uri=...` | Sending an unauthenticated visitor to sign in | The browser (you redirect it there) |
| `POST {GATEWAY_URL}/oauth/token` | Exchanging the code you get back for an identity token | Your server, server-to-server |
| `POST {GATEWAY_URL}/oauth/introspect` | Checking a session is still live | Your server, on every request |

Two config values, from the environment (SS-20), never guessed:

```
GATEWAY_URL=http://127.0.0.1:4301   # where the gateway is
PUBLIC_URL=http://127.0.0.1:3400    # your own address, as the gateway knows you
```

`PUBLIC_URL` must exactly match the `baseUrl` or `app_url` you registered
with — the gateway will not send an identity code to an address it does not
already recognise as yours.

---

## 2. The token you get back

```json
{
  "token_use": "identity",
  "sid": "a1b2c3d4-...",
  "sub": "3950f77e-...",
  "email": "dev@rizurf.local",
  "name": "Dev Tester",
  "role": "developer",
  "iss": "http://127.0.0.1:4301",
  "aud": "your-service-id",
  "exp": 1787999999
}
```

Deliberately thin, and deliberately short-lived (five minutes) — it exists to
prove who just signed in, once, so you can start your **own** session. It is
not an API credential and must never be held onto past that.

`role` is the gateway's *console* role (admin / platform / developer /
viewer) — a hint, not an instruction. It describes access to the gateway
console, not to your app. What a caller may do inside **your** app is your
own decision (SS-24), usually a local role table keyed to `sub` or `email` —
never gated on `role` directly.

**`sid`** is the field this whole document exists to explain. Keep it in your
own session. It is what you ask `/oauth/introspect` about.

---

## 3. Verify the token yourself — never trust that it merely arrived

The gateway signs with RS256 and publishes the public key. Your server
fetches that key once and verifies every token against it — no shared
secret, nothing your app holds that could leak and let someone forge a
token.

If your stack has a maintained JWT/JWKS library, use it (`jose` in Node,
`pyjwt` + `cryptography` in Python) — this is exactly the kind of code not
worth hand-rolling. If you want zero dependencies, your runtime's own crypto
primitives are enough, **as long as the actual signature check goes through a
real primitive** (e.g. Node's `crypto.verify`) rather than anything you wrote
yourself. This is the complete, proven, dependency-free version:

```js
const { createPublicKey, verify: cryptoVerify } = require("node:crypto");

// Fetched once and kept for the process lifetime — the key only changes on a
// gateway redeploy, which restarts this process too in any real deploy.
let jwksCache = null;

async function getGatewayPublicKey(kid) {
  if (!jwksCache) {
    const response = await fetch(`${GATEWAY_URL}/.well-known/jwks.json`);
    if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
    jwksCache = await response.json();
  }
  const jwk = jwksCache.keys.find((key) => key.kid === kid);
  if (!jwk) throw new Error(`No key "${kid}" in the gateway's JWKS.`);
  return createPublicKey({ key: jwk, format: "jwk" }); // no PEM conversion needed
}

function base64UrlDecode(segment) {
  return Buffer.from(segment, "base64url");
}

/**
 * Verify a token against the gateway's own published key. Throws on ANYTHING
 * wrong — an unverifiable token is not a token with less information, it is
 * not a token at all.
 *
 * `expectedUse` is not optional and not cosmetic. The gateway signs TWO kinds
 * of token with the same key, both carrying `aud` = your service id: a
 * five-minute IDENTITY assertion proving a human signed in, and a scoped
 * ACCESS token issued to a program (client_credentials, see §7). Checking
 * only signature/iss/aud/exp would let either be presented wherever the
 * other is expected — a human's sign-in assertion replayed as a machine
 * credential. Checking `token_use` is what makes the two non-interchangeable.
 */
async function verifyToken(token, expectedUse) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token.");
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
  if (header.alg !== "RS256") throw new Error(`Unexpected algorithm "${header.alg}".`);

  const publicKey = await getGatewayPublicKey(header.kid);

  // RS256 = RSASSA-PKCS1-v1_5 with SHA-256 — Node's default for an RSA key.
  // The cryptography is Node's; nothing here re-implements RSA.
  const signingInput = `${headerB64}.${payloadB64}`;
  const ok = cryptoVerify("RSA-SHA256", Buffer.from(signingInput), publicKey, base64UrlDecode(sigB64));
  if (!ok) throw new Error("Signature does not verify.");

  const claims = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));

  if (claims.token_use !== expectedUse) {
    throw new Error(`Expected a "${expectedUse}" token, got "${claims.token_use}".`);
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) {
    throw new Error("Token has expired.");
  }
  if (claims.iss !== GATEWAY_URL) {
    throw new Error(`Token issuer "${claims.iss}" is not this app's configured gateway.`);
  }
  if (claims.aud !== SERVICE_ID) {
    throw new Error(`Token audience "${claims.aud}" was not minted for this service.`);
  }

  return claims;
}
```

**The anti-pattern this exists to prevent** — the single most common way this
gets built wrong:

```js
// CATASTROPHIC. Anyone who can reach this app directly just sets the header.
const user = req.headers["x-authenticated-user"];
if (user) { /* trusted! */ }
```

A header is not proof. The gateway setting it does not stop anyone else
setting it, and one day your service will be reachable directly — a
misconfigured firewall, a port left open in development, anything. The
gateway's conformance checker (`/conformance`) sends exactly this forged
header at every registered service before approval and fails hard on a 200
(SS-25). Signature verification is the only thing that survives that test.

---

## 4. The sign-in flow, end to end

```
1. Visitor arrives with no session
      → redirect to {GATEWAY_URL}/oauth/authorize?redirect_uri={PUBLIC_URL}/

2. Not signed in to the gateway?
      → they see the gateway's login page, then land back at step 1

3. Signed in (or just signed in)
      → gateway redirects to {PUBLIC_URL}/?code=...
        (a one-time code, NOT the identity token — nothing sensitive
         ever sits in a URL, browser history, or an access log)

4. Your server (never the browser) exchanges the code:

      POST {GATEWAY_URL}/oauth/token
      content-type: application/json
      { "code": "...", "redirect_uri": "{PUBLIC_URL}/" }

      -> { "token": "...", "token_type": "Bearer", "expires_in": 300 }

5. verifyToken(token, "identity") — §3, above

6. Start YOUR OWN session, storing at minimum:
      sid    (from the token — this is what §5 checks against the gateway)
      sub    (the person's id)
      email, name
      an expiry (§6)

7. Redirect to the clean URL — the code must never sit in browser history.
```

No client secret on step 4. The trust boundary is the code itself:
single-use, expires in under a minute, and bound to the exact `redirect_uri`
it was issued for. That is the same model OAuth uses for a confidential,
server-side client — proportionate for a first-party service inside one
company's network. Do not copy this pattern for anything a stranger can call.

---

## 5. Auto-lock: check the gateway on every request, no cache

This is the part that gets built wrong by being built *reasonably* — caching
the answer for a minute "because it's cheap" is exactly what breaks auto-lock,
because a cache is a window in which your app and the gateway disagree about
whether someone still has access.

```js
async function gatewaySessionIsLive(session) {
  if (!session?.sid) return false;

  try {
    const response = await fetch(`${GATEWAY_URL}/oauth/introspect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sid: session.sid, sub: session.sub }),
    });
    if (!response.ok) return true; // see "fail open," below
    const { active } = await response.json();
    return Boolean(active);
  } catch {
    // FAIL OPEN, deliberately. A gateway that is briefly unreachable must not
    // sign everyone out of every app at once. Your session's own expiry
    // (§6) is the backstop for a gateway that stays down.
    return true;
  }
}
```

Call this on **every** request that serves a signed-in page — not just on
load, not on a timer. If it returns false: clear your session cookie and
redirect to `/oauth/authorize` again (step 1 of §4). No error page, no
confirmation — the person simply lands back at sign-in, the same as if they'd
never been there.

`introspect` also catches a **suspended account**, not only a sign-out — the
gateway re-checks the underlying user record, not just the session, so this
one call closes both doors.

Deliberately narrow on the gateway's side: it answers `active` and nothing
else. Unauthenticated, on purpose — knowing a `sid` is already knowing the
secret part, and requiring a second credential here would mean every service
holding one, the exact coupling this whole design avoids elsewhere.

**Do not build a sign-out button into your app.** The gateway is the only
place anyone signs in or out. An app with its own sign-out creates a second
place for the two systems to disagree — sign out of the app but not the
gateway, or the reverse — and that confusion is worse than the missing
button. Your app's *only* job is to notice, via §5, that the gateway session
ended, and lock.

---

## 6. Session expiry — the backstop, not the mechanism

```js
const SESSION_TTL_SECONDS = 15 * 60;

function setSessionCookie(res, claims) {
  const value = /* however you serialize: at minimum sid, sub, email, name */;
  res.setHeader(
    "set-cookie",
    `your_app_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`,
  );
}
```

This number is **not** what makes sign-out work — §5 does that, on every
request, immediately. This TTL exists for the one case §5 cannot cover: a
gateway that stays unreachable for a long time, where the fail-open behaviour
means your app would otherwise trust a session forever. Fifteen minutes is a
reasonable default: short enough that a truly-down gateway still closes
access before long, long enough not to matter in normal operation, since §5
is what actually locks things in the meantime.

**Sign your session cookie**, or encrypt it — do not store raw claims in
plaintext for anything beyond a disposable demo. Copy the gateway's own
pattern (HMAC-signed, `HttpOnly`, short-lived) rather than inventing a new
scheme per app.

---

## 7. `Cache-Control: no-store` — the header that makes all of the above real

**Without this, nothing above works, and the failure is invisible to `curl`.**

A browser is free to keep its own copy of a page that says nothing about
caching. Refresh, or press Back, and it serves that copy **without asking
your server at all** — so §5's check never runs, and someone who signed out
still sees their page. This looks exactly like broken sign-out, and testing
with `curl` will never catch it, because `curl` never caches anything.

```js
const NO_STORE = {
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
  pragma: "no-cache",
  expires: "0",
};
```

Send this on **every authenticated page and every auth redirect** — the
sign-in page, the code-exchange redirect, the signed-in page itself, all of
it. `no-store` is the directive that matters (it also keeps the page out of
the browser's back/forward cache, which is why this fixes Back too); the
other two are for older browsers and proxies that ignore it.

Most full-stack frameworks send this automatically for dynamically-rendered
pages — Next.js does. If you are writing raw HTTP responses by hand, as the
reference implementation does, nothing sets this for you; you must.

---

## 8. Get the redirect origin from config, never from the request

```js
// CORRECT — matches what every other service was told out of band.
const GATEWAY_URL = (process.env.GATEWAY_URL ?? "http://127.0.0.1:4301").replace(/\/+$/, "");

// WRONG on the GATEWAY's side of any redirect you might build, and wrong on
// yours too if you ever construct an absolute URL from the incoming request.
// Some frameworks (Next.js among them) do not reliably reflect the actual
// Host a request arrived on when you ask for the request's own origin — it
// can resolve to the server's bind address instead, silently sending someone
// to a DIFFERENT ORIGIN with its own separate cookie jar. This was a real,
// shipped bug: a visitor reaching the gateway via 127.0.0.1 was bounced to
// localhost to sign in, so the session lived on an origin nobody ever
// visited again to sign out of. Diagnosed by noticing the address bar
// disagreed with what was typed, confirmed with curl against an explicit
// Host header, fixed by never inferring — always reading a configured value.
```

This is a general rule, not just a gateway concern: anywhere your own code
builds an absolute redirect URL, use your own configured `PUBLIC_URL`, never
something derived from the inbound request.

---

## 9. Definition of done

- [ ] `verifyToken()` checks signature, `token_use`, `iss`, `aud`, `exp` — in
      that order, failing closed on any of them
- [ ] No trust placed in any header claiming an identity (`x-authenticated-user`
      and anything like it) — proven by testing your service with such a
      header set and no valid token, expecting a rejection
- [ ] Sign-in flow matches §4 exactly: code exchanged server-to-server, never
      by the browser; identity token never touches a URL or gets logged
- [ ] `gatewaySessionIsLive()` called on every authenticated request, **no
      cache**, failing open on a network error only
- [ ] No sign-out button anywhere in the app — the gateway is the only place
- [ ] Session cookie has an expiry (§6) and is signed or encrypted
- [ ] `Cache-Control: no-store` on every authenticated page and auth redirect
      (§7) — tested with a real browser refresh and a real browser Back, not
      only with `curl`
- [ ] `GATEWAY_URL` and `PUBLIC_URL` come from the environment, never inferred
      from an incoming request (§8)
- [ ] Verified live: sign in, open the app in one tab, sign out at the
      gateway in another, refresh the app tab — it locks with no delay

---

## 10. If you also need service-to-service calls

Everything above is the **human sign-in** flow. A scheduled job, a script, or
one microapp calling another has no browser and no password — that uses a
different grant (`client_credentials`) against the same `/oauth/token`
endpoint, presenting an API client secret issued in the gateway's **API
clients** admin page and receiving a scoped **access** token
(`token_use: "access"`) instead of an identity token. `verifyToken(token,
"access")` from §3 already handles this — just call it with the other
`expectedUse`. That token carries a `scope` claim (space-separated, matching
what the client was granted) that you check against what the specific
endpoint requires, the same way SS-6/SS-7 already describe. Out of scope for
this document beyond that pointer; ask if a service genuinely needs this.
