ALTER TABLE irrigation_settings ADD COLUMN measured_at timestamptz;
ALTER TABLE fields ADD CONSTRAINT fields_id_farmer_unique UNIQUE (id, farmer_id);

CREATE TABLE assistant_identities (
    farmer_id text PRIMARY KEY REFERENCES farmers(id),
    email text NOT NULL UNIQUE,
    language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ur', 'roman_ur')),
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE assistant_messages (
    id uuid PRIMARY KEY,
    farmer_id text NOT NULL REFERENCES assistant_identities(farmer_id),
    field_id text,
    direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
    kind text NOT NULL CHECK (kind IN ('verify','daily','correction','reply','manual')),
    status text NOT NULL CHECK (status IN ('received','queued','sending','sent','review','rejected','failed','cancelled')),
    body text NOT NULL,
    evidence jsonb NOT NULL DEFAULT '{}',
    usage jsonb NOT NULL DEFAULT '{}',
    review_reason text,
    recipient_email text,
    dedupe text NOT NULL UNIQUE,
    reply_used_at timestamptz,
    delivered_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (field_id, farmer_id) REFERENCES fields(id, farmer_id)
);
CREATE INDEX assistant_messages_farmer ON assistant_messages(farmer_id, created_at DESC);
CREATE INDEX assistant_delivery_queue ON assistant_messages(created_at) WHERE status = 'queued';

CREATE TABLE assistant_jobs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farmer_id text NOT NULL REFERENCES assistant_identities(farmer_id),
    field_id text,
    kind text NOT NULL CHECK (kind IN ('inbound','daily','correction')),
    inbound_id uuid REFERENCES assistant_messages(id),
    local_day date NOT NULL,
    dedupe text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
    attempt int NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    claimed_at timestamptz,
    error text,
    FOREIGN KEY (field_id, farmer_id) REFERENCES fields(id, farmer_id)
);
CREATE INDEX assistant_job_queue ON assistant_jobs(available_at,id) WHERE status IN ('queued','running');

CREATE TABLE assistant_observations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farmer_id text NOT NULL REFERENCES assistant_identities(farmer_id),
    field_id text NOT NULL,
    inbound_id uuid NOT NULL UNIQUE REFERENCES assistant_messages(id),
    measurements jsonb NOT NULL,
    status text NOT NULL DEFAULT 'review' CHECK (status IN ('review','approved','rejected')),
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    FOREIGN KEY (field_id, farmer_id) REFERENCES fields(id, farmer_id)
);
CREATE INDEX assistant_observations_field ON assistant_observations(field_id, status);
CREATE INDEX assistant_messages_field ON assistant_messages(field_id, created_at DESC);

CREATE TABLE assistant_model_limits (
    bucket timestamptz NOT NULL,
    scope text NOT NULL,
    calls int NOT NULL,
    PRIMARY KEY(bucket,scope)
);

CREATE TABLE assistant_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farmer_id text REFERENCES assistant_identities(farmer_id),
    message_id uuid REFERENCES assistant_messages(id),
    action text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aquaproof_assistant_reader') THEN
        CREATE ROLE aquaproof_assistant_reader NOLOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
    END IF;
    EXECUTE format('GRANT aquaproof_assistant_reader TO %I', current_user);
END $$;
GRANT USAGE ON SCHEMA public TO aquaproof_assistant_reader;
GRANT SELECT ON fields, crop_seasons, irrigation_settings, assistant_messages, assistant_observations TO aquaproof_assistant_reader;
GRANT SELECT ON advisories, farmer_messages TO aquaproof_assistant_reader;

ALTER TABLE fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_owned_field ON fields FOR SELECT TO aquaproof_assistant_reader
    USING (farmer_id = current_setting('aquaproof.farmer', true) AND archived_at IS NULL);
ALTER TABLE crop_seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_owned_season ON crop_seasons FOR SELECT TO aquaproof_assistant_reader
    USING (EXISTS (SELECT 1 FROM fields f WHERE f.id = field_id));
ALTER TABLE irrigation_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_owned_settings ON irrigation_settings FOR SELECT TO aquaproof_assistant_reader
    USING (EXISTS (SELECT 1 FROM fields f WHERE f.id = field_id));
ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_owned_message ON assistant_messages FOR SELECT TO aquaproof_assistant_reader
    USING (farmer_id = current_setting('aquaproof.farmer', true));
ALTER TABLE assistant_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_owned_observation ON assistant_observations FOR SELECT TO aquaproof_assistant_reader
    USING (farmer_id = current_setting('aquaproof.farmer', true));
ALTER TABLE advisories ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_owned_advisory ON advisories FOR SELECT TO aquaproof_assistant_reader
    USING (EXISTS (SELECT 1 FROM fields f WHERE f.id = field_id));
ALTER TABLE farmer_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY assistant_owned_legacy_message ON farmer_messages FOR SELECT TO aquaproof_assistant_reader
    USING (EXISTS (SELECT 1 FROM advisories a WHERE a.id = advisory_id));
