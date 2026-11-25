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
