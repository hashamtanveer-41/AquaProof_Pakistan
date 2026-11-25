ALTER TABLE farmers
    ADD COLUMN IF NOT EXISTS district text,
    ADD COLUMN IF NOT EXISTS tehsil text;
