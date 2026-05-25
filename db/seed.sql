INSERT INTO users (email, password_hash, student_id, department, nickname, status_message)
VALUES (
  'demo@jutopia.ac.kr',
  'demo1234',
  '20241234',
  '컴퓨터공학과',
  '김수빈',
  '오늘도 동아리방에 있습니다.'
)
ON CONFLICT (email) DO NOTHING;

WITH demo_user AS (
  SELECT id FROM users WHERE email = 'demo@jutopia.ac.kr'
),
created_club AS (
  INSERT INTO clubs (
    name,
    description,
    invite_code,
    created_by,
    dday,
    color,
    tags,
    role_tags
  )
  SELECT
    'Artisanal Jam',
    '정기연습과 팀 활동을 관리하는 공연 동아리',
    'JAM2024',
    id,
    DATE '2024-09-12',
    '#6b3518',
    ARRAY['공연', '교내', '예술', '친목'],
    ARRAY['회장', '임원진', '부원']
  FROM demo_user
  ON CONFLICT (invite_code) DO UPDATE SET name = EXCLUDED.name
  RETURNING id, created_by
)
INSERT INTO club_members (club_id, user_id, generation, role, status)
SELECT id, created_by, '12기', 'PRESIDENT', 'ACTIVE'
FROM created_club
ON CONFLICT (club_id, user_id) DO NOTHING;
