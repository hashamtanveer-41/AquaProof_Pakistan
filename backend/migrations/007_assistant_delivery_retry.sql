ALTER TABLE assistant_messages
    ADD COLUMN delivery_attempt integer NOT NULL DEFAULT 0,
    ADD COLUMN delivery_after timestamptz NOT NULL DEFAULT now();
