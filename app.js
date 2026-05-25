const SCHOOL_EMAIL_PATTERN = /^[^\s@]+@(?:[a-z0-9-]+\.)?(?:ac\.kr|edu)$/i;
const VERIFICATION_MINUTES = 5;

const state = {
  currentUserId: localStorage.getItem("jutopia.currentUserId"),
  currentClubId: localStorage.getItem("jutopia.currentClubId"),
  pendingClubLogo: "",
  lastCreatedClubId: localStorage.getItem("jutopia.lastCreatedClubId"),
  pendingJoinClubId: localStorage.getItem("jutopia.pendingJoinClubId"),
};

const storage = {
  get(key, fallback) {
    const value = localStorage.getItem(`jutopia.${key}`);
    return value ? JSON.parse(value) : fallback;
  },
  set(key, value) {
    localStorage.setItem(`jutopia.${key}`, JSON.stringify(value));
  },
};

const AUTH_TOKEN_KEY = "jutopia.authToken";
const PENDING_SIGNUP_KEY = "jutopia.pendingSignup";
const STUDENT_ID_PATTERN = /^\d{8}$/;

function sungshinEmail(studentId) {
  return `${studentId}@sungshin.ac.kr`;
}

function getPendingSignup() {
  const value = sessionStorage.getItem(PENDING_SIGNUP_KEY);
  return value ? JSON.parse(value) : null;
}

function setPendingSignup(value) {
  sessionStorage.setItem(PENDING_SIGNUP_KEY, JSON.stringify(value));
}

function clearPendingSignup() {
  sessionStorage.removeItem(PENDING_SIGNUP_KEY);
}

async function apiRequest(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "서버 요청에 실패했습니다.");
  }
  return data;
}

function mergeById(existing, incoming) {
  const map = new Map(existing.map((item) => [item.id, item]));
  incoming.forEach((item) => map.set(item.id, { ...map.get(item.id), ...item }));
  return Array.from(map.values());
}

function cacheAuthSession(payload) {
  if (payload.token) {
    localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
  }
  if (payload.user) {
    storage.set("users", mergeById(storage.get("users", []), [payload.user]));
    state.currentUserId = payload.user.id;
    localStorage.setItem("jutopia.currentUserId", payload.user.id);
  }
  if (payload.clubs) {
    storage.set("clubs", mergeById(storage.get("clubs", []), payload.clubs));
  }
  if (payload.memberships) {
    storage.set("clubMembers", mergeById(storage.get("clubMembers", []), payload.memberships));
  }
}

function seedData() {
  if (storage.get("seeded", false)) return;

  const user = {
    id: crypto.randomUUID(),
    email: "demo@jutopia.ac.kr",
    passwordHash: "demo1234",
    studentId: "20241234",
    department: "컴퓨터공학과",
    nickname: "하모니",
    profileImageUrl: "",
    statusMessage: "오늘도 합주실에 있습니다.",
    createdAt: new Date().toISOString(),
  };
  const clubs = [
    {
      id: crypto.randomUUID(),
      name: "Artisanal Jam",
      description: "정기연습과 팀 활동을 함께 관리하는 공연 동아리",
      profileImageUrl: "",
      inviteCode: "JAM2024",
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      name: "Jutopia Lab",
      description: "프로젝트, 스터디, 발표를 운영하는 학술 동아리",
      profileImageUrl: "",
      inviteCode: "LAB2024",
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    },
  ];
  const memberships = clubs.map((club, index) => ({
    id: crypto.randomUUID(),
    clubId: club.id,
    userId: user.id,
    generation: index === 0 ? "12기" : "3기",
    role: index === 0 ? "PRESIDENT" : "STAFF",
    status: "ACTIVE",
    joinedAt: new Date().toISOString(),
  }));

  storage.set("users", [user]);
  storage.set("clubs", clubs);
  storage.set("clubMembers", memberships);
  storage.set("emailVerifications", []);
  storage.set("seeded", true);
}

function roleLabel(role) {
  return {
    PRESIDENT: "회장",
    STAFF: "임원진",
    MEMBER: "부원",
  }[role] || "부원";
}

function statusLabel(status) {
  return {
    ACTIVE: "활동중",
    INACTIVE: "휴동",
    OB: "OB",
  }[status] || "활동중";
}

function getCurrentUser() {
  return storage.get("users", []).find((user) => user.id === state.currentUserId);
}

function getClubMemberships(userId) {
  const memberships = storage.get("clubMembers", []).filter((member) => member.userId === userId);
  const clubs = storage.get("clubs", []);
  return memberships.map((member) => ({
    ...member,
    club: clubs.find((club) => club.id === member.clubId),
  })).filter((member) => member.club);
}

function setCurrentClub(clubId) {
  state.currentClubId = clubId;
  localStorage.setItem("jutopia.currentClubId", clubId);
}

function displayName(user) {
  return user?.email === "demo@jutopia.ac.kr" ? "김수빈" : user?.nickname || "사용자";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function isClubAdmin(user, membership) {
  return Boolean(user && membership && (
    membership.role === "PRESIDENT" || membership.club.createdBy === user.id
  ));
}

function userLabelById(userId) {
  const user = storage.get("users", []).find((item) => item.id === userId);
  return displayName(user);
}

function clubVisuals(index) {
  const visuals = [
    {
      color: "#2aa179",
      cover: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=720&q=80",
      tags: ["학습", "교내", "공문", "친목"],
      dday: "D+10",
    },
    {
      color: "#f6a6a1",
      cover: "https://images.unsplash.com/photo-1456406644174-8ddd4cd52a06?auto=format&fit=crop&w=720&q=80",
      tags: ["학습", "교내", "독서"],
      dday: "D+214",
    },
    {
      color: "#6b3518",
      cover: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=720&q=80",
      tags: ["공연", "교내", "예술", "친목"],
      dday: "D+123",
    },
  ];
  return visuals[index % visuals.length];
}

function parseTags(value) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function ddayLabel(dateString) {
  if (!dateString) return "D-DAY";
  const today = new Date();
  const target = new Date(`${dateString}T00:00:00`);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return "D-DAY";
  return diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
}

function clubCardVisual(member, index) {
  const fallback = clubVisuals(index);
  return {
    color: member.club.color || fallback.color,
    cover: member.club.profileImageUrl || fallback.cover,
    tags: member.club.tags?.length ? member.club.tags : fallback.tags,
    dday: member.club.dday ? ddayLabel(member.club.dday) : fallback.dday,
  };
}

function activeClubVisual(membership) {
  const memberships = getClubMemberships(state.currentUserId);
  const index = Math.max(0, memberships.findIndex((member) => member.clubId === membership.clubId));
  return clubCardVisual(membership, index);
}

function clubHomeHeaderText(club) {
  return club.homeHeaderText || club.name;
}

function homeTeamsFor(memberships) {
  return memberships.flatMap((member, index) => {
    const baseColor = clubCardVisual(member, index).color;
    return [
      {
        id: `${member.clubId}-ensemble`,
        clubId: member.clubId,
        clubName: member.club.name,
        name: index === 0 ? "정기 합주팀" : "프로젝트 스터디",
        category: index === 0 ? "ENSEMBLE" : "STUDY",
        progress: index === 0 ? 68 : 42,
        dday: index === 0 ? "D-12" : "D-27",
        color: baseColor,
      },
      {
        id: `${member.clubId}-archive`,
        clubId: member.clubId,
        clubName: member.club.name,
        name: index === 0 ? "공연 준비조" : "발표 준비조",
        category: index === 0 ? "PROJECT" : "PROJECT",
        progress: index === 0 ? 81 : 55,
        dday: index === 0 ? "D-4" : "D-19",
        color: baseColor,
      },
    ];
  });
}

function importantNotices(memberships) {
  const days = [9, 12, 13, 22];
  return memberships.map((member, index) => {
    const source = clubNoticeItems(member)[index % 2];
    const noticeId = source?.id || "dues";
    return {
      ...source,
      id: `${member.clubId}-calendar-${noticeId}`,
      noticeId,
      clubId: member.clubId,
      clubName: member.club.name,
      title: source?.title || "정기연습 출석 안내",
      content: source?.content || "이번 주 정기연습 공지입니다.",
      day: days[index % days.length],
      color: clubCardVisual(member, index).color,
      kind: "notice",
      targetPath: `/notice/${noticeId}`,
    };
  });
}

function clubPracticeItems() {
  const cover = "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=720&q=80";
  const brown = "#6b3518";
  const defaultItems = [
    {
      title: "리스툰바나",
      dday: "D-10",
      progress: 76,
      color: brown,
      cover,
      day: 10,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "에잇",
      dday: "D-2",
      progress: 76,
      color: brown,
      cover,
      day: 9,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "에잇",
      dday: "D-2",
      progress: 76,
      color: brown,
      cover,
      day: 12,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "코카콜라",
      dday: "D-80",
      progress: 90,
      color: brown,
      cover,
      day: 13,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "리스툰바나",
      dday: "D-10",
      progress: 76,
      color: brown,
      cover,
      day: 16,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "리스툰바나",
      dday: "D-10",
      progress: 76,
      color: brown,
      cover,
      day: 18,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "Blue Hour",
      dday: "D-18",
      progress: 54,
      color: brown,
      cover,
      day: 19,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "온음계 산책",
      dday: "D-24",
      progress: 63,
      color: brown,
      cover,
      day: 21,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "Moonlight",
      dday: "D-36",
      progress: 48,
      color: brown,
      cover,
      day: 22,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "주말 합주",
      dday: "D-45",
      progress: 71,
      color: brown,
      cover,
      day: 23,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "봄의 왈츠",
      dday: "D-50",
      progress: 35,
      color: brown,
      cover,
      day: 24,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "앙코르",
      dday: "D-58",
      progress: 82,
      color: brown,
      cover,
      day: 25,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "저녁 리허설",
      dday: "D-63",
      progress: 29,
      color: brown,
      cover,
      day: 26,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "Finale",
      dday: "D-72",
      progress: 88,
      color: brown,
      cover,
      day: 27,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
    {
      title: "피날레 B",
      dday: "D-90",
      progress: 15,
      color: brown,
      cover,
      day: 28,
      members: ["김한희", "김서연", "박준희", "김민서"],
    },
  ];

  const savedItems = storage.get("practices", [])
    .filter((practice) => !state.currentClubId || practice.clubId === state.currentClubId)
    .map((practice) => normalizePracticeItem(practice, cover, brown));

  return [...savedItems, ...defaultItems];
}

function practiceDayFromDate(dateString) {
  if (!dateString) return 9;
  const target = new Date(`${dateString}T00:00:00`);
  return Number.isFinite(target.getTime()) ? target.getDate() : 9;
}

function formatPracticeDate(dateString) {
  if (!dateString) return "";
  return dateString.replaceAll("-", ".");
}

function normalizePracticeItem(practice, cover, brown) {
  const roleTags = Array.isArray(practice.roleTags) && practice.roleTags.length
    ? practice.roleTags
    : parseTags(practice.roleTags || "");
  return {
    id: practice.id,
    title: practice.title || "새 연습",
    dday: ddayLabel(practice.ddayDate),
    targetDate: practice.ddayDate || "",
    progress: Number.isFinite(Number(practice.progress)) ? Number(practice.progress) : 0,
    color: practice.color || brown,
    cover: practice.cover || cover,
    day: practiceDayFromDate(practice.ddayDate),
    members: practice.members?.length ? practice.members : ["모집 중", "모집 중", "모집 중", "모집 중"],
    roleTags,
    password: practice.password || "",
    leader: practice.leader || displayName(getCurrentUser()),
  };
}

function clampPage(page, totalPages) {
  const parsed = Number(page);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(1, Math.trunc(parsed)), totalPages);
}

function pageSlice(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function paginationMarkup(currentPage, totalPages, label) {
  const pageCount = Math.max(1, totalPages);
  return `
    <nav class="home-pagination" aria-label="${label}">
      ${Array.from({ length: pageCount }, (_, index) => {
        const page = index + 1;
        return `<button class="${page === currentPage ? "active" : ""}" type="button" data-page="${page}" aria-current="${page === currentPage ? "page" : "false"}">${page}</button>`;
      }).join("")}
    </nav>
  `;
}

function routeWithQuery(path, params) {
  const search = new URLSearchParams(params);
  return `${path}?${search.toString()}`;
}

function parseHashRoute() {
  const raw = window.location.hash.replace("#", "") || "/login";
  const [pathname, query = ""] = raw.split("?");
  return {
    path: pathname,
    params: new URLSearchParams(query),
  };
}

function noticeReadKey(membership, noticeId) {
  return `${membership.clubId}:${membership.userId}:${noticeId}`;
}

function isNoticeRead(membership, noticeId) {
  return storage.get("noticeReads", []).some((item) => item.key === noticeReadKey(membership, noticeId));
}

function setNoticeRead(membership, noticeId, read) {
  const key = noticeReadKey(membership, noticeId);
  const reads = storage.get("noticeReads", []);
  if (read) {
    if (!reads.some((item) => item.key === key)) {
      storage.set("noticeReads", [...reads, {
        key,
        noticeId,
        clubId: membership.clubId,
        userId: membership.userId,
        readAt: new Date().toISOString(),
      }]);
    }
    return true;
  }

  storage.set("noticeReads", reads.filter((item) => item.key !== key));
  return false;
}

function noticeCommentKey(membership, noticeId) {
  return `${membership.clubId}:${noticeId}`;
}

function getNoticeComments(membership, noticeId) {
  const key = noticeCommentKey(membership, noticeId);
  return storage.get("noticeComments", [])
    .filter((comment) => comment.key === key)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function addNoticeComment(membership, noticeId, user, content) {
  const comments = storage.get("noticeComments", []);
  const nextComment = {
    id: crypto.randomUUID(),
    key: noticeCommentKey(membership, noticeId),
    clubId: membership.clubId,
    noticeId,
    userId: user.id,
    author: displayName(user),
    content,
    createdAt: new Date().toISOString(),
  };
  storage.set("noticeComments", [...comments, nextComment]);
  return nextComment;
}

function deleteNoticeComment(membership, noticeId, user, commentId) {
  const key = noticeCommentKey(membership, noticeId);
  const comments = storage.get("noticeComments", []);
  const nextComments = comments.filter((comment) => (
    comment.key !== key || comment.id !== commentId || comment.userId !== user.id
  ));
  if (nextComments.length !== comments.length) {
    storage.set("noticeComments", nextComments);
    return true;
  }
  return false;
}

function formatCommentDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function noticeCommentsMarkup(comments, user) {
  return `
    <div class="notice-comments-header">
      <strong>댓글</strong>
      <span>${comments.length}개</span>
    </div>
    <div class="notice-comment-list">
      ${
        comments.length
          ? comments.map((comment) => {
              const canManage = comment.userId === user?.id;
              return `
              <article class="notice-comment">
                <div class="notice-comment-meta">
                  <strong>${escapeHtml(comment.author)}</strong>
                  <time>${formatCommentDate(comment.createdAt)}</time>
                </div>
                <p>${escapeHtml(comment.content)}</p>
                ${canManage ? `
                  <div class="notice-comment-actions">
                    <button type="button" data-comment-delete="${comment.id}">삭제</button>
                  </div>
                ` : ""}
              </article>
            `;
            }).join("")
          : '<p class="notice-comment-empty">아직 댓글이 없습니다.</p>'
      }
    </div>
    <form class="notice-comment-form" id="noticeCommentForm">
      <textarea id="noticeCommentInput" aria-label="댓글 입력" placeholder="댓글을 입력해주세요"></textarea>
      <button type="submit">등록</button>
    </form>
  `;
}

function practiceCalendarItems(membership, practices) {
  return practices.map((practice, index) => ({
    id: `${membership.clubId}-practice-${index}`,
    clubId: membership.clubId,
    clubName: membership.club.name,
    title: `${practice.title} 연습`,
    content: `${practice.title} 연습 일정입니다. 현재 진행률은 ${practice.progress}%입니다.`,
    day: practice.day,
    color: "#6b3518",
    meta: "진행중인 연습",
    kind: "practice",
    targetPath: "/practices",
  }));
}

function clubNoticeItems(membership) {
  const baseNotices = [
    {
      id: "dues",
      clubId: membership.clubId,
      clubName: membership.club.name,
      title: "회비내세요",
      listTitle: "회비 낸 사람 체크",
      author: "윤서희",
      writtenAt: "2025.02.12",
      content: "회비내세요 그리고 다음주에 MT있음\n회비 내고 오른쪽 위에 확인버튼 누르세요",
      checked: false,
      day: 9,
      color: "#2c2a2a",
      meta: "중요 공지",
    },
    {
      id: "checkup",
      clubId: membership.clubId,
      clubName: membership.club.name,
      title: "이번 주 토요일 중간점검",
      listTitle: "이번 주 토요일 중간점검",
      author: "김한희",
      writtenAt: "2025.02.14",
      content: "이번 주 토요일 중간점검이 있습니다.\n진행중인 연습팀은 참석 인원과 진행률을 확인해주세요.",
      checked: false,
      day: 13,
      color: membership.club.color || "#6b3518",
      meta: "중요 공지",
    },
  ];
  const repeated = Array.from({ length: 19 }, (_, index) => {
    const source = baseNotices[index % baseNotices.length];
    return {
      ...source,
      id: index < baseNotices.length ? source.id : `notice-${index + 1}`,
      title: index < baseNotices.length ? source.title : source.listTitle,
      listTitle: source.listTitle,
      author: index % 2 === 0 ? "윤서희" : "김한희",
      writtenAt: "2024.11.17",
      checked: false,
      day: index % 2 === 0 ? 9 : 13,
      color: index % 2 === 0 ? "#2c2a2a" : (membership.club.color || "#6b3518"),
    };
  });
  return repeated.map((notice) => ({
    ...notice,
    checked: isNoticeRead(membership, notice.id),
    kind: "notice",
    noticeId: notice.id,
    targetPath: `/notice/${notice.id}`,
  }));
}

function noticeDateValue(notice) {
  const normalized = String(notice.writtenAt || "").replaceAll(".", "-");
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestNoticeItems(notices, count = 2) {
  return notices
    .map((notice, index) => ({ notice, index }))
    .sort((a, b) => noticeDateValue(b.notice) - noticeDateValue(a.notice) || a.index - b.index)
    .slice(0, count)
    .map((item) => item.notice);
}

function roomMembersMarkup(roomMembers, highlighted = false) {
  return `
    <section class="room-report ${highlighted ? "highlighted" : ""}">
      <div class="side-heading">
        <h2>동아리방 인원보고</h2>
        ${highlighted ? "" : '<button type="button">더보기 &gt;</button>'}
      </div>
      <ul>
        ${roomMembers.map((member) => `<li><span class="small-logo">J</span>${member}</li>`).join("")}
      </ul>
      ${highlighted ? "" : '<button class="room-state-button" type="button">동방 열림</button>'}
    </section>
  `;
}

function clubSidebarMarkup({ user, membership, calendarItems, highlightedRoom = false, showLogout = false }) {
  const roomMembers = ["김한희", "김수빈", "전서연"];
  return `
    <aside class="club-main-sidebar ${highlightedRoom ? "practice-sidebar" : ""}">
      <section class="current-club-card">
        <span>현재 동아리</span>
        <strong>${escapeHtml(membership.club.name)}</strong>
        <small>${roleLabel(membership.role)} · ${statusLabel(membership.status)}</small>
      </section>

      <section class="member-greeting">
        <pre aria-hidden="true">/\\,,,/\\
/ ㅇㅅㅇ\\</pre>
        <span>${displayName(user)} 님, ${highlightedRoom ? "동방 접속 중" : "접속 중"}</span>
        <i aria-label="접속 중"></i>
      </section>

      <div class="sleeping-mascot">
        <div class="mascot-body"></div>
        <span>쥬리울림</span>
      </div>

      ${roomMembersMarkup(roomMembers, highlightedRoom)}
      ${highlightedRoom ? '<button class="room-state-button" type="button">동방 열림</button>' : ""}

      <pre class="club-doodle" aria-hidden="true">/\\,,,/\\ ||
( ·ω· )||
/ つΦ</pre>

      <section class="club-mini-calendar-wrap">
        <div class="aside-title compact-title">캘린더</div>
        <pre class="club-doodle small" aria-hidden="true">/\\,,,/\\ ||
( ·ω· )||
/ つΦ</pre>
        ${miniCalendarMarkup(calendarItems)}
      </section>
      ${showLogout ? '<button class="secondary-btn" type="button" id="switchClubButton">동아리 목록</button><button class="ghost-btn" type="button" id="logoutButton">로그아웃</button>' : ""}
    </aside>
  `;
}

function setMessage(id, text, type = "hint") {
  const element = document.querySelector(id);
  if (!element) return;
  element.className = type;
  element.textContent = text;
}

function navigate(route) {
  window.location.hash = route;
}

function renderLogin() {
  document.querySelector("#app").innerHTML = `
    <main class="auth-layout">
      <section class="auth-panel">
        <div class="brand">Jutopia</div>
        <div class="auth-copy">
          <h1>동아리 운영을 한 곳에서.</h1>
          <p>학교 이메일로 로그인하고, 내가 속한 동아리 공간으로 바로 들어가세요.</p>
        </div>
        <section class="auth-card">
          <form class="form" id="loginForm">
            <div class="field">
              <label for="loginEmail">학교 이메일</label>
              <input id="loginEmail" type="email" autocomplete="email" value="demo@jutopia.ac.kr" required />
            </div>
            <div class="field">
              <label for="loginPassword">비밀번호</label>
              <input id="loginPassword" type="password" autocomplete="current-password" value="demo1234" required />
            </div>
            <p id="loginMessage" class="hint">데모 계정: demo@jutopia.ac.kr / demo1234</p>
            <button class="primary-btn" type="submit">로그인</button>
            <div class="auth-actions">
              <button class="ghost-btn" type="button" data-route="/signup">회원가입</button>
              <button class="ghost-btn" type="button" data-route="/forgot-password">비밀번호 찾기</button>
            </div>
          </form>
        </section>
      </section>
    </main>
  `;

  document.querySelector("#loginForm").addEventListener("submit", handleLogin);
  document.querySelector('[data-route="/signup"]').addEventListener("click", () => navigate("/signup"));
  document.querySelector('[data-route="/forgot-password"]').addEventListener("click", () => navigate("/forgot-password"));
}

function renderForgotPassword() {
  document.querySelector("#app").innerHTML = `
    <main class="auth-layout">
      <section class="auth-panel">
        <div class="brand">Jutopia</div>
        <div class="auth-copy">
          <h1>비밀번호를 찾을게요.</h1>
          <p>학번을 입력하면 학교 이메일 주소로 재설정 안내가 전송됩니다.</p>
        </div>
        <section class="auth-card">
          <form class="form" id="forgotPasswordForm">
            <div class="field">
              <label for="forgotStudentId">학번</label>
              <input id="forgotStudentId" inputmode="numeric" maxlength="8" placeholder="20230000" required />
              <small class="email-preview" id="forgotEmailPreview">20230000@sungshin.ac.kr 로 안내가 전송됩니다.</small>
            </div>
            <p id="forgotPasswordMessage" class="hint">가입한 학번을 기준으로 학교 이메일을 찾습니다.</p>
            <button class="primary-btn" type="submit">재설정 안내 받기</button>
            <button class="ghost-btn" type="button" data-route="/login">로그인으로 돌아가기</button>
          </form>
        </section>
      </section>
    </main>
  `;

  document.querySelector("#forgotStudentId").addEventListener("input", updateForgotEmailPreview);
  document.querySelector("#forgotPasswordForm").addEventListener("submit", handleForgotPassword);
  document.querySelector('[data-route="/login"]').addEventListener("click", () => navigate("/login"));
}

function renderSignup() {
  document.querySelector("#app").innerHTML = `
    <main class="auth-layout">
      <section class="auth-panel">
        <div class="brand">Jutopia</div>
        <div class="auth-copy">
          <h1>학번으로 학교 이메일을 인증하세요.</h1>
          <p>학번을 입력하면 학번@sungshin.ac.kr 주소로 인증 코드가 전송됩니다.</p>
        </div>
        <section class="auth-card">
          <form class="form" id="signupForm">
            <div class="field">
              <label for="studentId">학번</label>
              <input id="studentId" inputmode="numeric" maxlength="8" placeholder="20230000" required />
              <small class="email-preview" id="studentEmailPreview">20230000@sungshin.ac.kr 로 인증 코드가 전송됩니다.</small>
            </div>
            <div class="field">
              <label for="department">학과</label>
              <input id="department" required />
            </div>
            <div class="field">
              <label for="signupPassword">비밀번호</label>
              <input id="signupPassword" type="password" autocomplete="new-password" minlength="8" required />
            </div>
            <div class="field">
              <label for="nickname">닉네임</label>
              <input id="nickname" required />
            </div>
            <p id="signupMessage" class="hint">성신여대 이메일 주소는 학번을 기준으로 자동 생성됩니다.</p>
            <button class="primary-btn" type="submit">이메일 인증하기</button>
            <button class="ghost-btn" type="button" data-route="/login">이미 계정이 있어요</button>
          </form>
        </section>
      </section>
    </main>
  `;

  document.querySelector("#studentId").addEventListener("input", updateStudentEmailPreview);
  document.querySelector("#signupForm").addEventListener("submit", handleSignup);
  document.querySelector('[data-route="/login"]').addEventListener("click", () => navigate("/login"));
}

function renderEmailVerification() {
  const pending = getPendingSignup();
  if (!pending) {
    navigate("/signup");
    return;
  }

  document.querySelector("#app").innerHTML = `
    <main class="auth-layout">
      <section class="auth-panel">
        <div class="brand">Jutopia</div>
        <div class="auth-copy">
          <h1>이메일 인증 코드를 입력하세요.</h1>
          <p><strong>${pending.email}</strong> 주소로 보낸 6자리 코드를 확인해주세요.</p>
        </div>
        <section class="auth-card">
          <form class="form" id="emailVerificationForm">
            <div class="field">
              <label for="verificationCode">인증 코드</label>
              <input id="verificationCode" inputmode="numeric" maxlength="6" placeholder="6자리 코드" required />
            </div>
            <p id="verificationMessage" class="hint">${pending.devCode ? `개발 모드 코드: ${pending.devCode}` : "코드는 5분 동안 사용할 수 있습니다."}</p>
            <button class="primary-btn" type="submit">인증하고 가입 완료</button>
            <div class="auth-actions">
              <button class="secondary-btn" id="resendCodeButton" type="button">코드 다시 보내기</button>
              <button class="ghost-btn" type="button" data-route="/signup">정보 다시 입력</button>
            </div>
          </form>
        </section>
      </section>
    </main>
  `;

  document.querySelector("#emailVerificationForm").addEventListener("submit", handleVerifyEmailSignup);
  document.querySelector("#resendCodeButton").addEventListener("click", handleResendSignupCode);
  document.querySelector('[data-route="/signup"]').addEventListener("click", () => navigate("/signup"));
}

function renderClubSelect(activeTab = "clubs", page = 1) {
  const user = getCurrentUser();
  if (!user) {
    navigate("/login");
    return;
  }
  const memberships = getClubMemberships(user.id);
  const notices = importantNotices(memberships);
  const teams = homeTeamsFor(memberships);
  const pageSize = activeTab === "clubs" ? 3 : 5;
  const itemCount = activeTab === "clubs" ? memberships.length : teams.length;
  const totalPages = Math.max(3, Math.ceil(Math.max(1, itemCount) / pageSize));
  const currentPage = clampPage(page, totalPages);

  document.querySelector("#app").innerHTML = `
    <header class="home-topbar">
      <div class="home-logo"><span class="logo-mark">J</span><span>JUTOPIA</span></div>
    </header>
    <main class="personal-home">
      <section class="home-content">
        <h1>${displayName(user)} 님의 동아리</h1>
        <div class="home-tabs" role="tablist" aria-label="개인 홈 탭">
          <button class="${activeTab === "clubs" ? "active" : ""}" type="button" data-home-tab="clubs">동아리</button>
          <button class="${activeTab === "teams" ? "active" : ""}" type="button" data-home-tab="teams">모임</button>
        </div>
        <section class="home-panel">
          ${
            activeTab === "clubs"
              ? clubHomeCards(memberships, currentPage, pageSize)
              : teamHomeCards(teams, currentPage, pageSize)
          }
        </section>
        ${paginationMarkup(currentPage, totalPages, `${activeTab === "clubs" ? "동아리" : "모임"} 페이지`)}
      </section>
      <aside class="home-aside">
        <div class="home-greeting">
          <pre aria-hidden="true">/\\,,,/\\
=( • · • )=
/づ♡</pre>
          <p>${displayName(user)} 님, 반갑습니다</p>
        </div>
        <div class="aside-title">캘린더</div>
        <pre class="calendar-doodle" aria-hidden="true">/\\,,,/\\ ||
( ·ω· )||
/ つΦ</pre>
        ${miniCalendarMarkup(notices)}
        <button class="ghost-btn" type="button" id="logoutButton">로그아웃</button>
      </aside>
    </main>
    <div id="modalRoot"></div>
  `;

  document.querySelectorAll("[data-home-tab]").forEach((button) => {
    button.addEventListener("click", () => renderClubSelect(button.dataset.homeTab, 1));
  });
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => renderClubSelect(activeTab, button.dataset.page));
  });
  document.querySelectorAll("[data-club-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentClubId = button.dataset.clubId;
      localStorage.setItem("jutopia.currentClubId", state.currentClubId);
      navigate("/dashboard");
    });
  });
  const createButton = document.querySelector("#createClubButton");
  if (createButton) createButton.addEventListener("click", () => navigate("/club-action"));
  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => renderNoticeModal(notices.find((notice) => notice.id === button.dataset.noticeId)));
  });
  document.querySelector("#logoutButton").addEventListener("click", logout);
}

function clubHomeCards(memberships, page = 1, pageSize = 3) {
  const visibleMemberships = pageSlice(memberships, page, pageSize);
  return `
    <div class="home-card-grid">
      ${visibleMemberships.map((member, index) => {
        const absoluteIndex = (page - 1) * pageSize + index;
        const visual = clubCardVisual(member, absoluteIndex);
        return `
          <article class="membership-card">
            <div class="card-dday" style="background:${visual.color}">${visual.dday}</div>
            <button class="card-cover" type="button" data-club-id="${member.clubId}" style="background-image:url('${visual.cover}')"></button>
            <div class="card-body">
              <h2>${member.club.name}</h2>
              <div class="tag-row">
                ${visual.tags.map((tag) => `<span>${tag}</span>`).join("")}
              </div>
            </div>
          </article>
        `;
      }).join("")}
      ${visibleMemberships.length === 0 ? '<article class="membership-card empty-card"><p>이 페이지에는 아직 동아리가 없어요.</p></article>' : ""}
      <article class="membership-card add-card">
        <button class="add-club-button" type="button" id="createClubButton" aria-label="동아리 생성">+</button>
      </article>
    </div>
  `;
}

function teamHomeCards(teams, page = 1, pageSize = 5) {
  const visibleTeams = pageSlice(teams, page, pageSize);
  return `
    <div class="team-list">
      ${visibleTeams.map((team) => `
        <button class="team-row" type="button" data-club-id="${team.clubId}">
          <span class="team-color" style="background:${team.color}"></span>
          <span>
            <strong>${team.name}</strong>
            <small>${team.clubName} · ${team.category}</small>
          </span>
          <span class="team-progress">
            <b>${team.progress}%</b>
            <i style="--progress:${team.progress}%"><em></em></i>
          </span>
          <span class="team-dday">${team.dday}</span>
        </button>
      `).join("")}
      ${visibleTeams.length === 0 ? '<div class="team-empty">이 페이지에는 아직 소모임이 없어요.</div>' : ""}
    </div>
  `;
}

function miniCalendarMarkup(notices) {
  const visibleDays = Array.from({ length: 35 }, (_, index) => {
    const day = index < 1 ? "" : index <= 30 ? index : index - 30;
    const isNextMonth = index > 30;
    const notice = notices.find((item) => item.day === day);
    return { day, isNextMonth, notice };
  });

  return `
    <section class="mini-calendar" aria-label="중요 공지 캘린더">
      <div class="mini-calendar-toolbar">
        <button type="button" aria-label="이전 달">‹</button>
        <select aria-label="월"><option>Sep</option></select>
        <select aria-label="연도"><option>2025</option></select>
        <button type="button" aria-label="다음 달">›</button>
      </div>
      <div class="mini-weekdays">
        ${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => `<span>${day}</span>`).join("")}
      </div>
      <div class="mini-days">
        ${visibleDays.map(({ day, isNextMonth, notice }) => {
          if (!day) return `<span></span>`;
          if (!notice) return `<span class="${isNextMonth ? "muted" : ""}">${day}</span>`;
          return `<button type="button" data-notice-id="${notice.id}" title="${notice.clubName} - ${notice.title}" style="background:${notice.color}">${day}</button>`;
        }).join("")}
      </div>
    </section>
  `;
}

function renderNoticeModal(notice) {
  if (!notice) return;
  const meta = notice.meta || "중요 공지";
  document.querySelector("#modalRoot").innerHTML = `
    <div class="modal-backdrop">
      <section class="notice-modal">
        <span class="notice-chip" style="background:${notice.color}">${notice.clubName}</span>
        <h2>${notice.title}</h2>
        <p>${notice.content}</p>
        <div class="notice-meta">2025년 9월 ${notice.day}일 · ${meta}</div>
        <div class="auth-actions">
          <button class="ghost-btn" type="button" data-close-modal>닫기</button>
          <button class="primary-btn" type="button" data-calendar-move>이동하기</button>
        </div>
      </section>
    </div>
  `;
  const modalRoot = document.querySelector("#modalRoot");
  modalRoot.querySelector("[data-close-modal]").addEventListener("click", closeModal);
  modalRoot.querySelector("[data-calendar-move]").addEventListener("click", () => moveToCalendarItem(notice));
}

function moveToCalendarItem(item) {
  if (!item) return;
  if (item.clubId) {
    setCurrentClub(item.clubId);
  }
  navigate(item.targetPath || (item.kind === "notice" ? `/notice/${item.noticeId || item.id}` : "/dashboard"));
}

function renderClubActionPage() {
  const user = getCurrentUser();
  if (!user) {
    navigate("/login");
    return;
  }

  document.querySelector("#app").innerHTML = `
    <header class="home-topbar">
      <button class="brand-link" type="button" id="backToClubListButton">JUTOPIA</button>
    </header>
    <main class="club-action-page">
      <section class="club-action-panel" aria-label="동아리 추가 방식 선택">
        <button class="club-action-button" type="button" id="chooseCreateClub">동아리 생성하기</button>
        <button class="club-action-button" type="button" id="chooseJoinClub">동아리 들어가기</button>
      </section>
    </main>
  `;

  document.querySelector("#backToClubListButton").addEventListener("click", () => navigate("/clubs"));
  document.querySelector("#chooseCreateClub").addEventListener("click", () => navigate("/create-club"));
  document.querySelector("#chooseJoinClub").addEventListener("click", () => navigate("/join-club-code"));
}

function renderCreateClubPage() {
  const user = getCurrentUser();
  if (!user) {
    navigate("/login");
    return;
  }
  state.pendingClubLogo = "";

  document.querySelector("#app").innerHTML = `
    <header class="home-topbar">
      <button class="brand-link" type="button" id="backToHomeButton">JUTOPIA</button>
    </header>
    <main class="create-club-page">
      <form class="create-club-form" id="createClubForm">
        <h1>동아리 생성</h1>
        <div class="create-field">
          <label for="clubName">동아리 이름</label>
          <input id="clubName" placeholder="0000011" required />
        </div>
        <div class="create-field">
          <label for="clubDday">D-DAY</label>
          <input id="clubDday" type="date" value="2025-01-01" required />
        </div>
        <div class="create-field">
          <label for="clubTags">동아리 태그 (추후 수정 가능, 쉼표로 구별)</label>
          <input id="clubTags" placeholder="태그 입력 : ex. 코딩, 친목 교내동아리 꼭 쉼표로 구별해주세요!" />
        </div>
        <div class="create-field">
          <label for="roleTags">역할 태그 (추후 수정 가능, 쉼표로 구별)</label>
          <input id="roleTags" placeholder="태그 입력 : ex. 관리자, 회장, 부회장 꼭 쉼표로 구별해주세요!" />
        </div>
        <label class="logo-upload" for="clubLogo">
          <span id="logoUploadText">동아리 로고<br />사진 업로드하기</span>
          <input id="clubLogo" type="file" accept="image/*" />
        </label>
        <p id="createClubMessage" class="hint"></p>
        <button class="create-submit" type="submit">동아리 코드 생성하기</button>
      </form>
    </main>
    <div id="modalRoot"></div>
  `;

  document.querySelector("#backToHomeButton").addEventListener("click", () => navigate("/clubs"));
  document.querySelector("#clubLogo").addEventListener("change", handleClubLogoChange);
  document.querySelector("#createClubForm").addEventListener("submit", handleCreateClub);
}

function renderJoinClubCodePage() {
  const user = getCurrentUser();
  if (!user) {
    navigate("/login");
    return;
  }

  document.querySelector("#app").innerHTML = `
    <header class="home-topbar">
      <button class="brand-link" type="button" id="backToClubActionButton">JUTOPIA</button>
    </header>
    <main class="join-code-page">
      <form class="join-code-form" id="joinClubCodeForm">
        <h1>동아리 코드를 입력해주세요.</h1>
        <input id="inviteCode" aria-label="동아리 코드" placeholder="23A8QZ" required />
        <button class="create-submit" type="submit">동아리 들어가기</button>
        <p id="joinMessage" class="hint">테스트 코드는 23A8QZ 입니다.</p>
      </form>
    </main>
  `;

  document.querySelector("#backToClubActionButton").addEventListener("click", () => navigate("/club-action"));
  document.querySelector("#joinClubCodeForm").addEventListener("submit", handleJoinClubCode);
}

function renderJoinClubProfilePage() {
  const user = getCurrentUser();
  if (!user) {
    navigate("/login");
    return;
  }
  const club = storage.get("clubs", []).find((item) => item.id === state.pendingJoinClubId);
  if (!club) {
    navigate("/join-club-code");
    return;
  }

  document.querySelector("#app").innerHTML = `
    <header class="home-topbar">
      <button class="brand-link" type="button" id="backToJoinCodeButton">JUTOPIA</button>
    </header>
    <main class="create-club-page join-profile-page">
      <form class="create-club-form join-profile-form" id="joinClubProfileForm">
        <h1>${escapeHtml(club.name)}에 오신 것을 환영합니다.</h1>
        <div class="create-field">
          <label for="clubMemberName">이름</label>
          <input id="clubMemberName" value="${escapeHtml(displayName(user))}" required />
        </div>
        <div class="create-field">
          <label for="clubGeneration">기수</label>
          <input id="clubGeneration" placeholder="예: 37기" required />
        </div>
        <fieldset class="join-status-field">
          <legend>활동 상태</legend>
          <label><input type="radio" name="clubStatus" value="ACTIVE" checked /> 활동중</label>
          <label><input type="radio" name="clubStatus" value="INACTIVE" /> 휴동</label>
          <label><input type="radio" name="clubStatus" value="OB" /> OB</label>
        </fieldset>
        <p id="joinProfileMessage" class="hint"></p>
        <button class="create-submit" type="submit">입장하기</button>
      </form>
    </main>
  `;

  document.querySelector("#backToJoinCodeButton").addEventListener("click", () => navigate("/join-club-code"));
  document.querySelector("#joinClubProfileForm").addEventListener("submit", handleJoinClubProfile);
}

function ensureDemoInviteClub(code) {
  if (code !== "23A8QZ") return null;
  const clubs = storage.get("clubs", []);
  const existing = clubs.find((club) => club.inviteCode?.toUpperCase() === code);
  if (existing) return existing;
  const club = {
    id: crypto.randomUUID(),
    name: "주리울림",
    description: "초대 코드로 입장할 수 있는 공연 동아리",
    profileImageUrl: "",
    dday: "2025-01-01",
    tags: ["공연", "교내", "예술", "친목"],
    roleTags: ["회장", "임원진", "부원"],
    color: "#6b3518",
    inviteCode: code,
    createdBy: "demo-invite-owner",
    createdAt: new Date().toISOString(),
  };
  storage.set("clubs", [...clubs, club]);
  return club;
}

function renderCreatePracticePage() {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }

  document.querySelector("#app").innerHTML = `
    <header class="home-topbar">
      <button class="brand-link" type="button" id="backToPracticeButton">JUTOPIA</button>
    </header>
    <main class="create-club-page create-practice-page">
      <form class="create-club-form create-practice-form" id="createPracticeForm">
        <h1>모임 생성</h1>
        <div class="create-field">
          <label for="practiceName">팀 이름</label>
          <input id="practiceName" placeholder="팀 이름" required />
        </div>
        <div class="create-field">
          <label for="practiceDday">D-DAY</label>
          <input id="practiceDday" type="date" value="2025-01-01" required />
        </div>
        <div class="create-field">
          <label for="practicePassword">참여 비밀번호</label>
          <input id="practicePassword" placeholder="0000011" required />
        </div>
        <div class="create-field">
          <label for="practiceRoleTags">역할 태그 (쉼표로 입력)</label>
          <input id="practiceRoleTags" placeholder="1파트, 2파트, 3파트, 4파트" required />
        </div>
        <p id="createPracticeMessage" class="hint"></p>
        <button class="create-submit" type="submit">연습 생성하기</button>
      </form>
    </main>
    <div id="modalRoot"></div>
  `;

  document.querySelector("#backToPracticeButton").addEventListener("click", () => navigate("/practices"));
  document.querySelector("#createPracticeForm").addEventListener("submit", handleCreatePractice);
}

function renderClubCodePage() {
  const user = getCurrentUser();
  if (!user) {
    navigate("/login");
    return;
  }

  const clubId = state.lastCreatedClubId || state.currentClubId;
  const club = storage.get("clubs", []).find((item) => item.id === clubId);
  if (!club) {
    navigate("/clubs");
    return;
  }

  document.querySelector("#app").innerHTML = `
    <header class="home-topbar">
      <button class="brand-link" type="button" id="backToCreateButton">JUTOPIA</button>
    </header>
    <main class="club-code-page">
      <section class="club-code-card">
        <p class="step-label">동아리 생성 완료</p>
        <h1>${club.name}</h1>
        <p class="code-description">아래 코드를 공유하면 멤버가 가입 신청을 보낼 수 있습니다.</p>
        <div class="generated-code" aria-label="생성된 동아리 코드">${club.inviteCode}</div>
        <div class="code-meta">
          <span>${ddayLabel(club.dday)}</span>
          <span>${club.tags?.length ? club.tags.join(" · ") : "태그 미등록"}</span>
        </div>
        <div class="code-actions">
          <button class="secondary-btn" type="button" id="copyClubCodeButton">코드 복사</button>
          <button class="ghost-btn" type="button" id="goHomeAfterCreate">개인 홈으로</button>
          <button class="primary-btn" type="button" id="goClubAfterCreate">동아리로 이동</button>
        </div>
        <p id="clubCodeMessage" class="hint">프로토타입 흐름에 맞춰 생성 후 이 확인 화면을 거칩니다.</p>
      </section>
    </main>
  `;

  document.querySelector("#backToCreateButton").addEventListener("click", () => navigate("/create-club"));
  document.querySelector("#goHomeAfterCreate").addEventListener("click", () => navigate("/clubs"));
  document.querySelector("#goClubAfterCreate").addEventListener("click", () => {
    state.currentClubId = club.id;
    localStorage.setItem("jutopia.currentClubId", club.id);
    navigate("/dashboard");
  });
  document.querySelector("#copyClubCodeButton").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(club.inviteCode);
      setMessage("#clubCodeMessage", "동아리 코드가 복사되었습니다.", "success");
    } catch (error) {
      setMessage("#clubCodeMessage", `동아리 코드: ${club.inviteCode}`, "hint");
    }
  });
}

function renderDashboard() {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }
  const practices = clubPracticeItems().slice(0, 2);
  const allNotices = clubNoticeItems(membership);
  const notices = latestNoticeItems(allNotices, 2);
  const clubCalendarItems = [...allNotices, ...practiceCalendarItems(membership, practices)];
  const clubVisual = activeClubVisual(membership);
  const admin = isClubAdmin(user, membership);
  const heroStyles = [
    `--club-accent:${clubVisual.color}`,
    membership.club.bannerImageUrl ? `background-image:linear-gradient(180deg,rgba(168,216,255,0.58),rgba(217,239,255,0.76)),url('${membership.club.bannerImageUrl}')` : "",
  ].filter(Boolean).join(";");

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToClubHome">
        <span class="logo-mark">J</span><span>JUTOPIA</span>
      </button>
      ${admin ? '<button class="settings-link" type="button" id="clubSettingsButton">설정 &gt;</button>' : '<span class="settings-placeholder" aria-hidden="true"></span>'}
    </header>
    <main class="club-main-page">
      <section class="club-main-content">
        <div class="club-hero-banner ${membership.club.bannerImageUrl ? "has-custom-banner" : ""}" style="${heroStyles}">
          <div class="cloud cloud-one"></div>
          <div class="cloud cloud-two"></div>
          <div class="cloud cloud-three"></div>
          <div class="flying-card">${escapeHtml(clubHomeHeaderText(membership.club))}</div>
        </div>

        <h1 class="club-dashboard-title">${escapeHtml(membership.club.name)}</h1>

        <section class="club-section notice-section">
          <div class="section-heading">
            <h1>공지사항</h1>
            <a href="#/notices">더보기 &gt;</a>
          </div>
          <div class="notice-list">
            ${notices.map((notice) => `
              <label class="notice-check-row">
                <input type="checkbox" data-notice-check="${notice.id}" ${notice.checked ? "checked" : ""} />
                <a href="#/notice/${notice.id}">${notice.listTitle}</a>
              </label>
            `).join("")}
          </div>
        </section>

        <section class="club-section practice-section">
          <div class="section-heading">
            <h1>진행중인 연습</h1>
            <a href="#/practices" id="openPracticesButton">더보기 &gt;</a>
          </div>
          <div class="practice-card-grid">
            ${practices.map((practice) => practiceCardMarkup(practice)).join("")}
            <article class="practice-card add-practice-card">
              <button type="button" aria-label="연습 추가">+</button>
            </article>
          </div>
        </section>
      </section>

      ${clubSidebarMarkup({ user, membership, calendarItems: clubCalendarItems, showLogout: true })}
      <div id="modalRoot"></div>
    </main>
  `;

  document.querySelector("#backToClubHome").addEventListener("click", () => navigate("/clubs"));
  if (admin) {
    document.querySelector("#clubSettingsButton").addEventListener("click", () => navigate("/club-settings"));
  }
  document.querySelector("#switchClubButton").addEventListener("click", () => navigate("/clubs"));
  document.querySelector("#logoutButton").addEventListener("click", logout);
  document.querySelectorAll(".add-practice-card button").forEach((button) => {
    button.addEventListener("click", () => navigate("/create-practice"));
  });
  document.querySelectorAll("[data-notice-check]").forEach((input) => {
    input.addEventListener("change", (event) => {
      setNoticeRead(membership, event.currentTarget.dataset.noticeCheck, event.currentTarget.checked);
    });
  });
  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const notice = clubCalendarItems.find((item) => item.id === button.dataset.noticeId);
      renderNoticeModal(notice);
    });
  });
}

function roleAssignmentKey(clubId, rowId) {
  return `${clubId}:${rowId}`;
}

function getClubRoleAssignments() {
  return storage.get("clubRoleAssignments", {});
}

function setClubRoleAssignment(clubId, rowId, role) {
  const assignments = getClubRoleAssignments();
  assignments[roleAssignmentKey(clubId, rowId)] = role;
  storage.set("clubRoleAssignments", assignments);
}

function clubRosterRows(membership) {
  const assignments = getClubRoleAssignments();
  const users = storage.get("users", []);
  const rows = storage.get("clubMembers", [])
    .filter((member) => member.clubId === membership.clubId)
    .map((member) => {
      const user = users.find((item) => item.id === member.userId);
      const rowId = member.id;
      return {
        id: rowId,
        memberId: member.id,
        userId: member.userId,
        name: displayName(user),
        meta: user?.email || "가입 멤버",
        generation: member.generation || "-",
        status: member.status || "ACTIVE",
        role: assignments[roleAssignmentKey(membership.clubId, rowId)] || member.role || "MEMBER",
        demo: false,
      };
    });

  const demoRows = [
    { id: "demo-kimhanhee", name: "김한희", meta: "초대 코드 가입 예정", generation: "12기", status: "ACTIVE", role: "STAFF" },
    { id: "demo-kimsubin", name: "김수빈", meta: "초대 코드 가입 예정", generation: "12기", status: "ACTIVE", role: "MEMBER" },
    { id: "demo-jeonseoyeon", name: "전서연", meta: "초대 코드 가입 예정", generation: "11기", status: "ACTIVE", role: "MEMBER" },
  ];

  demoRows.forEach((row) => {
    if (!rows.some((item) => item.name === row.name)) {
      rows.push({
        ...row,
        role: assignments[roleAssignmentKey(membership.clubId, row.id)] || row.role,
        demo: true,
      });
    }
  });

  return rows;
}

function renderClubSettingsPage() {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }
  if (!isClubAdmin(user, membership)) {
    navigate("/dashboard");
    return;
  }

  const club = membership.club;
  const roster = clubRosterRows(membership);

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToDashboardButton">
        <span class="logo-mark">J</span><span>JUTOPIA</span>
      </button>
      <span class="settings-link">관리자 설정</span>
    </header>
    <main class="club-settings-page">
      <section class="club-settings-panel">
        <p class="settings-eyebrow">관리자 전용</p>
        <h1>${escapeHtml(club.name)} 설정</h1>
        <p class="settings-copy">동아리 생성자와 회장만 홈 헤더를 수정하고 팀원 역할을 부여할 수 있습니다.</p>

        <form class="club-settings-form" id="clubHomeSettingsForm">
          <h2>동아리 홈 헤더</h2>
          <div class="settings-grid">
            <label class="create-field">
              <span>동아리 이름</span>
              <input id="settingsClubName" value="${escapeHtml(club.name)}" required />
            </label>
            <label class="create-field">
              <span>홈 헤더 문구</span>
              <input id="settingsHeaderText" value="${escapeHtml(clubHomeHeaderText(club))}" required />
            </label>
            <label class="create-field">
              <span>대표 색상</span>
              <input id="settingsClubColor" type="color" value="${club.color || activeClubVisual(membership).color}" />
            </label>
            <label class="create-field">
              <span>배너 이미지 URL</span>
              <input id="settingsBannerImage" type="url" value="${escapeHtml(club.bannerImageUrl || "")}" placeholder="선택 입력" />
            </label>
          </div>
          <p id="clubSettingsMessage" class="hint"></p>
          <button class="create-submit settings-submit" type="submit">홈 헤더 저장하기</button>
        </form>

        <section class="role-manager">
          <div class="role-manager-heading">
            <div>
              <h2>팀원 역할 부여</h2>
              <p>회장 / 임원진 / 부원 역할을 동아리별로 관리합니다.</p>
            </div>
            <button class="secondary-btn" type="button" id="saveRoleAssignmentsButton">역할 저장</button>
          </div>
          <div class="role-table">
            <div class="role-table-head">
              <strong>이름</strong>
              <strong>기수</strong>
              <strong>활동 상태</strong>
              <strong>역할</strong>
            </div>
            ${roster.map((row) => `
              <div class="role-table-row">
                <div>
                  <strong>${escapeHtml(row.name)}</strong>
                  <small>${escapeHtml(row.meta)}${row.demo ? " · 예시 멤버" : ""}</small>
                </div>
                <span>${escapeHtml(row.generation)}</span>
                <span>${statusLabel(row.status)}</span>
                <select data-role-row="${row.id}" data-member-id="${row.memberId || ""}">
                  ${["PRESIDENT", "STAFF", "MEMBER"].map((role) => `
                    <option value="${role}" ${row.role === role ? "selected" : ""}>${roleLabel(role)}</option>
                  `).join("")}
                </select>
              </div>
            `).join("")}
          </div>
          <p id="roleSettingsMessage" class="hint"></p>
        </section>
      </section>
    </main>
  `;

  document.querySelector("#backToDashboardButton").addEventListener("click", () => navigate("/dashboard"));
  document.querySelector("#clubHomeSettingsForm").addEventListener("submit", handleClubHomeSettingsSave);
  document.querySelector("#saveRoleAssignmentsButton").addEventListener("click", handleRoleAssignmentsSave);
}

function handleClubHomeSettingsSave(event) {
  event.preventDefault();
  const clubId = state.currentClubId;
  const clubs = storage.get("clubs", []);
  const updatedClubs = clubs.map((club) => {
    if (club.id !== clubId) return club;
    return {
      ...club,
      name: document.querySelector("#settingsClubName").value.trim(),
      homeHeaderText: document.querySelector("#settingsHeaderText").value.trim(),
      color: document.querySelector("#settingsClubColor").value,
      bannerImageUrl: document.querySelector("#settingsBannerImage").value.trim(),
    };
  });
  storage.set("clubs", updatedClubs);
  setMessage("#clubSettingsMessage", "동아리 홈 헤더가 저장되었습니다.", "success");
}

function handleRoleAssignmentsSave() {
  const clubId = state.currentClubId;
  const members = storage.get("clubMembers", []);
  document.querySelectorAll("[data-role-row]").forEach((select) => {
    const role = select.value;
    const rowId = select.dataset.roleRow;
    const memberId = select.dataset.memberId;
    setClubRoleAssignment(clubId, rowId, role);
    const member = members.find((item) => item.id === memberId);
    if (member) member.role = role;
  });
  storage.set("clubMembers", members);
  setMessage("#roleSettingsMessage", "팀원 역할이 저장되었습니다.", "success");
}

function practiceCardMarkup(practice) {
  return `
    <article class="practice-card">
      <div class="practice-dday">${practice.dday}</div>
      <div class="practice-cover" style="background-image:url('${practice.cover}')"></div>
      <div class="practice-body">
        <h2>${practice.title}</h2>
        <div class="practice-progress-row">
          <span>진행률</span>
          <strong>${practice.progress}%</strong>
        </div>
        <div class="practice-progress-track">
          <i style="width:${practice.progress}%; background:${practice.color}"></i>
        </div>
        ${practice.roleTags?.length ? `
          <div class="practice-role-tags">
            ${practice.roleTags.map((tag) => `<span>${tag}</span>`).join("")}
          </div>
        ` : ""}
        <ol class="practice-members">
          ${practice.members.map((member, index) => `<li>${index + 1}파트 : ${member}</li>`).join("")}
        </ol>
      </div>
    </article>
  `;
}

function renderNoticePage(noticeId = "dues") {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }

  const notices = clubNoticeItems(membership);
  const currentIndex = Math.max(0, notices.findIndex((notice) => notice.id === noticeId));
  const notice = notices[currentIndex] || notices[0];
  const previous = notices[(currentIndex - 1 + notices.length) % notices.length];
  const next = notices[(currentIndex + 1) % notices.length];
  const noticeRead = isNoticeRead(membership, notice.id);
  const comments = getNoticeComments(membership, notice.id);
  const calendarItems = [...notices, ...practiceCalendarItems(membership, clubPracticeItems().slice(0, 4))];

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToClubHome">
        <span class="logo-mark">J</span><span>JUTOPIA</span>
      </button>
    </header>
    <main class="notice-page club-main-page">
      <section class="notice-page-content">
        <h1><a href="#/notices">공지사항</a></h1>
        <article class="notice-detail">
          <header class="notice-detail-header">
            <h2>${notice.title}</h2>
            <button
              class="confirm-read-button ${noticeRead ? "confirmed" : ""}"
              type="button"
              id="confirmNoticeButton"
              aria-pressed="${noticeRead ? "true" : "false"}"
            >${noticeRead ? "확인됨" : "미확인"}</button>
          </header>
          <section class="notice-detail-body">
            <div class="notice-author-line">작성자 : ${notice.author}</div>
            <div class="notice-author-line">작성일 : ${notice.writtenAt}</div>
            <p>${notice.content.replace(/\n/g, "<br />")}</p>
          </section>
          <section class="notice-comments">
            ${noticeCommentsMarkup(comments, user)}
          </section>
        </article>
        <nav class="notice-nav" aria-label="공지사항 글 이동">
          <a href="#/notice/${previous.id}">&lt;이전 글</a>
          <a href="#/notice/${next.id}">다음 글&gt;</a>
        </nav>
      </section>
      ${clubSidebarMarkup({ user, membership, calendarItems, highlightedRoom: true })}
      <div id="modalRoot"></div>
    </main>
  `;

  document.querySelector("#backToClubHome").addEventListener("click", () => navigate("/dashboard"));
  document.querySelector("#confirmNoticeButton").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const nextReadState = button.getAttribute("aria-pressed") !== "true";
    setNoticeRead(membership, notice.id, nextReadState);
    button.classList.toggle("confirmed", nextReadState);
    button.setAttribute("aria-pressed", String(nextReadState));
    button.textContent = nextReadState ? "확인됨" : "미확인";
  });
  document.querySelector("#noticeCommentForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#noticeCommentInput");
    const content = input.value.trim();
    if (!content) {
      input.focus();
      return;
    }
    addNoticeComment(membership, notice.id, user, content);
    renderNoticePage(notice.id);
  });
  document.querySelectorAll("[data-comment-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const commentId = button.dataset.commentDelete;
      if (!window.confirm("댓글을 삭제할까요?")) return;
      if (deleteNoticeComment(membership, notice.id, user, commentId)) {
        renderNoticePage(notice.id);
      }
    });
  });
  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = calendarItems.find((item) => item.id === button.dataset.noticeId);
      if (target?.id && notices.some((noticeItem) => noticeItem.id === target.id)) {
        navigate(`/notice/${target.id}`);
      } else {
        renderNoticeModal(target);
      }
    });
  });
}

function renderNoticesPage(page = 1) {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }

  const notices = clubNoticeItems(membership);
  const pageSize = 7;
  const totalPages = Math.max(3, Math.ceil(notices.length / pageSize));
  const currentPage = clampPage(page, totalPages);
  const visibleNotices = pageSlice(notices, currentPage, pageSize);
  const calendarItems = [...clubNoticeItems(membership).slice(0, 2), ...practiceCalendarItems(membership, clubPracticeItems().slice(0, 4))];

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToClubHome">
        <span class="logo-mark">J</span><span>JUTOPIA</span>
      </button>
    </header>
    <main class="notices-page notice-page club-main-page">
      <section class="notices-page-content notice-page-content">
        <h1>공지사항</h1>
        <form class="notice-search" role="search">
          <input aria-label="공지 검색" placeholder="검색어를 입력해주세요" />
          <button type="submit">검색</button>
        </form>
        <section class="notice-table" aria-label="공지사항 목록">
          <div class="notice-table-head">
            <strong>제목</strong>
            <strong>작성자</strong>
            <strong>작성일</strong>
          </div>
          <div class="notice-table-body">
            ${visibleNotices.map((notice) => `
              <div class="notice-table-row">
                <input type="checkbox" data-notice-check="${notice.id}" aria-label="${notice.listTitle} 확인" ${notice.checked ? "checked" : ""} />
                <a href="#/notice/${notice.id}">${notice.listTitle}</a>
                <span>${notice.author}</span>
                <time>${notice.writtenAt}</time>
              </div>
            `).join("")}
          </div>
        </section>
        <div class="notice-list-pagination">
          ${paginationMarkup(currentPage, totalPages, "공지사항 목록 페이지")}
        </div>
      </section>
      ${clubSidebarMarkup({ user, membership, calendarItems, highlightedRoom: true })}
      <div id="modalRoot"></div>
    </main>
  `;

  document.querySelector("#backToClubHome").addEventListener("click", () => navigate("/dashboard"));
  document.querySelector(".notice-search").addEventListener("submit", (event) => {
    event.preventDefault();
  });
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => renderNoticesPage(button.dataset.page));
  });
  document.querySelectorAll("[data-notice-check]").forEach((input) => {
    input.addEventListener("change", (event) => {
      setNoticeRead(membership, event.currentTarget.dataset.noticeCheck, event.currentTarget.checked);
    });
  });
  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = calendarItems.find((item) => item.id === button.dataset.noticeId);
      if (target?.id && notices.some((noticeItem) => noticeItem.id === target.id)) {
        navigate(`/notice/${target.id}`);
      } else {
        renderNoticeModal(target);
      }
    });
  });
}

function renderPracticesPage(page = 1, view = "grid") {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }

  const activeView = view === "list" ? "list" : "grid";
  const practices = clubPracticeItems();
  const pageSize = 6;
  const totalPages = Math.max(3, Math.ceil(practices.length / pageSize));
  const currentPage = clampPage(page, totalPages);
  const visiblePractices = pageSlice(practices, currentPage, pageSize);
  const calendarItems = [
    ...clubNoticeItems(membership),
    ...practiceCalendarItems(membership, practices),
  ];

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToClubHome">
        <span class="logo-mark">J</span><span>JUTOPIA</span>
      </button>
    </header>
    <main class="practice-page club-main-page">
      <section class="practice-page-content">
        <div class="practice-page-heading">
          <h1>진행중인 연습</h1>
          <div class="view-toggle" aria-label="보기 방식">
            <a class="${activeView === "grid" ? "active" : ""}" href="#/practices?view=grid&page=${currentPage}" title="카드형"><span></span><span></span><span></span><span></span></a>
            <a class="${activeView === "list" ? "active" : ""}" href="#/practices?view=list&page=${currentPage}" title="리스트형"><i></i><i></i><i></i></a>
          </div>
        </div>
        ${
          activeView === "grid"
            ? `
              <div class="practice-list-grid">
                ${visiblePractices.map((practice) => practiceCardMarkup(practice)).join("")}
                <article class="practice-card add-practice-card">
                  <button type="button" aria-label="연습 추가">+</button>
                </article>
              </div>
            `
            : practiceListTableMarkup(visiblePractices)
        }
        <div class="practice-pagination-wrap">
          ${paginationMarkup(currentPage, totalPages, "연습 목록 페이지")}
        </div>
        ${activeView === "list" ? '<button class="new-practice-button" type="button">+ 새로운 연습 작성하기</button>' : ""}
        <form class="practice-search" role="search">
          <input aria-label="곡 제목 검색" placeholder="곡 제목을 검색해주세요" />
          <button type="submit">검색</button>
        </form>
      </section>

      ${clubSidebarMarkup({ user, membership, calendarItems, highlightedRoom: true })}
      <div id="modalRoot"></div>
    </main>
  `;

  document.querySelector("#backToClubHome").addEventListener("click", () => navigate("/dashboard"));
  document.querySelectorAll(".add-practice-card button, .new-practice-button").forEach((button) => {
    button.addEventListener("click", () => navigate("/create-practice"));
  });
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => renderPracticesPage(button.dataset.page, activeView));
  });
  document.querySelector(".practice-search").addEventListener("submit", (event) => {
    event.preventDefault();
  });
  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const notice = calendarItems.find((item) => item.id === button.dataset.noticeId);
      renderNoticeModal(notice);
    });
  });
}

function practiceListTableMarkup(practices) {
  return `
    <section class="practice-table" aria-label="진행중인 연습 게시글형 목록">
      <div class="practice-table-head">
        <strong>제목</strong>
        <strong>중주장</strong>
        <strong>D-DAY</strong>
        <strong>진행률</strong>
      </div>
      <div class="practice-table-body">
        ${practices.map((practice, index) => `
          <button class="practice-table-row" type="button">
            <span>
              ${practice.title}
              ${practice.roleTags?.length ? `<small class="practice-row-tags">${practice.roleTags.join(", ")}</small>` : ""}
            </span>
            <span>${practice.leader || (index % 2 === 0 ? "김성신" : "김한희")}</span>
            <time>${formatPracticeDate(practice.targetDate) || "2026.09.16"}</time>
            <strong>${practice.progress}%</strong>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function calendarMarkup() {
  const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const days = [
    { n: 26, muted: true },
    { n: 27, muted: true, event: "정기연습" },
    { n: 28, muted: true },
    { n: 29, muted: true },
    { n: 30, muted: true },
    { n: 31, muted: true },
    { n: "" },
    { n: 1 },
    { n: 2 },
    { n: 3, event: "정기연습" },
    { n: 4 },
    { n: 11, focus: true, event: "중간 점검" },
    { n: 5 },
    { n: 6 },
    { n: 7 },
    { n: 8 },
    { n: 9 },
    { n: 10, event: "정기연습" },
    { n: 12 },
    { n: 13 },
    { n: 14 },
    { n: 15 },
    { n: 16 },
    { n: 17, event: "정기연습" },
    { n: 18 },
    { n: 19 },
    { n: 20 },
    { n: 21 },
    { n: 22 },
  ];

  return `
    <section class="calendar" aria-label="2024년 9월 일정">
      <div class="weekdays">
        ${weekdays.map((day, index) => `<div class="weekday ${index > 4 ? "weekend" : ""}">${day}</div>`).join("")}
      </div>
      <div class="days">
        ${days.map((day) => `
          <div class="day ${day.muted ? "muted" : ""} ${day.focus ? "focus" : ""}">
            ${day.n}
            ${day.event ? `<div class="day-event"><span aria-hidden="true">♬</span><span>${day.event}</span></div>` : ""}
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

async function handleSignup(event) {
  event.preventDefault();
  const studentId = document.querySelector("#studentId").value.trim();
  if (!STUDENT_ID_PATTERN.test(studentId)) {
    setMessage("#signupMessage", "학번은 숫자 8자리로 입력해주세요.", "error");
    return;
  }
  const pendingSignup = {
    studentId,
    email: sungshinEmail(studentId),
    password: document.querySelector("#signupPassword").value,
    department: document.querySelector("#department").value.trim(),
    nickname: document.querySelector("#nickname").value.trim(),
    profileImageUrl: "",
    statusMessage: "",
  };

  try {
    const result = await apiRequest("/auth/send-code", {
      method: "POST",
      body: {
        studentId,
      },
    });
    setPendingSignup(pendingSignup);
    if (result.devCode) {
      pendingSignup.devCode = result.devCode;
      setPendingSignup(pendingSignup);
    }
    navigate("/verify-email");
  } catch (error) {
    setMessage("#signupMessage", error.message, "error");
  }
}

function updateStudentEmailPreview() {
  const studentId = document.querySelector("#studentId").value.trim();
  const preview = document.querySelector("#studentEmailPreview");
  if (!preview) return;
  preview.textContent = STUDENT_ID_PATTERN.test(studentId)
    ? `${sungshinEmail(studentId)} 로 인증 코드가 전송됩니다.`
    : "숫자 8자리 학번을 입력하면 성신 이메일이 자동 생성됩니다.";
}

function updateForgotEmailPreview() {
  const studentId = document.querySelector("#forgotStudentId").value.trim();
  const preview = document.querySelector("#forgotEmailPreview");
  if (!preview) return;
  preview.textContent = STUDENT_ID_PATTERN.test(studentId)
    ? `${sungshinEmail(studentId)} 로 안내가 전송됩니다.`
    : "숫자 8자리 학번을 입력하면 성신 이메일이 자동 생성됩니다.";
}

function handleForgotPassword(event) {
  event.preventDefault();
  const studentId = document.querySelector("#forgotStudentId").value.trim();
  if (!STUDENT_ID_PATTERN.test(studentId)) {
    setMessage("#forgotPasswordMessage", "학번은 숫자 8자리로 입력해주세요.", "error");
    return;
  }
  setMessage("#forgotPasswordMessage", `${sungshinEmail(studentId)} 로 비밀번호 재설정 안내를 보냈습니다.`, "success");
}

async function handleResendSignupCode() {
  const pending = getPendingSignup();
  if (!pending) {
    navigate("/signup");
    return;
  }

  try {
    const result = await apiRequest("/auth/send-code", {
      method: "POST",
      body: { studentId: pending.studentId },
    });
    if (result.devCode) {
      setPendingSignup({ ...pending, devCode: result.devCode });
    }
    setMessage(
      "#verificationMessage",
      result.devCode ? `인증 코드가 다시 생성되었습니다. 개발 코드: ${result.devCode}` : "인증 코드가 다시 발송되었습니다.",
      "success",
    );
  } catch (error) {
    setMessage("#verificationMessage", error.message, "error");
  }
}

async function handleVerifyEmailSignup(event) {
  event.preventDefault();
  const pending = getPendingSignup();
  if (!pending) {
    navigate("/signup");
    return;
  }
  const code = document.querySelector("#verificationCode").value.trim();

  try {
    await apiRequest("/auth/verify-code", {
      method: "POST",
      body: { studentId: pending.studentId, code },
    });
    const result = await apiRequest("/auth/signup", {
      method: "POST",
      body: pending,
    });
    clearPendingSignup();
    cacheAuthSession(result);
    navigate("/clubs");
  } catch (error) {
    setMessage("#verificationMessage", error.message, "error");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.querySelector("#loginEmail").value.trim();
  const password = document.querySelector("#loginPassword").value;

  try {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    cacheAuthSession(result);
    navigate("/clubs");
  } catch (error) {
    setMessage("#loginMessage", error.message, "error");
  }
}

function renderCreateClubModal() {
  document.querySelector("#modalRoot").innerHTML = `
    <div class="modal-backdrop">
      <form class="modal form" id="createClubForm">
        <h2>새 동아리 만들기</h2>
        <div class="field">
          <label for="clubName">동아리명</label>
          <input id="clubName" required />
        </div>
        <div class="field">
          <label for="clubDescription">소개</label>
          <textarea id="clubDescription" required></textarea>
        </div>
        <div class="auth-actions">
          <button class="ghost-btn" type="button" data-close-modal>취소</button>
          <button class="primary-btn" type="submit">생성</button>
        </div>
      </form>
    </div>
  `;
  document.querySelector("[data-close-modal]").addEventListener("click", closeModal);
  document.querySelector("#createClubForm").addEventListener("submit", handleCreateClub);
}

function renderJoinClubModal() {
  document.querySelector("#modalRoot").innerHTML = `
    <div class="modal-backdrop">
      <form class="modal form" id="joinClubForm">
        <h2>초대 코드 입력</h2>
        <div class="field">
          <label for="inviteCode">초대 코드</label>
          <input id="inviteCode" placeholder="예: JAM2024" required />
        </div>
        <p id="joinMessage" class="hint">가입 신청은 현재 데모에서 즉시 활성 멤버로 처리됩니다.</p>
        <div class="auth-actions">
          <button class="ghost-btn" type="button" data-close-modal>취소</button>
          <button class="primary-btn" type="submit">가입 신청</button>
        </div>
      </form>
    </div>
  `;
  document.querySelector("[data-close-modal]").addEventListener("click", closeModal);
  document.querySelector("#joinClubForm").addEventListener("submit", handleJoinClub);
}

function closeModal() {
  document.querySelector("#modalRoot").innerHTML = "";
}

function handleClubLogoChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    state.pendingClubLogo = String(reader.result || "");
    const upload = document.querySelector(".logo-upload");
    const label = document.querySelector("#logoUploadText");
    if (upload) upload.style.backgroundImage = `url('${state.pendingClubLogo}')`;
    if (label) label.textContent = "로고 업로드 완료";
  });
  reader.readAsDataURL(file);
}

function handleCreateClub(event) {
  event.preventDefault();
  const name = document.querySelector("#clubName").value.trim();
  const dday = document.querySelector("#clubDday")?.value || "";
  const tags = parseTags(document.querySelector("#clubTags")?.value || "");
  const roleTags = parseTags(document.querySelector("#roleTags")?.value || "");
  const colorSet = ["#2aa179", "#f6a6a1", "#6b3518", "#8f6bb8", "#2f6f9f"];
  const color = colorSet[storage.get("clubs", []).length % colorSet.length];
  const inviteCode = `JT${Math.floor(100000 + Math.random() * 900000)}`;

  if (!name) {
    setMessage("#createClubMessage", "동아리 이름을 입력해주세요.", "error");
    return;
  }

  const club = {
    id: crypto.randomUUID(),
    name,
    description: tags.length ? `${tags.join(", ")} 동아리` : "새롭게 생성된 동아리",
    profileImageUrl: state.pendingClubLogo,
    dday,
    tags,
    roleTags: roleTags.length ? roleTags : ["회장", "임원진", "부원"],
    color,
    inviteCode,
    createdBy: state.currentUserId,
    createdAt: new Date().toISOString(),
  };
  const membership = {
    id: crypto.randomUUID(),
    clubId: club.id,
    userId: state.currentUserId,
    generation: "1기",
    role: "PRESIDENT",
    status: "ACTIVE",
    joinedAt: new Date().toISOString(),
  };
  storage.set("clubs", [...storage.get("clubs", []), club]);
  storage.set("clubMembers", [...storage.get("clubMembers", []), membership]);
  state.currentClubId = club.id;
  state.lastCreatedClubId = club.id;
  localStorage.setItem("jutopia.currentClubId", club.id);
  localStorage.setItem("jutopia.lastCreatedClubId", club.id);
  navigate("/club-code");
}

function handleCreatePractice(event) {
  event.preventDefault();
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  const title = document.querySelector("#practiceName").value.trim();
  const ddayDate = document.querySelector("#practiceDday").value;
  const password = document.querySelector("#practicePassword").value.trim();
  const roleTags = parseTags(document.querySelector("#practiceRoleTags").value);
  const cover = "https://images.unsplash.com/photo-1465847899084-d164df4dedc6?auto=format&fit=crop&w=720&q=80";

  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }
  if (!title) {
    setMessage("#createPracticeMessage", "팀 이름을 입력해주세요.", "error");
    return;
  }
  if (!ddayDate) {
    setMessage("#createPracticeMessage", "D-DAY를 입력해주세요.", "error");
    return;
  }
  if (!password) {
    setMessage("#createPracticeMessage", "참여 비밀번호를 입력해주세요.", "error");
    return;
  }
  if (!roleTags.length) {
    setMessage("#createPracticeMessage", "역할 태그를 쉼표로 구분해서 입력해주세요.", "error");
    return;
  }

  const practice = {
    id: crypto.randomUUID(),
    clubId: membership.clubId,
    title,
    ddayDate,
    password,
    roleTags,
    progress: 0,
    color: "#6b3518",
    cover,
    day: practiceDayFromDate(ddayDate),
    members: roleTags.map((role) => `${role} 모집 중`),
    leader: displayName(user),
    createdAt: new Date().toISOString(),
  };

  storage.set("practices", [practice, ...storage.get("practices", [])]);
  navigate("/practices?view=grid&page=1");
}

function renderCreatedClubCodeModal(club) {
  state.lastCreatedClubId = club.id;
  localStorage.setItem("jutopia.lastCreatedClubId", club.id);
  navigate("/club-code");
}

function handleJoinClubCode(event) {
  event.preventDefault();
  const code = document.querySelector("#inviteCode").value.trim().toUpperCase();
  const club = storage.get("clubs", []).find((item) => item.inviteCode?.toUpperCase() === code) || ensureDemoInviteClub(code);
  if (!club) {
    setMessage("#joinMessage", "존재하지 않는 초대 코드입니다.", "error");
    return;
  }

  const members = storage.get("clubMembers", []);
  if (members.some((member) => member.clubId === club.id && member.userId === state.currentUserId)) {
    setCurrentClub(club.id);
    navigate("/dashboard");
    return;
  }

  state.pendingJoinClubId = club.id;
  localStorage.setItem("jutopia.pendingJoinClubId", club.id);
  navigate("/join-club-profile");
}

function handleJoinClubProfile(event) {
  event.preventDefault();
  const club = storage.get("clubs", []).find((item) => item.id === state.pendingJoinClubId);
  const name = document.querySelector("#clubMemberName").value.trim();
  const generation = document.querySelector("#clubGeneration").value.trim();
  const status = document.querySelector('input[name="clubStatus"]:checked')?.value || "ACTIVE";

  if (!club) {
    navigate("/join-club-code");
    return;
  }
  if (!name) {
    setMessage("#joinProfileMessage", "이름을 입력해주세요.", "error");
    return;
  }
  if (!generation) {
    setMessage("#joinProfileMessage", "기수를 입력해주세요.", "error");
    return;
  }

  const members = storage.get("clubMembers", []);
  if (members.some((member) => member.clubId === club.id && member.userId === state.currentUserId)) {
    setCurrentClub(club.id);
    navigate("/dashboard");
    return;
  }

  members.push({
    id: crypto.randomUUID(),
    clubId: club.id,
    userId: state.currentUserId,
    clubNickname: name,
    generation,
    role: "MEMBER",
    status,
    joinedAt: new Date().toISOString(),
  });
  storage.set("clubMembers", members);
  localStorage.removeItem("jutopia.pendingJoinClubId");
  state.pendingJoinClubId = null;
  setCurrentClub(club.id);
  navigate("/dashboard");
}

function handleJoinClub(event) {
  event.preventDefault();
  handleJoinClubCode(event);
}

function logout() {
  state.currentUserId = null;
  state.currentClubId = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem("jutopia.currentUserId");
  localStorage.removeItem("jutopia.currentClubId");
  navigate("/login");
}

function route() {
  const { path, params } = parseHashRoute();
  if (path === "/signup") renderSignup();
  else if (path === "/forgot-password") renderForgotPassword();
  else if (path === "/verify-email") renderEmailVerification();
  else if (path === "/clubs") renderClubSelect();
  else if (path === "/club-action") renderClubActionPage();
  else if (path === "/create-club") renderCreateClubPage();
  else if (path === "/join-club-code") renderJoinClubCodePage();
  else if (path === "/join-club-profile") renderJoinClubProfilePage();
  else if (path === "/create-practice") renderCreatePracticePage();
  else if (path === "/club-code") renderClubCodePage();
  else if (path === "/dashboard") renderDashboard();
  else if (path === "/club-settings") renderClubSettingsPage();
  else if (path === "/practices") renderPracticesPage(params.get("page") || 1, params.get("view") || "grid");
  else if (path === "/notices") renderNoticesPage(params.get("page") || 1);
  else if (path.startsWith("/notice/")) renderNoticePage(path.split("/")[2]);
  else renderLogin();
}

seedData();
window.addEventListener("hashchange", route);
route();
