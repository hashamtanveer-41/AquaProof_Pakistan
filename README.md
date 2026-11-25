# AquaProof Pakistan

AquaProof is an agricultural officer workspace for farm boundaries, crop seasons, weather-based irrigation planning, and farmer correspondence. Farmers use WhatsApp from a verified number. Officers manage enrollment, advisories and conversations in the dashboard.

## Local setup

Docker Compose runs the React web app, the FastAPI backend, and PostgreSQL 16 with PostGIS. Copy `.env.example` to `.env` for a new installation. Keep an existing `.env` and merge the new variable names into it. Fill in a database password and an independently generated officer access token of at least 32 characters.

```sh
docker compose up --build
```

Open `http://127.0.0.1:8080` and enter the officer token.

The API applies migrations on startup and retains data in the Compose volume. Use `docker compose down` to stop the services. Preserve the database volume and back it up before upgrades. Migrations 010 and 011 add WhatsApp enrollment and separate its queue from historical email records. Migration 012 sets Urdu as the default for new enrollments and retains saved language preferences.

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

## Configuration

| Environment variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `POSTGRES_PASSWORD` | Database access. Compose builds the connection string. Use a URL-safe Compose password or provide a properly encoded URL in a native deployment. |
| `ASSISTANT_OFFICER_TOKEN` | Shared officer access token. APIs require it with the assistant on or off. Use `AQUAPROOF_ALLOW_UNAUTHENTICATED_DEV=1` only on a disposable local instance with the assistant off. |
| `ASSISTANT_ENABLED`, `ASSISTANT_REPLY_SECRET` | Set `ASSISTANT_ENABLED=1` for verified farmer scheduling and conversations. Sign reply tokens with a separate random secret of at least 32 characters. Rotation invalidates outstanding tokens. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_APPROVED_PROVIDERS` | Defaults to `openai/gpt-4o`. Configure the approved provider allowlist. Synthetic testing of the Azure route passed with zero data retention and collection disabled. Obtain deployment approval before allowing any provider to process farmer data. |
| `ARCGIS_API_KEY` | Private geocoding credential used by the backend. |
| `ARCGIS_BROWSER_TOKEN` | Separate public token with basemap-only privileges and allowed referrers for the actual deployment. The runtime config refuses to expose a token equal to the geocoding key. Never put the private key in a Vite variable. |
| `ARCGIS_SERVER_BASEMAPS` | Set to `1` to serve ArcGIS v2 styles and relay tiles through the backend with `ARCGIS_API_KEY` when no separate browser token is configured. |
| `ARCGIS_DIGITIZATION_AUTHORIZED` | Optional authorization for ArcGIS Street editing. Satellite and Hybrid are view-only in the current workflow. |
| `OPENWEATHER_API_KEY` | Server-side credential for current conditions and the five-day, three-hour forecast. |
| `OPEN_METEO_URL`, `OPEN_METEO_API_KEY`, `OPEN_METEO_GEOCODING_URL`, `NASA_POWER_URL` | Optional overrides for authorized weather and location services. Use the licensed Open-Meteo endpoint and key for production as applicable. |
| `GREEN_API_ID_INSTANCE`, `GREEN_API_TOKEN_INSTANCE`, `GREEN_API_BASE_URL` | Server-only WhatsApp settings. Use the HTTPS API URL shown in the instance console. |
| `AQUAPROOF_BACKGROUND_WHATSAPP`, `AQUAPROOF_HEALTH_ENABLED` | WhatsApp polling, sending and scheduling require explicit activation. Provider checks default to enabled. |
| `VITE_MAP_TILES` | Optional browser-visible, nonsecret street tile configuration. |

Provider keys pasted into chat should be rotated before deployment and loaded through your secret store into runtime environment variables.

## Officer workflows

- **Farm map** uses MapLibre and Terra Draw. Search registry records or Pakistani places, or enter latitude and longitude. Draw and edit single-ring farm boundaries, undo or redo, import a single GeoJSON or KML polygon, and export visible boundaries. PostGIS calculates saved area. The map switches between irrigation status and crop stage and can display the selected field's current weather marker.

Open street is the default and stays selected during drawing, editing and import. From optional ArcGIS Satellite or Hybrid, opening the editor switches to street while keeping the viewport. The previous view returns after the edit is saved or discarded.

Configure imagery through the ArcGIS runtime settings above. Remove obsolete `VITE_SATELLITE_*` settings from older deployments.

- **Crop and irrigation** records crop and planting date, shows the estimated crop-stage timeline, and simulates consecutive forecast days using field inputs. Compare forecast rain, canal allocations and delays, and tubewell availability and energy costs. Accept, skip, adjust or reopen an irrigation decision from the baseline. These decisions record intentions. Farmer-reported observations and field measurements have their own review paths.
- **Advisory Center** enrolls farmer WhatsApp numbers, queues officer messages, schedules daily and changed-weather advisories, and reviews farmer replies and proposed observations. New enrollments default to Urdu. Officers can select Roman Urdu or English. Farmer messages emphasize practical field checks, irrigation technique and qualitative weather guidance. Numerical model results and sources are available in officer evidence. Historical email activity remains in field history.
- **Reports and Settings** show saved field activity and health checks for weather, map services, Green API and OpenRouter.

OpenWeather serves current conditions and forecast intervals. Open-Meteo supplies complete local-day rain and FAO reference evapotranspiration for irrigation calculations, and modeled soil and solar data. NASA POWER supplies the historical archive.

### WhatsApp setup

1. Connect a dedicated WhatsApp number to Green API and configure the three instance environment variables. Enable incoming notifications (`incomingWebhook=yes`) and leave the webhook URL empty to use the HTTP notification queue. Keep other consumers off this instance.
2. Check the Green API row in Settings. Enable the assistant and set a distinct reply secret. Enable `AQUAPROOF_BACKGROUND_WHATSAPP=1` in an isolated staging deployment with a controlled contact first. The worker polls Green API and deletes each notification after local processing.
3. Register a farmer with a WhatsApp number. Use **Send WhatsApp verification** from Advisory Center. The farmer uses WhatsApp **Reply** on the verification message and types **ہاں** or `YES`. To ask a question, reply to the latest AquaProof message or include its `AQ-REPLY` line. Each reply can continue the conversation using the new token. Tokens expire after seven days and can be used once by the matching number. Only an officer-requested verification can be delivered before the registered number is verified.
4. Green API acceptance is recorded separately from farmer responses. Timeout after possible provider acceptance goes to officer review. A changed registry number revokes verification and existing reply tokens. The worker never converts historical email rows into WhatsApp sends.

[Green API HTTP notification queue](https://green-api.com/en/docs/api/receiving/technology-http-api/ReceiveNotification/) and [Green API sendMessage](https://green-api.com/en/docs/api/sending/SendMessage/)

For automated farm answers and advisories, the worker loads the selected farmer-owned field and refreshes current conditions and the short-term forecast from OpenWeather with the Open-Meteo fallback. It also refreshes Open-Meteo rainfall, reference ET, and modeled soil and solar data. NASA POWER remains the historical weather source. Provider failures are recorded with the officer evidence. Farm messages with weather evidence older than ten minutes go to officer review. Irrigation guidance still requires fresh measurements and a usable forecast.

## Architecture and API

React and TypeScript live under `frontend/src`. Nginx serves the production bundle and proxies `/api` to FastAPI. The backend uses psycopg and PostGIS, APScheduler for communications and health checks, and SciPy for constrained irrigation scenarios. The assistant reader uses a transaction-local farmer scope and a restricted PostgreSQL role with row-level security.

| Route | Contract |
| --- | --- |
| `GET /health`, `GET /ready` | Process liveness and database connectivity. |
| `GET /api/registry`, `POST /api/registrations` | Current officer registry and atomic owner/field registration. |
| `GET/PATCH/DELETE /api/fields/{id}` | Retrieve, update a WGS84 polygon, or archive a field. |
| `GET /api/map/config`, `/api/map/search`, `/api/map/suggest`, `/api/map/reverse` | Browser basemap configuration and location queries. Coordinates are WGS84. |
| `POST /api/crop-seasons`, `GET /api/fields/{id}/crop-lifecycle` | Record planting and read model stage intervals. |
| `GET /api/fields/{id}/weather` and its current, recent, agriculture and history subroutes | Coordinate-based weather and source metadata. |
| `GET/PUT /api/fields/{id}/irrigation-settings` | Officer-entered soil and water inputs. |
| `POST /api/fields/{id}/simulate`, `PUT /api/fields/{id}/irrigation-decisions/{date}` | Read-only what-if model and revision-checked baseline decisions. |
| `GET /api/assistant/status`, `GET /api/assistant/fields/{id}` | WhatsApp and model configuration, enrollment status, messages and officer review queue. |
| `POST /api/assistant/fields/{id}/enroll`, `POST /api/assistant/fields/{id}/messages` | Queue verification or an officer-written WhatsApp message. Enrollment accepts an optional language and omitting it preserves an existing preference. Manual sends accept a client request UUID for deduplication. |
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

Set `AQUAPROOF_TEST_DATABASE_URL` to a disposable PostGIS database whose name begins with `aquaproof_test` to run the migration, row isolation, PostGIS, WhatsApp adapter and scheduler tests. The live assistant smoke command uses a dedicated QA database, synthetic farm and forecast fixtures, and the configured OpenRouter provider. It does not transmit WhatsApp messages.

```sh
cd frontend
pnpm format:check
pnpm typecheck
pnpm build
```

For browser tests, install Playwright in an ignored QA directory from the project root with `npm install --prefix .qa/browser --no-package-lock playwright`. Start the backend against the disposable database and Vite as described above. Set `AQUAPROOF_TEST_OFFICER_TOKEN` to the QA officer token and `AQUAPROOF_BROWSER_PERSISTENCE=1`, then run `pnpm test:browser` from `frontend`. The default browser channel is Edge. Set `AQUAPROOF_BROWSER_CHANNEL` and `AQUAPROOF_PLAYWRIGHT_DIR` for a different installed test browser or module path. Leave persistence mode off to exercise a backend with no database connection. Use only QA contacts and keep WhatsApp jobs disabled. See [test report](TEST_REPORT.md).

## Deployment and release gates

Use HTTPS and a government identity-aware gateway that accounts for individual officers, restrict the service to approved networks, and use a secret store and managed backups. Keep the default Compose database private. Use one scheduled API worker until there is shared provider health storage and a separately deployed scheduler. Validate restores and apply migrations in a staging database first. PostgreSQL migration access must support creating the PostGIS extension, tables, policies and assistant reader role. For a separate production runtime login, grant application DML, sequence access and membership in the restricted assistant reader role. Keep the migration role separate from runtime infrastructure.

Regional cultivar calibration, district water allocation data, a permitted satellite credential, and a controlled WhatsApp test number remain deployment inputs. The current optimizer is a short-horizon soil-water balance. It has no validated local yield model, paddy water model, live canal telemetry, or individually attributed officer accounts. See [project memory](CLAUDE.md).
