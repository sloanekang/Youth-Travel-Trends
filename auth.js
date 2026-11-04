/* 로그인·회원가입·세션 관리 (브라우저 전용)
 *
 * - 비밀번호는 저장하지 않고 PBKDF2-SHA256(무작위 salt, 반복 150,000회) 해시만 이 브라우저 localStorage에 저장한다.
 * - 세션은 sessionStorage(탭을 닫으면 삭제)에 두고, 60분 동안 조작이 없으면 만료한다.
 * - 같은 아이디로 5회 연속 실패하면 5분 동안 로그인을 막는다.
 * 한계: 서버가 없는 정적 사이트라 화면 접근만 막는다. 공개 저장소의 data.js 등 파일 자체는 보호하지 못한다.
 */
(function () {
  "use strict";
  const USERS = "jy_users", SESSION = "jy_session", LOCKS = "jy_locks";
  const TTL = 60 * 60 * 1000, MAX_FAIL = 5, LOCK_MS = 5 * 60 * 1000, ITER = 150000;
  const enc = new TextEncoder();
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
  const read = (store, key, fallback) => { try { return JSON.parse(store.getItem(key)) || fallback; } catch (e) { return fallback; } };
  const write = (store, key, val) => store.setItem(key, JSON.stringify(val));

  async function pbkdf2(password, saltBytes, iter) {
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: iter }, key, 256));
  }
  // 길이가 같은 두 문자열을 끝까지 비교(일치 위치에 따라 시간이 달라지지 않게)
  const sameHash = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

  const ID_RE = /^[a-z0-9_]{4,20}$/;
  function passwordRules(pw, id) {
    return [
      { ok: pw.length >= 8, text: "8자 이상" },
      { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), text: "영문과 숫자 포함" },
      { ok: /[^A-Za-z0-9]/.test(pw), text: "특수문자 포함" },
      { ok: !id || !pw.toLowerCase().includes(id.toLowerCase()), text: "아이디를 포함하지 않음" },
    ];
  }

  // 수업 시연용 데모 계정(비밀번호 원문 없이 해시만 내장). 브라우저에 없으면 추가한다.
  const DEMO = { id: "jejudemo", salt: "37318d104c87c890ff787874806059b1", hash: "a95f2f63cd755e1aeecd01e96c67cb4c6c9e5624ed46afb6bca051c06612afa0", iter: 150000 };
  (function seedDemo() {
    const users = read(localStorage, USERS, {});
    if (!users[DEMO.id]) { users[DEMO.id] = { salt: DEMO.salt, hash: DEMO.hash, iter: DEMO.iter, created: "demo" }; write(localStorage, USERS, users); }
  })();

  const Auth = {
    supported: () => !!(window.crypto && crypto.subtle && window.isSecureContext !== false),
    ID_RE, passwordRules,
    async signUp(id, pw) {
      id = id.trim().toLowerCase();
      if (!ID_RE.test(id)) throw new Error("아이디는 영문 소문자·숫자·밑줄(_) 4~20자로 입력하세요.");
      if (passwordRules(pw, id).some((r) => !r.ok)) throw new Error("비밀번호 조건을 모두 만족해야 합니다.");
      const users = read(localStorage, USERS, {});
      if (users[id]) throw new Error("이미 사용 중인 아이디입니다.");
      const salt = crypto.getRandomValues(new Uint8Array(16));
      users[id] = { salt: hex(salt), hash: await pbkdf2(pw, salt, ITER), iter: ITER, created: new Date().toISOString() };
      write(localStorage, USERS, users);
    },
    lockLeft(id) {
      const l = read(localStorage, LOCKS, {})[id.trim().toLowerCase()];
      return l && l.until > Date.now() ? l.until - Date.now() : 0;
    },
    async signIn(id, pw) {
      id = id.trim().toLowerCase();
      const locks = read(localStorage, LOCKS, {});
      const lock = locks[id] || { fails: 0, until: 0 };
      if (lock.until > Date.now()) throw new Error(`로그인 시도가 많아 잠겼습니다. ${Math.ceil((lock.until - Date.now()) / 60000)}분 뒤 다시 시도하세요.`);
      const u = read(localStorage, USERS, {})[id];
      // 없는 아이디도 같은 계산을 거쳐, 아이디 존재 여부가 응답 시간·문구로 드러나지 않게 한다
      const h = await pbkdf2(pw, u ? unhex(u.salt) : new Uint8Array(16), u ? u.iter : ITER);
      if (!u || !sameHash(h, u.hash)) {
        lock.fails = (lock.until && lock.until <= Date.now() ? 0 : lock.fails) + 1;
        lock.until = lock.fails >= MAX_FAIL ? Date.now() + LOCK_MS : 0;
        if (lock.until) lock.fails = 0;
        locks[id] = lock; write(localStorage, LOCKS, locks);
        throw new Error(lock.until ? "로그인 시도가 5회 실패해 5분 동안 잠겼습니다."
          : `아이디 또는 비밀번호가 올바르지 않습니다. (${lock.fails}/${MAX_FAIL})`);
      }
      delete locks[id]; write(localStorage, LOCKS, locks);
      write(sessionStorage, SESSION, { id, exp: Date.now() + TTL, token: hex(crypto.getRandomValues(new Uint8Array(16))) });
    },
    session() {
      const s = read(sessionStorage, SESSION, null);
      if (s && s.exp > Date.now()) return s;
      sessionStorage.removeItem(SESSION);
      return null;
    },
    touch() { const s = Auth.session(); if (s) { s.exp = Date.now() + TTL; write(sessionStorage, SESSION, s); } },
    signOut(reason) {
      sessionStorage.removeItem(SESSION);
      location.replace("login.html" + (reason ? "?msg=" + encodeURIComponent(reason) : ""));
    },
  };
  window.JYAuth = Auth;

  // 대시보드(<html data-guard="1">): 세션이 없으면 로그인 페이지로 보내고, 있으면 화면을 연다
  const root = document.documentElement;
  if (root.dataset.guard === "1") {
    if (!Auth.session()) {
      location.replace("login.html?msg=" + encodeURIComponent("로그인이 필요합니다."));
      return;
    }
    root.classList.add("authed");
    let last = 0;
    ["click", "keydown", "scroll", "pointermove"].forEach((ev) => window.addEventListener(ev, () => {
      if (Date.now() - last > 30000) { last = Date.now(); Auth.touch(); }
    }, { passive: true }));
    setInterval(() => { if (!Auth.session()) Auth.signOut("오랫동안 사용하지 않아 로그아웃되었습니다."); }, 30000);
    document.addEventListener("DOMContentLoaded", () => {
      const s = Auth.session(), uid = document.getElementById("u-id"), out = document.getElementById("u-logout");
      if (uid && s) uid.textContent = s.id;
      if (out) out.addEventListener("click", () => Auth.signOut("로그아웃되었습니다."));
    });
  }
})();
