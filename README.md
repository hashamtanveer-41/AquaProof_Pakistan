# AquaProof Pakistan 🌾💧

> **AI-Powered Agricultural Advisory & Irrigation Management Platform**  
> *Government-operated farm intelligence — built for the Hackathon by a 5-member engineering & research team.*

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB.svg?logo=python&logoColor=white)](https://www.python.org)
[![React](https://img.shields.io/badge/React-19.0-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC.svg?logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-PostGIS-4169E1.svg?logo=postgresql&logoColor=white)](https://postgis.net/)
[![OpenAI](https://img.shields.io/badge/OpenAI-API-412991.svg?logo=openai&logoColor=white)](https://platform.openai.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📖 Table of Contents

- [Overview](#-overview)
- [The Problem & Value Proposition](#-the-problem--value-proposition)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Team Roster & Ownership](#-team-roster--ownership)
- [Repository Structure](#-repository-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Backend Setup (FastAPI)](#backend-setup-fastapi)
  - [Frontend Setup (React + Vite)](#frontend-setup-react--vite)
  - [Email Testing with Mailpit](#email-testing-with-mailpit)
- [API Reference](#-api-reference)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [License](#-license)

---

## ⚡ Overview

**Current status.** Connected mode supports geographic field registration, crop seasons, scheduled email, field-level weather, and irrigation scenarios. Search the live map by place or coordinates and register a farmer outside the original demo regions. Weather and irrigation calculations use the saved field boundary.

**AquaProof Pakistan** gives government agricultural officers a digital record of every registered farm and uses location-specific weather data, FAO-56 scientific simulation, and AI communication to deliver timely, personalized irrigation and crop-management guidance — even to farmers who don't use smartphones.

Officers manage farms through a central web dashboard. Farmers receive recommendations via email (simulating SMS for the prototype). Every advisory is generated from that farm's actual polygon boundary, crop stage, soil profile, and local weather — not generic templates.

---

## 🌾 The Problem & Value Proposition

- **Pakistan's Water Crisis:** Agriculture consumes over **90% of Pakistan's freshwater** while irrigation efficiency remains critically low due to poor timing, over-watering, and lack of farm-specific guidance.
- **No Farm-Level Intelligence:** Existing advisory systems issue blanket district-level recommendations. A Punjab wheat farmer and a KPK maize farmer receive the same guidance despite having entirely different water sources, rainfall, and crop stages.
- **The AquaProof Solution:**
  1. **Persistent Farm Registry:** Every participating farm has a permanent digital profile — geographic boundary, crop history, water sources, and irrigation records — stored and queryable by location.
  2. **Scientific Irrigation Engine:** Implements the internationally validated FAO-56 methodology to calculate exactly how much water each crop needs at each growth stage, accounting for local evapotranspiration and soil conditions.
  3. **Canal vs. Tubewell Optimizer:** Weighs the farmer's registered canal turn schedule against tubewell pumping costs and rainfall forecasts to recommend the most cost-effective irrigation strategy.
  4. **AI-Powered Communication:** Farmers reply in English, Urdu, or Roman Urdu. OpenAI extracts structured data from natural language replies, updates farm records, and generates a recalculated advisory — all automatically.

---

## 🎯 Key Features

### 1. 🗺️ Interactive Farm Mapping & Permanent Registration
- Government officers draw exact farm boundaries by clicking points on a live map (MapLibre GL JS + Terra Draw).
- Field area is calculated server-side from the saved geographic polygon via PostGIS geography functions.
- Each farmer can have multiple fields; each field maintains an independent crop history.
- The API accepts GeoJSON polygons and stores valid WGS84 boundaries in PostGIS with a spatial index.

### 2. 🌱 Farmer-Specific Crop Monitoring
- System records crop type, variety, planting date, soil profile, and irrigation source per field.
- Crop growth stage is estimated from planting date and the PI-Advisor crop calendar. Local weather drives daily crop water demand.
- Full seasonal history is preserved after harvest. Officers can review past crop rotations and irrigation events without overwriting older records.

### 3. 💧 Scientific Irrigation & Smart Decision Engine
- Implements **FAO-56 crop-water balance** methodology (adapted from PI-Advisor) — the same standard used by international agricultural organizations.
- Answers four questions for every farm: how much water is needed, when to irrigate, whether to use canal or tubewell, and what happens if the forecast changes.
- The SciPy optimizer compares no irrigation, canal only, tubewell only, and mixed supply where configured. It prioritizes modeled crop stress and then pumping cost.
- Water volume formula: `Volume (m³) = Depth (mm) × Area (m²) ÷ 1000`

### 4. 📧 Email Advisories and Reply Review

- Officers approve emails for immediate or scheduled SMTP delivery. APScheduler processes the delivery queue.
- A configured OpenAI-compatible endpoint can extract irrigation source, duration, and date from Urdu, Roman Urdu, or English replies.
- Officers approve complete parsed replies before they appear in the field history. Automatic recommendations depend on the planned scientific engine.
- **Mailpit** captures outgoing email for local testing.

### 5. 🏛️ Government Officer Dashboard
- Clean, authoritative dashboard showing all registered farms, their current crop stage, last advisory, next recommended action, and full conversation history.
- Real-time weather panel per farm sourced from **Open-Meteo API** (temperature, humidity, rainfall, ET₀).
- Advisory center with one-click send, approval flow, and message log.
- Irrigation cost comparison chart (Recharts) — canal vs. tubewell, with estimated pumping expense.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    Officer([Government Officer / Browser])
    Farmer([Farmer / Email])

    subgraph Frontend ["Frontend (React 19 + Vite + MapLibre)"]
        Dashboard[Officer Dashboard]
        MapEditor[Farm Map & Polygon Editor]
        WeatherPanel[Weather & Crop Panel]
        AdvisoryUI[Advisory Center & Message Log]
    end

    subgraph Backend ["FastAPI Backend (:8000)"]
        Router[API Gateway & Router]
        FarmSvc[Farm & Crop Service]
        SciEngine[FAO-56 Scientific Engine]
        Optimizer[Canal vs Tubewell Optimizer]
        WeatherSvc[Weather Service]
        AISvc[OpenAI Message Parser]
        EmailSvc[Email Advisory Service]
        Scheduler[APScheduler — Daily Advisory Jobs]
        DB[(PostgreSQL + PostGIS)]
    end

    subgraph External ["External APIs"]
        OpenMeteo[Open-Meteo Weather API]
        OpenAI[OpenAI Structured Outputs]
        Mailpit[Mailpit — Local SMTP & Inbox]
    end

    Officer --> Dashboard
    Dashboard --> Router
    MapEditor -->|GeoJSON polygon| FarmSvc
    FarmSvc --> DB
    WeatherSvc --> OpenMeteo
    SciEngine --> Optimizer
    Optimizer --> Router
    Scheduler --> EmailSvc
    EmailSvc --> Mailpit
    Mailpit -->|Farmer replies| Farmer
    Farmer -->|Email reply| AISvc
    AISvc --> OpenAI
    AISvc --> FarmSvc
```

---

## Planned open-source integrations

These integrations are planned for a functional government-operated irrigation management platform. Inspect each project's documentation, source code, and license before implementation.

1. **PI-Advisor** — Use its irrigation algorithms, soil-water balance calculations, and crop water requirement models as the scientific foundation. [PI-Advisor](https://github.com/wateraccounting/PI-Advisor)
2. **MapLibre GL JS and Terra Draw** — Provide interactive farm mapping, boundary tracing and editing, and land area calculation. [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) · [Terra Draw](https://github.com/JamesLMilner/terra-draw)
3. **PostgreSQL and PostGIS** — Persist farm boundaries, farmer profiles, irrigation schedules, and historical records. [PostgreSQL](https://github.com/postgres/postgres) · [PostGIS](https://github.com/postgis/postgis)
4. **Open-Meteo and NASA POWER** — Integrate weather forecasts and historical agricultural data. [Open-Meteo](https://github.com/open-meteo/open-meteo) · [NASA POWER](https://power.larc.nasa.gov/)
5. **SciPy** — Develop Pakistan-specific Warabandi scheduling, canal water allocation, tubewell cost optimization, and what-if simulations. [SciPy](https://github.com/scipy/scipy)
6. **FastAPI** — Implement backend APIs using a modular architecture. [FastAPI](https://github.com/fastapi/fastapi)
7. **Mailpit and SMTP/IMAP** — Implement two-way email communication to simulate farmer SMS interactions. [Mailpit](https://github.com/axllent/mailpit)

### Future implementation instructions

- Inspect the existing AquaProof codebase before making changes, and verify repository URLs and licenses.
- Reuse relevant implementations and algorithms where appropriate. Install libraries directly instead of cloning entire repositories unnecessarily.
- Preserve the existing UI and PRD requirements. Keep dependencies minimal and avoid paid APIs.
- Implement each integration sequentially and test it before proceeding.
- Use real data where available and maintain proper open-source attribution.
- Ensure the modules work together as one functional government-operated irrigation management platform, and continue implementation until all integrations are functional.

## 👥 Team Roster & Ownership

| Member | Role | Key Responsibilities |
| :--- | :--- | :--- |
| **Asfand** | **Backend Lead, Mapping & AI Integration** | FastAPI setup, PostgreSQL/PostGIS schema and migrations, farm/field/crop APIs, MapLibre mapping and Terra Draw boundary editing, OpenAI message parsing, SMTP email service, APScheduler advisory jobs, Docker Compose, branch integration, and frontend/backend consistency for these features. |
| **Hasham** | **Scientific Engine & Weather** | FAO-56 crop-water balance module (adapted from PI-Advisor), Open-Meteo & NASA POWER integration, crop stage estimation, canal vs. tubewell cost optimizer, synthetic demo dataset. |
| **Hamza** | **Frontend & UI/UX** | React dashboard, weather panel, irrigation chart (Recharts), advisory center UI, conversation panel, full backend API integration. |
| **Talal** | **Research, Docs & Presentation** | Problem research (Pakistani canal water practices, FAO-56 methodology), README, architecture diagrams, API guide, competition slides, live demo script. |
| **Sarim** | **QA, Testing & Validation** | Pytest unit & integration tests, farm boundary & area validation, simulation regression tests against PI-Advisor reference fixtures, email delivery & AI parsing tests, bug tracker. |

---

## 📁 Repository Structure

The tree below describes the target layout. The implemented backend uses app/registry.py, app/communications.py, and numbered SQL migrations.

```text
aquaproof-pakistan/
│
├── frontend/              # React + Vite + TypeScript
│   ├── public/          # Branding and demo satellite imagery
│   ├── src/
│   │   ├── app/         # Dashboard shell, navigation, and state
│   │   ├── pages/       # Dashboard views
│   │   ├── features/    # Map and registration workflows
│   │   ├── components/  # Shared UI components
│   │   ├── domain/      # Demo data and irrigation calculations
│   │   ├── styles/      # Global dashboard styles
│   │   └── main.tsx     # React entry point
│   ├── package.json
│   ├── pnpm-lock.yaml
│   └── vite.config.ts
│
├── backend/                         # Python 3.12+ / FastAPI
│   ├── app/
│   │   ├── main.py                  # FastAPI entry point & CORS
│   │   ├── database.py              # SQLAlchemy engine & session factory
│   │   │
│   │   ├── models/                  # SQLAlchemy ORM models (10 entities)
│   │   ├── schemas/                 # Pydantic request/response schemas
│   │   │
│   │   ├── routes/
│   │   │   ├── farmers.py           # /api/farmers
│   │   │   ├── fields.py            # /api/fields
│   │   │   ├── crops.py             # /api/crop-seasons
│   │   │   ├── weather.py           # /api/fields/{id}/weather
│   │   │   ├── irrigation.py        # /api/fields/{id}/simulate & /optimize
│   │   │   ├── advisories.py        # /api/advisories
│   │   │   └── messages.py          # /api/messages/inbound
│   │   │
│   │   ├── services/
│   │   │   ├── weather_service.py   # Open-Meteo + NASA POWER integration
│   │   │   ├── canal_service.py     # Canal turn schedule management
│   │   │   ├── irrigation_engine.py # FAO-56 soil-water balance wrapper
│   │   │   ├── optimizer.py         # Canal vs tubewell SciPy optimizer
│   │   │   ├── ai_service.py        # OpenAI structured message parsing
│   │   │   ├── advisory_service.py  # Advisory generation & scheduling
│   │   │   └── email_service.py     # SMTP send + Mailpit integration
│   │   │
│   │   ├── scientific/
│   │   │   └── fao56/               # FAO-56 crop-water balance module
│   │   │       ├── __init__.py
│   │   │       ├── crop_coefficients.py
│   │   │       ├── water_balance.py
│   │   │       └── crop_parameters.json
│   │   │
│   │   └── worker.py                # APScheduler background jobs
│   │
│   ├── migrations/                  # Alembic migration scripts
│   ├── tests/                       # Pytest unit & integration tests
│   └── requirements.txt
│
├── data/
│   ├── crop_parameters/             # FAO-56 crop coefficient tables
│   ├── reference_weather/           # NASA POWER historical reference data
│   └── demo/                        # Synthetic Punjab wheat farm demo dataset
│
├── docs/
│   ├── architecture.md
│   ├── api-contract.md
│   ├── er-diagram.md
│   └── research-sources.md
│
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- **Frontend** requires Node.js 20.19+ on the 20.x line or Node.js 22.12+, and pnpm 10.34.3.
- **Python**: v3.12 or higher
- **Docker & Docker Compose**: v2.0+
- Docker Compose provides **PostgreSQL and PostGIS** for the persistent database.

---

### Backend Setup (FastAPI)

Start the dashboard, API, PostgreSQL with PostGIS, and Mailpit from the repository root.

```bash
docker compose up -d --build
```

Compose applies SQL migrations on startup and stores records in a named volume. Open the [connected dashboard](http://localhost:8080), [API documentation](http://localhost:8000/docs), or [service health](http://localhost:8000/health).

### Frontend Setup (React + Vite)

Use Vite for local frontend development. Install the dependencies and set the API URL before starting Vite. In PowerShell:

```powershell
cd frontend
pnpm install --frozen-lockfile
$env:VITE_API_URL = 'http://127.0.0.1:8000'
pnpm dev
```

In Bash, set the variable with `export VITE_API_URL=http://127.0.0.1:8000`. With the variable unset, the frontend runs its standalone demo. The connected registry starts empty and loads data from the API. The map uses MapLibre GL JS and Terra Draw with an attributed OpenStreetMap basemap. Set `VITE_MAP_TILES` to a compatible raster tile URL template to use another provider.

### Field weather and irrigation

- In Farm Map, enter a place name or decimal coordinates in `latitude, longitude` order. Pan or zoom to the parcel, draw its boundary, and link it to a farmer. A farmer's region is a label for filtering records. The weather API queries a point inside the parcel stored in PostGIS.
- Weather & Canal Data shows a seven-day forecast with reference ET from [Open-Meteo](https://open-meteo.com/en/docs) and daily historical observations from [NASA POWER](https://power.larc.nasa.gov/docs/services/api/temporal/daily/). An unavailable provider or measurement is reported as such.
- In Crop Monitoring, save the crop and planting date. In Irrigation Intelligence, enter the field's measured root-zone and surface water parameters, current depletion and application efficiency. Add the farmer's first Warabandi turn date, recurrence, duration and flow, or the tubewell flow, daily hours and pumping cost, as appropriate.
- Run a baseline or change rainfall, canal timing or pumping cost. Root-zone calculations use the PI-Advisor crop calendar and an FAO-56 balance with estimated surface evaporation. The plan is a seven-day, field-level estimate. Canal limits come from the entered roster and flow rather than telemetry, and irrigation windows are modeled at daily resolution.
- **Explain this plan with AI** uses the configured OpenAI-compatible API. It sends the modeled plan and weather context without farmer contact details. The explanation stays separate from the calculated quantities and costs.

To add two clearly labeled synthetic registry examples in Sindh and Balochistan, run:

```bash
docker compose exec api python -m app.science.demo
```

The examples use live weather for their sample coordinates.

### Email Testing with Mailpit

The Advisory Center queues an officer-approved email immediately or for a selected time. APScheduler sends due messages through SMTP and records delivery status. The default Compose configuration delivers locally to [Mailpit](http://localhost:8025).

Record a farmer reply against a sent advisory in the UI, or submit it through `POST /api/messages/inbound`. For a mailbox that receives real replies, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, and any required SMTP credentials. Set `SMTP_STARTTLS=1` for a provider that requires STARTTLS. Set `IMAP_HOST`, `IMAP_PORT`, `IMAP_USERNAME`, and `IMAP_PASSWORD` for mailbox polling. Replies imported from IMAP are matched to a sent advisory using the email thread and farmer address.

To parse replies, set `OPENAI_BASE_URL` to an OpenAI-compatible endpoint ending in `/v1` and set `OPENAI_MODEL`. Set `OPENAI_API_KEY` if the provider requires authentication. A compatible local model can handle parsing without a paid API. Complete parsed records go into field history when an officer approves them.

The local API and Mailpit UI bind to loopback. This development setup has no officer authentication and is intended for local evaluation with test records.

---

## 🔌 API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service status check |
| `POST` | `/api/farmers` | Register a new farmer |
| `GET` | `/api/farmers` | List all registered farmers |
| `GET` | `/api/farmers/{id}` | Retrieve farmer profile |
| `GET` | `/api/registry` | List farmers and fields in one snapshot |
| `POST` | `/api/registrations` | Register a farmer and field in one transaction |
| `POST` | `/api/fields?farmer_id={id}` | Save farm boundary (GeoJSON) + attributes |
| `GET` | `/api/fields/{id}` | Retrieve field with GeoJSON boundary |
| `PATCH` | `/api/fields/{id}` | Update registered field |
| `POST` | `/api/crop-seasons?field_id={id}` | Start a new crop cycle for a field |
| `GET` | `/api/locations?q={place}` | Look up map coordinates by place name |
| `GET` | `/api/fields/{id}/weather` | Open-Meteo forecast and registered canal capacity |
| `GET` | `/api/fields/{id}/weather/history` | NASA POWER daily observations for the field |
| `GET / PUT` | `/api/fields/{id}/irrigation-settings` | Read or save soil water and supply inputs |
| `POST` | `/api/fields/{id}/simulate` | Run a field-specific irrigation scenario |
| `POST` | `/api/fields/{id}/optimize` | Compare irrigation strategies, pumping costs, and crop stress |
| `POST` | `/api/fields/{id}/intelligence` | Explain a calculated plan using the configured model |
| `GET` | `/api/fields/{id}/advisories` | Retrieve advisory history for a field |
| `POST` | `/api/advisories` | Approve and queue an advisory email |
| `POST` | `/api/advisories/{id}/send` | Retry a failed delivery |
| `POST` | `/api/messages/inbound` | Record a farmer reply for parsing |
| `POST` | `/api/messages/{id}/approve` | Add a complete parsed reply to field history |

Interactive documentation available at `http://localhost:8000/docs`.

---

## 🧪 Testing & Quality Assurance

### Verify connected workflows

Use test records. Register a farmer and draw a field in the connected dashboard, then reload and check the saved boundary and area. Edit the polygon and confirm that the area updates. Use Crop Monitoring to start a season and check the previous crop on the farmer profile. Approve a test advisory, confirm its delivery in Mailpit, then record a reply and review the conversation.

With the backend dependencies installed, run the irrigation model tests from `backend/` with `python -m unittest discover -s tests -v`.

### Frontend Production Build

Check source formatting and TypeScript, then build the frontend.

```bash
cd frontend
pnpm format:check
pnpm typecheck
pnpm build
```

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

The frontend ships license notices for [MapLibre GL JS](frontend/public/licenses/maplibre-gl.txt) and [Terra Draw, including its MapLibre adapter](frontend/public/licenses/terra-draw.txt). Basemap data attribution appears on the map.

The crop coefficients and stage lengths come from PI-Advisor and the soil water calculation adapts its published method. [Pinned PI-Advisor source](https://github.com/wateraccounting/PI-Advisor/tree/18197955f9ad2f74da0a73de240ff448fa67c8dd) · [MIT license notice](backend/app/science/PI-Advisor-LICENSE.txt)

---

<p align="center">
  <b>AquaProof Pakistan</b> • Every farm. Every drop. Every decision. 🌾
</p>
