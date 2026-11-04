/* 로그인·회원가입 화면 동작 — 실제 처리는 auth.js(window.JYAuth) */
(function () {
  "use strict";
  const A = window.JYAuth;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  // 이미 로그인한 상태면 바로 대시보드로
  if (A.session()) { location.replace("index.html"); return; }

  function showMsg(text) { $("msg").hidden = !text; $("msg").textContent = text || ""; }
  function showErr(id, text) { $(id).hidden = !text; $(id).textContent = text || ""; }
  if (params.get("msg")) showMsg(params.get("msg"));
  // 주소창에 메시지가 남지 않게 정리
  if (location.search) history.replaceState(null, "", location.pathname);

  if (!A.supported()) {
    showMsg("이 브라우저 환경에서는 보안 기능(Web Crypto)을 쓸 수 없습니다. https 주소나 최신 브라우저로 접속하세요.");
    document.querySelectorAll("form button[type=submit]").forEach((b) => (b.disabled = true));
  }

  function switchTab(name) {
    const login = name === "login";
    $("tab-login").setAttribute("aria-selected", String(login));
    $("tab-signup").setAttribute("aria-selected", String(!login));
    $("form-login").hidden = !login; $("form-signup").hidden = login;
    showErr("li-err", ""); showErr("su-err", "");
    (login ? $("li-id") : $("su-id")).focus();
  }
  $("tab-login").addEventListener("click", () => switchTab("login"));
  $("tab-signup").addEventListener("click", () => switchTab("signup"));
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.go)));

  // Caps Lock 안내(비밀번호가 보이지 않으므로 오타를 줄이기 위해)
  [["li-pw", "li-caps"], ["su-pw", "su-caps"], ["su-pw2", "su-caps"]].forEach(([inp, tip]) =>
    ["keydown", "keyup"].forEach((ev) => $(inp).addEventListener(ev, (e) => {
      if (e.getModifierState) $(tip).hidden = !e.getModifierState("CapsLock");
    })));

  // 비밀번호 조건·강도 표시
  function renderRules() {
    const rules = A.passwordRules($("su-pw").value, $("su-id").value.trim());
    $("su-rules").innerHTML = rules.map((r) => `<li class="${r.ok ? "ok" : ""}">${r.ok ? "✓" : "·"} ${r.text}</li>`).join("");
    const score = rules.filter((r) => r.ok).length + ($("su-pw").value.length >= 12 ? 1 : 0);
    const m = $("su-meter");
    m.style.width = (score / 5) * 100 + "%";
    m.style.background = score <= 2 ? "#d63c55" : score <= 3 ? "#e8962e" : "#12996b";
    return rules;
  }
  $("su-pw").addEventListener("input", renderRules);
  $("su-id").addEventListener("input", renderRules);
  renderRules();

  async function busy(btn, label, fn) {
    const t = btn.textContent; btn.disabled = true; btn.textContent = label;
    try { await fn(); } finally { btn.disabled = false; btn.textContent = t; }
  }

  $("form-login").addEventListener("submit", (e) => {
    e.preventDefault();
    showErr("li-err", "");
    const id = $("li-id").value, pw = $("li-pw").value;
    if (!id.trim() || !pw) return showErr("li-err", "아이디와 비밀번호를 입력하세요.");
    busy($("li-btn"), "확인 중…", async () => {
      try {
        await A.signIn(id, pw);
        $("li-pw").value = "";
        location.replace("index.html");
      } catch (err) {
        $("li-pw").value = "";
        showErr("li-err", err.message);
        $("li-pw").focus();
      }
    });
  });

  $("form-signup").addEventListener("submit", (e) => {
    e.preventDefault();
    showErr("su-err", "");
    const id = $("su-id").value, pw = $("su-pw").value, pw2 = $("su-pw2").value;
    if (!A.ID_RE.test(id.trim().toLowerCase())) return showErr("su-err", "아이디는 영문 소문자·숫자·밑줄(_) 4~20자로 입력하세요.");
    if (renderRules().some((r) => !r.ok)) return showErr("su-err", "비밀번호 조건을 모두 만족해야 합니다.");
    if (pw !== pw2) { $("su-pw2").value = ""; return showErr("su-err", "비밀번호 확인이 일치하지 않습니다."); }
    busy($("su-btn"), "가입 중…", async () => {
      try {
        await A.signUp(id, pw);
        $("su-pw").value = ""; $("su-pw2").value = ""; renderRules();
        $("li-id").value = id.trim().toLowerCase();
        switchTab("login");
        showMsg("가입이 완료되었습니다. 로그인하세요.");
        $("li-pw").focus();
      } catch (err) { showErr("su-err", err.message); }
    });
  });

  $("li-id").focus();
})();
