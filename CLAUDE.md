# AquaProof project memory

## Architecture and decisions

- `backend/app/main.py` registers the officer API and background jobs. `database.py` runs transactional SQL migrations under a database lock. Migration 009 retains existing records and adds optional farmer district and tehsil.
- `registry.py` owns the authoritative PostGIS polygon, representative point and stored field history. The map uses Terra Draw for drafts, incremental MapLibre feature updates and geodesic area from PostGIS when saved. Browser drafts estimate area with Turf. EPSG:4326 coordinates use longitude, latitude except human-entered search pairs.
- `arcgis.py` uses private geocoding credentials, checks Pakistani candidates and leaves coordinate navigation available. MapLibre renders ArcGIS v2 styles. The optional server relay serves only known ArcGIS raster and vector services and removes private credentials from the style before sending it to the browser. Alternatively, browser map config can return a separately provisioned public basemap token. MapLibre preserves the closed draft across style replacement.
- FarmMap defaults to Open street and keeps drawing and editing on street. ArcGIS Satellite and Hybrid remain selectable for viewing. A draft preserves the previous basemap preference, viewport, and polygon while the street style loads.
- The React workspace uses registry-backed records and provider-backed data. The stylesheet imports Tailwind Preflight directly for the base reset. Imagery configuration lives in the ArcGIS runtime settings.
- `science/routes.py` exposes farm weather, crop lifecycle, simulation and revision-checked decisions. `science/CLAUDE.md` records model rules and attribution.
- `science/openweather.py` normalizes current readings and three-hour forecasts. The irrigation engine receives a separate Open-Meteo forecast with complete Pakistan-local-day rain and reference ET. Never use partial OpenWeather date group totals as irrigation inputs.
- `assistant_model.py` classifies messages and validates tool calls and JSON output. `assistant_access.py` applies verified farmer scope and the PostgreSQL reader role. `assistant_jobs.py` queues daily and correction work in PKT and deduplicates by field/day/slot. `assistant_copy.py` renders replies in three languages using server calculations. `assistant_whatsapp.py` delivers officer-approved and automated messages and polls the dedicated Green API queue. `green_api.py` validates direct WhatsApp text and provider response shapes and sanitizes errors.
- Migration 012 defaults new WhatsApp enrollments to Urdu. The farmer's saved preference controls response language. Automated field answers share one refreshed weather context per field per job. Keep source and outage details in officer evidence and use practical, qualitative wording in farmer messages.
- Legacy email records are retained for field history. Migrations 010 and 011 distinguish transport queues and revoke a farmer's WhatsApp verification and reply tokens when their registered number changes. The prior `/intelligence` contract explains scientific results deterministically.
- `service_health.py` tests actual upstream responses using public samples and synthetic model requests. It checks Green API instance authorization and incoming notification settings without sending messages or reading the notification queue. `service_http.py` retries transient transport and HTTP failures and opens a short process-local circuit. Admin status retains the endpoint, recent check time, observed latency and available coverage and quota details.

## Security and configuration

Use a dedicated officer secret and distinct WhatsApp reply secret. Enforce TLS at the deployment perimeter. Configure only approved OpenRouter routes and keep explicit data collection denial and ZDR. Keep farmer names and contact details out of model context where practicable. Share exact geometry only by explicit deployment policy. Keep ArcGIS browser and server credentials separate.

The government gateway, named officer identities, deployment authorization and retention policy are separate release inputs. Single-process service health and scheduling are deployment constraints until moved to shared infrastructure.

## Conventions and tests

Use explicit units in public JSON keys, PKT for agricultural dates, UTC for instants, and public provider names in status. Keep calculations deterministic. Test stale and invalid data, no-rain sensitivity, observed data isolation and retry failure recovery. The setup, contracts and commands are in [README.md](README.md). The verified outcomes and gaps are in [TEST_REPORT.md](TEST_REPORT.md) and [API_STATUS.md](API_STATUS.md).

## Outstanding issues

- Obtain a license decision before enabling imagery digitization. If the deployment uses direct browser tile requests, provision a separate referrer-restricted basemap token.
- Enable incoming notifications on the dedicated Green API instance and verify an end-to-end round trip with a controlled WhatsApp number. Obtain deployment approval for the OpenRouter privacy route.
- Calibrate local cultivar stage lengths, soil-water parameters, and risk thresholds with provincial agronomists. Obtain authorized village gazetteers, water allocation rosters and station or sensor coverage where needed.
- Add paddy hydrology and yield estimates only after local calibration and validation. Polygon rendering currently receives a full registry snapshot. National deployments need server-side spatial pagination or tiles and representative load testing.
