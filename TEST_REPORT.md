# AquaProof verification report

Run on 25 November 2026 with Python 3.12, PostgreSQL 18.4, PostGIS 3.7.0, Node.js 24, and headless Microsoft Edge. Test databases and synthetic farm records were isolated. One authorized WhatsApp test send was made. The provider notification queue was untouched.

| Check | Result |
| --- | --- |
| Backend suite | 41 passed with the disposable PostGIS test database enabled, including private ArcGIS style rewriting and tile relay authorization. |
| Migrations and storage | All eleven migrations applied. A repeat migration run was idempotent. WGS84 polygon creation, area calculation, update, retrieval and archive passed. |
| Authorization and AI boundaries | The officer API rejected missing credentials with the assistant disabled. Database RLS limited a verified reader to its own rows. Explicit cross-farmer and unverified reads were denied. Injected model tool arguments did not reach the farm query. |
| Crop lifecycle and irrigation | Stage boundaries, excess rainfall, depletion, unmet ET, PKR cost, diesel unit conversion, hours and allocation caps, persisted decisions and salinity screening passed. These tests verify model behavior and consistency. |
| Weather and provider recovery | Current and forecast normalization, stale data rejection, fallback source and depth handling, cache expiry, dual outage and circuit recovery passed. |
| Current weather provider | The running API returned OpenWeather for current conditions and the 40-period forecast. Edge displayed both OpenWeather sections after a coordinate search. OpenWeather and Open-Meteo each passed health checks in four sampled provinces. The irrigation loader rejects missing reference ET. |
| Live farm API workflow | A controlled wheat field near Multan returned live weather and Open-Meteo soil and solar data. The lifecycle, three-hour pump-cap simulation and saved irrigation skip all returned HTTP 200. The current provider checks are recorded separately in API_STATUS.md. |
| WhatsApp and scheduling | Mock Green API transport verified direct text and quoted replies, provider ID handling, acknowledgement after processing, and sanitization after an ambiguous send failure. PostGIS tests covered signed enrollment, wrong-number and replay rejection, phone-change revocation, preserved email rows and idempotent verified-only daily scheduling. |
| Browser without database connectivity | Officer authentication, unavailable-registry behavior, coordinate navigation, expanded map, keyboard exit and mobile layout passed. |
| Browser with PostGIS | Map drawing following a zoom, undo/redo, GeoJSON import, farm registration, GeoJSON and KML downloads, reload and opening the saved boundary for edit, administration navigation, and desktop and mobile layout passed. |
| Street-only editing | The connected browser test confirmed street view stays selected through drawing and reopening a saved polygon. Optional ArcGIS Satellite and Hybrid are viewing modes. |
| Advisory Center browser flow | Registered a farmer using only a phone contact, found its field in Advisory Center and queued WhatsApp verification. The queue record was persisted with the worker paused. |
| Live AI with synthetic farm data | Four normal requests completed through OpenRouter GPT‑4o and authorized backend tools. The prompt-injection attempt received HTTP 400 and the app returned a safe clarification. A separate controlled tool-call test confirmed application-level rejection of unauthorized farm arguments. |
| Live WhatsApp send | Prepared a synthetic wheat advisory for Mianwali through the live OpenRouter model and backend science engine. Sent the labeled demonstration and verification instructions together through the normal outbound queue to the supplied test number. Green API returned a message ID and the journal reported `sent`. Delivery to the phone had not been confirmed at the last check. |
| Static checks and build | Ruff lint, Python compile check, frontend format check, TypeScript, Vite production build, and git whitespace checks passed. |
| Registry performance smoke | 2,000 controlled four-vertex boundaries returned from the local registry endpoint in 270–288 ms across three TestClient requests. The uncompressed response was about 1.10 MB. This measured application and database work in a local QA instance. |

[API_STATUS.md](API_STATUS.md) records live coverage for Multan, Hyderabad, Mardan and Quetta, OpenWeather One Call 3.0 authorization, the OpenRouter Azure route and the disabled Green API incoming notification setting.

### Repository cleanup verification

All 41 backend tests passed from a fresh environment against isolated PostGIS. Ruff, Python compilation, the frozen pnpm install, frontend formatting, TypeScript, and the production build passed. Edge passed with PostGIS and in database outage mode. The connected run queued one verification with synthetic Green API configuration and the worker disabled. Live provider checks were not repeated. Vite still warns about large MapLibre chunks, and Starlette emits an HTTPX TestClient deprecation warning.

### Urdu WhatsApp and farm replies

All 42 backend tests passed with isolated PostGIS. Migration 012 applied and repeated application was idempotent. Mock Green API delivery covered Urdu consent, rejection of unverified recipients and wrong-number replies, single-use tokens, and two successive answers tied to the farmer's field. The second reply used the saved Urdu preference even when the model selected English. Tests also checked all four live weather and agricultural calls for the selected field, provider error evidence, and delivery evidence expiry. Frontend formatting, TypeScript, the production build, and the Edge browser test with PostGIS passed. Edge confirmed Urdu as the default and queued verification with the worker paused. No live messages were sent in this run.

### Live synthetic response samples

- English weather returned the fixture’s 2.5 mm forecast rainfall, 60% rain chance, 27°C high and 58% humidity.
- Roman Urdu wheat advice returned “Ibtidai” and labeled the maturity date as an estimate.
- Urdu tubewell advice asked the officer to record fresh soil-water measurements and supplied no pump runtime.
- With a separately measured synthetic fixture, the science engine calculated 720 m³, 8 h and PKR 4,400. The message stayed in the officer review queue.

The live WhatsApp reply round trip, a Docker image build, and production-scale browser and concurrency tests remain open. The production web bundle builds with a Vite warning for the lazy MapLibre chunk. The installed Starlette version issues a TestClient deprecation notice for its current HTTPX adapter. Crop-model QA did not include independent field accuracy or yield validation data.

### WAHA integration and conversation dashboard

All 42 backend tests passed against isolated PostGIS. Migration 013 applied and its repeat run was idempotent. The WAHA contract tests covered text payloads, linked sender resolution and uncertain send outcomes. Signed webhook tests covered officer-requested Urdu verification, invalid signatures, wrong-number rejection, replay protection, ID-only quotes and two consecutive farmer replies. Conversation pagination kept messages scoped to the selected farmer and historical email rows stayed in their original channel.

Frontend formatting, TypeScript, the production build and the Edge persistence suite passed. Edge queued verification with the worker paused, displayed the queued message in WhatsApp Conversations and opened the farmer's Advisory Center from the thread.

The local Ubuntu WAHA container reached the pairing screen after Docker Desktop reported read-only container storage. From the WAHA container, an unsigned callback returned HTTP 401 and a signed callback reached the paused worker and returned HTTP 503.

### Officer browser sign-in

All 42 backend tests passed with isolated PostGIS. The sign-in checks covered incorrect passwords, cross-origin rejection, HTTP-only cookie attributes, expired and tampered cookies, sign-out and API protection while the assistant is disabled. Edge signed in with the password once, reloaded the workspace and used the saved session to access the registry and conversation history. Frontend formatting, TypeScript and the production build passed.

### Live weather and outbound WhatsApp recheck

Both local dashboards returned HTTP 200 for the sampled weather routes. Edge rendered current conditions, the registered-field forecast, soil and solar data, recent history, the historical archive and the Multan city search. The primary field's simulation returned the expected HTTP 409 for missing irrigation inputs. The isolated WAHA test sent the officer-requested verification and received a `DEVICE` acknowledgement for that exact message. Farmer confirmation was pending.

### Conversation refresh and live confirmation

An officer refresh checked the WAHA GOWS inbox for the registered test recipient, recovered the plain confirmation and marked that number verified. The isolated worker sent the enrollment acknowledgement. Edge showed both directions and kept a single confirmation after a second refresh. Tests exercised linked sender resolution, plain replies, missed-message recovery, rejection of older and wrong-number confirmations, and replay protection.

### Field-aware replies and permanent deletion

All 44 backend tests passed against isolated PostGIS. A read-only replay of the recorded soil question resolved the already linked field and returned its saved soil type, Loam. A greeting with a known field produced a topic prompt naming that field. Permanent deletion removed the synthetic field, linked messages and audit entries, historical email records, crop and irrigation records, and the API process's weather cache entry. The farmer and a sibling field remained accessible.

Edge confirmed that cancelling the permanent deletion prompt keeps an archived field and typing `DELETE` removes it from the archive. Frontend formatting, TypeScript and the production build passed. A live dashboard check confirmed API access logs omit the requested field ID.

### Plain WhatsApp chat and sender controls

All 45 backend tests passed against isolated PostGIS. Tests confirmed plain consent after an officer request, two consecutive verified messages without reply codes, provider message deduplication, retention of the farmer ownership gate, and officer-only pairing, QR and unlink endpoints. The live main workspace reported its assistant and WAHA worker active and accepted a signed diagnostic callback. The configured OpenRouter GPT-4o route returned valid structured output and a forced tool call for synthetic data. The current sending phone stayed linked during testing.
