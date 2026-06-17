const SCHOOL_EMAIL_PATTERN = /^[^\s@]+@(?:[a-z0-9-]+\.)?(?:ac\.kr|edu)$/i;
const VERIFICATION_MINUTES = 5;

const state = {
  currentUserId: localStorage.getItem("jutopia.currentUserId"),
  currentClubId: localStorage.getItem("jutopia.currentClubId"),
  pendingClubLogo: "",
  lastCreatedClubId: localStorage.getItem("jutopia.lastCreatedClubId"),
  pendingJoinClubId: localStorage.getItem("jutopia.pendingJoinClubId"),
  calendarYear: Number(localStorage.getItem("jutopia.calendarYear")) || 2025,
  calendarMonth: Number(localStorage.getItem("jutopia.calendarMonth")) || 8,
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("서버 응답이 지연되고 있습니다. DB와 서버 상태를 확인해주세요.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "서버 요청에 실패했습니다.");
    error.status = response.status;
    throw error;
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

function isApiUnavailable(error) {
  if (error?.status >= 500) return false;
  if ([404, 405, 501].includes(error?.status)) return true;
  const message = String(error?.message || error || "");
  return /Failed to fetch|NetworkError|Unexpected token|JSON|404|Not Found/i.test(message);
}

function localVerificationCode(studentId) {
  return String(studentId || "").slice(-6).padStart(6, "0");
}

function issueLocalVerification(studentId) {
  const email = sungshinEmail(studentId);
  const verifications = storage.get("emailVerifications", []);
  const verification = {
    id: crypto.randomUUID(),
    email,
    code: localVerificationCode(studentId),
    expiresAt: Date.now() + VERIFICATION_MINUTES * 60 * 1000,
    verifiedAt: null,
    createdAt: new Date().toISOString(),
    localOnly: true,
  };
  storage.set("emailVerifications", [verification, ...verifications]);
  return verification;
}

function verifyLocalSignupCode(pending, code) {
  const verifications = storage.get("emailVerifications", []);
  const index = verifications.findIndex((verification) => (
    verification.email === pending.email
    && verification.code === code
    && Number(verification.expiresAt) > Date.now()
  ));

  if (index < 0) {
    throw new Error("인증 코드가 올바르지 않거나 만료되었습니다.");
  }

  verifications[index] = {
    ...verifications[index],
    verifiedAt: new Date().toISOString(),
  };
  storage.set("emailVerifications", verifications);
}

function signupLocalUser(pending) {
  const users = storage.get("users", []);
  if (users.some((user) => user.email === pending.email)) {
    throw new Error("이미 가입된 학교 이메일입니다.");
  }

  const user = {
    id: crypto.randomUUID(),
    email: pending.email,
    passwordHash: pending.password,
    studentId: pending.studentId,
    department: pending.department,
    nickname: pending.nickname,
    profileImageUrl: "",
    statusMessage: "",
    createdAt: new Date().toISOString(),
  };

  return {
    token: `local-${user.id}-${Date.now()}`,
    user,
    clubs: [],
    memberships: [],
  };
}

function loginLocalUser(email, password) {
  const user = storage.get("users", []).find((item) => (
    item.email === email && item.passwordHash === password
  ));

  if (!user) {
    throw new Error("이메일 또는 비밀번호를 확인해주세요.");
  }

  return {
    token: `local-${user.id}-${Date.now()}`,
    user,
    clubs: getClubMemberships(user.id).map((membership) => membership.club),
    memberships: getClubMemberships(user.id).map(({ club, ...membership }) => membership),
  };
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
      contentMode: "demo",
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      name: "Jutopia Lab",
      description: "프로젝트, 스터디, 발표를 운영하는 학술 동아리",
      profileImageUrl: "",
      inviteCode: "LAB2024",
      contentMode: "demo",
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

const CLUB_ROLE_OPTIONS = ["PRESIDENT", "VICE_PRESIDENT", "STAFF", "DESIGNER", "MEMBER"];

const CLUB_PERMISSION_OPTIONS = [
  { key: "editClubSettings", label: "동아리 설정 편집" },
  { key: "writeNotice", label: "공지 작성" },
  { key: "deleteAnyPost", label: "모든 글 삭제" },
  { key: "approveApplications", label: "동아리 신청 수락" },
  { key: "changeHeaderImage", label: "동아리 헤더사진 변경" },
  { key: "createGroupMeeting", label: "그룹 모임 만들기" },
  { key: "expelMember", label: "동아리 추방" },
  { key: "deleteClub", label: "동아리 삭제" },
];

const DEFAULT_CLUB_ROLE_PERMISSIONS = {
  PRESIDENT: CLUB_PERMISSION_OPTIONS.map((permission) => permission.key),
  VICE_PRESIDENT: ["writeNotice", "approveApplications"],
  STAFF: ["writeNotice", "changeHeaderImage", "createGroupMeeting"],
  DESIGNER: ["writeNotice", "changeHeaderImage"],
  MEMBER: [],
};

function roleLabel(role) {
  return {
    PRESIDENT: "회장",
    VICE_PRESIDENT: "부회장",
    STAFF: "임원진",
    DESIGNER: "디자이너",
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

function hasClubPermission(user, membership, permissionKey) {
  if (isClubAdmin(user, membership)) return true;
  const permissions = getClubRolePermissions(membership?.clubId || "");
  return Boolean(permissions[membership?.role]?.includes(permissionKey));
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

function formatPartLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "파트";
  return /^\d+$/.test(text) ? `${text}파트` : text;
}

const CALENDAR_MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function setCalendarView(year, month) {
  const normalized = new Date(year, month, 1);
  state.calendarYear = normalized.getFullYear();
  state.calendarMonth = normalized.getMonth();
  localStorage.setItem("jutopia.calendarYear", String(state.calendarYear));
  localStorage.setItem("jutopia.calendarMonth", String(state.calendarMonth));
}

function parseCalendarDateParts(dateString) {
  if (!dateString) return null;
  const parsed = new Date(`${dateString}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth(),
    day: parsed.getDate(),
    dateString,
  };
}

function calendarItemDateParts(item) {
  const scheduledAt = item?.startDate || item?.scheduledAt || item?.date || item?.ddayDate;
  const parsed = parseCalendarDateParts(scheduledAt);
  if (parsed) {
    return parsed;
  }
  if (!item?.day) return null;
  return { year: 2025, month: 8, day: Number(item.day) };
}

function calendarItemOccurrences(items) {
  return items.flatMap((item) => {
    const seen = new Set();
    const occurrences = [];
    const pushDate = (dateString, role) => {
      const parts = parseCalendarDateParts(dateString);
      if (!parts) return;
      const key = `${parts.year}-${parts.month}-${parts.day}`;
      if (seen.has(key)) return;
      seen.add(key);
      occurrences.push({
        item: {
          ...item,
          day: parts.day,
          calendarRole: role,
          calendarDate: dateString,
        },
        parts,
      });
    };

    pushDate(item.startDate, "start");
    pushDate(item.endDate, "end");
    if (!occurrences.length) {
      const parts = calendarItemDateParts(item);
      if (parts) {
        occurrences.push({
          item: {
            ...item,
            day: parts.day,
            calendarRole: "single",
            calendarDate: parts.dateString || "",
          },
          parts,
        });
      }
    }
    return occurrences;
  });
}

function calendarItemFromButton(calendarItems, button) {
  const noticeId = button.dataset.noticeId;
  const calendarDate = button.dataset.calendarDate || "";
  const occurrences = calendarItemOccurrences(calendarItems).map((occurrence) => occurrence.item);
  return occurrences.find((item) => (
    item.id === noticeId && (!calendarDate || item.calendarDate === calendarDate)
  )) || calendarItems.find((item) => item.id === noticeId);
}

function calendarMonthDays(year, month) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const raw = index - firstDay + 1;
    if (raw < 1) return { day: previousMonthDays + raw, muted: true };
    if (raw > daysInMonth) return { day: raw - daysInMonth, muted: true };
    return { day: raw, muted: false };
  });
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

function hasDemoContent(membership) {
  const code = String(membership?.club?.inviteCode || "").toUpperCase();
  return Boolean(
    membership?.club?.contentMode === "demo" ||
    membership?.club?.createdBy === "demo-invite-owner" ||
    ["JAM2024", "LAB2024", "23A8QZ"].includes(code)
  );
}

function clubHomeHeaderText(club) {
  return club.homeHeaderText || club.name;
}

function clubPracticeSectionTitle(club) {
  return club.practiceSectionTitle || "그룹 모임";
}

function cssImageUrl(imageUrl) {
  return `url('${String(imageUrl).replace(/'/g, "\\'")}')`;
}

function clubBannerBackground(imageUrl) {
  if (!imageUrl) return "";
  return `linear-gradient(180deg,rgba(168,216,255,0.18),rgba(217,239,255,0.26)),${cssImageUrl(imageUrl)}`;
}

function saveCurrentClubBannerImage(imageUrl) {
  const clubId = state.currentClubId;
  const clubs = storage.get("clubs", []);
  const updatedClubs = clubs.map((club) => (
    club.id === clubId ? { ...club, bannerImageUrl: imageUrl } : club
  ));
  storage.set("clubs", updatedClubs);
}

function applyClubBannerPreview(imageUrl) {
  const banner = document.querySelector(".club-hero-banner");
  if (!banner) return;
  if (imageUrl) {
    banner.classList.add("has-custom-banner");
    banner.style.backgroundImage = clubBannerBackground(imageUrl);
  } else {
    banner.classList.remove("has-custom-banner");
    banner.style.backgroundImage = "";
  }
}

function handleClubBannerImageChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setMessage("#clubSettingsMessage", "이미지 파일만 업로드할 수 있습니다.", "error");
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const imageUrl = String(reader.result || "");
    saveCurrentClubBannerImage(imageUrl);
    applyClubBannerPreview(imageUrl);

    const uploadName = document.querySelector("#settingsBannerFileName");
    if (uploadName) uploadName.textContent = file.name;
    setMessage("#clubSettingsMessage", "헤더 사진이 저장되었습니다.", "success");
  });
  reader.readAsDataURL(file);
}

function saveCurrentClubLogoImage(imageUrl) {
  const clubId = state.currentClubId;
  const clubs = storage.get("clubs", []);
  const updatedClubs = clubs.map((club) => (
    club.id === clubId ? { ...club, profileImageUrl: imageUrl } : club
  ));
  storage.set("clubs", updatedClubs);
}

function applyClubLogoSettingsPreview(imageUrl, fileName = "") {
  const card = document.querySelector("#settingsLogoUploadCard");
  const uploadName = document.querySelector("#settingsLogoFileName");
  if (card) {
    card.classList.toggle("has-preview", Boolean(imageUrl));
    if (imageUrl) {
      card.style.setProperty("--upload-preview", cssImageUrl(imageUrl));
    } else {
      card.style.removeProperty("--upload-preview");
    }
  }
  if (uploadName) {
    uploadName.textContent = fileName || (imageUrl ? "현재 로고 사진이 저장되어 있어요." : "클릭해서 로고 사진을 골라주세요.");
  }
}

function handleClubLogoSettingsChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setMessage("#clubSettingsMessage", "이미지 파일만 업로드할 수 있습니다.", "error");
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const imageUrl = String(reader.result || "");
    saveCurrentClubLogoImage(imageUrl);
    applyClubLogoSettingsPreview(imageUrl, file.name);
    setMessage("#clubSettingsMessage", "동아리 로고 사진이 저장되었습니다.", "success");
  });
  reader.readAsDataURL(file);
}

function homeTeamsFor(memberships) {
  const membershipByClubId = new Map(memberships.map((member) => [member.clubId, member]));
  return storage.get("practices", [])
    .filter((practice) => membershipByClubId.has(practice.clubId))
    .map((practice, index) => {
      const member = membershipByClubId.get(practice.clubId);
      const baseColor = practice.color || clubCardVisual(member, index).color;
      return {
        id: practice.id,
        clubId: practice.clubId,
        clubName: member.club.name,
        name: practice.title || "그룹 모임",
        category: practice.roleTags?.length ? practice.roleTags.join(", ") : "GROUP",
        progress: calculatedPracticeProgress(practice),
        dday: practice.dday || ddayLabel(practice.ddayDate || practice.targetDate),
        color: baseColor,
      };
    });
}

function importantNotices(memberships) {
  const days = [9, 12, 13, 22];
  return memberships.flatMap((member, index) => {
    const noticeItems = clubNoticeItems(member);
    const calendarSources = noticeItems
      .filter((notice) => notice.isImportant || notice.startDate || notice.endDate || notice.scheduledAt || notice.day)
      .slice(0, 4);
    const sources = calendarSources.length ? calendarSources : [noticeItems[index % 2]].filter(Boolean);
    return sources.map((source, sourceIndex) => {
      const noticeId = source?.id || "dues";
      return {
      ...source,
      id: `${member.clubId}-calendar-${noticeId}-${sourceIndex}`,
      noticeId,
      clubId: member.clubId,
      clubName: member.club.name,
      title: source?.title || "정기연습 출석 안내",
      content: source?.content || "이번 주 정기연습 공지입니다.",
      day: source?.startDate || source?.endDate || source?.scheduledAt ? source.day : (source.day || days[(index + sourceIndex) % days.length]),
      color: clubCardVisual(member, index).color,
      kind: "notice",
      targetPath: `/notice/${noticeId}`,
    };
    });
  });
}

function clubPracticeItems() {
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
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
  const savedIds = new Set(savedItems.map((practice) => practice.id));
  const defaultItemsWithIds = defaultItems.map((practice, index) => ({
    ...practice,
    id: practice.id || `demo-practice-${index + 1}`,
    clubId: membership?.clubId || state.currentClubId || "",
    targetDate: practice.targetDate || "",
    roleTags: practice.roleTags?.length ? practice.roleTags.map(formatPartLabel) : practice.members.map((_, partIndex) => `${partIndex + 1}파트`),
    leader: practice.leader || practice.members[0] || "김한희",
    createdBy: practice.createdBy || "",
  })).filter((practice) => !savedIds.has(practice.id));

  if (!hasDemoContent(membership)) {
    return savedItems;
  }

  return [...savedItems, ...defaultItemsWithIds];
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

function clampPercent(value) {
  return Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
}

function practiceUsesScoreProgress(practice) {
  return Boolean(practice.scoreProgressEnabled || practice.measureProgressEnabled);
}

function measureNumberFromText(value) {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function practiceTotalMeasures(practice) {
  return Math.max(0, Math.round(Number(practice.totalMeasures || practice.scoreTotalMeasures || 0)));
}

function latestPracticeCompletedMeasures(practice, logs = practiceLogsFor(practice)) {
  const directValue = measureNumberFromText(practice.completedMeasures || practice.latestCompletedMeasures);
  if (directValue > 0) return directValue;
  const latestLog = logs.find((log) => measureNumberFromText(log.completedMeasures || log.completedProgress) > 0);
  return latestLog ? measureNumberFromText(latestLog.completedMeasures || latestLog.completedProgress) : 0;
}

function calculatedPracticeProgress(practice, logs) {
  if (practiceUsesScoreProgress(practice)) {
    const totalMeasures = practiceTotalMeasures(practice);
    if (!totalMeasures) return 0;
    return clampPercent((latestPracticeCompletedMeasures(practice, logs) / totalMeasures) * 100);
  }
  return clampPercent(practice.progress);
}

function normalizePracticeItem(practice, cover, brown) {
  const parsedRoleTags = Array.isArray(practice.roleTags) && practice.roleTags.length
    ? practice.roleTags
    : parseTags(practice.roleTags || "");
  const roleTags = parsedRoleTags.length
    ? parsedRoleTags.map(formatPartLabel)
    : (practice.members?.length ? practice.members.map((_, index) => `${index + 1}파트`) : ["1파트", "2파트", "3파트", "4파트"]);
  const leader = practice.leader || displayName(getCurrentUser());
  const members = practice.members?.length
    ? practice.members
    : roleTags.map((_, index) => index === 0 ? leader : "모집 중");
  return {
    id: practice.id || `practice-${practice.clubId || state.currentClubId || "club"}-${practice.createdAt || practice.ddayDate || practice.title || crypto.randomUUID()}`,
    clubId: practice.clubId || state.currentClubId || "",
    title: practice.title || "새 연습",
    dday: practice.dday || ddayLabel(practice.ddayDate),
    targetDate: practice.targetDate || practice.ddayDate || "",
    ddayDate: practice.ddayDate || practice.targetDate || "",
    progress: calculatedPracticeProgress(practice),
    color: practice.color || brown,
    cover: practice.cover || cover,
    day: practiceDayFromDate(practice.ddayDate),
    members,
    roleTags,
    password: practice.password || "",
    scoreProgressEnabled: practiceUsesScoreProgress(practice),
    totalMeasures: practiceTotalMeasures(practice),
    completedMeasures: latestPracticeCompletedMeasures(practice),
    leader,
    createdBy: practice.createdBy || "",
    createdAt: practice.createdAt || "",
  };
}

function practiceDetailRoute(practiceId) {
  return `/practice/${encodeURIComponent(practiceId)}`;
}

function findPracticeById(practiceId) {
  return clubPracticeItems().find((practice) => practice.id === practiceId);
}

function practiceParts(practice) {
  const roleTags = practice.roleTags?.length
    ? practice.roleTags
    : practice.members.map((_, index) => `${index + 1}파트`);
  return roleTags.map((partLabel, index) => {
    const part = formatPartLabel(partLabel);
    const fallbackName = index === 0 && practice.leader ? practice.leader : "모집 중";
    let rawName = practice.members?.[index] || fallbackName;
    if (rawName === `${part} 모집 중` || rawName === `${partLabel} 모집 중` || /^\d+\s*모집 중$/.test(rawName)) {
      rawName = "모집 중";
    }
    const name = rawName === "모집 중" && index === 0 && practice.leader ? practice.leader : rawName;
    return {
      part,
      name,
      isLeader: index === 0 && Boolean(practice.leader) && name === practice.leader,
    };
  });
}

function savePracticeParts(practice, parts) {
  const savedPractices = storage.get("practices", []);
  const updatedPractice = {
    ...practice,
    roleTags: parts.map((part) => formatPartLabel(part.part)),
    members: parts.map((part) => part.name || "모집 중"),
  };
  const existingIndex = savedPractices.findIndex((item) => item.id === practice.id);
  if (existingIndex >= 0) {
    savedPractices[existingIndex] = {
      ...savedPractices[existingIndex],
      roleTags: updatedPractice.roleTags,
      members: updatedPractice.members,
    };
    storage.set("practices", savedPractices);
    return updatedPractice;
  }

  storage.set("practices", [{
    ...updatedPractice,
    clubId: updatedPractice.clubId || state.currentClubId,
    createdAt: updatedPractice.createdAt || new Date().toISOString(),
  }, ...savedPractices]);
  return updatedPractice;
}

function savePracticeCoverImage(practice, imageUrl) {
  const savedPractices = storage.get("practices", []);
  const updatedPractice = {
    ...practice,
    cover: imageUrl,
  };
  const existingIndex = savedPractices.findIndex((item) => item.id === practice.id);
  if (existingIndex >= 0) {
    savedPractices[existingIndex] = {
      ...savedPractices[existingIndex],
      cover: imageUrl,
    };
    storage.set("practices", savedPractices);
    return updatedPractice;
  }

  storage.set("practices", [{
    ...updatedPractice,
    clubId: updatedPractice.clubId || state.currentClubId,
    createdAt: updatedPractice.createdAt || new Date().toISOString(),
  }, ...savedPractices]);
  return updatedPractice;
}

function savePracticeProgress(practice, progress, settings = {}) {
  const savedPractices = storage.get("practices", []);
  const safeProgress = Math.min(100, Math.max(0, Math.round(Number(progress) || 0)));
  const updatedPractice = {
    ...practice,
    progress: safeProgress,
    ...settings,
  };
  const existingIndex = savedPractices.findIndex((item) => item.id === practice.id);
  if (existingIndex >= 0) {
    savedPractices[existingIndex] = {
      ...savedPractices[existingIndex],
      progress: safeProgress,
      ...settings,
    };
    storage.set("practices", savedPractices);
    return updatedPractice;
  }

  storage.set("practices", [{
    ...updatedPractice,
    clubId: updatedPractice.clubId || state.currentClubId,
    createdAt: updatedPractice.createdAt || new Date().toISOString(),
  }, ...savedPractices]);
  return updatedPractice;
}

function handlePracticeCoverImageChange(event, practice) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    savePracticeCoverImage(practice, String(reader.result || ""));
    renderPracticeDetailPage(practice.id);
    setMessage("#practiceLogMessage", "대표사진이 변경되었습니다.", "success");
  });
  reader.readAsDataURL(file);
}

function practiceLogsFor(practice) {
  return storage.get("practiceLogs", [])
    .filter((log) => log.practiceId === practice.id && !String(log.id).includes("-demo-log-"))
    .sort((a, b) => new Date(b.createdAt || b.startAt || 0) - new Date(a.createdAt || a.startAt || 0));
}

function setPracticeLogChecked(practiceId, logId, checked) {
  const logs = storage.get("practiceLogs", []);
  const existingIndex = logs.findIndex((log) => log.id === logId && log.practiceId === practiceId);
  if (existingIndex >= 0) {
    logs[existingIndex] = { ...logs[existingIndex], checked };
    storage.set("practiceLogs", logs);
    return;
  }
  logs.push({
    id: logId,
    practiceId,
    title: "오늘 연습 기록",
    duration: "2시간",
    writtenAt: "2024.11.17",
    checked,
  });
  storage.set("practiceLogs", logs);
}

function practiceLogRoute(practiceId, logId) {
  return `/practice/${encodeURIComponent(practiceId)}/log/${encodeURIComponent(logId)}`;
}

function practiceLogCreateRoute(practiceId) {
  return `/practice/${encodeURIComponent(practiceId)}/logs/new`;
}

function findPracticeLogById(practice, logId) {
  return practiceLogsFor(practice).find((log) => log.id === logId);
}

function hourOptionsMarkup(selectedHour = 18) {
  return Array.from({ length: 24 }, (_, hour) => {
    const value = String(hour).padStart(2, "0");
    return `<option value="${value}" ${Number(selectedHour) === hour ? "selected" : ""}>${value}:00</option>`;
  }).join("");
}

function dateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function combineDateHour(dateValue, hourValue) {
  if (!dateValue) return null;
  const hour = String(hourValue || "00").padStart(2, "0");
  const date = new Date(`${dateValue}T${hour}:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatHour(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:00`;
}

function formatPracticeLogDate(log) {
  return formatNoticeWrittenAt(log.startAt || log.createdAt || log.writtenAt || new Date());
}

function formatPracticeLogTime(log) {
  const start = new Date(log.startAt || "2024-11-17T18:00:00");
  const end = new Date(log.endAt || "2024-11-17T20:00:00");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return log.duration || "";
  }
  const sameDay = dateInputValue(start) === dateInputValue(end);
  if (sameDay) return `${formatHour(start)}-${formatHour(end)}`;
  return `${formatNoticeWrittenAt(start)} ${formatHour(start)}-${formatNoticeWrittenAt(end)} ${formatHour(end)}`;
}

function practiceLogDuration(log) {
  if (log.duration) return log.duration;
  const start = new Date(log.startAt || "");
  const end = new Date(log.endAt || "");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return "2시간";
  const hours = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60)));
  return `${hours}시간`;
}

function practiceLogAttendanceState(log) {
  if (log.checked) {
    return { label: "출석 완료", className: "attended", canClick: true };
  }
  const now = new Date();
  const start = new Date(log.startAt || "2024-11-17T18:00:00");
  const end = new Date(log.endAt || "2024-11-17T20:00:00");
  if (Number.isFinite(start.getTime()) && now < start) {
    return { label: "시작 전", className: "before", canClick: true };
  }
  if (Number.isFinite(end.getTime()) && now > end) {
    return { label: "결석", className: "absent", canClick: false };
  }
  return { label: "출석하기", className: "ready", canClick: true };
}

function practiceLogPlannedMembers(practice, log) {
  const partMembers = practiceParts(practice)
    .map((part) => part.name)
    .filter((name) => name && name !== "모집 중");
  if (partMembers.length) return partMembers;
  return [`${Number(log.expectedParticipants || 0) || 1}명 예정`];
}

function practiceLogAttendees(log, user, membership) {
  const stored = Array.isArray(log.attendees) ? log.attendees : [];
  if (log.checked && user && !stored.some((attendee) => attendee.userId === user.id)) {
    return [...stored, { userId: user.id, name: clubMemberDisplayName(user, membership) }];
  }
  return stored;
}

function savePracticeLog(log) {
  const logs = storage.get("practiceLogs", []);
  const existingIndex = logs.findIndex((item) => item.id === log.id && item.practiceId === log.practiceId);
  if (existingIndex >= 0) {
    logs[existingIndex] = { ...logs[existingIndex], ...log };
  } else {
    logs.unshift(log);
  }
  storage.set("practiceLogs", logs);
  return log;
}

function addPracticeLog(practice, user, membership, payload) {
  const log = {
    id: `practice-log-${crypto.randomUUID()}`,
    practiceId: practice.id,
    clubId: membership.clubId,
    title: payload.title,
    startAt: payload.startAt,
    endAt: payload.endAt,
    location: payload.location,
    expectedParticipants: payload.expectedParticipants,
    previousProgress: payload.previousProgress,
    targetProgress: payload.targetProgress,
    completedProgress: payload.completedProgress,
    completedMeasures: payload.completedMeasures,
    totalMeasures: payload.totalMeasures,
    progressNote: payload.progressNote,
    memo: payload.memo,
    checked: false,
    attendees: [],
    duration: practiceLogDuration(payload),
    writtenAt: formatNoticeWrittenAt(),
    createdBy: user.id,
    createdAt: new Date().toISOString(),
  };
  return savePracticeLog(log);
}

function setPracticeLogAttendance(log, user, membership) {
  const attendees = Array.isArray(log.attendees) ? log.attendees : [];
  if (log.checked) {
    return savePracticeLog({
      ...log,
      checked: false,
      attendees: attendees.filter((attendee) => attendee.userId !== user.id),
    });
  }

  const next = {
    ...log,
    checked: true,
    attendees: attendees.some((attendee) => attendee.userId === user.id)
      ? attendees
      : [...attendees, { userId: user.id, name: clubMemberDisplayName(user, membership) }],
  };
  return savePracticeLog(next);
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

function pageCountFor(itemCount, pageSize) {
  return Math.max(1, Math.ceil(itemCount / pageSize));
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

function noticeReadMembers(membership, noticeId) {
  const reads = storage.get("noticeReads", [])
    .filter((item) => item.clubId === membership.clubId && item.noticeId === noticeId)
    .sort((a, b) => new Date(a.readAt).getTime() - new Date(b.readAt).getTime());
  const clubMembers = storage.get("clubMembers", []).filter((member) => member.clubId === membership.clubId);
  const users = storage.get("users", []);
  const seen = new Set();

  return reads
    .map((read) => {
      if (seen.has(read.userId)) return null;
      seen.add(read.userId);
      const member = clubMembers.find((item) => item.userId === read.userId);
      const user = users.find((item) => item.id === read.userId);
      return {
        id: read.userId,
        name: member?.clubNickname || displayName(user),
        readAt: read.readAt,
      };
    })
    .filter((item) => item && item.name);
}

function noticeReadMembersMarkup(readMembers) {
  return `
    <section class="notice-read-members">
      <div class="notice-read-members-header">
        <strong>확인한 인원</strong>
        <span>${readMembers.length}명</span>
      </div>
      ${
        readMembers.length
          ? `<ul>${readMembers.map((member) => `<li>${escapeHtml(member.name)}</li>`).join("")}</ul>`
          : '<p>아직 확인한 인원이 없습니다.</p>'
      }
    </section>
  `;
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

function formatNoticeWrittenAt(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function noticeVisibilityLabel(visibility) {
  return {
    ALL: "전체 공지",
    STAFF_ONLY: "임원진 전용",
    TEAM_ONLY: "팀 전용",
  }[visibility] || "전체 공지";
}

function noticeScheduleLabel(notice) {
  const startDate = notice?.startDate || notice?.scheduledAt || "";
  const endDate = notice?.endDate || "";
  const format = (dateString) => dateString ? dateString.replaceAll("-", ".") : "";
  if (startDate && endDate && startDate !== endDate) return `${format(startDate)} 시작 · ${format(endDate)} 마감`;
  if (startDate) return `${format(startDate)} 일정`;
  if (endDate) return `${format(endDate)} 마감`;
  return "";
}

function savedClubNotices(membership) {
  return storage.get("clubNotices", [])
    .filter((notice) => notice.clubId === membership.clubId)
    .map((notice) => ({
      ...notice,
      clubName: membership.club.name,
      checked: isNoticeRead(membership, notice.id),
      kind: "notice",
      noticeId: notice.id,
      targetPath: `/notice/${notice.id}`,
    }))
    .sort((a, b) => noticeDateValue(b) - noticeDateValue(a) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function addClubNotice(membership, user, payload) {
  const startDate = payload.startDate || payload.scheduledAt || "";
  const endDate = payload.endDate || "";
  const scheduledAt = startDate;
  const scheduledDate = startDate ? new Date(`${startDate}T00:00:00`) : null;
  const fallbackDate = endDate ? new Date(`${endDate}T00:00:00`) : null;
  const day = scheduledDate && Number.isFinite(scheduledDate.getTime())
    ? scheduledDate.getDate()
    : fallbackDate && Number.isFinite(fallbackDate.getTime())
      ? fallbackDate.getDate()
      : null;
  const notice = {
    id: `notice-${crypto.randomUUID()}`,
    clubId: membership.clubId,
    title: payload.title,
    listTitle: payload.title,
    author: clubMemberDisplayName(user, membership),
    writtenAt: formatNoticeWrittenAt(),
    content: payload.content,
    checked: false,
    visibility: payload.visibility || "ALL",
    isImportant: Boolean(payload.isImportant),
    scheduledAt,
    startDate,
    endDate,
    day,
    color: payload.isImportant ? (membership.club.color || "#6b3518") : "#9b7158",
    meta: payload.isImportant ? "중요 공지" : noticeScheduleLabel({ startDate, endDate, scheduledAt }) || noticeVisibilityLabel(payload.visibility),
    createdAt: new Date().toISOString(),
  };
  storage.set("clubNotices", [notice, ...storage.get("clubNotices", [])]);
  return {
    ...notice,
    clubName: membership.club.name,
    kind: "notice",
    noticeId: notice.id,
    targetPath: `/notice/${notice.id}`,
  };
}

function practiceCalendarItems(membership, practices) {
  const sectionTitle = clubPracticeSectionTitle(membership.club);
  return practices.map((practice, index) => ({
    id: `${membership.clubId}-practice-${index}`,
    clubId: membership.clubId,
    clubName: membership.club.name,
    title: `${practice.title} ${sectionTitle}`,
    content: `${practice.title} ${sectionTitle} 일정입니다. 현재 진행률은 ${calculatedPracticeProgress(practice)}%입니다.`,
    day: practice.day,
    ddayDate: practice.ddayDate,
    color: "#6b3518",
    meta: sectionTitle,
    kind: "practice",
    targetPath: practiceDetailRoute(practice.id),
  }));
}

function clubNoticeItems(membership) {
  const savedNotices = savedClubNotices(membership);
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

  if (!hasDemoContent(membership)) {
    return savedNotices;
  }

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
  const demoNotices = repeated.map((notice) => ({
    ...notice,
    checked: isNoticeRead(membership, notice.id),
    kind: "notice",
    noticeId: notice.id,
    targetPath: `/notice/${notice.id}`,
  }));
  return [...savedNotices, ...demoNotices];
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

function clubMemberDisplayName(user, membership) {
  return membership?.clubNickname || displayName(user);
}

function activeRoomCheckins(clubId) {
  return storage.get("roomCheckins", [])
    .filter((checkin) => checkin.clubId === clubId && checkin.isActive)
    .sort((a, b) => new Date(a.checkedInAt).getTime() - new Date(b.checkedInAt).getTime());
}

function isUserRoomCheckedIn(membership) {
  return activeRoomCheckins(membership.clubId).some((checkin) => checkin.userId === membership.userId);
}

function roomLogTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function saveRoomLog({ membership, user, action }) {
  const logs = storage.get("roomLogs", []);
  logs.push({
    id: crypto.randomUUID(),
    clubId: membership.clubId,
    userId: user.id,
    userName: clubMemberDisplayName(user, membership),
    action,
    createdAt: new Date().toISOString(),
  });
  storage.set("roomLogs", logs.slice(-80));
}

function toggleRoomCheckin(user, membership) {
  const checkins = storage.get("roomCheckins", []);
  const activeIndex = checkins.findIndex((checkin) => (
    checkin.clubId === membership.clubId &&
    checkin.userId === user.id &&
    checkin.isActive
  ));

  if (activeIndex >= 0) {
    checkins[activeIndex] = {
      ...checkins[activeIndex],
      isActive: false,
      checkedOutAt: new Date().toISOString(),
    };
    storage.set("roomCheckins", checkins);
    saveRoomLog({ membership, user, action: "DISCONNECT" });
    return;
  }

  checkins.push({
    id: crypto.randomUUID(),
    clubId: membership.clubId,
    userId: user.id,
    userName: clubMemberDisplayName(user, membership),
    checkedInAt: new Date().toISOString(),
    checkedOutAt: null,
    isActive: true,
  });
  storage.set("roomCheckins", checkins);
  saveRoomLog({ membership, user, action: "CONNECT" });
}

function removeLocalClubMembership(user, membership) {
  const clubId = membership.clubId;
  storage.set(
    "clubMembers",
    storage.get("clubMembers", []).filter((member) => !(member.clubId === clubId && member.userId === user.id))
  );
  storage.set(
    "roomCheckins",
    storage.get("roomCheckins", []).filter((checkin) => !(checkin.clubId === clubId && checkin.userId === user.id))
  );
  storage.set(
    "practices",
    storage.get("practices", []).filter((practice) => !(practice.clubId === clubId && practice.createdBy === user.id))
  );
  if (state.currentClubId === clubId) {
    state.currentClubId = null;
    localStorage.removeItem("jutopia.currentClubId");
  }
}

async function handleClubLeave(user, membership) {
  if (isClubAdmin(user, membership)) return;
  const confirmed = window.confirm(`${membership.club.name}에서 탈퇴할까요?\n탈퇴하면 이 동아리 화면과 모임 목록에서 더 이상 보이지 않습니다.`);
  if (!confirmed) return;

  try {
    await apiRequest("/clubs/leave", {
      method: "POST",
      body: { clubId: membership.clubId },
      auth: true,
    });
  } catch (error) {
    console.warn("[Jutopia] club leave API skipped:", error);
  }

  removeLocalClubMembership(user, membership);
  navigate("/clubs");
}

function renderRoomLogModal(membership) {
  const roomOpen = activeRoomCheckins(membership.clubId).length > 0;
  const logs = storage.get("roomLogs", [])
    .filter((log) => log.clubId === membership.clubId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 12);

  document.querySelector("#modalRoot").innerHTML = `
    <div class="modal-backdrop">
      <section class="room-log-modal">
        <div class="room-log-top">
          <span>${roomOpen ? "문이 열려 있어요" : "문이 쉬고 있어요"}</span>
          <strong>${roomOpen ? "동방 열림" : "동방 닫힘"}</strong>
        </div>
        <h2>동방 기록장</h2>
        <p class="room-log-copy">동방 접속 버튼과 접속 해제 버튼을 누른 기록이 여기에 차곡차곡 쌓입니다.</p>
        <div class="room-log-list">
          ${logs.length ? logs.map((log) => `
            <article class="room-log-item ${log.action === "CONNECT" ? "connect" : "disconnect"}">
              <span>${log.action === "CONNECT" ? "똑똑" : "쏙"}</span>
              <div>
                <strong>${escapeHtml(log.userName)}</strong>
                <p>${log.action === "CONNECT" ? "동방에 접속했어요." : "동방 접속을 해제했어요."}</p>
              </div>
              <time>${roomLogTime(log.createdAt)}</time>
            </article>
          `).join("") : '<div class="room-log-empty">아직 기록이 없어요. 첫 접속을 기다리는 중입니다.</div>'}
        </div>
        <div class="auth-actions">
          <button class="ghost-btn" type="button" data-close-modal>닫기</button>
        </div>
      </section>
    </div>
  `;
  document.querySelector("[data-close-modal]").addEventListener("click", closeModal);
}

function wireRoomControls(user, membership) {
  document.querySelectorAll("[data-room-connect]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleRoomCheckin(user, membership);
      route();
    });
  });
  document.querySelectorAll("[data-room-log]").forEach((button) => {
    button.addEventListener("click", () => renderRoomLogModal(membership));
  });
  document.querySelectorAll("[data-club-leave]").forEach((button) => {
    button.addEventListener("click", () => handleClubLeave(user, membership));
  });
}

function roomMembersMarkup({ roomMembers, highlighted = false, roomOpen = false, currentUserInRoom = false }) {
  return `
    <section class="room-report ${highlighted ? "highlighted" : ""}">
      <div class="side-heading">
        <h2>동아리방 인원보고</h2>
        <button class="room-status-button ${roomOpen ? "open" : ""}" type="button" data-room-log>
          ${roomOpen ? "동방 열림" : "동방 닫힘"}
        </button>
      </div>
      <ul>
        ${
          roomMembers.length
            ? roomMembers.map((member) => `<li>${escapeHtml(member)}</li>`).join("")
            : '<li class="room-empty">아직 동방에 접속한 멤버가 없습니다.</li>'
        }
      </ul>
      <button class="room-state-button ${currentUserInRoom ? "checked-in" : ""}" type="button" data-room-connect>
        ${currentUserInRoom ? "접속 해제" : "동방 접속"}
      </button>
    </section>
  `;
}

function clubSidebarMarkup({ user, membership, calendarItems, highlightedRoom = false, showLogout = false }) {
  const activeMembers = activeRoomCheckins(membership.clubId);
  const roomMembers = activeMembers.map((member) => member.userName);
  const roomOpen = activeMembers.length > 0;
  const currentUserInRoom = isUserRoomCheckedIn(membership);
  const canLeaveClub = !isClubAdmin(user, membership);
  return `
    <aside class="club-main-sidebar ${highlightedRoom ? "practice-sidebar" : ""}">
      <section class="current-club-card">
        <span>현재 동아리</span>
        <strong>${escapeHtml(membership.club.name)}</strong>
        <small>${roleLabel(membership.role)} · ${statusLabel(membership.status)}</small>
      </section>

      <section class="member-greeting">
        <span>${clubMemberDisplayName(user, membership)} 님, ${currentUserInRoom ? "동방 접속 중" : "접속 중"}</span>
        <i aria-label="접속 중"></i>
      </section>

      ${roomMembersMarkup({ roomMembers, highlighted: highlightedRoom, roomOpen, currentUserInRoom })}

      <section class="club-mini-calendar-wrap">
        <div class="aside-title compact-title">캘린더</div>
        ${miniCalendarMarkup(calendarItems)}
      </section>
      ${canLeaveClub ? '<button class="leave-club-button" type="button" data-club-leave>동아리 탈퇴</button>' : ""}
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
              <input id="loginEmail" type="email" autocomplete="email" required />
            </div>
            <div class="field">
              <label for="loginPassword">비밀번호</label>
              <input id="loginPassword" type="password" autocomplete="current-password" required />
            </div>
            <p id="loginMessage" class="hint"></p>
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

  document.querySelector("#signupForm").addEventListener("submit", handleSignup);
  document.querySelector('[data-route="/login"]').addEventListener("click", () => navigate("/login"));
}

function renderEmailVerification() {
  const pending = getPendingSignup();
  if (!pending) {
    navigate("/signup");
    return;
  }
  const verificationHint = pending.localOnly
    ? "프론트 단독 테스트에서는 학번 뒤 6자리 코드를 입력하면 인증됩니다."
    : "코드는 5분 동안 사용할 수 있습니다.";

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
            <p id="verificationMessage" class="hint">${verificationHint}</p>
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
  const totalPages = pageCountFor(itemCount, pageSize);
  const currentPage = clampPage(page, totalPages);

  document.querySelector("#app").innerHTML = `
    <header class="home-topbar">
      <div class="home-logo"><span>JUTOPIA</span></div>
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
        ${itemCount > pageSize ? paginationMarkup(currentPage, totalPages, `${activeTab === "clubs" ? "동아리" : "모임"} 페이지`) : ""}
      </section>
      <aside class="home-aside">
        <div class="home-greeting">
          <p>${displayName(user)} 님, 반갑습니다</p>
        </div>
        <div class="aside-title">캘린더</div>
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
    button.addEventListener("click", () => renderNoticeModal(calendarItemFromButton(notices, button)));
  });
  wireCalendarExpand(notices);
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
      ${visibleTeams.length === 0 ? '<div class="team-empty">아직 표시할 모임이 없습니다.</div>' : ""}
    </div>
  `;
}

function miniCalendarMarkup(notices, { expanded = false } = {}) {
  const viewYear = state.calendarYear;
  const viewMonth = state.calendarMonth;
  const noticesByDay = calendarItemOccurrences(notices).reduce((map, occurrence) => {
    const { item: notice, parts } = occurrence;
    if (!parts || parts.year !== viewYear || parts.month !== viewMonth) return map;
    const bucket = map.get(parts.day) || [];
    bucket.push(notice);
    map.set(parts.day, bucket);
    return map;
  }, new Map());
  const visibleDays = calendarMonthDays(viewYear, viewMonth).map((date) => ({
    ...date,
    dayNotices: date.muted ? [] : noticesByDay.get(date.day) || [],
  }));
  const yearOptions = Array.from({ length: 5 }, (_, index) => viewYear - 2 + index);

  return `
    <section class="mini-calendar ${expanded ? "expanded-calendar" : ""}" aria-label="중요 공지 캘린더">
      ${expanded ? "" : '<button class="calendar-expand-button" type="button" data-calendar-expand aria-label="캘린더 크게 보기">+</button>'}
      <div class="mini-calendar-toolbar">
        <button type="button" data-calendar-prev aria-label="이전 달">‹</button>
        <select aria-label="월" data-calendar-month>
          ${CALENDAR_MONTH_LABELS.map((label, index) => `<option value="${index}" ${index === viewMonth ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <select aria-label="연도" data-calendar-year>
          ${yearOptions.map((year) => `<option value="${year}" ${year === viewYear ? "selected" : ""}>${year}</option>`).join("")}
        </select>
        <button type="button" data-calendar-next aria-label="다음 달">›</button>
      </div>
      <div class="mini-weekdays">
        ${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => `<span>${day}</span>`).join("")}
      </div>
      <div class="mini-days">
        ${visibleDays.map(({ day, muted, dayNotices }) => {
          const notice = dayNotices[0];
          if (!notice) return `<span class="${muted ? "muted" : ""}">${day}</span>`;
          const visibleColors = dayNotices.slice(0, 4);
          const clusterClass = `count-${Math.min(visibleColors.length, 4)}`;
          const title = dayNotices.map((item) => `${item.clubName} - ${item.title}`).join("\n");
          return `
            <button class="${dayNotices.length > 1 ? "multi-event-day" : ""}" type="button" data-notice-id="${notice.id}" data-calendar-date="${escapeHtml(notice.calendarDate || "")}" title="${escapeHtml(title)}" style="--event-color:${notice.color || "#6b3518"}">
              <span class="calendar-day-number">${day}</span>
              ${dayNotices.length > 1 ? `
                <span class="calendar-event-stack ${clusterClass}" aria-hidden="true">
                  ${visibleColors.map((item) => `<i style="--dot-color:${item.color || "#6b3518"}"></i>`).join("")}
                </span>
              ` : ""}
              ${expanded && dayNotices.length > 1 ? `<small>+${dayNotices.length - 1}</small>` : ""}
            </button>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderCalendarModal(calendarItems) {
  const viewYear = state.calendarYear;
  const viewMonth = state.calendarMonth;
  const agendaItems = calendarItemOccurrences(calendarItems)
    .filter(({ parts }) => parts && parts.year === viewYear && parts.month === viewMonth)
    .sort((a, b) => a.parts.day - b.parts.day || String(a.item.title).localeCompare(String(b.item.title), "ko"))
    .slice(0, 8);

  document.querySelector("#modalRoot").innerHTML = `
    <div class="modal-backdrop">
      <section class="calendar-modal">
        <header class="calendar-modal-header">
          <div>
            <span>Jutopia Calendar</span>
            <h2>${viewYear}년 ${viewMonth + 1}월</h2>
          </div>
          <button type="button" data-close-modal aria-label="캘린더 닫기">×</button>
        </header>
        ${miniCalendarMarkup(calendarItems, { expanded: true })}
        <section class="calendar-agenda" aria-label="캘린더 일정 목록">
          <h3>이달의 표시된 일정</h3>
          ${
            agendaItems.length
              ? agendaItems.map(({ item, parts }) => `
                <button type="button" data-notice-id="${item.id}" data-calendar-date="${escapeHtml(item.calendarDate || "")}" style="--event-color:${item.color || "#6b3518"}">
                  <i></i>
                  <span>${parts.day}일</span>
                  <strong>${escapeHtml(item.title)}</strong>
                  <small>${escapeHtml([item.clubName || item.meta || "", item.calendarRole === "start" ? "시작" : item.calendarRole === "end" ? "마감" : ""].filter(Boolean).join(" · "))}</small>
                </button>
              `).join("")
              : '<p>아직 캘린더에 표시된 일정이 없습니다.</p>'
          }
        </section>
      </section>
    </div>
  `;

  const modalRoot = document.querySelector("#modalRoot");
  modalRoot.querySelector("[data-close-modal]").addEventListener("click", closeModal);
  modalRoot.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = calendarItemFromButton(calendarItems, button);
      renderNoticeModal(item);
    });
  });
  wireCalendarExpand(calendarItems);
}

function wireCalendarExpand(calendarItems) {
  document.querySelectorAll("[data-calendar-expand]").forEach((button) => {
    button.addEventListener("click", () => renderCalendarModal(calendarItems));
  });
  const rerenderCalendar = (expanded) => {
    if (expanded) {
      renderCalendarModal(calendarItems);
      return;
    }
    route();
  };
  document.querySelectorAll("[data-calendar-prev]").forEach((button) => {
    button.addEventListener("click", () => {
      const expanded = Boolean(button.closest(".expanded-calendar"));
      setCalendarView(state.calendarYear, state.calendarMonth - 1);
      rerenderCalendar(expanded);
    });
  });
  document.querySelectorAll("[data-calendar-next]").forEach((button) => {
    button.addEventListener("click", () => {
      const expanded = Boolean(button.closest(".expanded-calendar"));
      setCalendarView(state.calendarYear, state.calendarMonth + 1);
      rerenderCalendar(expanded);
    });
  });
  document.querySelectorAll("[data-calendar-month]").forEach((select) => {
    select.addEventListener("change", () => {
      const expanded = Boolean(select.closest(".expanded-calendar"));
      setCalendarView(state.calendarYear, Number(select.value));
      rerenderCalendar(expanded);
    });
  });
  document.querySelectorAll("[data-calendar-year]").forEach((select) => {
    select.addEventListener("change", () => {
      const expanded = Boolean(select.closest(".expanded-calendar"));
      setCalendarView(Number(select.value), state.calendarMonth);
      rerenderCalendar(expanded);
    });
  });
}

function renderNoticeModal(notice) {
  if (!notice) return;
  const meta = notice.meta || "중요 공지";
  const dateLabel = notice.calendarDate
    ? notice.calendarDate.replaceAll("-", ".")
    : `2025년 9월 ${notice.day}일`;
  document.querySelector("#modalRoot").innerHTML = `
    <div class="modal-backdrop">
      <section class="notice-modal">
        <span class="notice-chip" style="background:${notice.color}">${escapeHtml(notice.clubName)}</span>
        <h2>${escapeHtml(notice.title)}</h2>
        <p>${escapeHtml(notice.content)}</p>
        <div class="notice-meta">${escapeHtml(dateLabel)} · ${escapeHtml(meta)}</div>
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
          <input id="clubName" placeholder="동아리명을 입력해주세요" required />
        </div>
        <div class="create-field">
          <label for="clubDday">동아리 개설일</label>
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
    contentMode: "demo",
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
          <input id="practicePassword" placeholder="번호 입력" required />
        </div>
        <div class="create-field">
          <label for="practiceRoleTags">역할 태그 (쉼표로 입력)</label>
          <input id="practiceRoleTags" placeholder="1파트, 2파트, 3파트, 4파트" required />
        </div>
        <label class="practice-score-toggle">
          <input id="practiceScoreProgressEnabled" type="checkbox" />
          <span>악보 기준 진행률 표시</span>
        </label>
        <div class="create-field hidden" id="practiceTotalMeasuresField">
          <label for="practiceTotalMeasures">총 악보 마디 수</label>
          <input id="practiceTotalMeasures" type="number" min="1" step="1" placeholder="예: 120" />
        </div>
        <p id="createPracticeMessage" class="hint"></p>
        <button class="create-submit" type="submit">연습 생성하기</button>
      </form>
    </main>
    <div id="modalRoot"></div>
  `;

  document.querySelector("#backToPracticeButton").addEventListener("click", () => navigate("/practices"));
  document.querySelector("#practiceScoreProgressEnabled").addEventListener("change", (event) => {
    const totalField = document.querySelector("#practiceTotalMeasuresField");
    const totalInput = document.querySelector("#practiceTotalMeasures");
    totalField.classList.toggle("hidden", !event.currentTarget.checked);
    totalInput.required = event.currentTarget.checked;
  });
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
        <p id="clubCodeMessage" class="hint"></p>
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
  const practiceSectionTitle = clubPracticeSectionTitle(membership.club);
  const heroStyles = [
    `--club-accent:${clubVisual.color}`,
    membership.club.bannerImageUrl ? `background-image:${clubBannerBackground(membership.club.bannerImageUrl)}` : "",
  ].filter(Boolean).join(";");

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToClubHome">
        <span>JUTOPIA</span>
      </button>
      ${admin ? '<button class="settings-link" type="button" id="clubSettingsButton">설정 &gt;</button>' : '<span class="settings-placeholder" aria-hidden="true"></span>'}
    </header>
    <main class="club-main-page">
      <section class="club-main-content">
        <div class="club-hero-banner ${membership.club.bannerImageUrl ? "has-custom-banner" : ""}" style="${heroStyles}">
          <div class="cloud cloud-one"></div>
          <div class="cloud cloud-two"></div>
          <div class="cloud cloud-three"></div>
        </div>

        <h1 class="club-dashboard-title">${escapeHtml(membership.club.name)}</h1>

        <section class="club-section notice-section">
          <div class="section-heading">
            <h1>공지사항</h1>
            <a href="#/notices">더보기 &gt;</a>
          </div>
          <div class="notice-list">
            ${notices.length ? notices.map((notice) => `
              <label class="notice-check-row">
                <input type="checkbox" data-notice-check="${notice.id}" ${notice.checked ? "checked" : ""} />
                <a href="#/notice/${notice.id}">${escapeHtml(notice.listTitle)}</a>
              </label>
            `).join("") : '<div class="section-empty">아직 등록된 공지사항이 없습니다.</div>'}
          </div>
        </section>

        <section class="club-section practice-section">
          <div class="section-heading">
            <h1>${escapeHtml(practiceSectionTitle)}</h1>
            <a href="#/practices" id="openPracticesButton">더보기 &gt;</a>
          </div>
          <div class="practice-card-grid">
            ${practices.map((practice) => practiceCardMarkup(practice)).join("")}
            ${practices.length ? "" : `<div class="section-empty practice-empty">${escapeHtml(practiceSectionTitle)}이 아직 없습니다.</div>`}
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
  wirePracticeNavigation();
  document.querySelectorAll("[data-notice-check]").forEach((input) => {
    input.addEventListener("change", (event) => {
      setNoticeRead(membership, event.currentTarget.dataset.noticeCheck, event.currentTarget.checked);
    });
  });
  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const notice = calendarItemFromButton(clubCalendarItems, button);
      renderNoticeModal(notice);
    });
  });
  wireCalendarExpand(clubCalendarItems);
  wireRoomControls(user, membership);
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

function defaultClubRolePermissions() {
  return Object.fromEntries(
    CLUB_ROLE_OPTIONS.map((role) => [role, [...(DEFAULT_CLUB_ROLE_PERMISSIONS[role] || [])]])
  );
}

function getClubRolePermissions(clubId) {
  const saved = storage.get("clubRolePermissions", {});
  return {
    ...defaultClubRolePermissions(),
    ...(saved[clubId] || {}),
  };
}

function setClubRolePermissions(clubId, permissions) {
  const saved = storage.get("clubRolePermissions", {});
  storage.set("clubRolePermissions", {
    ...saved,
    [clubId]: permissions,
  });
}

function rolePermissionSummary(rolePermissions) {
  const count = rolePermissions.length;
  if (count === 0) return "조회 중심";
  if (count === CLUB_PERMISSION_OPTIONS.length) return "전체 권한";
  return `${count}개 권한`;
}

function rolePermissionSettingsMarkup(clubId) {
  const permissions = getClubRolePermissions(clubId);
  return CLUB_ROLE_OPTIONS.map((role) => {
    const rolePermissions = permissions[role] || [];
    return `
      <article class="permission-row">
        <div class="permission-role">
          <strong>${roleLabel(role)}</strong>
          <small>${rolePermissionSummary(rolePermissions)}</small>
        </div>
        <div class="permission-checks">
          ${CLUB_PERMISSION_OPTIONS.map((permission) => `
            <label class="permission-chip ${rolePermissions.includes(permission.key) ? "active" : ""}">
              <input
                type="checkbox"
                data-permission-role="${role}"
                data-permission-key="${permission.key}"
                ${rolePermissions.includes(permission.key) ? "checked" : ""}
              />
              <span>${permission.label}</span>
            </label>
          `).join("")}
        </div>
      </article>
    `;
  }).join("");
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
        <span>JUTOPIA</span>
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
              <span>모임 섹션 문구</span>
              <input id="settingsPracticeSectionTitle" value="${escapeHtml(clubPracticeSectionTitle(club))}" placeholder="그룹 모임" required />
            </label>
            <label class="create-field">
              <span>대표 색상</span>
              <input id="settingsClubColor" type="color" value="${club.color || activeClubVisual(membership).color}" />
            </label>
            <label class="create-field settings-upload-field" for="settingsLogoFile">
              <span>동아리 로고 사진 업로드</span>
              <div class="settings-upload-card logo-preview" id="settingsLogoUploadCard">
                <strong>로고 사진 고르기</strong>
                <small id="settingsLogoFileName">${club.profileImageUrl ? "현재 로고 사진이 저장되어 있어요." : "클릭해서 로고 사진을 골라주세요."}</small>
              </div>
              <input id="settingsLogoFile" type="file" accept="image/*" />
            </label>
            <label class="create-field settings-upload-field" for="settingsBannerFile">
              <span>헤더 사진 업로드</span>
              <div class="settings-upload-card">
                <strong>사진 톡 올리기</strong>
                <small id="settingsBannerFileName">${club.bannerImageUrl ? "현재 헤더 사진이 저장되어 있어요." : "클릭해서 헤더 사진을 골라주세요."}</small>
              </div>
              <input id="settingsBannerFile" type="file" accept="image/*" />
            </label>
            <button class="create-submit settings-submit" type="submit">홈 헤더 저장하기</button>
          </div>
          <p id="clubSettingsMessage" class="hint"></p>
        </form>

        <section class="role-manager">
          <div class="role-manager-heading">
            <div>
              <h2>회원 역할 설정</h2>
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
                  ${CLUB_ROLE_OPTIONS.map((role) => `
                    <option value="${role}" ${row.role === role ? "selected" : ""}>${roleLabel(role)}</option>
                  `).join("")}
                </select>
              </div>
            `).join("")}
          </div>
          <p id="roleSettingsMessage" class="hint"></p>
        </section>

        <section class="permission-manager">
          <div class="role-manager-heading">
            <div>
              <h2>역할별 권한 설정</h2>
              <p>역할 태그마다 접근 가능한 기능을 다르게 설정합니다.</p>
            </div>
            <button class="secondary-btn" type="button" id="saveRolePermissionsButton">권한 저장</button>
          </div>
          <div class="permission-grid">
            ${rolePermissionSettingsMarkup(membership.clubId)}
          </div>
          <p id="permissionSettingsMessage" class="hint"></p>
        </section>
      </section>
    </main>
  `;

  document.querySelector("#backToDashboardButton").addEventListener("click", () => navigate("/dashboard"));
  applyClubLogoSettingsPreview(club.profileImageUrl);
  document.querySelector("#settingsLogoFile").addEventListener("change", handleClubLogoSettingsChange);
  document.querySelector("#settingsBannerFile").addEventListener("change", handleClubBannerImageChange);
  document.querySelector("#clubHomeSettingsForm").addEventListener("submit", handleClubHomeSettingsSave);
  document.querySelector("#saveRoleAssignmentsButton").addEventListener("click", handleRoleAssignmentsSave);
  document.querySelector("#saveRolePermissionsButton").addEventListener("click", handleRolePermissionsSave);
  document.querySelectorAll("[data-permission-key]").forEach((input) => {
    input.addEventListener("change", (event) => {
      event.currentTarget.closest(".permission-chip")?.classList.toggle("active", event.currentTarget.checked);
    });
  });
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
      practiceSectionTitle: document.querySelector("#settingsPracticeSectionTitle").value.trim() || "그룹 모임",
      color: document.querySelector("#settingsClubColor").value,
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

function handleRolePermissionsSave() {
  const clubId = state.currentClubId;
  const nextPermissions = Object.fromEntries(CLUB_ROLE_OPTIONS.map((role) => [role, []]));

  document.querySelectorAll("[data-permission-role]").forEach((input) => {
    if (!input.checked) return;
    const role = input.dataset.permissionRole;
    const permissionKey = input.dataset.permissionKey;
    if (!nextPermissions[role]) nextPermissions[role] = [];
    nextPermissions[role].push(permissionKey);
  });

  setClubRolePermissions(clubId, nextPermissions);
  setMessage("#permissionSettingsMessage", "역할별 권한이 저장되었습니다.", "success");
}

function practiceCardMarkup(practice) {
  return `
    <article class="practice-card practice-card-link" role="button" tabindex="0" data-practice-id="${escapeHtml(practice.id)}" aria-label="${escapeHtml(practice.title)} 연습일지 보기">
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
  if (!notices.length) {
    renderNoticesPage();
    return;
  }
  const currentIndex = Math.max(0, notices.findIndex((notice) => notice.id === noticeId));
  const notice = notices[currentIndex] || notices[0];
  const previous = notices[(currentIndex - 1 + notices.length) % notices.length];
  const next = notices[(currentIndex + 1) % notices.length];
  const noticeRead = isNoticeRead(membership, notice.id);
  const comments = getNoticeComments(membership, notice.id);
  const readMembers = noticeReadMembers(membership, notice.id);
  const calendarItems = [...notices, ...practiceCalendarItems(membership, clubPracticeItems().slice(0, 4))];

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToClubHome">
        <span>JUTOPIA</span>
      </button>
    </header>
    <main class="notice-page club-main-page">
      <section class="notice-page-content">
        <h1><a href="#/notices">공지사항</a></h1>
        <article class="notice-detail">
          <header class="notice-detail-header">
            <h2>${escapeHtml(notice.title)}</h2>
            <button
              class="confirm-read-button ${noticeRead ? "confirmed" : ""}"
              type="button"
              id="confirmNoticeButton"
              aria-pressed="${noticeRead ? "true" : "false"}"
            >${noticeRead ? "확인됨" : "미확인"}</button>
          </header>
          <section class="notice-detail-body">
            <div class="notice-author-line">작성자 : ${escapeHtml(notice.author)}</div>
            <div class="notice-author-line">작성일 : ${escapeHtml(notice.writtenAt)}</div>
            ${noticeScheduleLabel(notice) ? `<div class="notice-author-line">일정 : ${escapeHtml(noticeScheduleLabel(notice))}</div>` : ""}
            <p>${escapeHtml(notice.content).replace(/\n/g, "<br />")}</p>
          </section>
          <section class="notice-comments">
            ${noticeCommentsMarkup(comments, user)}
          </section>
          ${noticeReadMembersMarkup(readMembers)}
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
    renderNoticePage(notice.id);
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
      const target = calendarItemFromButton(calendarItems, button);
      if (target?.id && notices.some((noticeItem) => noticeItem.id === target.id)) {
        navigate(`/notice/${target.id}`);
      } else {
        renderNoticeModal(target);
      }
    });
  });
  wireCalendarExpand(calendarItems);
  wireRoomControls(user, membership);
}

function renderNoticeCreatePage() {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }
  if (!hasClubPermission(user, membership, "writeNotice")) {
    navigate("/notices");
    return;
  }

  const calendarItems = [...clubNoticeItems(membership).slice(0, 2), ...practiceCalendarItems(membership, clubPracticeItems().slice(0, 4))];

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToClubHome">
        <span>JUTOPIA</span>
      </button>
    </header>
    <main class="notices-page notice-page club-main-page">
      <section class="notice-page-content">
        <div class="notice-page-toolbar">
          <h1><a href="#/notices">공지사항</a></h1>
        </div>
        <form class="notice-create-form" id="noticeCreateForm">
          <div class="notice-create-head">
            <span>새 공지</span>
            <strong>${escapeHtml(membership.club.name)}</strong>
          </div>
          <label>
            <span>제목</span>
            <input id="noticeTitleInput" placeholder="공지 제목을 입력해주세요" required />
          </label>
          <label>
            <span>내용</span>
            <textarea id="noticeContentInput" placeholder="공지 내용을 입력해주세요" required></textarea>
          </label>
          <div class="notice-create-grid">
            <label>
              <span>시작일</span>
              <input id="noticeStartDateInput" type="date" />
            </label>
            <label>
              <span>마감일</span>
              <input id="noticeEndDateInput" type="date" />
            </label>
          </div>
          <label class="notice-important-toggle">
            <input id="noticeImportantInput" type="checkbox" />
            <span>중요 공지로 표시</span>
          </label>
          <p id="noticeCreateMessage" class="hint">시작일과 마감일을 선택하면 오른쪽 캘린더에 모두 표시됩니다.</p>
          <div class="notice-create-actions">
            <button class="ghost-btn" type="button" id="cancelNoticeCreate">취소</button>
            <button class="primary-btn" type="submit">공지 등록하기</button>
          </div>
        </form>
      </section>
      ${clubSidebarMarkup({ user, membership, calendarItems, highlightedRoom: true })}
      <div id="modalRoot"></div>
    </main>
  `;

  document.querySelector("#backToClubHome").addEventListener("click", () => navigate("/dashboard"));
  document.querySelector("#cancelNoticeCreate").addEventListener("click", () => navigate("/notices"));
  document.querySelector("#noticeCreateForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = document.querySelector("#noticeTitleInput").value.trim();
    const content = document.querySelector("#noticeContentInput").value.trim();
    if (!title || !content) {
      setMessage("#noticeCreateMessage", "제목과 내용을 모두 입력해주세요.", "error");
      return;
    }
    const startDate = document.querySelector("#noticeStartDateInput").value;
    const endDate = document.querySelector("#noticeEndDateInput").value;
    if (startDate && endDate && new Date(`${endDate}T00:00:00`) < new Date(`${startDate}T00:00:00`)) {
      setMessage("#noticeCreateMessage", "마감일은 시작일보다 빠를 수 없습니다.", "error");
      return;
    }
    const notice = addClubNotice(membership, user, {
      title,
      content,
      startDate,
      endDate,
      isImportant: document.querySelector("#noticeImportantInput").checked,
    });
    navigate(`/notice/${notice.id}`);
  });
  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = calendarItemFromButton(calendarItems, button);
      if (target?.id && clubNoticeItems(membership).some((noticeItem) => noticeItem.id === target.id)) {
        navigate(`/notice/${target.id}`);
      } else {
        renderNoticeModal(target);
      }
    });
  });
  wireCalendarExpand(calendarItems);
  wireRoomControls(user, membership);
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
  const totalPages = pageCountFor(notices.length, pageSize);
  const currentPage = clampPage(page, totalPages);
  const visibleNotices = pageSlice(notices, currentPage, pageSize);
  const calendarItems = [...clubNoticeItems(membership).slice(0, 2), ...practiceCalendarItems(membership, clubPracticeItems().slice(0, 4))];
  const canWriteNotice = hasClubPermission(user, membership, "writeNotice");

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToClubHome">
        <span>JUTOPIA</span>
      </button>
    </header>
    <main class="notices-page notice-page club-main-page">
      <section class="notices-page-content notice-page-content">
        <div class="notice-page-toolbar">
          <h1>공지사항</h1>
          ${canWriteNotice ? '<button class="notice-write-button" type="button" id="writeNoticeButton">공지 작성하기</button>' : ""}
        </div>
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
            ${visibleNotices.length ? visibleNotices.map((notice) => `
              <div class="notice-table-row">
                <input type="checkbox" data-notice-check="${notice.id}" aria-label="${escapeHtml(notice.listTitle)} 확인" ${notice.checked ? "checked" : ""} />
                <a href="#/notice/${notice.id}">${escapeHtml(notice.listTitle)}</a>
                <span>${escapeHtml(notice.author)}</span>
                <time>${escapeHtml(notice.writtenAt)}</time>
              </div>
            `).join("") : '<div class="section-empty notice-empty-row">아직 등록된 공지사항이 없습니다.</div>'}
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
  if (canWriteNotice) {
    document.querySelector("#writeNoticeButton").addEventListener("click", () => navigate("/notices/new"));
  }
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
      const target = calendarItemFromButton(calendarItems, button);
      if (target?.id && notices.some((noticeItem) => noticeItem.id === target.id)) {
        navigate(`/notice/${target.id}`);
      } else {
        renderNoticeModal(target);
      }
    });
  });
  wireCalendarExpand(calendarItems);
  wireRoomControls(user, membership);
}

function renderPracticesPage(page = 1, view = "grid") {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }

  const activeView = view === "list" ? "list" : "grid";
  const practiceSectionTitle = clubPracticeSectionTitle(membership.club);
  const practices = clubPracticeItems();
  const pageSize = 6;
  const totalPages = pageCountFor(practices.length, pageSize);
  const currentPage = clampPage(page, totalPages);
  const visiblePractices = pageSlice(practices, currentPage, pageSize);
  const calendarItems = [
    ...clubNoticeItems(membership),
    ...practiceCalendarItems(membership, practices),
  ];

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToClubHome">
        <span>JUTOPIA</span>
      </button>
    </header>
    <main class="practice-page club-main-page">
      <section class="practice-page-content">
        <div class="practice-page-heading">
          <h1>${escapeHtml(practiceSectionTitle)}</h1>
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
                ${visiblePractices.length ? "" : `<div class="section-empty practice-empty">${escapeHtml(practiceSectionTitle)}이 아직 없습니다.</div>`}
                <article class="practice-card add-practice-card">
                  <button type="button" aria-label="연습 추가">+</button>
                </article>
              </div>
            `
            : practiceListTableMarkup(visiblePractices, practiceSectionTitle)
        }
        <div class="practice-pagination-wrap">
          ${paginationMarkup(currentPage, totalPages, "연습 목록 페이지")}
        </div>
        ${activeView === "list" ? `<button class="new-practice-button" type="button">+ 새로운 ${escapeHtml(practiceSectionTitle)} 작성하기</button>` : ""}
        <form class="practice-search" role="search">
          <input aria-label="제목 검색" placeholder="제목을 검색해주세요" />
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
  wirePracticeNavigation();
  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => renderPracticesPage(button.dataset.page, activeView));
  });
  document.querySelector(".practice-search").addEventListener("submit", (event) => {
    event.preventDefault();
  });
  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const notice = calendarItemFromButton(calendarItems, button);
      renderNoticeModal(notice);
    });
  });
  wireCalendarExpand(calendarItems);
  wireRoomControls(user, membership);
}

function practiceListTableMarkup(practices, sectionTitle = "그룹 모임") {
  return `
    <section class="practice-table" aria-label="${escapeHtml(sectionTitle)} 게시글형 목록">
      <div class="practice-table-head">
        <strong>제목</strong>
        <strong>중주장</strong>
        <strong>D-DAY</strong>
        <strong>진행률</strong>
      </div>
      <div class="practice-table-body">
        ${practices.length ? practices.map((practice, index) => `
          <button class="practice-table-row" type="button" data-practice-id="${escapeHtml(practice.id)}">
            <span>
              ${practice.title}
              ${practice.roleTags?.length ? `<small class="practice-row-tags">${practice.roleTags.join(", ")}</small>` : ""}
            </span>
            <span>${practice.leader || (index % 2 === 0 ? "김성신" : "김한희")}</span>
            <time>${formatPracticeDate(practice.targetDate) || "2026.09.16"}</time>
            <strong>${practice.progress}%</strong>
          </button>
        `).join("") : `<div class="section-empty practice-empty-row">${escapeHtml(sectionTitle)}이 아직 없습니다.</div>`}
      </div>
    </section>
  `;
}

function wirePracticeNavigation() {
  document.querySelectorAll("[data-practice-id]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (event.target.closest(".add-practice-card")) return;
      navigate(practiceDetailRoute(element.dataset.practiceId));
    });
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      navigate(practiceDetailRoute(element.dataset.practiceId));
    });
  });
}

function renderPracticeDetailPage(practiceId) {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }

  const practice = findPracticeById(practiceId);
  if (!practice) {
    navigate("/practices");
    return;
  }

  const logs = practiceLogsFor(practice);
  const calendarItems = [
    ...clubNoticeItems(membership),
    ...practiceCalendarItems(membership, clubPracticeItems()),
  ];
  const parts = practiceParts(practice);
  const scoreProgressEnabled = practiceUsesScoreProgress(practice);
  const totalMeasures = practiceTotalMeasures(practice);
  const completedMeasures = latestPracticeCompletedMeasures(practice, logs);
  const progressPercent = calculatedPracticeProgress(practice, logs);

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToPractices">
        <span>JUTOPIA</span>
      </button>
    </header>
    <main class="practice-log-page">
      <section class="practice-log-content">
        <h1>TEAM '${escapeHtml(practice.title)}' 연습일지</h1>
        <section class="practice-team-panel">
          <div>
            <h2>팀원</h2>
            <ul class="practice-part-list">
              ${parts.map((part) => `
                <li>
                  <span>${escapeHtml(part.part)} :</span>
                  <strong>${escapeHtml(part.name)}${part.isLeader ? "<em>(팀장)</em>" : ""}</strong>
                </li>
              `).join("")}
            </ul>
          </div>
          <div class="practice-team-actions">
            <button class="part-edit-button" type="button" id="editPracticePartsButton">파트 변경하기</button>
            <label class="part-edit-button practice-cover-upload" for="practiceCoverInput">대표사진 변경하기</label>
            <input class="practice-cover-input" id="practiceCoverInput" type="file" accept="image/*" />
          </div>
        </section>

        <form class="practice-overall-progress" id="practiceProgressForm">
          <div>
            <h2>전체 진도</h2>
            <p>연습의 진행률 표시 방식을 설정해주세요.</p>
          </div>
          <div class="practice-progress-control">
            <label class="practice-score-toggle compact">
              <input id="practiceScoreProgressSetting" type="checkbox" ${scoreProgressEnabled ? "checked" : ""} />
              <span>악보 기준 진행률 표시</span>
            </label>
            <div class="practice-score-fields ${scoreProgressEnabled ? "" : "hidden"}" id="practiceScoreProgressFields">
              <label for="practiceTotalMeasuresInput">총 악보 마디 수</label>
              <div class="practice-progress-input-row score-mode">
                <input id="practiceTotalMeasuresInput" type="number" min="1" step="1" value="${totalMeasures || ""}" placeholder="예: 120" />
                <span>마디</span>
              </div>
              <p class="practice-score-summary">최근 완료 마디 ${completedMeasures || 0} / 총 ${totalMeasures || 0}마디 · ${progressPercent}%</p>
            </div>
            <div class="practice-percent-fields ${scoreProgressEnabled ? "hidden" : ""}" id="practicePercentProgressFields">
              <label for="practiceOverallProgressInput">진행률</label>
              <div class="practice-progress-input-row">
                <input id="practiceOverallProgressInput" type="number" min="0" max="100" step="1" value="${progressPercent}" />
                <span>%</span>
              </div>
              <input class="practice-progress-slider" id="practiceOverallProgressRange" type="range" min="0" max="100" step="1" value="${progressPercent}" />
            </div>
            <div class="practice-progress-track practice-overall-track" aria-hidden="true">
              <i style="width:${progressPercent}%; background:${escapeHtml(practice.color || "#6b3518")}"></i>
            </div>
            <button class="part-edit-button practice-progress-save" type="submit">저장하기</button>
            <p id="practiceProgressMessage" class="hint"></p>
          </div>
        </form>

        <section class="practice-log-table" aria-label="${escapeHtml(practice.title)} 연습일지 목록">
          <div class="practice-log-head">
            <strong>제목</strong>
            <strong>연습 시간</strong>
            <strong>작성일</strong>
          </div>
          <div class="practice-log-body">
            ${logs.length ? logs.map((log) => `
              <div class="practice-log-row">
                <input type="checkbox" data-practice-log-check="${escapeHtml(log.id)}" ${log.checked ? "checked" : ""} />
                <button class="practice-log-link" type="button" data-practice-log-id="${escapeHtml(log.id)}">${escapeHtml(log.title)}</button>
                <span>${escapeHtml(practiceLogDuration(log))}</span>
                <time>${escapeHtml(log.writtenAt)}</time>
              </div>
            `).join("") : `<div class="section-empty practice-empty-row">아직 작성된 연습일지가 없습니다.</div>`}
          </div>
        </section>
        <div class="practice-log-pagination">
          ${logs.length ? paginationMarkup(1, pageCountFor(logs.length, 5), "연습일지 페이지") : ""}
        </div>
        <button class="new-practice-button practice-log-create" type="button" id="newPracticeLogButton">+ 새로운 일지 작성하기</button>
        <p id="practiceLogMessage" class="hint"></p>
      </section>
      <aside class="home-aside practice-log-aside">
        <div class="home-greeting">
          <p>${displayName(user)} 님, 반갑습니다</p>
        </div>
        <div class="aside-title">캘린더</div>
        ${miniCalendarMarkup(calendarItems)}
        <button class="ghost-btn" type="button" id="logoutButton">로그아웃</button>
      </aside>
      <div id="modalRoot"></div>
    </main>
  `;

  document.querySelector("#backToPractices").addEventListener("click", () => navigate("/practices"));
  document.querySelector("#editPracticePartsButton").addEventListener("click", () => {
    navigate(`${practiceDetailRoute(practice.id)}/parts`);
  });
  document.querySelector("#practiceCoverInput").addEventListener("change", (event) => {
    handlePracticeCoverImageChange(event, practice);
  });
  document.querySelector("#practiceScoreProgressSetting").addEventListener("change", (event) => {
    const enabled = event.currentTarget.checked;
    document.querySelector("#practiceScoreProgressFields").classList.toggle("hidden", !enabled);
    document.querySelector("#practicePercentProgressFields").classList.toggle("hidden", enabled);
    document.querySelector("#practiceTotalMeasuresInput").required = enabled;
  });
  document.querySelector("#practiceOverallProgressRange")?.addEventListener("input", (event) => {
    document.querySelector("#practiceOverallProgressInput").value = event.currentTarget.value;
  });
  document.querySelector("#practiceOverallProgressInput")?.addEventListener("input", (event) => {
    const range = document.querySelector("#practiceOverallProgressRange");
    if (range) range.value = event.currentTarget.value;
  });
  document.querySelector("#practiceProgressForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const enabled = document.querySelector("#practiceScoreProgressSetting").checked;
    const total = Number(document.querySelector("#practiceTotalMeasuresInput").value);
    const progress = enabled ? (total ? (completedMeasures / total) * 100 : 0) : Number(document.querySelector("#practiceOverallProgressInput").value);
    if (enabled && (!Number.isFinite(total) || total < 1)) {
      setMessage("#practiceProgressMessage", "총 악보 마디 수를 1 이상으로 입력해주세요.", "error");
      return;
    }
    if (!enabled && (!Number.isFinite(progress) || progress < 0 || progress > 100)) {
      setMessage("#practiceProgressMessage", "전체 진도는 0부터 100 사이로 입력해주세요.", "error");
      return;
    }
    savePracticeProgress(practice, progress, {
      scoreProgressEnabled: enabled,
      totalMeasures: enabled ? Math.round(total) : 0,
      completedMeasures: enabled ? completedMeasures : 0,
    });
    renderPracticeDetailPage(practice.id);
    setMessage("#practiceProgressMessage", "전체 진도가 저장되었습니다.", "success");
  });
  document.querySelector("#newPracticeLogButton").addEventListener("click", () => {
    navigate(practiceLogCreateRoute(practice.id));
  });
  document.querySelectorAll("[data-practice-log-id]").forEach((button) => {
    button.addEventListener("click", () => {
      navigate(practiceLogRoute(practice.id, button.dataset.practiceLogId));
    });
  });
  document.querySelectorAll("[data-practice-log-check]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const log = findPracticeLogById(practice, event.currentTarget.dataset.practiceLogCheck);
      if (!log) return;
      setPracticeLogAttendance(log, user, membership);
      renderPracticeDetailPage(practice.id);
    });
  });
  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => renderNoticeModal(calendarItemFromButton(calendarItems, button)));
  });
  wireCalendarExpand(calendarItems);
  document.querySelector("#logoutButton").addEventListener("click", logout);
}

function renderPracticeLogCreatePage(practiceId) {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }

  const practice = findPracticeById(practiceId);
  if (!practice) {
    navigate("/practices");
    return;
  }

  const today = dateInputValue();
  const calendarItems = [
    ...clubNoticeItems(membership),
    ...practiceCalendarItems(membership, clubPracticeItems()),
  ];
  const scoreProgressEnabled = practiceUsesScoreProgress(practice);
  const totalMeasures = practiceTotalMeasures(practice);

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToPracticeDetail">
        <span>JUTOPIA</span>
      </button>
    </header>
    <main class="notices-page notice-page club-main-page practice-log-create-page">
      <section class="notice-page-content">
        <div class="notice-page-toolbar">
          <h1><a href="#${practiceDetailRoute(practice.id)}">연습일지</a></h1>
        </div>
        <form class="notice-create-form practice-log-create-form" id="practiceLogCreateForm">
          <div class="notice-create-head">
            <span>새 일지</span>
            <strong>${escapeHtml(practice.title)}</strong>
          </div>
          <label>
            <span>제목</span>
            <input id="practiceLogTitleInput" placeholder="연습 일지 제목을 입력해주세요" required />
          </label>
          <div class="notice-create-grid practice-time-grid">
            <label>
              <span>시작일</span>
              <input id="practiceLogStartDateInput" type="date" value="${today}" required />
            </label>
            <label>
              <span>시작 시간</span>
              <select id="practiceLogStartHourInput">${hourOptionsMarkup(18)}</select>
            </label>
            <label>
              <span>마감일</span>
              <input id="practiceLogEndDateInput" type="date" value="${today}" required />
            </label>
            <label>
              <span>마감 시간</span>
              <select id="practiceLogEndHourInput">${hourOptionsMarkup(20)}</select>
            </label>
          </div>
          <div class="notice-create-grid">
            <label>
              <span>연습 장소</span>
              <input id="practiceLogLocationInput" placeholder="예: 성신관 302호" required />
            </label>
            <label>
              <span>참여 예정 인원</span>
              <input id="practiceLogExpectedInput" type="number" min="1" step="1" placeholder="예: 4" required />
            </label>
          </div>
          <section class="practice-progress-editor">
            <h2>진도 일지</h2>
            ${scoreProgressEnabled ? `
              <div class="practice-score-log-settings">
                <label>
                  <span>총 악보 마디 수</span>
                  <input id="practiceLogTotalMeasuresInput" type="number" min="1" step="1" value="${totalMeasures || ""}" placeholder="예: 120" required />
                </label>
              </div>
            ` : ""}
            <div class="notice-create-grid">
              <label>
                <span>이전 진도</span>
                <input id="practiceLogPreviousInput" placeholder="예: 20마디" />
              </label>
              <label>
                <span>목표 진도</span>
                <input id="practiceLogTargetInput" placeholder="예: 32마디" />
              </label>
              <label>
                <span>완료된 진도</span>
                <input id="practiceLogCompletedInput" ${scoreProgressEnabled ? 'type="number" min="0" step="1"' : ""} placeholder="${scoreProgressEnabled ? "예: 30" : "예: 30마디"}" />
              </label>
            </div>
            <label>
              <span>진도 메모</span>
              <textarea id="practiceLogProgressNoteInput" placeholder="오늘 진행한 내용과 다음 연습까지의 목표를 적어주세요"></textarea>
            </label>
          </section>
          <label>
            <span>Memo</span>
            <textarea id="practiceLogMemoInput" class="compact-textarea" placeholder="팀원에게 남길 짧은 메모를 적어주세요"></textarea>
          </label>
          <p id="practiceLogCreateMessage" class="hint">시간은 1시간 단위로만 선택할 수 있습니다.</p>
          <div class="notice-create-actions">
            <button class="ghost-btn" type="button" id="cancelPracticeLogCreate">취소</button>
            <button class="primary-btn" type="submit">일지 등록하기</button>
          </div>
        </form>
      </section>
      ${clubSidebarMarkup({ user, membership, calendarItems, highlightedRoom: true })}
      <div id="modalRoot"></div>
    </main>
  `;

  document.querySelector("#backToPracticeDetail").addEventListener("click", () => navigate(practiceDetailRoute(practice.id)));
  document.querySelector("#cancelPracticeLogCreate").addEventListener("click", () => navigate(practiceDetailRoute(practice.id)));
  document.querySelector("#practiceLogCreateForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const title = document.querySelector("#practiceLogTitleInput").value.trim();
    const startAt = combineDateHour(
      document.querySelector("#practiceLogStartDateInput").value,
      document.querySelector("#practiceLogStartHourInput").value
    );
    const endAt = combineDateHour(
      document.querySelector("#practiceLogEndDateInput").value,
      document.querySelector("#practiceLogEndHourInput").value
    );
    const location = document.querySelector("#practiceLogLocationInput").value.trim();
    const expectedParticipants = Number(document.querySelector("#practiceLogExpectedInput").value);
    if (!title || !startAt || !endAt || !location || !Number.isFinite(expectedParticipants) || expectedParticipants < 1) {
      setMessage("#practiceLogCreateMessage", "제목, 시간, 장소, 참여 예정 인원을 모두 입력해주세요.", "error");
      return;
    }
    if (endAt <= startAt) {
      setMessage("#practiceLogCreateMessage", "마감 시간은 시작 시간보다 늦어야 합니다.", "error");
      return;
    }
    const logTotalMeasures = scoreProgressEnabled ? Number(document.querySelector("#practiceLogTotalMeasuresInput").value) : practiceTotalMeasures(practice);
    const completedMeasureValue = scoreProgressEnabled ? Number(document.querySelector("#practiceLogCompletedInput").value || 0) : 0;
    if (scoreProgressEnabled && (!Number.isFinite(logTotalMeasures) || logTotalMeasures < 1)) {
      setMessage("#practiceLogCreateMessage", "총 악보 마디 수를 1 이상으로 입력해주세요.", "error");
      return;
    }
    if (scoreProgressEnabled && (!Number.isFinite(completedMeasureValue) || completedMeasureValue < 0 || completedMeasureValue > logTotalMeasures)) {
      setMessage("#practiceLogCreateMessage", "완료된 마디 수는 0부터 총 악보 마디 수 사이로 입력해주세요.", "error");
      return;
    }
    const log = addPracticeLog(practice, user, membership, {
      title,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      location,
      expectedParticipants,
      previousProgress: document.querySelector("#practiceLogPreviousInput").value.trim(),
      targetProgress: document.querySelector("#practiceLogTargetInput").value.trim(),
      completedProgress: scoreProgressEnabled ? `${Math.round(completedMeasureValue)}마디` : document.querySelector("#practiceLogCompletedInput").value.trim(),
      completedMeasures: scoreProgressEnabled ? Math.round(completedMeasureValue) : 0,
      totalMeasures: scoreProgressEnabled ? Math.round(logTotalMeasures) : 0,
      progressNote: document.querySelector("#practiceLogProgressNoteInput").value.trim(),
      memo: document.querySelector("#practiceLogMemoInput").value.trim(),
    });
    if (scoreProgressEnabled) {
      savePracticeProgress(practice, (completedMeasureValue / logTotalMeasures) * 100, {
        scoreProgressEnabled: true,
        totalMeasures: Math.round(logTotalMeasures),
        completedMeasures: Math.round(completedMeasureValue),
      });
    }
    navigate(practiceLogRoute(practice.id, log.id));
  });
  document.querySelectorAll("[data-notice-id]").forEach((button) => {
    button.addEventListener("click", () => renderNoticeModal(calendarItemFromButton(calendarItems, button)));
  });
  wireCalendarExpand(calendarItems);
  wireRoomControls(user, membership);
}

function renderPracticeLogPage(practiceId, logId) {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }

  const practice = findPracticeById(practiceId);
  if (!practice) {
    navigate("/practices");
    return;
  }

  const log = findPracticeLogById(practice, logId);
  if (!log) {
    navigate(practiceDetailRoute(practice.id));
    return;
  }

  const attendance = practiceLogAttendanceState(log);
  const plannedMembers = practiceLogPlannedMembers(practice, log);
  const attendees = practiceLogAttendees(log, user, membership);
  const logScoreTotal = Math.round(Number(log.totalMeasures || practiceTotalMeasures(practice) || 0));
  const logScoreCompleted = Math.round(measureNumberFromText(log.completedMeasures || log.completedProgress));
  const logScorePercent = logScoreTotal ? clampPercent((logScoreCompleted / logScoreTotal) * 100) : 0;
  const logs = practiceLogsFor(practice);
  const currentIndex = Math.max(0, logs.findIndex((item) => item.id === log.id));
  const currentPage = currentIndex + 1;

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToPracticeLogs">
        <span>JUTOPIA</span>
      </button>
    </header>
    <main class="practice-log-detail-page">
      <section class="practice-log-detail-content">
        <h1>TEAM '${escapeHtml(practice.title)}' 연습일지</h1>
        <article class="practice-log-detail">
          <header class="practice-log-detail-header">
            <h2>${escapeHtml(log.title)}</h2>
            <button
              class="practice-attendance-button ${attendance.className}"
              type="button"
              id="practiceAttendanceButton"
              ${attendance.canClick ? "" : "disabled"}
            >${escapeHtml(attendance.label)}</button>
          </header>
          <section class="practice-log-summary">
            <p>연습 날짜 : ${escapeHtml(formatPracticeLogDate(log))}</p>
            <p>연습 시간 : ${escapeHtml(formatPracticeLogTime(log))}</p>
            <p>연습 장소 : ${escapeHtml(log.location || "미정")}</p>
            <p>참여 예정 인원 : ${escapeHtml(String(log.expectedParticipants || plannedMembers.length))}명 ${plannedMembers.length ? `· ${plannedMembers.map(escapeHtml).join(" · ")}` : ""}</p>
            <p>출석 인원 : ${attendees.length ? attendees.map((attendee) => escapeHtml(attendee.name)).join(" · ") : "아직 출석한 인원이 없습니다."}</p>
          </section>
          <section class="practice-progress-detail">
            <h2>진도 일지</h2>
            <p>이전 진도 : ${escapeHtml(log.previousProgress || "-")}</p>
            <p>목표 진도 : ${escapeHtml(log.targetProgress || "-")}</p>
            <p>완료된 진도 : ${escapeHtml(log.completedProgress || "-")}</p>
            ${practiceUsesScoreProgress(practice) ? `<p>악보 진행률 : ${logScoreCompleted || 0} / ${logScoreTotal || 0}마디 (${logScorePercent}%)</p>` : ""}
            <div class="practice-progress-note">${escapeHtml(log.progressNote || "아직 작성된 진도 메모가 없습니다.").replace(/\n/g, "<br />")}</div>
          </section>
          <section class="practice-log-memo">
            ${escapeHtml(log.memo || "Memo...").replace(/\n/g, "<br />")}
          </section>
        </article>
        <div class="practice-log-pagination">
          ${paginationMarkup(currentPage, pageCountFor(logs.length, 1), "연습일지 상세 페이지")}
        </div>
      </section>
    </main>
  `;

  document.querySelector("#backToPracticeLogs").addEventListener("click", () => navigate(practiceDetailRoute(practice.id)));
  const attendanceButton = document.querySelector("#practiceAttendanceButton");
  if (attendance.canClick) {
    attendanceButton.addEventListener("click", () => {
      setPracticeLogAttendance(log, user, membership);
      renderPracticeLogPage(practice.id, log.id);
    });
  }
  document.querySelectorAll("[data-page]").forEach((button) => {
    const nextLog = logs[Number(button.dataset.page) - 1];
    button.addEventListener("click", () => {
      if (nextLog) navigate(practiceLogRoute(practice.id, nextLog.id));
    });
  });
}

function renderPracticePartsPage(practiceId) {
  const user = getCurrentUser();
  const membership = getClubMemberships(state.currentUserId).find((member) => member.clubId === state.currentClubId);
  if (!user || !membership) {
    navigate(user ? "/clubs" : "/login");
    return;
  }

  const practice = findPracticeById(practiceId);
  if (!practice) {
    navigate("/practices");
    return;
  }

  const parts = practiceParts(practice);
  const partOptions = [...new Set(parts.map((part) => part.part))];

  document.querySelector("#app").innerHTML = `
    <header class="club-main-topbar">
      <button class="home-logo compact" type="button" id="backToPracticeDetail">
        <span>JUTOPIA</span>
      </button>
    </header>
    <main class="club-settings-page practice-parts-page">
      <section class="club-settings-panel">
        <p class="settings-eyebrow">그룹 모임 관리</p>
        <h1>${escapeHtml(practice.title)} 파트 변경</h1>
        <p class="settings-copy">모임을 만들 때 쉼표로 입력한 파트를 기준으로 팀원의 파트를 조정합니다. 팀장은 이름 옆에 고정 표시됩니다.</p>
        <form class="role-manager practice-part-manager" id="practicePartsForm">
          <div class="role-manager-heading">
            <div>
              <h2>팀원 파트 설정</h2>
              <p>파트를 바꾸면 연습일지의 팀원 목록에도 바로 반영됩니다.</p>
            </div>
            <button class="settings-save-button" type="submit">파트 저장</button>
          </div>
          <div class="part-table">
            <div class="part-table-head">
              <strong>이름</strong>
              <strong>파트</strong>
            </div>
            ${parts.map((part, index) => `
              <div class="part-table-row">
                <span>
                  <strong>${escapeHtml(part.name)}${part.isLeader ? "<em>(팀장)</em>" : ""}</strong>
                  <small>${escapeHtml(practice.title)}</small>
                </span>
                <select data-part-select="${index}" data-member-name="${escapeHtml(part.name)}">
                  ${partOptions.map((option) => `<option value="${escapeHtml(option)}" ${option === part.part ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
                </select>
              </div>
            `).join("")}
          </div>
          <p id="practicePartsMessage" class="hint"></p>
        </form>
      </section>
    </main>
  `;

  document.querySelector("#backToPracticeDetail").addEventListener("click", () => navigate(practiceDetailRoute(practice.id)));
  document.querySelector("#practicePartsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const updatedParts = Array.from(document.querySelectorAll("[data-part-select]")).map((select) => ({
      part: select.value,
      name: select.dataset.memberName || "모집 중",
    }));
    savePracticeParts(practice, updatedParts);
    setMessage("#practicePartsMessage", "파트가 저장되었습니다.", "success");
    navigate(practiceDetailRoute(practice.id));
  });
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
  const submitButton = event.submitter || document.querySelector("#signupForm button[type='submit']");
  const originalButtonText = submitButton?.textContent || "";
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "인증번호 보내는 중";
  }
  setMessage("#signupMessage", "인증번호를 보내는 중입니다. 잠시만 기다려주세요.", "hint");
  let shouldRestoreButton = true;

  try {
    await apiRequest("/auth/send-code", {
      method: "POST",
      body: {
        studentId,
      },
    });
    setPendingSignup(pendingSignup);
    shouldRestoreButton = false;
    navigate("/verify-email");
  } catch (error) {
    if (isApiUnavailable(error)) {
      issueLocalVerification(studentId);
      setPendingSignup({ ...pendingSignup, localOnly: true });
      shouldRestoreButton = false;
      navigate("/verify-email");
      return;
    }
    setMessage("#signupMessage", error.message, "error");
  } finally {
    if (shouldRestoreButton && submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  }
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
    await apiRequest("/auth/send-code", {
      method: "POST",
      body: { studentId: pending.studentId },
    });
    setMessage(
      "#verificationMessage",
      "인증 코드가 다시 발송되었습니다.",
      "success",
    );
  } catch (error) {
    if (isApiUnavailable(error)) {
      issueLocalVerification(pending.studentId);
      setPendingSignup({ ...pending, localOnly: true });
      setMessage(
        "#verificationMessage",
        "프론트 단독 테스트에서는 학번 뒤 6자리 코드를 입력하면 인증됩니다.",
        "success",
      );
      return;
    }
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
  let result;

  try {
    await apiRequest("/auth/verify-code", {
      method: "POST",
      body: { studentId: pending.studentId, code },
    });
    result = await apiRequest("/auth/signup", {
      method: "POST",
      body: pending,
    });
  } catch (error) {
    if (!isApiUnavailable(error)) {
      setMessage("#verificationMessage", error.message, "error");
      return;
    }

    try {
      verifyLocalSignupCode(pending, code);
      result = signupLocalUser(pending);
    } catch (localError) {
      setMessage("#verificationMessage", localError.message, "error");
      return;
    }
  }

  clearPendingSignup();
  cacheAuthSession(result);
  navigate("/clubs");
}

async function handleLogin(event) {
  event.preventDefault();
  const email = document.querySelector("#loginEmail").value.trim();
  const password = document.querySelector("#loginPassword").value;
  let result;

  try {
    result = await apiRequest("/auth/login", {
      method: "POST",
      body: { email, password },
    });
  } catch (error) {
    if (!isApiUnavailable(error)) {
      setMessage("#loginMessage", error.message, "error");
      return;
    }

    try {
      result = loginLocalUser(email, password);
    } catch (localError) {
      setMessage("#loginMessage", localError.message, "error");
      return;
    }
  }

  cacheAuthSession(result);
  navigate("/clubs");
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

async function handleCreateClub(event) {
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

  let result;
  try {
    result = await apiRequest("/clubs", {
      method: "POST",
      auth: true,
      body: {
        name,
        description: tags.length ? `${tags.join(", ")} 동아리` : "새롭게 생성된 동아리",
        profileImageUrl: state.pendingClubLogo || "",
        dday,
        tags,
        roleTags: roleTags.length ? roleTags : ["회장", "임원진", "부원"],
        color,
      },
    });
  } catch (error) {
    setMessage("#createClubMessage", `서버에 동아리를 저장하지 못했습니다. ${error.message}`, "error");
    return;
  }

  const club = {
    ...result.club,
    profileImageUrl: result.club?.profileImageUrl || state.pendingClubLogo || "",
    dday,
    tags: result.club?.tags?.length ? result.club.tags : tags,
    roleTags: result.club?.roleTags?.length ? result.club.roleTags : roleTags.length ? roleTags : ["회장", "임원진", "부원"],
    color: result.club?.color || color,
    inviteCode: result.club?.inviteCode || inviteCode,
    contentMode: "empty",
    createdBy: result.club?.createdBy || state.currentUserId,
    createdAt: result.club?.createdAt || new Date().toISOString(),
  };
  const membership = {
    ...result.membership,
    clubId: result.membership?.clubId || club.id,
    userId: result.membership?.userId || state.currentUserId,
    generation: "1기",
    role: "PRESIDENT",
    status: "ACTIVE",
    joinedAt: result.membership?.joinedAt || new Date().toISOString(),
  };
  cacheAuthSession({ clubs: [club], memberships: [membership] });
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
  const roleTags = parseTags(document.querySelector("#practiceRoleTags").value).map(formatPartLabel);
  const scoreProgressEnabled = document.querySelector("#practiceScoreProgressEnabled")?.checked || false;
  const totalMeasures = Number(document.querySelector("#practiceTotalMeasures")?.value || 0);
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
  if (scoreProgressEnabled && (!Number.isFinite(totalMeasures) || totalMeasures < 1)) {
    setMessage("#createPracticeMessage", "총 악보 마디 수를 1 이상으로 입력해주세요.", "error");
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
    scoreProgressEnabled,
    totalMeasures: scoreProgressEnabled ? Math.round(totalMeasures) : 0,
    completedMeasures: 0,
    color: "#6b3518",
    cover,
    day: practiceDayFromDate(ddayDate),
    members: roleTags.map((role, index) => index === 0 ? displayName(user) : "모집 중"),
    leader: displayName(user),
    createdBy: user.id,
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
  else if (path.startsWith("/practice/")) {
    const segments = path.split("/");
    const practiceId = decodeURIComponent(segments[2] || "");
    if (segments[3] === "logs" && segments[4] === "new") renderPracticeLogCreatePage(practiceId);
    else if (segments[3] === "log") renderPracticeLogPage(practiceId, decodeURIComponent(segments[4] || ""));
    else if (segments[3] === "parts") renderPracticePartsPage(practiceId);
    else renderPracticeDetailPage(practiceId);
  }
  else if (path === "/notices") renderNoticesPage(params.get("page") || 1);
  else if (path === "/notices/new") renderNoticeCreatePage();
  else if (path.startsWith("/notice/")) renderNoticePage(path.split("/")[2]);
  else renderLogin();
}

seedData();
window.addEventListener("hashchange", route);
route();
