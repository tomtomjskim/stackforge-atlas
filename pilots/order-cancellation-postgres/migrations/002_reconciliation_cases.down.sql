DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM reconciliation_cases) THEN
    RAISE EXCEPTION
      '002_reconciliation_cases cannot be rolled back after reconciliation data exists; roll forward instead';
  END IF;
END;
$$;

DROP VIEW operational_recovery_health;
DROP TRIGGER outbox_open_reconciliation_case ON outbox_events;
DROP FUNCTION open_reconciliation_case_from_outbox();
DROP TABLE reconciliation_cases;
