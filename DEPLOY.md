# Jutopia 실제 서버 배포

추천 구성은 `Cloud Run + Supabase PostgreSQL`입니다. GCP 크레딧은 서버 실행 비용에 쓰고, DB는 Supabase PostgreSQL을 연결합니다.

## 1. Supabase DB 준비

Supabase 프로젝트를 만들고 SQL Editor에서 다음 파일을 실행합니다.

```sql
-- db/schema.sql 전체 실행
-- 필요하면 db/seed.sql 실행
```

Supabase Dashboard의 `Connect`에서 Session pooler 연결 문자열을 복사합니다. 로컬 PC나 Cloud Run처럼 IPv4 환경이면 pooler 연결 문자열이 편합니다.

## 2. Cloud Run 환경 변수 파일 만들기

```powershell
Copy-Item .\cloud-run.env.yaml.example .\cloud-run.env.yaml
```

`cloud-run.env.yaml`에 실제 값을 넣습니다. 이 파일은 비밀번호가 들어가므로 Git에 올리지 마세요.

```yaml
DATABASE_URL: "postgresql://postgres.[PROJECT-REF]:[PASSWORD]@[REGION].pooler.supabase.com:5432/postgres?sslmode=require"
SESSION_SECRET: "충분히-긴-랜덤-문자열"
EMAIL_MODE: "smtp"
APP_ORIGIN: "*"
SMTP_HOST: "smtp.gmail.com"
SMTP_PORT: "587"
SMTP_USER: "your-email@gmail.com"
SMTP_PASSWORD: "your-app-password"
SMTP_FROM: "your-email@gmail.com"
SMTP_USE_TLS: "true"
```

## 3. Cloud Run 배포

Google Cloud SDK가 설치된 PC나 Cloud Shell에서 실행합니다.

```powershell
.\scripts\deploy-cloud-run.ps1 -ProjectId "YOUR_GCP_PROJECT_ID" -Region "asia-northeast3"
```

배포가 끝나면 Cloud Run URL이 출력됩니다. 그 URL이 실제 서비스 주소입니다.

## 4. 운영 전에 바꿀 부분

- `EMAIL_MODE=dev`는 인증 코드가 응답으로 보이는 개발 모드입니다.
- 실제 이메일 발송은 `EMAIL_MODE=smtp`로 바꾸고 SMTP 값을 채우면 됩니다.
- `SESSION_SECRET`은 긴 랜덤 문자열로 바꿔야 합니다.
- 공개 서비스라면 `APP_ORIGIN`을 Cloud Run 도메인이나 커스텀 도메인으로 제한하세요.

## 5. 로컬 실행

```powershell
.\scripts\start-postgres.ps1
.\scripts\start-server.ps1
```

로컬 주소:

```txt
http://127.0.0.1:4173/index.html
```
