#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP="$ROOT/pilots/order-cancellation-postgres/app"
IMAGE="${POSTGRES_IMAGE:-postgres:18.4}"
EVIDENCE="${OPERATIONAL_EVIDENCE_DIR:-/tmp/stackforge-atlas-postgres-recovery}"
PPORT="${PRIMARY_PORT:-56432}"; RPORT="${RESTORE_PORT:-56433}"
TOKEN="${GITHUB_RUN_ID:-local}-$$"
PC="stackforge-primary-$TOKEN"; RC="stackforge-restore-$TOKEN"
PV="stackforge-primary-data-$TOKEN"; RV="stackforge-restore-data-$TOKEN"
PURL="postgresql://stackforge:stackforge@127.0.0.1:$PPORT/stackforge"
RBURL="postgresql://stackforge:stackforge@127.0.0.1:$RPORT/stackforge_rollback"
RURL="postgresql://stackforge:stackforge@127.0.0.1:$RPORT/stackforge_restore"
RECOVERY_LIMIT_MS="${RECOVERY_LIMIT_MS:-60000}"; RESTORE_LIMIT_MS="${RESTORE_LIMIT_MS:-120000}"
mkdir -p "$EVIDENCE"; rm -f "$EVIDENCE"/*

cleanup() {
  code=$?
  docker logs "$PC" >"$EVIDENCE/primary-postgres.log" 2>&1 || true
  docker logs "$RC" >"$EVIDENCE/restore-postgres.log" 2>&1 || true
  if [[ "${KEEP_RECOVERY_RESOURCES:-0}" != 1 ]]; then
    docker rm -f "$PC" "$RC" >/dev/null 2>&1 || true
    docker volume rm "$PV" "$RV" >/dev/null 2>&1 || true
  fi
  exit "$code"
}
trap cleanup EXIT
now_ms(){ python - <<'PY'
import time
print(int(time.time()*1000))
PY
}
wait_pg(){
  deadline=$((SECONDS+60))
  until docker exec "$1" pg_isready -U stackforge -d postgres >/dev/null 2>&1; do
    (( SECONDS < deadline )) || { docker logs "$1" >&2; return 1; }
    sleep 1
  done
  docker exec "$1" psql -U stackforge -d postgres -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null
}
start_pg(){
  docker volume create "$2" >/dev/null
  docker run -d --name "$1" -e POSTGRES_DB=stackforge -e POSTGRES_USER=stackforge \
    -e POSTGRES_PASSWORD=stackforge -p "127.0.0.1:$3:5432" \
    -v "$2:/var/lib/postgresql" "$IMAGE" >/dev/null
  wait_pg "$1"
}
field(){ python - "$1" "$2" <<'PY'
import json,sys
v=json.load(open(sys.argv[1],encoding='utf-8'))
for p in sys.argv[2].split('.'):
    v=v[int(p)] if isinstance(v,list) else v[p]
print(v)
PY
}
assert_same_counts(){ python - "$1" "$2" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); y=json.load(open(sys.argv[2]))
keys=('orders','cancellations','outbox_events','audit_events','pending','completed','failed')
d={k:(x['counts'][k],y['counts'][k]) for k in keys if x['counts'][k]!=y['counts'][k]}
if d: raise SystemExit(f'committed state changed across crash recovery: {d}')
PY
}

cd "$APP"
[[ -d node_modules ]] || { echo 'run npm ci in the PostgreSQL pilot first' >&2; exit 1; }
start_pg "$PC" "$PV" "$PPORT"
export DATABASE_URL="$PURL"
MIGRATION_TARGET=001_order_cancellation.sql npm run migrate >/dev/null
MIGRATION_TARGET=001_order_cancellation.sql npm run seed >/dev/null
docker exec "$PC" psql -U stackforge -d stackforge -c CHECKPOINT >/dev/null
MIGRATION_TARGET=001_order_cancellation.sql node src/ops-main.ts prepare-pending \
  --order order-1001 --key ops-order-1001-0001 >"$EVIDENCE/accepted-before-crash.json"
node src/ops-main.ts snapshot >"$EVIDENCE/snapshot-before-crash.json"

backup_start=$(now_ms)
docker exec "$PC" pg_dump -U stackforge -d stackforge -Fc --no-owner --no-privileges -f /tmp/pre002.dump
docker cp "$PC:/tmp/pre002.dump" "$EVIDENCE/pre002.dump" >/dev/null
backup_end=$(now_ms)

# Immediate shutdown deliberately requires WAL crash recovery on the same volume.
docker kill --signal=SIGQUIT "$PC" >/dev/null
until [[ "$(docker inspect -f '{{.State.Running}}' "$PC")" == false ]]; do sleep .2; done
restart_start=$(now_ms); docker start "$PC" >/dev/null; wait_pg "$PC"; restart_end=$(now_ms)
recovery_ms=$((restart_end-restart_start))
node src/ops-main.ts snapshot >"$EVIDENCE/snapshot-after-crash-recovery.json"
assert_same_counts "$EVIDENCE/snapshot-before-crash.json" "$EVIDENCE/snapshot-after-crash-recovery.json"
docker logs "$PC" >"$EVIDENCE/primary-after-crash.log" 2>&1
if ! grep -Eqi 'database system was interrupted|redo starts at|database system was not properly shut down' "$EVIDENCE/primary-after-crash.log"; then
  echo 'missing PostgreSQL crash-recovery evidence' >&2; exit 1
fi

npm run migrate >/dev/null
node src/ops-main.ts snapshot >"$EVIDENCE/snapshot-after-forward-migration.json"
[[ "$(field "$EVIDENCE/snapshot-after-forward-migration.json" migrations.1)" == 002_reconciliation_cases.sql ]]
node src/ops-main.ts run-worker --worker ops-after-restart >"$EVIDENCE/worker-after-restart.json"
node src/ops-main.ts create-reconciliation --order order-2001 --key ops-order-2001-0001 \
  >"$EVIDENCE/reconciliation-opened.json"
case_id="$(field "$EVIDENCE/reconciliation-opened.json" reconciliationCase.caseId)"
node src/ops-main.ts health >"$EVIDENCE/health-before-reconciliation.json"
[[ "$(field "$EVIDENCE/health-before-reconciliation.json" health.openReconciliationCases)" == 1 ]]
node src/ops-main.ts resolve-reconciliation --case "$case_id" --resolution completed \
  --actor ops-recovery-drill --provider-reference "provider-reconciled-$case_id" \
  --note 'controlled recovery drill confirmed provider completion' >"$EVIDENCE/reconciliation-resolved.json"
node src/ops-main.ts health >"$EVIDENCE/health-after-reconciliation.json"
[[ "$(field "$EVIDENCE/health-after-reconciliation.json" health.openReconciliationCases)" == 0 ]]
node src/ops-main.ts snapshot >"$EVIDENCE/snapshot-final-primary.json"

final_backup_start=$(now_ms)
docker exec "$PC" pg_dump -U stackforge -d stackforge -Fc --no-owner --no-privileges -f /tmp/final.dump
docker cp "$PC:/tmp/final.dump" "$EVIDENCE/final.dump" >/dev/null
final_backup_end=$(now_ms); backup_sha="$(sha256sum "$EVIDENCE/final.dump" | awk '{print $1}')"

start_pg "$RC" "$RV" "$RPORT"
docker exec "$RC" createdb -U stackforge stackforge_rollback
docker exec "$RC" createdb -U stackforge stackforge_restore
docker cp "$EVIDENCE/pre002.dump" "$RC:/tmp/pre002.dump" >/dev/null
docker cp "$EVIDENCE/final.dump" "$RC:/tmp/final.dump" >/dev/null

docker exec "$RC" pg_restore -U stackforge -d stackforge_rollback --no-owner --no-privileges --exit-on-error /tmp/pre002.dump
DATABASE_URL="$RBURL" npm run migrate >/dev/null
DATABASE_URL="$RBURL" npm run rollback -- 002_reconciliation_cases.sql >/dev/null
[[ -z "$(docker exec "$RC" psql -U stackforge -d stackforge_rollback -tAc "SELECT to_regclass('public.reconciliation_cases')")" ]]
[[ "$(docker exec "$RC" psql -U stackforge -d stackforge_rollback -tAc "SELECT count(*)||':'||(SELECT count(*) FROM order_cancellations)||':'||(SELECT count(*) FROM outbox_events) FROM orders")" == 1:1:1 ]]

restore_start=$(now_ms)
docker exec "$RC" pg_restore -U stackforge -d stackforge_restore --no-owner --no-privileges --exit-on-error /tmp/final.dump
restore_end=$(now_ms); restore_ms=$((restore_end-restore_start))
DATABASE_URL="$RURL" node src/ops-main.ts snapshot >"$EVIDENCE/snapshot-restored.json"
python - "$EVIDENCE/snapshot-final-primary.json" "$EVIDENCE/snapshot-restored.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1])); y=json.load(open(sys.argv[2]))
if x['counts']!=y['counts'] or x['migrations']!=y['migrations'] or x['reconciliationCases']!=y['reconciliationCases']:
    raise SystemExit('independent restore differs from primary snapshot')
PY
(( recovery_ms <= RECOVERY_LIMIT_MS )) || { echo "restart exceeded threshold: ${recovery_ms}ms" >&2; exit 1; }
(( restore_ms <= RESTORE_LIMIT_MS )) || { echo "restore exceeded threshold: ${restore_ms}ms" >&2; exit 1; }

report="$EVIDENCE/operational-recovery-report.json"
python - "$report" <<PY
import json
from datetime import datetime,timezone
from pathlib import Path
E=Path("$EVIDENCE")
def load(n): return json.loads((E/n).read_text())
before=load('snapshot-before-crash.json'); after=load('snapshot-after-crash-recovery.json')
primary=load('snapshot-final-primary.json'); restored=load('snapshot-restored.json')
keys=('orders','cancellations','outbox_events','audit_events','pending','completed','failed')
loss=sum(abs(int(before['counts'][k])-int(after['counts'][k])) for k in keys)
report={
 'version':1,'observedAt':datetime.now(timezone.utc).isoformat(),'postgresImage':'$IMAGE',
 'evidenceLevel':'operational-recovery-subset',
 'crashRecovery':{'shutdownSignal':'SIGQUIT','restartReadyMs':$recovery_ms,'thresholdMs':$RECOVERY_LIMIT_MS,
   'observedCommittedRowLoss':loss,'before':before['counts'],'after':after['counts']},
 'migration':{'forwardFrom':'001_order_cancellation.sql','forwardTo':'002_reconciliation_cases.sql',
   'retainedDataVerified':True,'guardedRollbackVerified':True,
   'rollbackBoundary':'allowed only before reconciliation_cases contains rows'},
 'logicalBackupRestore':{'format':'custom','backupSha256':'$backup_sha',
   'backupMs':$((final_backup_end-final_backup_start)),'restoreMs':$restore_ms,
   'restoreThresholdMs':$RESTORE_LIMIT_MS,'primaryCounts':primary['counts'],'restoredCounts':restored['counts'],
   'observedPreBackupRowLoss':0},
 'reconciliation':{'caseId':int('$case_id'),'openCasesBefore':1,'openCasesAfter':0,'resolution':'COMPLETED'},
 'scopeLimitations':['CI timings are observations, not production SLOs','logical backup is verified; WAL archiving and PITR are not','single-node container restart is verified; replication and failover are not','provider status is simulated']}
}
Path("$report").write_text(json.dumps(report,indent=2)+'\n')
PY
python "$ROOT/scripts/validate_operational_report.py" "$report"
echo "Operational PostgreSQL recovery drill passed: $report"
