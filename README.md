# AquaProof Pakistan

AquaProof is an agricultural officer workspace for farm boundaries, crop seasons, weather-based irrigation planning, and farmer correspondence. Farmers use WhatsApp from a verified number. Officers manage enrollment, advisories and conversations in the dashboard.

## The problem

**Pakistani farmers lose crops and water because they have to guess the timing of irrigation and harvest, and they get no field-specific, trustworthy advice in their own language.** The decisions that make or break a season — *when to irrigate, when to run the tubewell, and when to cut the crop* — depend on the weather and the crop's stage, but the information is scattered, generic, or simply unavailable at the field level:

- **Water timing.** Farmers irrigate too early, too late, or waste tubewell fuel and electricity because they cannot tell how much water the crop actually needs today or when the canal (warabandi) turn is best used.
- **Rain at the wrong time.** Running the tubewell just before rain floods the field and wastes water and money; a sudden rain or flood during harvest can destroy a ripe crop.
- **Harvest timing.** Farmers do not know when the crop will mature or how to time cutting around the rain forecast, so grain is lost to rain damage and sprouting.

AquaProof answers these questions **per field**: it models the crop stage from the planting date (FAO-56), pulls live weather forecasts, runs a daily soil-water balance, and sends the farmer a plain-language, reasoned recommendation on WhatsApp in Urdu, Roman Urdu or English — *irrigate or wait, how much and why, use the canal turn or the tubewell, and when to harvest around the rain* — while the officer keeps the exact numbers, sources and review controls in the dashboard.

### Built from a farmer survey

The problem and priorities were defined by surveying farmers in Pakistan — **Sanaullah, Zohaib, Amir Malik, Kashif, Anwar, and Rafiullah**. In their words, while growing crops they face water issues; during harvesting, floods come or it rains; they do not know when to harvest; and they do not know when to run the tubewell so that it does not rain afterwards. AquaProof's features — field-specific irrigation timing, tubewell-vs-canal and cost guidance, rain-aware harvest timing, and WhatsApp advisories in the farmer's language — map directly onto these needs.

## Local setup

Docker Compose runs the React web app, the FastAPI backend, and PostgreSQL 16 with PostGIS. Copy `.env.example` to `.env` for a new installation. Keep an existing `.env` and merge the new variable names into it. Fill in a database password. Run `python -m app.officer_auth` from `backend` to choose an officer password and generate its hash. Copy the resulting setting into `.env` and set `AQUAPROOF_SESSION_SECRET` to a separate random value of at least 32 characters.

```sh
docker compose up --build
```

Open `http://127.0.0.1:8080` and sign in with the officer password. The browser session lasts 14 days and survives reloads and browser restarts. To end your session, choose **Sign out** from the officer profile.

The API applies migrations on startup and retains data in the Compose volume. Use `docker compose down` to stop the services. Preserve the database volume and back it up before upgrades. Migrations 010 and 011 add WhatsApp enrollment and separate its queue from historical email records. Migration 012 sets Urdu as the default for new enrollments. Migration 013 records the WhatsApp transport and indexes conversation history.

### Run without Compose

Use Python 3.12+, Node.js as specified in `frontend/package.json`, pnpm, and PostgreSQL with PostGIS. Create a database, configure `DATABASE_URL` in the process environment, and set the officer and provider variables before starting the API. The Compose `.env` file is loaded by Compose. For native development, source a secure environment or use Uvicorn's `--env-file` for the process environment.

```sh
cd backend
python -m venv .venv
# Activate the virtual environment for your shell.
python -m pip install -r requirements.txt
python -m app.database
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Start the frontend in a separate shell.

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Vite proxies `/api` to port 8000. Leave `AQUAPROOF_BACKGROUND_WHATSAPP=0` in development and during QA.

## Cloud deployment (Supabase + Render + Vercel)

The repository ships with `render.yaml` (backend), `frontend/vercel.json` (frontend) and the Dockerfiles so a managed deployment needs only three services: **Supabase** for the PostGIS database, **Render** for the FastAPI backend, and **Vercel** for the React frontend. The frontend proxies `/api` to the backend (configured in `frontend/vercel.json`), so the browser stays on a single origin and the officer session cookie works without cross-site cookies.

Never commit secrets. `.env` is git-ignored; set every secret in the Supabase/Render/Vercel dashboards instead.

### 1. Database — Supabase

1. Create a Supabase project and choose a strong database password.
2. Open **Database → Extensions** and enable **postgis** (migration `001` also runs `CREATE EXTENSION IF NOT EXISTS postgis`, but enabling it first avoids a first-boot race).
3. Copy the connection string from **Project Settings → Database → Connection string**. Use the **Session pooler** (or direct) URI and append `?sslmode=require`. This becomes `DATABASE_URL` on Render. The backend applies all migrations on startup, creating the farms, boundaries (PostGIS polygons), crop seasons, irrigation settings, assistant and WhatsApp tables, so the database stores every field's boundary geometry, area, crop calendar and history automatically after the first deploy.

### 2. Backend — Render

1. In Render choose **New + → Blueprint** and select this repository and the deploy branch. Render reads `render.yaml` and provisions the `aquaproof-api` Docker web service (build context `backend/`). The container runs migrations and then `uvicorn` on Render's `$PORT`; `/health` is the health check.
2. Fill the environment values Render prompts for (the ones marked `sync:false`):
   - `DATABASE_URL` — the Supabase Session-pooler URI with `?sslmode=require`.
   - `AQUAPROOF_OFFICER_PASSWORD_HASH` — generate locally with `cd backend && python -m app.officer_auth` and paste the printed `AQUAPROOF_OFFICER_PASSWORD_HASH=...` value. (`AQUAPROOF_SESSION_SECRET` is generated for you; `AQUAPROOF_SECURE_COOKIES` is already `1`.)
   - `CORS_ORIGINS` — your Vercel site origin, e.g. `https://your-app.vercel.app` (no trailing slash). Required so officer writes from the Vercel-served UI are accepted.
   - `GROQ_API_KEY`, `OPENWEATHER_API_KEY`, `ARCGIS_API_KEY` — provider credentials.
   - WhatsApp (`WAHA_*`) only when a WAHA session is provisioned; leave `ASSISTANT_ENABLED` and `AQUAPROOF_BACKGROUND_WHATSAPP` at `0` until then.
3. Deploy and note the service URL, e.g. `https://aquaproof-api.onrender.com`.

### 3. Frontend — Vercel

1. In `frontend/vercel.json`, replace `REPLACE-WITH-YOUR-RENDER-URL.onrender.com` with your Render backend host. This rewrite forwards `/api/*` to the backend; the SPA fallback serves client-side routes.
2. In Vercel **New Project**, import this repository and set the **Root Directory** to `frontend`. The Vite framework preset, pnpm install and build come from `frontend/vercel.json`.
3. Leave `VITE_API_URL` empty (the app calls `/api` on its own origin). Optionally set `VITE_MAP_TILES` to a public street-tile URL.
4. Deploy. Open the Vercel URL and sign in with the officer password. Confirm the Render `CORS_ORIGINS` matches this exact Vercel origin.

After the first backend boot the Supabase database holds the full schema; drawing and saving a field persists its boundary polygon, representative point and area via PostGIS, and crop, irrigation, weather-decision and WhatsApp records accumulate from there.

> Note: deployment platforms deploy from the branch you connect. This branch (`hasham/science-and-global-map`) carries the Vite frontend and these deploy files; the repository's `main` currently follows a separate Next.js migration. Connect Render and Vercel to this branch (or merge it first) to match the configuration above.

## Configuration

| Environment variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `POSTGRES_PASSWORD` | Database access. Compose builds the connection string. Use a URL-safe Compose password or provide a properly encoded URL in a native deployment. |
| `AQUAPROOF_OFFICER_PASSWORD_HASH`, `AQUAPROOF_SESSION_SECRET`, `AQUAPROOF_SECURE_COOKIES` | Server-only password verifier and independent browser session signing key. Set secure cookies to `1` behind HTTPS. Changing the verifier or signing key invalidates existing sessions. Serve the browser and API on the same origin and retain the original Host header at the proxy. |
| `ASSISTANT_ENABLED`, `ASSISTANT_REPLY_SECRET` | Set `ASSISTANT_ENABLED=1` for verified farmer scheduling and conversations. The reply secret is optional and is used for legacy messages only. |
| `GROQ_API_KEY`, `GROQ_MODEL` | Groq OpenAI-compatible model access for intent classification and reply composition. Defaults to `openai/gpt-oss-120b`. Obtain deployment approval before allowing the provider to process farmer data; confirm the account's data-retention terms, since the OpenAI-compatible endpoint does not accept a zero-retention routing block. |
| `ARCGIS_API_KEY` | Private geocoding credential used by the backend. |
| `ARCGIS_BROWSER_TOKEN` | Separate public token with basemap-only privileges and allowed referrers for the actual deployment. The runtime config refuses to expose a token equal to the geocoding key. Never put the private key in a Vite variable. |
| `ARCGIS_SERVER_BASEMAPS` | Set to `1` to serve ArcGIS v2 styles and relay tiles through the backend with `ARCGIS_API_KEY` when no separate browser token is configured. |
| `ARCGIS_DIGITIZATION_AUTHORIZED` | Optional authorization for ArcGIS Street editing. Satellite and Hybrid are view-only in the current workflow. |
| `OPENWEATHER_API_KEY` | Server-side credential for current conditions and the five-day, three-hour forecast. |
| `OPEN_METEO_URL`, `OPEN_METEO_API_KEY`, `OPEN_METEO_GEOCODING_URL`, `NASA_POWER_URL` | Optional overrides for authorized weather and location services. Use the licensed Open-Meteo endpoint and key for production as applicable. |
| `WAHA_BASE_URL`, `WAHA_SESSION`, `WAHA_API_KEY`, `WAHA_WEBHOOK_SECRET` | Server-only WAHA settings. Use HTTPS for remote WAHA or the private Compose address `http://waha:3000`. The webhook uses an independent HMAC key. |
| `AQUAPROOF_BACKGROUND_WHATSAPP`, `AQUAPROOF_HEALTH_ENABLED` | WhatsApp polling, sending and scheduling require explicit activation. Provider checks default to enabled. |
| `VITE_MAP_TILES` | Optional browser-visible, nonsecret street tile configuration. |

Provider keys pasted into chat should be rotated before deployment and loaded through your secret store into runtime environment variables.

## Officer workflows

- **Farm map** uses MapLibre and Terra Draw. Search registry records or Pakistani places, or enter latitude and longitude. Draw and edit single-ring farm boundaries, undo or redo, import a single GeoJSON or KML polygon, and export visible boundaries. PostGIS calculates saved area. The map switches between irrigation status and crop stage and can display the selected field's current weather marker.

Open street is the default and stays selected during drawing, editing and import. From optional ArcGIS Satellite or Hybrid, opening the editor switches to street while keeping the viewport. The previous view returns after the edit is saved or discarded.

Configure imagery through the ArcGIS runtime settings above. Remove obsolete `VITE_SATELLITE_*` settings from older deployments.

- **Crop and irrigation** records crop and planting date and shows the estimated crop-stage timeline with a per-field progress bar. Crop Monitoring pre-fills the crop from the field's registration record so it is not retyped. The soil-water parameters (total available water, depletion, efficiency, surface evaporation) are **derived automatically from the registered crop and soil type** using FAO-56 tables, so officers only enter the physical water supply (canal turn or tubewell); an **Advanced** toggle exposes the derived values for calibration. The backend runs the FAO-56 irrigation plan automatically and the page shows the recommended plan and daily water balance. Accept, skip, adjust or reopen an irrigation decision from the baseline. These decisions record intentions. Farmer-reported observations and field measurements have their own review paths.
- **Advisory Center** enrolls farmer WhatsApp numbers, queues officer messages, schedules daily and changed-weather advisories, and reviews farmer replies and proposed observations. New enrollments default to Urdu. Officers can select Roman Urdu or English. Every farmer answer is **composed by the language model from the field's full context** — stored records, fresh API weather, the FAO-56 simulation, warabandi schedule, harvest timing and recent history — and is grounded in the engine's deterministic numbers (the model never invents a figure). Identity questions answer as the AquaProof AI assistant, and missing inputs are explained in plain language rather than a canned message. Hazardous, salinity, rice and crop-stress cases are held for officer review. Numerical model results and sources are available in officer evidence. Historical email activity remains in field history.
- **WhatsApp Conversations** shows a farmer's incoming replies, officer messages and assistant advisories across fields. The latest page refreshes while open and older messages are paginated.
- **Reports and Settings** show saved field activity and health checks for weather, map services, WAHA and OpenRouter. The WAHA check self-heals: it tolerates the brief reconnection window after a restart, restarts a session WAHA left stopped (the pairing persists, so no re-scan), and refreshes every few minutes, so a working sending phone shows operational rather than a stale "degraded".

Use **Farm Map → Delete permanently** to remove a field and its linked AquaProof records. For a previously archived field, use **Reports & History → Archived fields**. Type `DELETE` in the confirmation prompt. Permanent deletion removes the boundary, crop seasons, irrigation settings and decisions, linked message history, observations, queued jobs and associated database audit entries. It clears weather cache entries for the field's saved point in the API process. The farmer profile and other fields are preserved. Existing backups, previously collected server logs and copies of WhatsApp messages held outside AquaProof have their own retention.

OpenWeather serves current conditions and forecast intervals. Open-Meteo supplies complete local-day rain and FAO reference evapotranspiration for irrigation calculations, and modeled soil and solar data. NASA POWER supplies the historical archive.

### WhatsApp setup

1. Set a strong `WAHA_API_KEY` and `WAHA_DASHBOARD_PASSWORD` for a dedicated WAHA instance. Give `WAHA_WEBHOOK_SECRET` an independent random value of at least 32 characters. For local Compose, start the optional profile with `docker compose --profile waha up --build -d`. Open AquaProof **Settings → WhatsApp sending phone**. The profile persists the WAHA session in a named volume and configures the signed `message` webhook automatically. Set `WAHA_IMAGE` to a validated tag or digest for a managed rollout.
2. Click **Link sending phone**, then scan the QR code from WhatsApp **Linked devices → Link a device**. To switch numbers, click **Unlink sending phone**, confirm, and link the new number. For an externally hosted WAHA instance, set its private HTTPS origin in `WAHA_BASE_URL` and configure its `message` webhook to the AquaProof API's `POST /webhooks/waha` with HMAC SHA-512 and the same `WAHA_WEBHOOK_SECRET`. Configure retries. Route only that webhook path from WAHA to the API through your private network or HTTPS ingress.
3. In an isolated test instance, enable `ASSISTANT_ENABLED=1` and `AQUAPROOF_BACKGROUND_WHATSAPP=1`. Register the controlled recipient as a farmer, save a field, and select **Send WhatsApp verification** in **AI Advisory Center**. On the recipient phone, send `YES` or the localized confirmation in that WhatsApp chat. Then send an officer test message, reply to it with a farm question, and confirm both directions in **WhatsApp Conversations**.
4. Only the farmer's current registered number may receive an officer-requested verification. Pairing WAHA connects the sending account. The farmer confirms enrollment separately by sending `YES` from the registered number after the verification arrives. After consent, the verified farmer can send regular direct messages in the chat. A registry phone change revokes verification. The webhook ignores groups, self-messages, media and unrecognized senders and deduplicates accepted replies.
5. The conversation shows farmer and AquaProof message text. The Advisory Center records provider acceptance and review status. **WhatsApp Conversations** retains earlier AquaProof history, including Green API records. Review pending and ambiguous messages before enabling the worker after switching providers.

[WAHA installation and pairing](https://waha.devlike.pro/docs/overview/quick-start/) and [WAHA signed webhook configuration](https://waha.devlike.pro/docs/how-to/events/)

To send an officer-written message, open **AI Advisory Center** and select the registered field. When it shows **Verified WhatsApp number**, enter the text under **Officer message** and select **Queue WhatsApp message**. Use **WhatsApp Conversations** to check the message and replies. Queue delivery requires the configured WAHA worker to be running.

In **WhatsApp Conversations**, **Refresh conversation** checks WAHA for recent inbound messages from the selected farmer since verification or an active enrollment request. It checks up to 50 messages and uses the same authorization and deduplication rules as the webhook.

For automated farm answers and advisories, the worker loads the selected farmer-owned field and refreshes current conditions and the short-term forecast from OpenWeather with the Open-Meteo fallback. It also refreshes Open-Meteo rainfall, reference ET, and modeled soil and solar data. NASA POWER remains the historical weather source. Provider failures are recorded with the officer evidence. Farm messages with weather evidence older than ten minutes go to officer review. Irrigation guidance still requires fresh measurements and a usable forecast.

## Architecture and API

React and TypeScript live under `frontend/src`. Nginx serves the production bundle and proxies `/api` to FastAPI. The backend uses psycopg and PostGIS, APScheduler for communications and health checks, and SciPy for constrained irrigation scenarios. The assistant reader uses a transaction-local farmer scope and a restricted PostgreSQL role with row-level security.

| Route | Contract |
| --- | --- |
| `GET /health`, `GET /ready` | Process liveness and database connectivity. |
| `POST /api/auth/sign-in`, `POST /api/auth/sign-out` | Starts or clears the officer's HTTP-only browser session. |
| `GET /api/registry`, `POST /api/registrations` | Current officer registry and atomic owner/field registration. |
| `GET/PATCH/DELETE /api/fields/{id}` | Retrieve, update a WGS84 polygon, or archive a field. |
| `GET /api/registry/archived-fields`, `POST /api/registry/permanent-field-deletion` | List archived fields or permanently delete a field and its linked database records after an explicit confirmation. |
| `GET /api/map/config`, `/api/map/search`, `/api/map/suggest`, `/api/map/reverse` | Browser basemap configuration and location queries. Coordinates are WGS84. |
| `POST /api/crop-seasons`, `GET /api/fields/{id}/crop-lifecycle` | Record planting and read model stage intervals. |
| `GET /api/fields/{id}/crop-progress`, `GET /api/fields/{id}/water-plan` | Deterministic FAO-56 stage timeline (current stage, day-in-stage, percent progress) and per-stage water (mm, m³, tubewell hours) with a forecast-driven "water needed now" block and next irrigation date. Returns `input_required` with the missing inputs instead of guessing. |
| `GET /api/fields/{id}/harvest-window` | Compares modeled crop maturity against the complete Open-Meteo daily rain forecast and returns a harvest readiness (`immature`/`approaching`/`ready`/`overdue`) and recommendation (e.g. harvest before the next wet day). Maturity is modeled; rainfall is forecast. |
| `GET /api/fields/{id}/weather` and its current, recent, agriculture and history subroutes | Coordinate-based weather and source metadata. |
| `GET/PUT /api/fields/{id}/irrigation-settings` | Water supply (canal turn or tubewell) with optional advanced overrides. The FAO-56 soil-water parameters are derived from the registered crop and soil type; `GET` returns the values in effect with a `derived` flag. |
| `POST /api/fields/{id}/simulate`, `PUT /api/fields/{id}/irrigation-decisions/{date}` | Deterministic FAO-56 model (run automatically for the plan, and usable for what-if inputs) and revision-checked baseline decisions. Falls back to the derived soil-water defaults when no record is saved. |
| `GET /api/assistant/status`, `GET /api/assistant/fields/{id}` | WhatsApp and model configuration, enrollment status, messages and officer review queue. |
| `POST /api/assistant/fields/{id}/enroll`, `POST /api/assistant/fields/{id}/messages` | Queue verification or an officer-written WhatsApp message. Enrollment accepts an optional language and omitting it preserves an existing preference. Manual sends accept a client request UUID for deduplication. |
| `GET /api/assistant/conversations/{farmer_id}` | Officer-only farmer conversation history. Use `before` to page backward and `limit` to set page size. History remains readable when the assistant is paused. |
| `POST /api/assistant/conversations/{farmer_id}/refresh` | Reconciles eligible missed replies for the selected farmer while WAHA processing is enabled. |
| `GET /api/assistant/waha/session`, `GET /api/assistant/waha/qr`, `POST /api/assistant/waha/pair`, `POST /api/assistant/waha/unlink` | Officer-only sending phone status, pairing and unlinking. |
| `POST /webhooks/waha` | WAHA signed direct-message callback. Validates SHA-512 HMAC before processing and returns 204 for handled or ignored events. |
| `GET /api/admin/services` | Latest process-local endpoint and coverage checks. |

See [API status](API_STATUS.md) for observed provider behavior and [scientific rules](backend/app/science/CLAUDE.md) for assumptions and source references.

## Testing

```sh
cd backend
python -m unittest discover -s tests -v
python -m compileall -q app tests
python -m app.service_health
python -m app.service_health --credential-smoke --probe-model-routes
python -m tests.live_assistant_smoke
```

Set `AQUAPROOF_TEST_DATABASE_URL` to a disposable PostGIS database whose name begins with `aquaproof_test` to run the migration, row isolation, PostGIS, WhatsApp adapter and scheduler tests. The live assistant smoke command uses a dedicated QA database, synthetic farm and forecast fixtures, and the configured Groq model. It does not transmit WhatsApp messages.

```sh
cd frontend
pnpm format:check
pnpm typecheck
pnpm build
```

For browser tests, install Playwright in an ignored QA directory from the project root with `npm install --prefix .qa/browser --no-package-lock playwright`. Start the backend against the disposable database and Vite as described above. Set `AQUAPROOF_TEST_OFFICER_PASSWORD` to the isolated instance's officer password and `AQUAPROOF_BROWSER_PERSISTENCE=1`, then run `pnpm test:browser` from `frontend`. The default browser channel is Edge. Set `AQUAPROOF_BROWSER_CHANNEL` and `AQUAPROOF_PLAYWRIGHT_DIR` for a different installed test browser or module path. Leave persistence mode off to exercise a backend with no database connection. Use only QA contacts and keep WhatsApp jobs disabled. See [test report](TEST_REPORT.md).

## Deployment and release gates

Use HTTPS and a government identity-aware gateway that accounts for individual officers, restrict the service to approved networks, and use a secret store and managed backups. Keep the default Compose database private. Use one scheduled API worker until there is shared provider health storage and a separately deployed scheduler. Validate restores and apply migrations in a staging database first. PostgreSQL migration access must support creating the PostGIS extension, tables, policies and assistant reader role. For a separate production runtime login, grant application DML, sequence access and membership in the restricted assistant reader role. Keep the migration role separate from runtime infrastructure.

## License

AquaProof is released under the [MIT License](LICENSE). The crop and irrigation model is adapted from the PI-Advisor project (MIT) and FAO-56 / CROPWAT published methods; see [scientific rules](backend/app/science/CLAUDE.md) and `backend/app/science/PI-Advisor-LICENSE.txt` for attribution. Third-party data and map providers (OpenWeather, Open-Meteo, NASA POWER, ArcGIS, Groq, WAHA) remain under their own terms.
