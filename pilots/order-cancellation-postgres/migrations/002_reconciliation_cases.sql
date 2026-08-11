CREATE TABLE reconciliation_cases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cancellation_id text NOT NULL UNIQUE REFERENCES order_cancellations(id),
  outbox_event_id bigint NOT NULL UNIQUE REFERENCES outbox_events(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (
    status IN ('OPEN', 'RESOLVED_COMPLETED', 'RESOLVED_FAILED')
  ),
  reason_code text NOT NULL CHECK (reason_code IN ('PROVIDER_STATUS_UNKNOWN')),
  provider_reference text CHECK (
    provider_reference IS NULL OR char_length(provider_reference) <= 160
  ),
  resolution_note text CHECK (
    resolution_note IS NULL OR char_length(resolution_note) <= 500
  ),
  opened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  resolved_by text CHECK (
    resolved_by IS NULL OR char_length(resolved_by) BETWEEN 3 AND 80
  ),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (status = 'OPEN' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR
    (status <> 'OPEN' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

CREATE INDEX reconciliation_cases_opened_idx
  ON reconciliation_cases (opened_at, id)
  WHERE status = 'OPEN';

INSERT INTO reconciliation_cases(
  cancellation_id,
  outbox_event_id,
  status,
  reason_code,
  opened_at,
  updated_at
)
SELECT
  event.aggregate_id,
  event.id,
  'OPEN',
  'PROVIDER_STATUS_UNKNOWN',
  event.reconciliation_required_at,
  event.reconciliation_required_at
FROM outbox_events AS event
JOIN order_cancellations AS cancellation
  ON cancellation.id = event.aggregate_id
WHERE event.reconciliation_required_at IS NOT NULL
  AND event.published_at IS NULL
  AND cancellation.status = 'PENDING'
ON CONFLICT (cancellation_id) DO NOTHING;


CREATE FUNCTION open_reconciliation_case_from_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.reconciliation_required_at IS NOT NULL
     AND OLD.reconciliation_required_at IS NULL THEN
    INSERT INTO reconciliation_cases(
      cancellation_id,
      outbox_event_id,
      status,
      reason_code,
      opened_at,
      updated_at
    )
    VALUES (
      NEW.aggregate_id,
      NEW.id,
      'OPEN',
      'PROVIDER_STATUS_UNKNOWN',
      NEW.reconciliation_required_at,
      NEW.reconciliation_required_at
    )
    ON CONFLICT (cancellation_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_open_reconciliation_case
AFTER UPDATE OF reconciliation_required_at ON outbox_events
FOR EACH ROW
EXECUTE FUNCTION open_reconciliation_case_from_outbox();

CREATE VIEW operational_recovery_health AS
SELECT
  (
    SELECT count(*)::bigint
    FROM order_cancellations
    WHERE status = 'PENDING'
  ) AS pending_cancellations,
  (
    SELECT count(*)::bigint
    FROM outbox_events
    WHERE published_at IS NULL
      AND reconciliation_required_at IS NULL
      AND available_at <= clock_timestamp()
  ) AS ready_outbox_events,
  (
    SELECT count(*)::bigint
    FROM outbox_events
    WHERE published_at IS NULL
      AND reconciliation_required_at IS NULL
      AND locked_at IS NOT NULL
      AND locked_at < clock_timestamp() - interval '30 seconds'
  ) AS expired_worker_leases,
  (
    SELECT count(*)::bigint
    FROM reconciliation_cases
    WHERE status = 'OPEN'
  ) AS open_reconciliation_cases,
  COALESCE(
    (
      SELECT max(extract(epoch FROM (clock_timestamp() - accepted_at)))::bigint
      FROM order_cancellations
      WHERE status = 'PENDING'
    ),
    0
  ) AS oldest_pending_seconds;
