# External API status

Observed on 25 November 2026 using public inputs in Multan, Hyderabad, Mardan and Quetta. The dashboard's Settings page reads the latest service health snapshot. Credentials were kept out of this report and the application source.

| Provider and endpoint | Verified output | Required input or limitation |
| --- | --- | --- |
| OpenWeather `https://api.openweathermap.org/data/2.5/weather` and `/data/2.5/forecast` | Current conditions and 40 three-hour periods passed the live checks across all four provincial samples. | Forecast periods are grouped by local end time for display. These endpoints do not supply reference ET. [OpenWeather forecast documentation](https://openweathermap.org/api/forecast5) |
| OpenWeather `https://api.openweathermap.org/data/3.0/onecall` and `/data/3.0/onecall/day_summary` | HTTP 401 with the supplied credential. | These endpoints are outside the active integration. |
| Open-Meteo `https://api.open-meteo.com/v1/forecast` | Current conditions, fresh rainfall and ET forecasts, and modeled soil/solar fields passed in all four samples. | Supplies irrigation inputs and the public-weather fallback. Configure the authorized production endpoint and key if applicable. |
| Open-Meteo `https://geocoding-api.open-meteo.com/v1/search` | Pakistani candidate returned for Multan. | Gazetteer coverage varies. |
| NASA POWER `https://power.larc.nasa.gov/api/temporal/daily/point` | Dated historical precipitation returned for the Multan archive check. | Daily archive source. Near-real-time data and local station equivalence were outside the check. |
| ArcGIS `https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer` operations `findAddressCandidates`, `suggest` and `reverseGeocode` | The supplied server credential returned Pakistan candidates in all four cities, suggestions for a Multan prefix, and a reverse-geocoded Multan address. | This is sampled coverage. Registry search and WGS84 coordinates remain available for unindexed places. |
| ArcGIS `https://basemapstyles-api.arcgis.com/arcgis/rest/services/styles/v2/styles/arcgis` styles `streets`, `imagery/standard` and `imagery` | HTTP 200 and v8 style documents. Edge loaded real ArcGIS raster and vector tiles via the server relay. | Open street is the default editor basemap. ArcGIS Satellite and Hybrid are view-only. |
| OpenRouter `https://openrouter.ai/api/v1/key` | HTTP 200 with credit and usage fields. | Rotate the exposed credential before deployment. |
| OpenRouter `https://openrouter.ai/api/v1/chat/completions` | `openai/gpt-4o` via Azure returned HTTP 200 for structured output and a forced function call with the app's privacy restrictions. `openai/gpt-4.1` via Azure also passed. The OpenAI provider route returned HTTP 404 for both models under the same restrictions. | Approve and configure the Azure route or another verified ZDR provider. Keep the default model unless deployment requirements change. |
| OpenFreeMap `https://tiles.openfreemap.org/styles/liberty` and OpenStreetMap raster tiles | HTTP success for the v8 style and HTTP 200 for a sample raster tile. | Maintain attribution and provider usage policy. Plan capacity for a national rollout. |
| Historical Green API WhatsApp `getStateInstance`, `getSettings`, `sendMessage`, `getMessage` | Regional HTTPS endpoint returned `authorized` and `incomingWebhook=no`. A one-off synthetic Mianwali wheat advisory to the supplied test number returned a message ID. | **Degraded.** Outbound sending is verified. Incoming notifications and the background worker are paused, so farmer replies have not been tested live. The notification queue was untouched. [Green API settings docs](https://green-api.com/en/docs/api/account/GetSettings/) |

The optional custom street tile URL (`VITE_MAP_TILES`) and Google font files are browser resources. Use the ArcGIS runtime settings for satellite and hybrid views. The legacy `VITE_SATELLITE_*` options have been removed. See the map options in [README.md](README.md).

## WAHA integration

| Provider and endpoint | Behavior |
| --- | --- |
| WAHA `POST /api/sendText` | Enqueues delivery through the existing verified-farmer worker. WAHA acceptance is recorded separately from farmer responses. An uncertain response puts the message in review. |
| WAHA `message` webhook to `POST /webhooks/waha` | Validates the raw SHA-512 HMAC, session and direct sender and applies the existing enrollment, reply expiry and deduplication rules. Uses `GET /api/{session}/lids/{lid}` for linked sender IDs. |
| WAHA `GET /api/sessions/{session}` | Settings reports WAHA connectivity and session state. The signed callback is verified independently during round-trip QA. |

[WAHA text API](https://waha.devlike.pro/docs/how-to/send-messages/) and [WAHA incoming messages and quoted replies](https://waha.devlike.pro/docs/how-to/receive-messages/)

The WhatsApp worker continues to refresh OpenWeather current and forecast feeds and Open-Meteo irrigation and agricultural feeds for field answers.

The WAHA session and private callback path were checked locally. The AquaProof endpoint rejected unsigned requests and accepted the signature on a test request before applying its paused-worker gate. After pairing, WAHA reported `WORKING`. An isolated enrollment verification received a WhatsApp `DEVICE` acknowledgement. The GOWS history endpoint returned the farmer's plain consent with a linked sender ID. Conversation refresh recovered one matching confirmation and the worker sent one enrollment acknowledgement.

The main workspace now receives the signed WAHA callback. It reported the linked sending phone and an active worker. A fresh synthetic OpenRouter probe for `openai/gpt-4o` returned HTTP 200 for structured output and a forced tool call under the configured privacy routing. The pairing and unlink API keeps the WAHA credential on the server. No existing phone was unlinked during the checks.

Both officer dashboards returned HTTP 200 for place and coordinate forecasts, registered-field forecasts, current conditions, recent history, soil and solar data, and the historical archive. Results came from OpenWeather, Open-Meteo and NASA POWER. The primary field's irrigation simulation returned HTTP 409 because its irrigation settings had not been saved.

Officer API clients use `POST /api/auth/sign-in` to obtain the same-site session cookie and `POST /api/auth/sign-out` to clear it.

The permanent field deletion endpoint removes linked records from AquaProof's live database. The WAHA service and handset copies keep their own message history. AquaProof access logging omits API paths and query strings from the current FastAPI and Nginx configuration.
