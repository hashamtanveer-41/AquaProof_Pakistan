CREATE TABLE irrigation_decisions (
    season_id bigint NOT NULL REFERENCES crop_seasons(id),
    irrigation_date date NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    action text NOT NULL CHECK (action IN ('accept', 'skip', 'edit', 'reopen')),
    canal_m3 double precision NOT NULL CHECK (canal_m3 BETWEEN 0 AND 1000000000),
    pump_m3 double precision NOT NULL CHECK (pump_m3 BETWEEN 0 AND 1000000000),
    weather_source text NOT NULL,
    weather_retrieved_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (season_id, irrigation_date, revision),
    CHECK (action IN ('accept', 'edit') OR (canal_m3 = 0 AND pump_m3 = 0))
);
