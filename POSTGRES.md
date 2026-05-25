# PostgreSQL local setup

This project uses a local PostgreSQL 18.4 binary install under `tools/postgresql-18.4`.
It does not require a Windows service.

## Connection

```txt
DATABASE_URL=postgresql://jutopia_app:jutopia_dev_password@127.0.0.1:55432/jutopia_dev
```

## Start

```powershell
.\scripts\start-postgres.ps1
```

## Start the app server

The custom server serves both static files and `/api/*` authentication endpoints.

```powershell
.\scripts\start-server.ps1
```

Open:

```txt
http://127.0.0.1:4173/index.html
```

## Stop

```powershell
.\scripts\stop-postgres.ps1
```

## Connect with psql

```powershell
.\tools\postgresql-18.4\pgsql\bin\psql.exe -h 127.0.0.1 -p 55432 -U jutopia_app -d jutopia_dev
```

## Re-apply schema and seed

```powershell
.\tools\postgresql-18.4\pgsql\bin\psql.exe -h 127.0.0.1 -p 55432 -U jutopia_app -d jutopia_dev -f .\db\schema.sql
.\tools\postgresql-18.4\pgsql\bin\psql.exe -h 127.0.0.1 -p 55432 -U jutopia_app -d jutopia_dev -f .\db\seed.sql
```
