# Linking from inside the dashboard — Embedded Signup (Stage A)

## What this is

A "Connect with Meta" button inside the WhatsApp section of the Pilot
dashboard that launches Meta's official Embedded Signup flow, plus a
server callback that exchanges the returned `code` and **tests** the
resulting token. It is the ZeroMsg pattern (README: "Meta Embedded
Signup… using Meta's official signup flow", env names
`WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_CONFIG_ID`, dashboard
route `/dashboard/whatsapp-accounts`) re-implemented on Pilot's own stack
(React + Vite + TypeScript frontend, Node built-ins backend — no PHP, no
Laravel, no ZeroMsg code).

## Why Embedded Signup is NOT banned (and QR paths ARE)

- **Embedded Signup = official Meta flow.** The business signs in to Meta
  itself, inside Meta's own dialog, and grants the Pilot app's Meta App
  permission to manage its WhatsApp Business Account. The token exchange
  happens server-to-server with the App Secret (`POST/GET
  /oauth/access_token` on `graph.facebook.com`, then a read-only `/me`
  validation). Nothing pretends to be a phone, nothing scans a QR code
  into a browser session, and nothing uses an unofficial client library.
  Meta documents and supports this flow for Cloud API onboarding.
- **WhatsApp Web QR paths = unofficial and banned here.** Baileys,
  Evolution API, WAHA, and any QR-linked-device automation drive the
  consumer WhatsApp Web client as if it were a phone. That violates
  WhatsApp's terms for business messaging, risks the number being banned,
  and mixes the service with a normal WhatsApp app number — which Pilot
  forbids (dedicated Cloud API number only, never a normal WhatsApp app
  number). Pilot implements none of these and must never add them.
- **Manual setup is still the fallback** and is not second-class: set the
  env vars in Render, Redeploy, then "Test Token" in the wizard. Embedded
  Signup does not replace it; it only removes the copy-paste of IDs for
  the initial link.

## How it works (Stage A)

1. **Server config (no secrets to the browser).**
   `GET /api/whatsapp/embedded-signup/config` (`whatsapp:view`) returns
   booleans only (`app_id_configured`, `config_id_configured`,
   `app_secret_configured`, `embedded_configured`) plus the launch
   parameters that are *not* secrets: dialog base/path, `client_id`
   (App ID), `config_id`, `response_type=code`,
   `override_default_response_type=true`, and the scope
   `whatsapp_business_management,whatsapp_business_messaging`. The App
   Secret is never returned.
2. **Launch.** The dashboard button builds
   `https://www.facebook.com/{api_version}/dialog/oauth?client_id=…&config_id=…&response_type=code&override_default_response_type=true&scope=…&redirect_uri=…`
   and opens it in a new tab. `redirect_uri` defaults to the dashboard
   origin (`window.location.origin + '/'`) and **must be registered in
   the Meta App under Valid OAuth Redirect URIs**, or Meta rejects the
   launch. The button is disabled until all three env names are set.
3. **Return + code.** Meta redirects back to `redirect_uri` with a
   short-lived `code` in the URL. The dashboard pre-fills that `code`
   (if present in the URL) into a form field; the operator may also paste
   it manually. A `code` is an authorization code, not an access token,
   and it is sent only to Pilot's own backend over the same origin.
4. **Callback (server-side exchange + test).**
   `POST /api/whatsapp/embedded-signup/callback` (`whatsapp:edit`,
   audited) requires all three Embedded Signup env values, then:
   - exchanges the code server-to-server (App Secret travels only in
     that server-to-Meta request, never to the browser, never to a log);
   - validates the exchanged token with a read-only `GET /me`;
   - optionally looks up phone numbers under the already-configured
     WABA ID (failure here does not fail the test; env IDs are the
     fallback).
   It returns **only**: `tested: true`, `persisted: false`,
   `meta_user_id`, `display_name`, `waba_id` (from env, or null),
   `phone_number_id` (from env or the lookup, or null), and configured
   booleans. **The token value is never in the response, never in a log,
   never in an audit detail, and never in any file.**
5. **TESTED — not persisted (read this before production).**
   The exchanged token is used in-process and then discarded. It is NOT
   written to `backend/data.json`, NOT written to the repo, and NOT
   stored in any encrypted at-rest store — no encrypted token storage
   was implemented in Stage A, deliberately, because the free container
   file is ephemeral and a half-implemented vault would be worse than
   an honest manual step. For production, the operator must take the
   WABA ID / Phone Number ID from the callback result (and the permanent
   System User token from Meta, created in the client's own Business
   account) and set them as **Render Environment Variables, then
   Redeploy**. Until that Redeploy happens, the link is a successful
   *test*, not a live connection — the UI says exactly that.
   If a later stage adds encrypted at-rest storage, it must document
   the storage location, the key env name, and that it remains
   pilot-testing-only until Postgres — until then, this paragraph is
   the whole storage story.

## Env names (names only — values live in hosting env, never in files)

- `WHATSAPP_APP_ID` — Meta App ID (public launch parameter).
- `WHATSAPP_CONFIG_ID` — Embedded Signup Configuration ID from the Meta
  App dashboard (public launch parameter).
- `WHATSAPP_APP_SECRET` — already existed; used only server-side for
  the code exchange and for webhook HMAC verification.
- Existing manual-path names are unchanged: `WHATSAPP_ACCESS_TOKEN`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`,
  `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_VERSION` (default `v26.0`).

## What the callback does NOT do

- It does not create a contract, a conversation, or a customer record.
- It does not send any message, subscribe any webhook, or change any
  Meta setting.
- It does not store the token, the code, or the App Secret anywhere.
- It does not accept a token pasted into the UI — there is no token
  input field anywhere in the dashboard, by design.

## Failure modes (honest list)

- Embedded Signup env missing → `400 embedded_not_configured`; use the
  manual path.
- `redirect_uri` not whitelisted in the Meta App → Meta refuses the
  launch before any code exists; fix the whitelist, do not work around
  it in code.
- Exchange or `/me` failure → `502` with Meta's error code only; the
  token/code are not echoed. Re-run the flow for a fresh code (codes
  are short-lived and single-use).
- Media-header templates submitted to Meta may fail until a real media
  upload session exists (file-upload stage); text headers, bodies,
  footers, and buttons submit normally.

## Hard rules this feature does not change

No internal wallets, no marketplace/catalog, no bank API, money stays
with the external financial institution under manual coordination, no
payment confirmation without an FI reference, no automation step touches
money, audit is append-only, customer interface is WhatsApp only,
production accounts are in the client's name, the number is a dedicated
Cloud API number, no marketing broadcasts, no catalogs, no in-chat
payments, and no unofficial WhatsApp automation of any kind.
