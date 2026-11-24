CREATE TABLE irrigation_settings (
    field_id text PRIMARY KEY REFERENCES fields(id),
    settings jsonb NOT NULL
);
