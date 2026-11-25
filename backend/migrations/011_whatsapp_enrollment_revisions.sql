ALTER TABLE assistant_jobs
    ADD COLUMN channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'whatsapp'));

-- The existing WhatsApp message and scheduling identifiers distinguish the jobs
-- already created by the WhatsApp workflow during a staged rollout.
UPDATE assistant_jobs j SET channel='whatsapp'
WHERE j.dedupe LIKE 'daily:wa:%' OR EXISTS (
    SELECT 1 FROM assistant_messages m WHERE m.id=j.inbound_id AND m.channel='whatsapp'
);
ALTER TABLE assistant_jobs ALTER COLUMN channel SET DEFAULT 'whatsapp';

CREATE FUNCTION aquaproof_revoke_whatsapp_on_phone_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF aquaproof_whatsapp_phone(OLD.phone) IS DISTINCT FROM aquaproof_whatsapp_phone(NEW.phone) THEN
        UPDATE assistant_identities SET whatsapp_phone=NULL, whatsapp_verified_at=NULL WHERE farmer_id=NEW.id;
        UPDATE assistant_messages SET reply_used_at=COALESCE(reply_used_at, now()),
            status=CASE WHEN status IN ('queued','review') THEN 'cancelled' ELSE status END,
            updated_at=now()
        WHERE farmer_id=NEW.id AND channel='whatsapp' AND direction='outbound'
          AND (reply_used_at IS NULL OR status IN ('queued','review'));
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER revoke_whatsapp_on_phone_change AFTER UPDATE OF phone ON farmers
FOR EACH ROW EXECUTE FUNCTION aquaproof_revoke_whatsapp_on_phone_change();
