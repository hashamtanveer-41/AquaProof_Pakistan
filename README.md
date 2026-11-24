# AquaProof Pakistan 🌾💧

> **AI-Powered Agricultural Advisory & Irrigation Management Platform**  
> *Government-operated farm intelligence — built for the Hackathon by a 5-member engineering & research team.*

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB.svg?logo=python&logoColor=white)](https://www.python.org)
[![React](https://img.shields.io/badge/React-19.0-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38B2AC.svg?logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev)
[![MySQL](https://img.shields.io/badge/MySQL-8.0+-4479A1.svg?logo=mysql&logoColor=white)](https://www.mysql.com)
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

**Current status:** The repository contains a standalone frontend demonstration using local sample data. The backend, integrations, architecture, and capabilities described below are planned unless explicitly identified as available.

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
- Field area is calculated server-side from the saved geographic polygon via MySQL spatial functions.
- Each farmer can have multiple fields; each field maintains an independent crop history.
- Boundaries are saved as valid GeoJSON polygons in MySQL 8+ with spatial indexing.

### 2. 🌱 Farmer-Specific Crop Monitoring
- System records crop type, variety, planting date, soil profile, and irrigation source per field.
- Crop growth stage is estimated daily from planting date + weather data — no manual field surveys required.
- Full seasonal history is preserved after harvest. Officers can review past crop rotations and irrigation events without overwriting older records.

### 3. 💧 Scientific Irrigation & Smart Decision Engine
- Implements **FAO-56 crop-water balance** methodology (adapted from PI-Advisor) — the same standard used by international agricultural organizations.
- Answers four questions for every farm: how much water is needed, when to irrigate, whether to use canal or tubewell, and what happens if the forecast changes.
- Scenario optimizer (SciPy) evaluates three strategies — wait for canal, pump now, or partial hybrid — and selects the optimal decision based on the farm's registered constraints.
- Water volume formula: `Volume (m³) = Depth (mm) × Area (m²) ÷ 1000`

### 4. 📧 Proactive AI-Powered Email Advisories
- APScheduler triggers daily advisory checks across all active farms.
- Outgoing email is generated by OpenAI from the farm's real data and sent via SMTP.
- Farmer replies in natural language (Urdu, Roman Urdu, English) are parsed by OpenAI into structured JSON — extracting irrigation source, duration, date, and any missing information.
- Extracted events update the farm record and trigger a recalculated recommendation automatically.
- Locally tested using **Mailpit** (no real email server needed during development).

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
        DB[(MySQL 8+ — Spatial + Relational)]
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
| **Asfand** | **Backend Lead & AI Integration** | FastAPI setup, MySQL schema & migrations, farm/field/crop APIs, OpenAI message parsing, SMTP email service, APScheduler advisory jobs, Docker Compose, branch integration. |
| **Hasham** | **Scientific Engine & Weather** | FAO-56 crop-water balance module (adapted from PI-Advisor), Open-Meteo & NASA POWER integration, crop stage estimation, canal vs. tubewell cost optimizer, synthetic demo dataset. |
| **Hamza** | **Frontend & UI/UX** | React dashboard, MapLibre map, Terra Draw polygon editor, weather panel, irrigation chart (Recharts), advisory center UI, conversation panel, full backend API integration. |
| **Talal** | **Research, Docs & Presentation** | Problem research (Pakistani canal water practices, FAO-56 methodology), README, architecture diagrams, API guide, competition slides, live demo script. |
| **Sarim** | **QA, Testing & Validation** | Pytest unit & integration tests, farm boundary & area validation, simulation regression tests against PI-Advisor reference fixtures, email delivery & AI parsing tests, bug tracker. |

---

## 📁 Repository Structure

The repository currently contains the standalone frontend below. The backend, data, and deployment paths that follow describe the planned project layout.

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
- **MySQL**: 8.0+ (or use the Docker Compose service)

---

### Backend Setup (FastAPI)

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```

2. **Create and activate a virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` with your settings:*
   ```env
   # Database
   DATABASE_URL=mysql+pymysql://aquaproof:password@localhost:3306/aquaproof_db

   # OpenAI
   OPENAI_API_KEY=sk-YOUR_API_KEY

   # Email (SMTP)
   SMTP_HOST=localhost
   SMTP_PORT=1025
   SMTP_FROM=advisory@aquaproof.pk

   # App
   SECRET_KEY=your-secret-key
   CORS_ORIGINS=http://localhost:5173
   ```

5. **Start the full stack with Docker Compose (recommended):**
   ```bash
   docker compose up --build
   ```
   Or start only the database and Mailpit, then run FastAPI manually:
   ```bash
   docker compose up db mailpit -d
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

6. **Run database migrations:**
   ```bash
   alembic upgrade head
   ```

   - API Gateway: `http://localhost:8000`
   - Interactive Swagger Docs: `http://localhost:8000/docs`
   - Health Check: `http://localhost:8000/health`

---

### Frontend Setup (React + Vite)

The frontend runs with bundled demo data and satellite imagery. Field edits and advisory activity are held in browser memory for the current session. The demo requires no API credentials, backend service, or email delivery setup.

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite, usually http://localhost:5173.

---

### Email Testing with Mailpit

Mailpit captures all outgoing advisory emails locally — no real email server needed.

```bash
# Started automatically via Docker Compose, or run standalone:
docker run -d -p 8025:8025 -p 1025:1025 axllent/mailpit
```

- **Email Inbox UI:** `http://localhost:8025`
- **SMTP Port:** `1025` (configured in `.env`)

To simulate a farmer email reply, use the `/api/messages/inbound` endpoint or the dashboard's conversation panel.

---

## 🔌 API Reference

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service status check |
| `POST` | `/api/farmers` | Register a new farmer |
| `GET` | `/api/farmers` | List all registered farmers |
| `GET` | `/api/farmers/{id}` | Retrieve farmer profile |
| `POST` | `/api/fields` | Save farm boundary (GeoJSON) + attributes |
| `GET` | `/api/fields/{id}` | Retrieve field with GeoJSON boundary |
| `PATCH` | `/api/fields/{id}` | Update registered field |
| `POST` | `/api/crop-seasons` | Start a new crop cycle for a field |
| `GET` | `/api/fields/{id}/weather` | Location-specific weather from Open-Meteo |
| `POST` | `/api/fields/{id}/simulate` | Run FAO-56 irrigation simulation |
| `POST` | `/api/fields/{id}/optimize` | Canal vs. tubewell decision with cost comparison |
| `GET` | `/api/fields/{id}/advisories` | Retrieve advisory history for a field |
| `POST` | `/api/advisories/{id}/send` | Send approved advisory email to farmer |
| `POST` | `/api/messages/inbound` | Log farmer reply and parse with OpenAI |

Interactive documentation available at `http://localhost:8000/docs`.

---

## 🧪 Testing & Quality Assurance

### Run Backend Tests

From the repository root with virtual environment activated:

```bash
PYTHONPATH=backend python3 -m pytest backend/tests/ -v
```

*Test suite covers:*
- Farm boundary storage and PostGIS area calculation
- FAO-56 simulation outputs vs. PI-Advisor reference fixtures
- Weather lookup returning correct coordinates and timestamps
- Canal scheduling — no water assigned outside permitted windows
- OpenAI message parsing for English, Urdu, and Roman Urdu inputs
- Email delivery to Mailpit and duplicate message idempotency
- Advisory scheduling — no duplicates; harvested crops excluded from active alerts

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

---

<p align="center">
  <b>AquaProof Pakistan</b> • Every farm. Every drop. Every decision. 🌾
</p>
