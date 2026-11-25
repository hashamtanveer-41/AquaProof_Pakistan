CREATE FUNCTION aquaproof_whatsapp_phone(raw text) RETURNS text
LANGUAGE SQL IMMUTABLE STRICT AS $$
    SELECT CASE
        WHEN phone ~ '^03[0-9]{9}$' THEN '92' || substr(phone, 2)
        WHEN phone ~ '^923[0-9]{9}$' THEN phone
        WHEN phone ~ '^\+[1-9][0-9]{7,14}$' THEN substr(phone, 2)
        WHEN phone ~ '^00[1-9][0-9]{7,14}$' THEN substr(phone, 3)
    END
    FROM (SELECT regexp_replace(trim(raw), '[[:space:]()-]', '', 'g') AS phone) AS normalized
$$;

ALTER TABLE assistant_identities
    ALTER COLUMN email DROP NOT NULL,
    ADD COLUMN whatsapp_phone text,
    ADD COLUMN whatsapp_verified_at timestamptz;
CREATE UNIQUE INDEX assistant_whatsapp_phone ON assistant_identities(whatsapp_phone)
    WHERE whatsapp_phone IS NOT NULL;

ALTER TABLE assistant_messages
    ADD COLUMN channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp')),
    ADD COLUMN recipient_phone text,
    ADD COLUMN provider_message_id text;
ALTER TABLE assistant_messages ALTER COLUMN channel SET DEFAULT 'whatsapp';
