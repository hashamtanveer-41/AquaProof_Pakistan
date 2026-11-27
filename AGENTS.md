# AquaProof engineering guide

Use the existing FastAPI, PostgreSQL/PostGIS, React and MapLibre entry points. Keep migrations additive and preserve existing field IDs, WGS84 geometry, records and approved decisions. Use psycopg parameters for values and transaction locks or revision checks for shared writes.

Officer records and actions under `/api` require the server-verified officer browser session. The sign-in endpoint accepts an officer password. The farmer channel uses verified WhatsApp enrollment and authenticated WAHA sender identity. Keep farmer data access in `farmer_scope`, filter by verified owner, use the reader role and test RLS directly. Keep runtime credentials in environment variables, never in frontend builds, provider reports, logs or fixtures. A browser-visible ArcGIS token must have basemap-only permissions and approved referrers.

Keep numerical agricultural calculations in `backend/app/science`. The model proposes allowlisted actions and structured values for review. Weather failures must retain source and error context. Preserve fresh-data checks, provider units, observation provenance, and the distinction between a saved irrigation decision and a completed irrigation event.

Run backend tests from `backend` with `python -m unittest discover -s tests -v`. Point `AQUAPROOF_TEST_DATABASE_URL` only at an isolated PostGIS database. Keep background WhatsApp disabled during routine QA. A dedicated WAHA session and controlled test numbers are required for live round-trip testing. Run frontend format checks, TypeScript checking and the production build from `frontend`. Start local QA services for `pnpm test:browser`.

Update [CLAUDE.md](CLAUDE.md), [README.md](README.md), [TEST_REPORT.md](TEST_REPORT.md), and [API_STATUS.md](API_STATUS.md) when changing contracts, operational behavior, validated results or limitations.
