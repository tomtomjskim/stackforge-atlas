CREATE TABLE orders (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  payment_status text NOT NULL CHECK (
    payment_status IN ('PAID', 'REFUND_PENDING', 'REFUNDED')
  ),
  shipment_status text NOT NULL CHECK (
    shipment_status IN ('NOT_STARTED', 'PROCESSING', 'SHIPPED')
  ),
  currency character(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  cancellation_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE order_cancellations (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders(id),
  customer_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 128
  ),
  request_fingerprint character(64) NOT NULL,
  reason_code text NOT NULL CHECK (
    reason_code IN (
      'ORDERED_BY_MISTAKE',
      'DUPLICATE_ORDER',
      'DELIVERY_TOO_LATE',
      'OTHER'
    )
  ),
  reason_detail text CHECK (
    reason_detail IS NULL OR char_length(reason_detail) <= 500
  ),
  status text NOT NULL CHECK (
    status IN ('PENDING', 'COMPLETED', 'FAILED')
  ),
  accepted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  outcome_code text,
  refund_currency character(3),
  refund_amount_minor bigint CHECK (
    refund_amount_minor IS NULL OR refund_amount_minor >= 0
  ),
  trace_id text NOT NULL,
  UNIQUE (customer_id, idempotency_key),
  CHECK (
    (refund_currency IS NULL AND refund_amount_minor IS NULL)
    OR (refund_currency IS NOT NULL AND refund_amount_minor IS NOT NULL)
  )
);

CREATE UNIQUE INDEX order_cancellations_one_effective_per_order_idx
  ON order_cancellations (order_id)
  WHERE status IN ('PENDING', 'COMPLETED');

ALTER TABLE orders
  ADD CONSTRAINT orders_cancellation_fk
  FOREIGN KEY (cancellation_id)
  REFERENCES order_cancellations(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE outbox_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL UNIQUE,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN ('order.cancellation.requested')
  ),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_by text,
  locked_at timestamptz,
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((locked_by IS NULL) = (locked_at IS NULL))
);

CREATE INDEX outbox_events_ready_idx
  ON outbox_events (available_at, id)
  WHERE published_at IS NULL;

CREATE TABLE provider_cancellation_effects (
  cancellation_id text PRIMARY KEY REFERENCES order_cancellations(id),
  provider_reference text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('COMPLETED', 'FAILED')),
  outcome_code text,
  call_count integer NOT NULL DEFAULT 1 CHECK (call_count >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE audit_events (
  event_id text PRIMARY KEY,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  result text NOT NULL,
  reason_code text,
  trace_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (
    jsonb_typeof(metadata) = 'object'
  ),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX audit_events_object_timeline_idx
  ON audit_events (object_type, object_id, occurred_at, event_id);

CREATE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION reject_audit_event_mutation();
