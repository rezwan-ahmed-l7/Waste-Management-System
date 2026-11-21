#!/usr/bin/env bash
set -euo pipefail
umask 077

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${1:-./backups/$timestamp}"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

# PostgreSQL logical backup (superuser inside the private database container).
docker compose exec -T db pg_dump -U postgres -d waste_management -Fc --no-owner --no-acl > "$backup_dir/waste_management.dump"

# Evidence files are not in PostgreSQL; archive the persistent private volume separately.
docker compose exec -T api tar -czf - -C /data private > "$backup_dir/private-evidence.tar.gz"

(
  cd "$backup_dir"
  sha256sum waste_management.dump private-evidence.tar.gz > SHA256SUMS
)

echo "Backup created in $backup_dir"
echo "Copy this directory to encrypted off-host storage and periodically test restoration."
