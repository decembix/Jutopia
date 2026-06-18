# Jutopia DB-less dev test guide

This guide lets evaluators run Jutopia without preparing PostgreSQL or Supabase.
The server uses an in-memory dev store when `JUTOPIA_DEV_NO_DB=true` or when
`DATABASE_URL` is not configured.

## 1. Clone

```powershell
git clone https://github.com/decembix/Jutopia.git
cd Jutopia
git log --oneline -3
```

## 2. Check Python

```powershell
python --version
```

macOS/Linux:

```bash
python3 --version
```

DB-less mode uses only the Python standard library. Installing
`requirements.txt` is only required for PostgreSQL mode.

## 3. Create env file

```powershell
Copy-Item .env.example .env
```

The example env already contains:

```env
JUTOPIA_DEV_NO_DB=true
EMAIL_MODE=dev
HOST=127.0.0.1
PORT=4173
```

## 4. Run

```powershell
python .\server.py
```

Or:

```powershell
.\scripts\start-server.ps1
```

Open:

```txt
http://127.0.0.1:4173/index.html
```

Health check:

```txt
http://127.0.0.1:4173/api/health
```

Expected response:

```json
{"ok": true, "mode": "memory"}
```

## 5. Demo login

```txt
email: demo@jutopia.ac.kr
password: demo1234
```

## 6. Signup flow

In DB-less dev mode, signup verification codes are returned by the API response
because `EMAIL_MODE=dev` is enabled. The in-memory data resets whenever the
server process restarts.

## 7. PostgreSQL mode

To test with a real database:

1. Set `JUTOPIA_DEV_NO_DB=false`.
2. Set `DATABASE_URL`.
3. Apply `db/schema.sql`.
4. Optionally apply `db/seed.sql`.
5. Restart `server.py`.
