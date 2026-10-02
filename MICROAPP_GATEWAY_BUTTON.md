# The gateway button: adding it to a Rizurf microapp

For the team, or the coding agent, working on **one microapp with a user
interface** that people open from the Rizurf API Gateway. This is rule
**SS-28** in `RIZURF_API_TEMPLATE.md`. API-only services with no pages skip it.

**What it is:** a small tab with an arrow at the bottom-right edge of the app.
Hover it (or tap it on a phone) and a slim dock slides out with the person's
**quick-access apps** and a **home** button. Home takes them back to the
gateway's **Your apps** page, **in the same tab**. Closed, it's just the tab,
so it stays out of the way of your app's UI.

The gateway opens apps in the same tab too, so the whole journey (gateway →
app → gateway → another app) happens in **one tab**. There are no extra tabs to
close, and you never end up with two gateways open.

The button is **served by the gateway**, so every app shows exactly the same
button, and a design change or fix reaches every app without anyone
redeploying.

---

## 1. Add one line

Put this in the `<head>` (or at the end of `<body>`) of **every page**:

```html
<script src="https://web-omega-two-47.vercel.app/widget/gateway-button.js" defer></script>
```

That's all. There's nothing to configure, install or build. The script works
out the gateway's address from its own URL.

### Rules

- **Load it from the gateway URL above.** Don't copy the file into your app,
  don't bundle it, and don't build your own look-alike. A copy stops getting
  updates, and then the app no longer matches the others.
- **Don't restyle or hide it with CSS.** Its styles live in a Shadow DOM, so
  your CSS can't reach it anyway. If it covers something, use the options
  below.
- **Don't add your own "back to gateway" or sign-out button.** The gateway is
  the only place people sign out (MICROAPP_AUTH.md).

---

## 2. Per framework

### Next.js (App Router)

In the root layout, `app/layout.tsx`, so it's on every page:

```tsx
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://web-omega-two-47.vercel.app/widget/gateway-button.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
```

### Next.js (Pages Router)

In `pages/_app.tsx`, same `<Script>` as above, rendered next to
`<Component {...pageProps} />`.

### React / Vue / Svelte with Vite, or any single-page app

In `index.html`, inside `<head>`:

```html
<script src="https://web-omega-two-47.vercel.app/widget/gateway-button.js" defer></script>
```

The button stays in place as your router changes pages; no per-route setup.

### Server-rendered apps (Express + templates, Laravel, Django, Rails…)

Add the line to the shared layout template that every page extends.

---

## 3. Options (optional)

Set these as attributes on the same `<script>` tag.

| Attribute | Default | Use it when |
|---|---|---|
| `data-position="bottom-left"` | bottom-right | Your app already has something fixed in the bottom-right (a chat bubble, a floating "+" button). |
| `data-offset="88"` | `20` | Your app has a fixed bottom bar (common on mobile). Lifts the button that many pixels above the bottom edge. Max 400. |

```html
<script src="https://web-omega-two-47.vercel.app/widget/gateway-button.js"
        data-position="bottom-left" data-offset="88" defer></script>
```

With Next.js `<Script>`, pass the same attributes as props:
`<Script src="…" data-position="bottom-left" data-offset="88" />`.

**Hiding it on one screen** (for example a full-screen kiosk or clock-in
view) is the only other control:

```js
window.RizurfGatewayButton?.hide();
window.RizurfGatewayButton?.show(); // when leaving that screen
```

Keep that to screens that genuinely need the whole display. People rely on
the button being there.

---

## 4. If your app sets a Content Security Policy

If your app sends a `Content-Security-Policy` header, allow:

```
script-src  ... https://web-omega-two-47.vercel.app;
img-src     ... data:;
```

`script-src` is for the script itself. `img-src data:` is for the gateway icon,
which is embedded in the script so no extra request is made. Without these the
browser silently blocks the button. Check the browser console for a CSP error
if it doesn't appear.

---

## 5. What it looks like

- **Closed:** a small white tab with a `‹` arrow, flush against the right edge.
- **Open** (hover the tab, or tap it on a touch screen): a slim dock slides out
  of the edge with, top to bottom:
  - the person's **quick-access apps**, up to 5, as coloured icons with their
    badge counts (the name shows beside the icon on hover; the current app has
    a ring round it). Clicking one opens it in the same tab;
  - a dashed **+** while there's room, which goes to Your apps;
  - the **home** button, back to the gateway's Your apps page.
- **Choosing the apps:** each person fills the 5 **Quick access** slots on the
  gateway's **Your apps** page: hold an app's icon and drag it into a slot, or
  press a slot's **+** and choose an app. Your app has nothing to do: the dock asks the gateway,
  which knows who is signed in. In browsers that block third-party cookies
  (Safari, Firefox in strict mode) the dock shows only the home button.
- **Touch screens:** tap the tab to open or close it; a tap anywhere else
  closes it. It sits above the iPhone home indicator (safe-area aware).
- **Accessibility:** the tab is a real `<button>` (reachable with Tab; focusing
  it opens the dock), the apps and home are links with their names as labels,
  Escape closes it, and it respects "reduce motion".
- It sits above your app's own content (very high `z-index`), is hidden when
  printing, makes one small request to the gateway for the quick-access apps,
  sets no cookies of its own and tracks nothing.

---

## 6. Why not the browser's Back button, or a new tab?

- **Not `history.back()`:** on the way into an app, the browser passes through
  the gateway's sign-in hop (`/oauth/authorize`). Going "back" replays that
  hop, which sends the person straight back into the app. The button always
  navigates to Your apps instead.
- **Not a new tab:** that was the first version. Each app opened in a new tab,
  and getting back left two gateway tabs open. One tab is simpler and
  predictable. People who want an app in its own tab can still Ctrl/Cmd-click
  it in the gateway.

---

## 7. Checklist

- [ ] The script line is on every page (root layout / `index.html` / base template)
- [ ] Loaded from `https://web-omega-two-47.vercel.app/widget/gateway-button.js`, not a copy
- [ ] Opened from the gateway's **Your apps** → the app opens in the same tab and the button appears bottom-right
- [ ] Clicking it goes to the gateway's Your apps page **in the same tab** (no new tab, no second gateway)
- [ ] On a phone-sized screen it's a round icon and covers nothing important (else set `data-offset` / `data-position`)
- [ ] No CSP errors in the browser console
- [ ] No other "back to gateway" or sign-out button left in the app
