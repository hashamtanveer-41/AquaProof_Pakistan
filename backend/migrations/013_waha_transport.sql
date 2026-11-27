ALTER TABLE assistant_messages
    ADD COLUMN whatsapp_transport text CHECK (whatsapp_transport IN ('green_api', 'waha'));

UPDATE assistant_messages SET whatsapp_transport = 'green_api'
    WHERE channel = 'whatsapp' AND provider_message_id IS NOT NULL;

CREATE INDEX assistant_whatsapp_conversation_history
    ON assistant_messages (farmer_id, created_at DESC, id DESC) WHERE channel = 'whatsapp';

CREATE INDEX assistant_whatsapp_quoted_message
    ON assistant_messages (provider_message_id, recipient_phone, whatsapp_transport)
    WHERE channel = 'whatsapp' AND direction = 'outbound';
