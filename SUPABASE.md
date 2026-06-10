# Jutopia Supabase 연결 가이드

PDF 기준으로 Jutopia는 PostgreSQL 기반 DB와 Supabase 클라우드 DB 환경을 사용합니다. 이 프로젝트는 `DATABASE_URL`만 바꾸면 로컬 PostgreSQL과 Supabase PostgreSQL을 같은 서버 코드로 사용할 수 있게 구성했습니다.

## 1. Supabase 프로젝트 준비

1. Supabase에서 새 프로젝트를 생성합니다.
2. SQL Editor에서 `db/schema.sql` 전체를 실행합니다.
3. 개발용 데모 데이터가 필요하면 `db/seed.sql`도 실행합니다.

## 2. 연결 문자열 설정

Supabase Dashboard의 `Connect` 버튼에서 PostgreSQL connection string을 복사한 뒤 `.env`에 넣습니다.

```env
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[PASSWORD]@[REGION].pooler.supabase.com:5432/postgres?sslmode=require
SESSION_SECRET=replace-with-a-long-random-production-secret
EMAIL_MODE=dev
PORT=4173
```

로컬 PC나 Cloud Run처럼 IPv4 환경이면 Supabase의 Session pooler 연결 문자열을 우선 추천합니다. Supabase 공식 문서도 프론트엔드는 Data API, 서버나 PostgreSQL 클라이언트는 connection string을 사용하고, IPv4가 필요한 지속 서버는 pooler session mode를 쓰라고 안내합니다.

## 3. 서버 실행

```powershell
.\scripts\start-server.ps1
```

서버는 같은 포트에서 정적 파일과 API를 함께 제공합니다.

- 화면: `http://127.0.0.1:4173/index.html`
- 상태 체크: `http://127.0.0.1:4173/api/health`

## 4. 구현된 인증 API

- `POST /api/auth/send-code`
- `POST /api/auth/verify-code`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/me`
- `GET /api/my-clubs`

현재 `EMAIL_MODE=dev`에서는 실제 메일 발송 대신 인증 코드가 응답에 포함됩니다. 실제 메일 발송은 `EMAIL_MODE=smtp`로 바꾸고 아래 SMTP 값을 추가하면 됩니다.

```env
EMAIL_MODE=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=your-email@gmail.com
SMTP_USE_TLS=true
```

## 5. GCP 크레딧 사용 방향

Supabase 관리형 DB 비용은 일반적으로 Supabase 쪽 과금입니다. GCP 크레딧을 쓰려면 백엔드 서버를 Cloud Run에 올리고, DB는 Supabase를 연결하거나, DB까지 GCP 크레딧으로 처리하려면 Cloud SQL for PostgreSQL을 쓰는 구성이 더 자연스럽습니다.
