CREATE TABLE advisories (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    field_id text NOT NULL REFERENCES fields(id),
    subject text NOT NULL,
    body text NOT NULL,
    scheduled_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    failed_at timestamptz
);
CREATE INDEX advisories_due_idx ON advisories (scheduled_at)
    WHERE sent_at IS NULL AND failed_at IS NULL;

CREATE TABLE farmer_messages (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    advisory_id bigint NOT NULL REFERENCES advisories(id),
    message_id text NOT NULL UNIQUE,
    body text NOT NULL,
    parsed jsonb,
    approved_at timestamptz,
    status text NOT NULL CHECK (status IN ('pending', 'review', 'unavailable')),
    received_at timestamptz NOT NULL DEFAULT now()
);
