from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import sys
import time
from datetime import datetime, timezone
from email.message import EmailMessage
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
LOCAL_PACKAGES = BASE_DIR / "tools" / "python-packages"
if LOCAL_PACKAGES.exists():
  sys.path.insert(0, str(LOCAL_PACKAGES))

import psycopg
from psycopg.rows import dict_row

SCHOOL_EMAIL_PATTERN = re.compile(r"^[^\s@]+@(?:[a-z0-9-]+\.)?(?:ac\.kr|edu)$", re.I)
STUDENT_ID_PATTERN = re.compile(r"^\d{8}$")
SUNGSHIN_EMAIL_DOMAIN = "sungshin.ac.kr"
TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7
PBKDF2_ITERATIONS = 260_000


def load_env() -> None:
  env_path = BASE_DIR / ".env"
  if not env_path.exists():
    return

  for raw_line in env_path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()

DATABASE_URL = os.environ.get("DATABASE_URL")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "jutopia-dev-session-secret")
EMAIL_MODE = os.environ.get("EMAIL_MODE", "dev")
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER)
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() != "false"
PORT = int(os.environ.get("PORT", "4173"))
HOST = os.environ.get("HOST", "0.0.0.0")


def db():
  if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not configured")
  return psycopg.connect(DATABASE_URL, row_factory=dict_row)


def b64url_encode(data: bytes) -> str:
  return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(value: str) -> bytes:
  padding = "=" * (-len(value) % 4)
  return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str) -> str:
  salt = secrets.token_bytes(16)
  digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
  return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${b64url_encode(salt)}${b64url_encode(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
  if not stored:
    return False
  if not stored.startswith("pbkdf2_sha256$"):
    return hmac.compare_digest(password, stored)

  try:
    _, iterations, salt, digest = stored.split("$", 3)
    candidate = hashlib.pbkdf2_hmac(
      "sha256",
      password.encode("utf-8"),
      b64url_decode(salt),
      int(iterations),
    )
    return hmac.compare_digest(b64url_encode(candidate), digest)
  except (ValueError, TypeError):
    return False


def make_token(user: dict) -> str:
  payload = {
    "sub": str(user["id"]),
    "email": user["email"],
    "exp": int(time.time()) + TOKEN_TTL_SECONDS,
  }
  encoded_payload = b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
  signature = hmac.new(SESSION_SECRET.encode("utf-8"), encoded_payload.encode("ascii"), hashlib.sha256).digest()
  return f"{encoded_payload}.{b64url_encode(signature)}"


def verify_token(token: str) -> dict:
  try:
    encoded_payload, signature = token.split(".", 1)
    expected = hmac.new(SESSION_SECRET.encode("utf-8"), encoded_payload.encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(b64url_encode(expected), signature):
      raise ValueError("bad signature")
    payload = json.loads(b64url_decode(encoded_payload))
    if int(payload.get("exp", 0)) < int(time.time()):
      raise ValueError("expired")
    return payload
  except Exception as error:
    raise PermissionError("Invalid or expired token") from error


def sungshin_email_from_student_id(student_id: str) -> str:
  normalized = str(student_id or "").strip()
  if not STUDENT_ID_PATTERN.match(normalized):
    raise ValueError("학번은 숫자 8자리로 입력해주세요.")
  return f"{normalized}@{SUNGSHIN_EMAIL_DOMAIN}"


def email_from_auth_payload(data: dict) -> str:
  student_id = str(data.get("studentId", "")).strip()
  if student_id:
    return sungshin_email_from_student_id(student_id)
  email = str(data.get("email", "")).strip().lower()
  if not email:
    raise ValueError("학번을 입력해주세요.")
  if not email.endswith(f"@{SUNGSHIN_EMAIL_DOMAIN}"):
    raise ValueError("성신여자대학교 이메일만 사용할 수 있습니다.")
  local_part = email.split("@", 1)[0]
  return sungshin_email_from_student_id(local_part)


def send_verification_email(to_email: str, code: str) -> None:
  if EMAIL_MODE == "dev":
    return
  if not SMTP_HOST or not SMTP_FROM:
    raise ValueError("SMTP 설정이 필요합니다. SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM을 설정해주세요.")

  message = EmailMessage()
  message["Subject"] = "[Jutopia] 이메일 인증 코드"
  message["From"] = SMTP_FROM
  message["To"] = to_email
  message.set_content(
    "\n".join([
      "Jutopia 회원가입 인증 코드입니다.",
      "",
      f"인증 코드: {code}",
      "",
      "이 코드는 5분 동안만 사용할 수 있습니다.",
    ])
  )

  with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
    if SMTP_USE_TLS:
      smtp.starttls()
    if SMTP_USER:
      smtp.login(SMTP_USER, SMTP_PASSWORD)
    smtp.send_message(message)


def normalize_text_list(value, limit: int = 6) -> list[str]:
  if isinstance(value, str):
    candidates = value.split(",")
  elif isinstance(value, list):
    candidates = value
  else:
    candidates = []
  normalized = []
  for item in candidates:
    text = str(item).strip()
    if text:
      normalized.append(text)
  return normalized[:limit]


def normalize_optional_date(value) -> str | None:
  text = str(value or "").strip()
  if not text:
    return None
  try:
    datetime.strptime(text, "%Y-%m-%d")
  except ValueError as error:
    raise ValueError("날짜는 YYYY-MM-DD 형식이어야 합니다.") from error
  return text


def generate_invite_code(conn) -> str:
  for _ in range(20):
    code = f"JT{secrets.randbelow(900000) + 100000}"
    exists = conn.execute("SELECT 1 FROM clubs WHERE invite_code = %s", (code,)).fetchone()
    if not exists:
      return code
  raise RuntimeError("동아리 초대 코드를 생성하지 못했습니다.")


def masked_database_url() -> str:
  if not DATABASE_URL:
    return "(not configured)"
  parsed = urlparse(DATABASE_URL)
  if not parsed.password:
    return DATABASE_URL
  return DATABASE_URL.replace(parsed.password, "****", 1)


def user_to_client(user: dict) -> dict:
  return {
    "id": str(user["id"]),
    "email": user["email"],
    "studentId": user.get("student_id") or "",
    "department": user.get("department") or "",
    "nickname": user.get("nickname") or "",
    "profileImageUrl": user.get("profile_image_url") or "",
    "statusMessage": user.get("status_message") or "",
    "createdAt": str(user.get("created_at") or ""),
  }


def club_to_client(club: dict) -> dict:
  return {
    "id": str(club["id"]),
    "name": club["name"],
    "description": club.get("description") or "",
    "profileImageUrl": club.get("profile_image_url") or "",
    "inviteCode": club.get("invite_code") or "",
    "createdBy": str(club.get("created_by") or ""),
    "dday": str(club.get("dday") or ""),
    "color": club.get("color") or "",
    "tags": club.get("tags") or [],
    "roleTags": club.get("role_tags") or [],
    "createdAt": str(club.get("created_at") or ""),
  }


def member_to_client(member: dict) -> dict:
  return {
    "id": str(member["id"]),
    "clubId": str(member["club_id"]),
    "userId": str(member["user_id"]),
    "generation": member.get("generation") or "",
    "role": member.get("role") or "MEMBER",
    "status": member.get("status") or "ACTIVE",
    "joinedAt": str(member.get("joined_at") or ""),
  }


def fetch_user_by_email(conn, email: str) -> dict | None:
  return conn.execute(
    """
    SELECT id, email, password_hash, student_id, department, nickname,
           profile_image_url, status_message, created_at
    FROM users
    WHERE lower(email) = lower(%s)
    """,
    (email,),
  ).fetchone()


def fetch_user_by_id(conn, user_id: str) -> dict | None:
  return conn.execute(
    """
    SELECT id, email, password_hash, student_id, department, nickname,
           profile_image_url, status_message, created_at
    FROM users
    WHERE id = %s
    """,
    (user_id,),
  ).fetchone()


def fetch_memberships(conn, user_id: str) -> tuple[list[dict], list[dict]]:
  rows = conn.execute(
    """
    SELECT
      cm.id AS member_id, cm.club_id AS member_club_id, cm.user_id, cm.generation, cm.role, cm.status, cm.joined_at,
      c.id, c.name, c.description, c.profile_image_url, c.invite_code,
      c.created_by, c.dday, c.color, c.tags, c.role_tags, c.created_at
    FROM club_members cm
    JOIN clubs c ON c.id = cm.club_id
    WHERE cm.user_id = %s
    ORDER BY cm.joined_at DESC
    """,
    (user_id,),
  ).fetchall()
  memberships = []
  clubs = []
  for row in rows:
    memberships.append(member_to_client({
      "id": row["member_id"],
      "club_id": row["member_club_id"],
      "user_id": row["user_id"],
      "generation": row["generation"],
      "role": row["role"],
      "status": row["status"],
      "joined_at": row["joined_at"],
    }))
    clubs.append(club_to_client(row))
  return memberships, clubs


class JutopiaHandler(SimpleHTTPRequestHandler):
  server_version = "JutopiaDevServer/1.0"

  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=str(BASE_DIR), **kwargs)

  def end_headers(self):
    self.send_header("Access-Control-Allow-Origin", os.environ.get("APP_ORIGIN", "*"))
    self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    super().end_headers()

  def do_OPTIONS(self):
    self.send_response(HTTPStatus.NO_CONTENT)
    self.end_headers()

  def do_GET(self):
    path = urlparse(self.path).path
    if path.startswith("/api/"):
      return self.handle_api("GET", path)
    return super().do_GET()

  def do_POST(self):
    path = urlparse(self.path).path
    if path.startswith("/api/"):
      return self.handle_api("POST", path)
    self.send_error(HTTPStatus.NOT_FOUND)

  def send_json(self, status: int, payload: dict):
    body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def read_json(self) -> dict:
    length = int(self.headers.get("Content-Length", "0"))
    if length <= 0:
      return {}
    return json.loads(self.rfile.read(length).decode("utf-8"))

  def current_user_id(self) -> str:
    auth = self.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
      raise PermissionError("Authorization header is required")
    return verify_token(auth.removeprefix("Bearer ").strip())["sub"]

  def handle_api(self, method: str, path: str):
    try:
      if method == "GET" and path == "/api/health":
        with db() as conn:
          conn.execute("SELECT 1").fetchone()
        return self.send_json(200, {"ok": True})

      if method == "POST" and path == "/api/auth/send-code":
        return self.send_code()
      if method == "POST" and path == "/api/auth/verify-code":
        return self.verify_code()
      if method == "POST" and path == "/api/auth/signup":
        return self.signup()
      if method == "POST" and path == "/api/auth/login":
        return self.login()
      if method == "GET" and path == "/api/me":
        return self.me()
      if method == "GET" and path == "/api/my-clubs":
        return self.my_clubs()
      if method == "POST" and path == "/api/clubs":
        return self.create_club()
      if method == "POST" and path == "/api/clubs/leave":
        return self.leave_club()

      return self.send_json(404, {"error": "Not found"})
    except PermissionError as error:
      return self.send_json(401, {"error": str(error)})
    except ValueError as error:
      return self.send_json(400, {"error": str(error)})
    except psycopg.errors.UniqueViolation:
      return self.send_json(409, {"error": "이미 가입된 이메일입니다."})
    except Exception as error:
      print(f"[server] {type(error).__name__}: {error}", file=sys.stderr)
      return self.send_json(500, {"error": "서버 처리 중 오류가 발생했습니다."})

  def send_code(self):
    data = self.read_json()
    email = email_from_auth_payload(data)

    with db() as conn:
      if fetch_user_by_email(conn, email):
        raise ValueError("이미 가입된 이메일입니다.")
      code = f"{secrets.randbelow(1_000_000):06d}"
      conn.execute(
        """
        INSERT INTO email_verifications (email, code, expires_at)
        VALUES (%s, %s, now() + interval '5 minutes')
        """,
        (email, code),
      )
    send_verification_email(email, code)
    payload = {"ok": True, "message": "인증 코드가 발송되었습니다."}
    if EMAIL_MODE == "dev":
      payload["devCode"] = code
      payload["message"] = "개발 모드 인증 코드가 생성되었습니다."
    payload["email"] = email
    return self.send_json(200, payload)

  def verify_code(self):
    data = self.read_json()
    email = email_from_auth_payload(data)
    code = str(data.get("code", "")).strip()
    with db() as conn:
      row = conn.execute(
        """
        SELECT id
        FROM email_verifications
        WHERE lower(email) = lower(%s)
          AND code = %s
          AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (email, code),
      ).fetchone()
      if not row:
        raise ValueError("인증 코드가 일치하지 않거나 만료되었습니다.")
      conn.execute("UPDATE email_verifications SET verified_at = now() WHERE id = %s", (row["id"],))
    return self.send_json(200, {"ok": True, "message": "이메일 인증이 완료되었습니다."})

  def signup(self):
    data = self.read_json()
    student_id = str(data.get("studentId", "")).strip()
    email = email_from_auth_payload(data)
    password = str(data.get("password", ""))
    if len(password) < 8:
      raise ValueError("비밀번호는 8자 이상이어야 합니다.")

    with db() as conn:
      verified = conn.execute(
        "SELECT 1 FROM email_verifications WHERE lower(email) = lower(%s) AND verified_at IS NOT NULL LIMIT 1",
        (email,),
      ).fetchone()
      if not verified:
        raise ValueError("이메일 인증을 먼저 완료해주세요.")

      user = conn.execute(
        """
        INSERT INTO users (
          email, password_hash, student_id, department, nickname,
          profile_image_url, status_message
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING id, email, password_hash, student_id, department, nickname,
                  profile_image_url, status_message, created_at
        """,
        (
          email,
          hash_password(password),
          student_id,
          str(data.get("department", "")).strip(),
          str(data.get("nickname", "")).strip() or email.split("@")[0],
          str(data.get("profileImageUrl", "")).strip(),
          str(data.get("statusMessage", "")).strip(),
        ),
      ).fetchone()
    return self.send_json(201, {"token": make_token(user), "user": user_to_client(user), "memberships": [], "clubs": []})

  def login(self):
    data = self.read_json()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    with db() as conn:
      user = fetch_user_by_email(conn, email)
      if not user or not verify_password(password, user["password_hash"]):
        raise PermissionError("이메일 또는 비밀번호를 확인해주세요.")
      if not str(user["password_hash"]).startswith("pbkdf2_sha256$"):
        conn.execute("UPDATE users SET password_hash = %s WHERE id = %s", (hash_password(password), user["id"]))
      memberships, clubs = fetch_memberships(conn, str(user["id"]))
    return self.send_json(200, {
      "token": make_token(user),
      "user": user_to_client(user),
      "memberships": memberships,
      "clubs": clubs,
    })

  def me(self):
    user_id = self.current_user_id()
    with db() as conn:
      user = fetch_user_by_id(conn, user_id)
      if not user:
        raise PermissionError("User not found")
      memberships, clubs = fetch_memberships(conn, user_id)
    return self.send_json(200, {
      "user": user_to_client(user),
      "memberships": memberships,
      "clubs": clubs,
    })

  def my_clubs(self):
    user_id = self.current_user_id()
    with db() as conn:
      memberships, clubs = fetch_memberships(conn, user_id)
    return self.send_json(200, {"memberships": memberships, "clubs": clubs})

  def create_club(self):
    user_id = self.current_user_id()
    data = self.read_json()
    name = str(data.get("name", "")).strip()
    if not name:
      raise ValueError("동아리 이름을 입력해주세요.")

    tags = normalize_text_list(data.get("tags"))
    role_tags = normalize_text_list(data.get("roleTags")) or ["회장", "임원진", "부원"]
    dday = normalize_optional_date(data.get("dday"))
    profile_image_url = str(data.get("profileImageUrl", "")).strip()
    color = str(data.get("color", "")).strip()[:32]
    description = str(data.get("description", "")).strip()
    if not description:
      description = f"{', '.join(tags)} 동아리" if tags else "새롭게 생성된 동아리"

    with db() as conn:
      invite_code = generate_invite_code(conn)
      club = conn.execute(
        """
        INSERT INTO clubs (
          name, description, profile_image_url, invite_code,
          created_by, dday, color, tags, role_tags
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id, name, description, profile_image_url, invite_code,
                  created_by, dday, color, tags, role_tags, created_at
        """,
        (
          name,
          description,
          profile_image_url,
          invite_code,
          user_id,
          dday,
          color,
          tags,
          role_tags,
        ),
      ).fetchone()
      membership = conn.execute(
        """
        INSERT INTO club_members (club_id, user_id, generation, role, status)
        VALUES (%s, %s, %s, 'PRESIDENT', 'ACTIVE')
        RETURNING id, club_id, user_id, generation, role, status, joined_at
        """,
        (club["id"], user_id, "1기"),
      ).fetchone()

    client_club = club_to_client(club)
    client_membership = member_to_client(membership)
    return self.send_json(201, {
      "club": client_club,
      "membership": client_membership,
      "clubs": [client_club],
      "memberships": [client_membership],
    })

  def leave_club(self):
    user_id = self.current_user_id()
    data = self.read_json()
    club_id = str(data.get("clubId", "")).strip()
    if not club_id:
      raise ValueError("동아리 ID가 필요합니다.")

    with db() as conn:
      row = conn.execute(
        """
        SELECT cm.id, cm.role, c.created_by
        FROM club_members cm
        JOIN clubs c ON c.id = cm.club_id
        WHERE cm.club_id = %s AND cm.user_id = %s
        """,
        (club_id, user_id),
      ).fetchone()
      if not row:
        raise ValueError("이미 해당 동아리 소속이 아닙니다.")
      if row["role"] == "PRESIDENT" or str(row["created_by"]) == user_id:
        raise ValueError("관리자 직책은 동아리 탈퇴를 할 수 없습니다.")

      conn.execute(
        """
        DELETE FROM team_members tm
        USING teams t
        WHERE tm.team_id = t.id
          AND t.club_id = %s
          AND tm.user_id = %s
        """,
        (club_id, user_id),
      )
      conn.execute(
        """
        UPDATE club_room_checkins
        SET is_active = false, checked_out_at = COALESCE(checked_out_at, now())
        WHERE club_id = %s AND user_id = %s AND is_active = true
        """,
        (club_id, user_id),
      )
      conn.execute("DELETE FROM club_members WHERE id = %s", (row["id"],))

    return self.send_json(200, {"ok": True, "message": "동아리에서 탈퇴했습니다."})


def main():
  print(f"Jutopia server listening on http://{HOST}:{PORT}/index.html")
  print(f"Database: {masked_database_url()}")
  ThreadingHTTPServer((HOST, PORT), JutopiaHandler).serve_forever()


if __name__ == "__main__":
  main()
