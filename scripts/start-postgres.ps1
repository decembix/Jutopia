$Root = Split-Path -Parent $PSScriptRoot
$PgBin = Join-Path $Root "tools/postgresql-18.4/pgsql/bin"
$DataDir = Join-Path $Root "data/pgdata"
$LogDir = Join-Path $Root "logs"
$LogFile = Join-Path $LogDir "postgres.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
& (Join-Path $PgBin "pg_ctl.exe") -D $DataDir -l $LogFile -o "-p 55432" start
& (Join-Path $PgBin "pg_isready.exe") -h 127.0.0.1 -p 55432 -U postgres
