# WhatsApp Real-Transport Swap Point — Pilot System v3.1 (Sprint 3 → Sprint 5)

Status: DRY-RUN ONLY in Sprint 3. No real Meta message is sent by
this build, and no real token, number, or account id appears in it.
This document is the single swap point for Sprint 5. Nothing else in
the WhatsApp path needs to change when the real transport arrives —
that is the point of the design.

## Current state (Sprint 3, verified by tests)

- Transport: `DryRunTransport` (`backend/src/whatsapp/templates.service.ts`).
  It creates an OUTBOUND `MessageLog` row with `is_dry_run = true`,
  status `QUEUED`, and delivers nothing. Every dry-run row is
  labelled dry-run wherever displayed (panel, API payloads), and
  `countActuallySent` excludes dry-run rows.
- Gates live in `TemplatesService.sendMessage`, NOT in the transport:
  window enforcement, template sendability (local + Meta approval
  separately), button ≤ 3, list ≤ 10. Swapping the transport cannot
  bypass a gate, because the transport never sees an ungated send.
- Webhook (inbound + status callbacks) is transport-independent and
  already implemented with HMAC verification and idempotency.

## The swap (Sprint 5, on the final client-owned account only)

1. Implement `MessageTransport` (same interface in
   `templates.service.ts`) with the DIRECT Meta WhatsApp Business
   Platform Cloud API send call — no intermediary/BSP in the
   baseline. Configuration uses environment VARIABLE NAMES ONLY:
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_API_VERSION` (values in the secret store / final
   account handover, never in code, logs, or this document).
2. In `whatsapp.module.ts`, pass the real transport to
   `TemplatesService` instead of `DryRunTransport`. No controller,
   service, or panel change is needed.
3. On a successful Meta send, the transport returns the Meta message
   id; `sendMessage` records it as the `whatsapp_message_id` of a
   NON-dry-run OUTBOUND row (status SENT). On Meta failure, record
   status FAILED with Meta's non-sensitive error/reason visible to
   staff; do NOT relabel a failure as success and do NOT retry in a
   blind loop (retry policy: bounded attempts + dead-letter for
   staff review, decided in Sprint 5).
4. Keep the dry-run transport available behind configuration for
   demonstrations and training: any demonstration before the final
   account migration stays dry-run, labelled as such.

## Gates that must hold after the swap (re-run all of them)

- Wrong-signature webhook still rejected (critical test 1).
- Duplicate event still has no duplicate effect (critical test 2).
- Locally-approved but Meta-rejected template still un-sendable
  with its reason shown.
- Free text outside the customer-service window still rejected;
  approved Utility templates only outside it.
- Dry-run rows still labelled dry-run and still excluded from sent
  counts (the dry-run transport remains for demos/training).
- No send is ever triggered by a state transition alone without
  passing the window + template + human-review gates.
- Ownership: the final Meta account, WABA, and number belong to the
  client wherever Meta permits; ORTECH staff permissions are
  returned/handed over at delivery, and linking migrates from test
  accounts/numbers to the final account/number only after they are
  ready (PB-14).

## Explicitly NOT part of the swap

- No WhatsApp Web / QR / unofficial transport, ever.
- No BSP unless an insurmountable direct-linking obstacle is proven
  AND written approval exists.
- No message is ever treated as institution confirmation, funding,
  settlement, or acceptance — before or after the swap.
- No Meta fee, message fee, or template fee is part of the
  development price (CORE PROMPT §12, §14.3).
