$Root = Split-Path -Parent $PSScriptRoot
$PgBin = Join-Path $Root "tools/postgresql-18.4/pgsql/bin"
$DataDir = Join-Path $Root "data/pgdata"

& (Join-Path $PgBin "pg_ctl.exe") -D $DataDir stop
