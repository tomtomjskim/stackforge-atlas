DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
DROP FUNCTION IF EXISTS reject_audit_event_mutation();
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS provider_cancellation_effects;
DROP TABLE IF EXISTS outbox_events;
ALTER TABLE IF EXISTS orders DROP CONSTRAINT IF EXISTS orders_cancellation_fk;
DROP TABLE IF EXISTS order_cancellations;
DROP TABLE IF EXISTS orders;
