/* 청년층 제주 관광 동향 대시보드 — data.js(window.DASH_DATA)를 읽어 필터·지표·차트를 갱신한다. */
(function () {
  "use strict";
  const D = window.DASH_DATA;
  const $ = (id) => document.getElementById(id);
  const HAS_CHART = typeof window.Chart !== "undefined";
  const HAS_L = typeof window.L !== "undefined";
  const HAS_WC = typeof window.WordCloud !== "undefined" && WordCloud.isSupported;
  const charts = {};
  const wcStat = { total: 0, drawn: 0, skipped: 0 };

  if (!D) {
    document.querySelector(".wrap").innerHTML =
      '<p class="notice">data.js를 찾을 수 없습니다. scripts/build_data.py를 먼저 실행하세요.</p>';
    return;
  }

  // ---------- 공통 유틸 ----------
  const fmt = (v) => (v == null || Number.isNaN(v) ? "-" : Math.round(v).toLocaleString("ko-KR"));
  const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "-" : (v * 100).toFixed(d) + "%");
  const ymLabel = (m) => `${Math.floor(m / 100)}년 ${m % 100}월`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const AGE_LABEL = (a) => (a === "all" ? "전체 연령" : a === 70 ? "70(원본 코드)" : `${a}대`);
  const SEX_LABEL = { all: "남녀 전체", M: "남성", W: "여성" };
  const VIS_LABEL = { tot: "전체(내국인+외국인)", dom: "내국인", for: "외국인" };
  const PM_LABEL = { tour: "관광객 도착 수", res: "도민 도착 수", all: "도착건수(전체)" };
  const YEAR_COLORS = { 2024: "#6d4fd8", 2025: "#e0569b", 2026: "#e8962e" };
  const C = { purple: "#6d4fd8", pink: "#e0569b", teal: "#14a3a0", amber: "#e8962e", blue: "#3b82f6" };
  const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, "0");
  if (window.Chart) { Chart.defaults.font.family = '"Pretendard", "Malgun Gothic", sans-serif'; Chart.defaults.color = "#6b6488"; Chart.defaults.borderColor = "#ece8f8"; }

  function table(cols, rows, hlFn) {
    if (!rows.length) return '<p class="fine">표시할 데이터가 없습니다.</p>';
    const th = cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("");
    const tr = rows.map((r, i) => `<tr class="${hlFn && hlFn(r) ? "hl" : ""}">` +
      cols.map((c) => `<td class="${c.num ? "num" : ""}">${c.html ? c.html(r, i) : esc(c.get(r, i))}</td>`).join("") + "</tr>").join("");
    return `<div class="tbl-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
  }
  // 필터 종류별 색(사이드바·칩·패널 배지 공통)
  const FKEY = {
    period: { label: "기간", color: "#6d4fd8" }, age: { label: "연령", color: "#d6336c" }, sex: { label: "성별", color: "#e8590c" },
    region: { label: "지역", color: "#0f9d94" }, visitor: { label: "내·외국인", color: "#2f6fe0" },
    pmetric: { label: "장소 기준", color: "#5f6b85" }, scat: { label: "검색 분류", color: "#5f6b85" },
  };
  function badges(id, list) {
    const el = $(id);
    el.innerHTML = list.map(([t, on, key]) => {
      const f = FKEY[key];
      if (!f) return `<span class="badge ${on ? "" : "off"}">${esc(t)}</span>`;
      const cls = !on ? "off" : narrowing(key) ? "on" : "idle";
      const tip = !on ? `${f.label}: 이 패널의 데이터에는 해당 정보가 없어 적용되지 않음` : `${f.label}: ${fValue(key)}${cls === "on" ? " (적용 중)" : " (전체)"}`;
      return `<span class="badge ${cls}" style="--fc:${f.color}" title="${esc(tip)}">${esc(t)}</span>`;
    }).join("");
  }
  function show(id, msg) { const el = $(id); el.hidden = !msg; if (msg) el.innerHTML = msg; }
  function drawChart(key, canvasId, cfg) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
    const cv = $(canvasId);
    cv.parentElement.hidden = !cfg || !HAS_CHART;
    if (!cfg || !HAS_CHART) return;
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options);
    charts[key] = new Chart(cv, cfg);
  }
  const axisTitle = (t) => ({ display: true, text: t });

  // ---------- 필터 초기화 ----------
  const allMonths = [...new Set([].concat(D.age.months, D.inbound.months, D.region.months, D.places.months, D.search.months))].sort();
  const ages = [...new Set(D.age.rows.map((r) => r[2]))].sort((a, b) => a - b);
  const sggs = [...new Set(D.region.emds.map((e) => e.sgg))];
  const DEFAULT = { start: 202501, end: 202512, age: 20, sex: "all", sgg: "all", emd: "all", visitor: "tot", pmetric: "tour", scat: "all", rall: false };
  const S = Object.assign({}, DEFAULT);

  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  $("f-age").innerHTML = opt("all", "전체 연령") + ages.map((a) => opt(a, AGE_LABEL(a))).join("");
  $("f-sgg").innerHTML = opt("all", "전체 지역") + sggs.map((s) => opt(s, s)).join("");
  $("f-scat").innerHTML = opt("all", "전체 분류") + D.search.cats.map((c) => opt(c, c)).join("");
  function fillEmd() {
    const list = D.region.emds.filter((e) => S.sgg === "all" || e.sgg === S.sgg);
    $("f-emd").innerHTML = opt("all", "전체 읍면동") + list.map((e) => opt(e.name, e.name)).join("");
    if (S.emd !== "all" && !list.some((e) => e.name === S.emd)) S.emd = "all";
    $("f-emd").value = S.emd;
  }
  function syncControls() {
    $("f-start").textContent = ymLabel(S.start); $("f-end").textContent = ymLabel(S.end); $("f-age").value = S.age;
    if (typeof syncRange === "function") { syncRange(); syncPresets(); }
    $("f-sex").value = S.sex; $("f-sgg").value = S.sgg; fillEmd();
    $("f-visitor").value = S.visitor; $("f-pmetric").value = S.pmetric; $("f-scat").value = S.scat;
    $("f-rall").checked = S.rall;
  }
  const bind = (id, key, num) => $(id).addEventListener("change", (e) => {
    const v = e.target.value; S[key] = num && v !== "all" ? Number(v) : v;
    if (key === "sgg") { S.emd = "all"; fillEmd(); }
    if (key === "emd" && S.emd !== "all") S.sgg = D.region.emds.find((x) => x.name === S.emd).sgg, $("f-sgg").value = S.sgg;
    render();
  });
  bind("f-age", "age", true); bind("f-sex", "sex");
  bind("f-sgg", "sgg"); bind("f-emd", "emd"); bind("f-visitor", "visitor"); bind("f-pmetric", "pmetric"); bind("f-scat", "scat");
  $("f-rall").addEventListener("change", (e) => { S.rall = e.target.checked; render(); });

  // 월 달력: 연도를 넘기며 월을 고른다. 데이터가 없는 월은 비활성
  const YEARS = [...new Set(allMonths.map((m) => Math.floor(m / 100)))];
  const mp = { target: null, year: null };
  const pop = $("mp-pop");
  function openPicker(which) {
    if (mp.target === which && !pop.hidden) return closePicker();
    mp.target = which; mp.year = Math.floor(S[which] / 100);
    const b = $(`f-${which}`).getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(b.left, window.innerWidth - 274)) + "px";
    pop.style.top = Math.min(b.bottom + 6, window.innerHeight - 300) + "px";
    ["start", "end"].forEach((w) => $(`f-${w}`).setAttribute("aria-expanded", String(w === which)));
    pop.hidden = false; renderPicker();
  }
  function closePicker() {
    pop.hidden = true; mp.target = null;
    ["start", "end"].forEach((w) => $(`f-${w}`).setAttribute("aria-expanded", "false"));
  }
  function renderPicker() {
    $("mp-year").textContent = `${mp.year}년 · ${mp.target === "start" ? "시작 월" : "종료 월"}`;
    $("mp-prev").disabled = mp.year <= YEARS[0]; $("mp-next").disabled = mp.year >= YEARS[YEARS.length - 1];
    $("mp-grid").innerHTML = Array.from({ length: 12 }, (_, i) => {
      const ym = mp.year * 100 + i + 1, has = allMonths.includes(ym);
      const cls = ym === S[mp.target] ? "sel" : ym >= S.start && ym <= S.end ? "in" : "";
      return `<button type="button" data-ym="${ym}" class="${cls}" ${has ? "" : 'disabled title="데이터 없음"'}>${i + 1}월</button>`;
    }).join("");
    const last = allMonths[allMonths.length - 1];
    const presets = YEARS.map((y) => [`${y}년`, Math.max(y * 100 + 1, allMonths[0]), Math.min(y * 100 + 12, last)])
      .concat([["전체 기간", allMonths[0], last]]);
    $("mp-foot").innerHTML = presets.map(([t, a, b]) => `<button type="button" data-a="${a}" data-b="${b}">${t}</button>`).join("");
  }
  const setPeriod = (a, b) => { S.start = a; S.end = b; closePicker(); syncControls(); render(); };
  $("f-start").addEventListener("click", (e) => { e.stopPropagation(); openPicker("start"); });
  $("f-end").addEventListener("click", (e) => { e.stopPropagation(); openPicker("end"); });
  $("mp-prev").addEventListener("click", () => { mp.year--; renderPicker(); });
  $("mp-next").addEventListener("click", () => { mp.year++; renderPicker(); });
  $("mp-grid").addEventListener("click", (e) => {
    const ym = Number(e.target.dataset.ym);
    if (!ym || e.target.disabled) return;
    // 시작이 종료보다 늦어지면(또는 반대) 나머지 한쪽을 같은 월로 맞춘다
    if (mp.target === "start") setPeriod(ym, Math.max(ym, S.end)); else setPeriod(Math.min(ym, S.start), ym);
  });
  $("mp-foot").addEventListener("click", (e) => { if (e.target.dataset.a) setPeriod(Number(e.target.dataset.a), Number(e.target.dataset.b)); });
  pop.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => { if (!pop.hidden) closePicker(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) closePicker(); });
  window.addEventListener("resize", () => { if (!pop.hidden) closePicker(); });
  $("sidebar").addEventListener("scroll", () => { if (!pop.hidden) closePicker(); });

  // 기간 범위 슬라이더(월 단위). 끄는 동안은 표시만 바꾸고, 놓으면 반영
  const ra = $("f-range-a"), rb = $("f-range-b");
  ra.max = rb.max = String(allMonths.length - 1);
  $("range-min").textContent = ymLabel(allMonths[0]); $("range-max").textContent = ymLabel(allMonths[allMonths.length - 1]);
  function syncRange() {
    const a = allMonths.indexOf(S.start), b = allMonths.indexOf(S.end), n = allMonths.length - 1;
    ra.value = a; rb.value = b;
    $("range-fill").style.left = (a / n) * 100 + "%"; $("range-fill").style.right = (100 - (b / n) * 100) + "%";
  }
  const sliderMonths = () => { const a = Math.min(+ra.value, +rb.value), b = Math.max(+ra.value, +rb.value); return [allMonths[a], allMonths[b]]; };
  [ra, rb].forEach((el) => {
    el.addEventListener("input", () => {
      const [a, b] = sliderMonths(), n = allMonths.length - 1;
      $("f-start").textContent = ymLabel(a); $("f-end").textContent = ymLabel(b);
      $("range-fill").style.left = (allMonths.indexOf(a) / n) * 100 + "%"; $("range-fill").style.right = (100 - (allMonths.indexOf(b) / n) * 100) + "%";
    });
    el.addEventListener("change", () => { const [a, b] = sliderMonths(); setPeriod(a, b); });
  });

  // 상단 기간 빠른 선택
  const PRESETS = YEARS.map((y) => [`${y}년`, Math.max(y * 100 + 1, allMonths[0]), Math.min(y * 100 + 12, allMonths[allMonths.length - 1])])
    .concat([["전체", allMonths[0], allMonths[allMonths.length - 1]]]);
  $("tb-presets").innerHTML = PRESETS.map(([t, a, b]) => `<button type="button" data-a="${a}" data-b="${b}">${t}</button>`).join("");
  $("tb-presets").addEventListener("click", (e) => { if (e.target.dataset.a) setPeriod(Number(e.target.dataset.a), Number(e.target.dataset.b)); });
  const syncPresets = () => $("tb-presets").querySelectorAll("button").forEach((btn) =>
    btn.classList.toggle("on", Number(btn.dataset.a) === S.start && Number(btn.dataset.b) === S.end));

  // 사이드바 메뉴: 현재 보이는 섹션 강조, 모바일에서는 메뉴 열고 닫기
  const navLinks = [...document.querySelectorAll("#nav a")];
  const secs = navLinks.map((a) => document.querySelector(a.getAttribute("href")));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((ents) => {
      ents.forEach((en) => { if (en.isIntersecting) navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id)); });
    }, { rootMargin: "-30% 0px -60% 0px" });
    secs.forEach((sec) => sec && io.observe(sec));
  }
  const setSidebar = (open) => { $("sidebar").classList.toggle("open", open); $("sb-backdrop").hidden = !open; $("sb-toggle").setAttribute("aria-expanded", String(open)); };
  $("sb-toggle").addEventListener("click", () => setSidebar(!$("sidebar").classList.contains("open")));
  $("sb-backdrop").addEventListener("click", () => setSidebar(false));
  navLinks.forEach((a) => a.addEventListener("click", () => setSidebar(false)));
  $("f-reset").addEventListener("click", () => { Object.assign(S, DEFAULT); syncControls(); render(); });

  const inRange = (m) => m >= S.start && m <= S.end;
  const rangeMonths = (list) => list.filter(inRange);
  const regionOn = () => S.sgg !== "all" || S.emd !== "all";
  const regionLabel = () => (S.emd !== "all" ? S.emd : S.sgg !== "all" ? S.sgg : "전체 지역");
  // 현재 지역 필터에 들어가는 읍면동 인덱스
  const scopeEmdIdx = () => D.region.emds.map((e, i) => [e, i])
    .filter(([e]) => (S.emd !== "all" ? e.name === S.emd : S.sgg === "all" || e.sgg === S.sgg)).map(([, i]) => i);
  // 읍면동 방문객(연령 무관) 월 합계: 선택 지역 범위, 내·외국인 필터 적용
  function regionMonthValue(m) {
    const j = D.region.months.indexOf(m);
    if (j < 0) return null;
    return sum(scopeEmdIdx().map((i) => D.region[S.visitor][i][j] || 0));
  }
  const allRegionMonthValue = (m) => { const j = D.region.months.indexOf(m); return j < 0 ? null : sum(D.region[S.visitor].map((a) => a[j] || 0)); };

  // ---------- 계산 ----------
  function ageValue(m, age, sex) {
    let v = 0, n = 0;
    for (const r of D.age.rows) {
      if (r[0] !== m) continue;
      if (age !== "all" && r[2] !== age) continue;
      if (sex !== "all" && r[1] !== sex) continue;
      v += r[3]; n++;
    }
    return n ? v : null;
  }

  function calcKpi() {
    const months = rangeMonths(D.age.months);
    const out = { months };
    if (!months.length) return out;
    out.value = sum(months.map((m) => ageValue(m, S.age, S.sex)));
    out.allAges = sum(months.map((m) => ageValue(m, "all", S.sex)));
    out.share = S.age === "all" ? null : out.value / out.allAges;
    const prev = months.map((m) => m - 100);
    out.missingPrev = prev.filter((m) => !D.age.months.includes(m));
    if (!out.missingPrev.length) {
      out.prevValue = sum(prev.map((m) => ageValue(m, S.age, S.sex)));
      out.yoy = out.value / out.prevValue - 1;
    }
    const im = rangeMonths(D.inbound.months);
    out.inbMonths = im;
    out.inbound = im.length ? sum(im.map((m) => D.inbound[S.visitor][D.inbound.months.indexOf(m)])) : null;
    // 선택 지역(읍면동 데이터, 연령 무관)
    const rm = rangeMonths(D.region.months);
    if (regionOn() && rm.length) {
      out.reg = { months: rm, value: sum(rm.map(regionMonthValue)), all: sum(rm.map(allRegionMonthValue)) };
      if (rm.every((m) => D.region.months.includes(m - 100))) {
        out.reg.prev = sum(rm.map((m) => regionMonthValue(m - 100)));
        out.reg.yoy = out.reg.value / out.reg.prev - 1;
      }
    }
    return out;
  }

  // 여름(7~8월) 집중도: 선택 기간에 1~12월이 모두 들어간 연도만 계산
  function calcSummer() {
    const years = [...new Set(rangeMonths(D.age.months).map((m) => Math.floor(m / 100)))]
      .filter((y) => Array.from({ length: 12 }, (_, i) => y * 100 + i + 1).every((m) => inRange(m) && D.age.months.includes(m)));
    return years.map((y) => {
      const ms = Array.from({ length: 12 }, (_, i) => y * 100 + i + 1);
      const tot = sum(ms.map((m) => ageValue(m, S.age, S.sex))), all = sum(ms.map((m) => ageValue(m, "all", S.sex)));
      const jul = ageValue(y * 100 + 7, S.age, S.sex), aug = ageValue(y * 100 + 8, S.age, S.sex);
      return { y, jul, aug, tot, share: (jul + aug) / tot,
        allShare: (ageValue(y * 100 + 7, "all", S.sex) + ageValue(y * 100 + 8, "all", S.sex)) / all };
    });
  }

  function calcTrendReg() {
    return rangeMonths(D.region.months).map((m) => {
      const v = regionMonthValue(m), p = D.region.months.includes(m - 100) ? regionMonthValue(m - 100) : null;
      return { m, v, p, yoy: p ? v / p - 1 : null };
    });
  }

  function calcTrend() {
    return rangeMonths(D.age.months).map((m) => {
      const v = ageValue(m, S.age, S.sex);
      const p = D.age.months.includes(m - 100) ? ageValue(m - 100, S.age, S.sex) : null;
      return { m, v, p, yoy: p ? v / p - 1 : null };
    });
  }

  function calcRegion() {
    const months = rangeMonths(D.region.months);
    const idx = months.map((m) => D.region.months.indexOf(m));
    if (!months.length) return { months, rows: [], total: 0 };
    const rows = D.region.emds.map((e, i) => ({ ...e, i }))
      .filter((e) => S.sgg === "all" || e.sgg === S.sgg)
      .map((e) => {
        const g = (k) => sum(idx.map((j) => D.region[k][e.i][j] || 0));
        const pIdx = months.map((m) => D.region.months.indexOf(m - 100));
        const prev = pIdx.every((j) => j >= 0) ? sum(pIdx.map((j) => D.region[S.visitor][e.i][j] || 0)) : null;
        return { ...e, dom: g("dom"), for: g("for"), tot: g("tot"), prev };
      })
      .sort((a, b) => b[S.visitor] - a[S.visitor]);
    const total = sum(rows.map((r) => r[S.visitor]));
    rows.forEach((r, k) => { r.rank = k + 1; r.share = total ? r[S.visitor] / total : null; r.yoy = r.prev ? r[S.visitor] / r.prev - 1 : null; });
    return { months, rows, total };
  }

  function topN(items, valFn, cutoffBound, n, nameFn) {
    const scored = items.map((it, i) => ({ it, i, v: valFn(i), name: nameFn(it) })).filter((x) => x.v > 0);
    scored.sort((a, b) => b.v - a.v || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); // 동점은 이름순
    const top = scored.slice(0, n);
    // 후보 밖 항목은 기간 합계가 cutoffBound를 넘을 수 없으므로, v >= bound인 순위까지는 확정
    let exact = 0;
    for (const x of top) { if (x.v >= cutoffBound) exact++; else break; }
    return { top, exact };
  }

  function calcPlaces() {
    const P = D.places;
    const months = rangeMonths(P.months);
    const idx = months.map((m) => P.months.indexOf(m));
    const inScope = (d) => (S.emd !== "all" ? d.emd === S.emd : S.sgg === "all" || d.sgg === S.sgg);
    const scope = P.dests.map((d, i) => ({ d, i })).filter((x) => inScope(x.d));
    const emds = Object.keys(P.cutoff).filter((e) => (S.emd !== "all" ? e === S.emd :
      S.sgg === "all" || (D.region.emds.find((x) => x.name === e) || {}).sgg === S.sgg));
    const bound = Math.max(0, ...emds.map((e) => sum(idx.map((j) => P.cutoff[e][S.pmetric][j]))));
    const val = (k) => (i) => sum(idx.map((j) => P[k][scope[i].i][j]));
    const r = topN(scope, val(S.pmetric), bound, 20, (x) => x.d.n);
    const rows = r.top.map((x, k) => {
      const gi = scope[x.i].i;
      return { rank: k + 1, ...scope[x.i].d, tour: sum(idx.map((j) => P.tour[gi][j])),
        res: sum(idx.map((j) => P.res[gi][j])), all: sum(idx.map((j) => P.all[gi][j])) };
    });
    return { months, rows, exact: r.exact, bound };
  }

  function calcSearch() {
    const V = D.search;
    const months = rangeMonths(V.months);
    const idx = months.map((m) => V.months.indexOf(m));
    const cats = S.scat === "all" ? V.cats : [S.scat];
    // 지역 범위: 읍·면은 주소로 판별, 동은 판별 불가라 시군구로 대체
    const key = S.emd !== "all" && V.scopes.includes(S.emd) ? S.emd : S.sgg !== "all" ? S.sgg : "all";
    const fallback = S.emd !== "all" && key !== S.emd;
    const inReg = (it) => (key === "all" ? true : key === S.emd ? it.emd === key : it.sgg === key);
    const scope = V.items.map((it, i) => ({ it, i })).filter((x) => cats.includes(x.it.c) && inReg(x.it));
    const bound = Math.max(0, ...cats.map((c) => sum(idx.map((j) => V.cutoff[key][c][j]))));
    const r = topN(scope, (i) => sum(idx.map((j) => V.v[scope[i].i][j])), bound, 60, (x) => x.it.n);
    const rows = r.top.map((x, k) => {
      const gi = scope[x.i].i;
      return { rank: k + 1, ...scope[x.i].it, v: x.v, rows: sum(idx.map((j) => V.rows[gi][j])) };
    });
    const catTotals = V.cats.map((c) => ({ c, v: sum(idx.map((j) => V.catTotal[key][c][j])) }));
    return { months, rows, exact: r.exact, bound, catTotals, key, fallback };
  }

  // ---------- 렌더링 ----------
  function render() {
    const warn = [];
    if (S.start > S.end) {
      show("period-warn", "시작 월이 종료 월보다 늦습니다. 기간을 다시 선택하세요.");
      return;
    }
    $("hdr-period").textContent = `${ymLabel(S.start)} ~ ${ymLabel(S.end)} (데이터별 제공 기간이 다름 — 하단 '데이터 기준' 참고)`;
    const cover = (name, list) => {
      const r = rangeMonths(list), want = allMonths.filter(inRange).length;
      if (r.length < want) warn.push(`${name}: 선택 ${want}개월 중 ${r.length}개월만 데이터 있음 (제공 ${ymLabel(list[0])}~${ymLabel(list[list.length - 1])})`);
    };
    cover("연령대별 방문", D.age.months); cover("읍면동 방문객", D.region.months);
    cover("인기 장소", D.places.months); cover("비짓제주", D.search.months);
    show("period-warn", warn.length ? "기간 범위 안내 — " + warn.map(esc).join(" / ") : "");

    const ageLbl = `${AGE_LABEL(S.age)} · ${SEX_LABEL[S.sex]}`;
    const regionLbl = S.emd !== "all" ? S.emd : S.sgg !== "all" ? S.sgg : "전체 지역";

    // KPI
    const k = calcKpi();
    const ring = (id, v, color) => { const el = $(id); el.classList.toggle("na", v == null); el.style.setProperty("--p", v == null ? 0 : Math.max(0, Math.min(100, v * 100))); if (color) el.style.setProperty("--c", color); };
    k.summer = calcSummer();
    if (k.summer.length) {
      const last = k.summer[k.summer.length - 1];
      $("k-summer").textContent = pct(last.share, 2); ring("k-summer-ring", last.share, C.pink);
      $("k-summer-sub").textContent = k.summer.map((x) => `${x.y}년 ${pct(x.share, 2)}(전체 연령 ${pct(x.allShare, 2)})`).join(" · ") + ` — ${ageLbl} 연간 방문 중 7·8월 비중`;
    } else {
      $("k-summer").innerHTML = '<span class="na-v">계산 불가</span>'; ring("k-summer-ring", null);
      $("k-summer-sub").textContent = "1~12월이 모두 포함된 연도를 기간으로 선택하면 계산됩니다(예: 2024년, 2025년).";
    }
    if (!k.months.length) {
      ["k-visit", "k-yoy", "k-share"].forEach((id) => ($(id).innerHTML = '<span class="na-v">데이터 없음</span>')); ring("k-share-ring", null);
      $("k-visit-sub").textContent = "선택 기간에 연령대별 방문 데이터가 없습니다.";
      $("k-yoy-sub").textContent = ""; $("k-share-sub").textContent = "";
    } else {
      $("k-visit").textContent = fmt(k.value) + "명";
      $("k-visit-sub").textContent = `${ageLbl} 방문객 수 합계 (${k.months.length}개월, 연령대별 방문 데이터` + (regionOn() ? " · 이 데이터는 지역 구분이 없어 제주 전체)" : ")");
      if (k.yoy != null) {
        $("k-yoy").innerHTML = `<span class="${k.yoy >= 0 ? "up" : "down"}">${k.yoy >= 0 ? "+" : ""}${pct(k.yoy)}</span>`;
        $("k-yoy-sub").textContent = `전년 동기간 ${fmt(k.prevValue)}명 → 선택 기간 ${fmt(k.value)}명 (같은 월끼리 비교)`;
      } else {
        $("k-yoy").innerHTML = '<span class="na-v">계산 불가</span>';
        $("k-yoy-sub").textContent = `비교 대상 전년 월 데이터 없음: ${k.missingPrev.map(ymLabel).join(", ")} (데이터는 2024년 1월부터)`;
      }
      if (k.share != null) {
        $("k-share").textContent = pct(k.share); ring("k-share-ring", k.share, C.purple);
        $("k-share-sub").textContent = `전체 연령(${SEX_LABEL[S.sex]}) ${fmt(k.allAges)}명 중 ${AGE_LABEL(S.age)} 비중`;
      } else {
        $("k-share").innerHTML = '<span class="na-v">-</span>'; ring("k-share-ring", null);
        $("k-share-sub").textContent = "연령대를 선택하면 계산됩니다.";
      }
    }
    const period = `${ymLabel(S.start)} ~ ${ymLabel(S.end)}`;
    setTip("k-share-ring", k.share != null
      ? `<b>전체 연령 중 ${esc(AGE_LABEL(S.age))} 비중 ${pct(k.share, 2)}</b><br>${esc(AGE_LABEL(S.age))} 방문객 ${fmt(k.value)}명<br>÷ 전체 연령(${esc(SEX_LABEL[S.sex])}) ${fmt(k.allAges)}명` +
        `<hr><small>${esc(period)} · ${k.months.length}개월 합계 · 연령대별 방문 데이터(지역 구분 없음)</small>`
      : `<b>전체 연령 중 비중</b><br>${k.months.length ? "연령대를 '전체'가 아닌 값으로 고르면 계산됩니다." : "선택 기간에 연령대별 방문 데이터가 없습니다."}`);
    setTip("k-summer-ring", k.summer.length
      ? `<b>여름(7~8월) 집중도</b> — ${esc(ageLbl)}<br>` + k.summer.map((x) =>
          `${x.y}년: (7월 ${fmt(x.jul)} + 8월 ${fmt(x.aug)}) ÷ 연간 ${fmt(x.tot)}명 = <b>${pct(x.share, 2)}</b><br><small>같은 해 전체 연령 ${pct(x.allShare, 2)}</small>`).join("<br>") +
        `<hr><small>1~12월이 모두 선택된 연도만 계산 · 큰 숫자는 가장 최근 연도</small>`
      : `<b>여름(7~8월) 집중도</b><br>1~12월이 모두 포함된 연도를 기간으로 고르면 계산됩니다(예: 2024년, 2025년).`);
    const regLine = (id, html) => { $(id).hidden = !html; $(id).innerHTML = html || ""; };
    if (k.reg) {
      const rl = `<b>선택 지역 ${esc(regionLabel())}</b> · ${esc(VIS_LABEL[S.visitor])} · 연령 구분 없음`;
      regLine("k-visit-reg", `${rl}<br>읍면동 방문객 ${fmt(k.reg.value)}명 (${k.reg.months.length}개월)`);
      regLine("k-yoy-reg", `${rl}<br>` + (k.reg.yoy != null ? `전년 동기간 대비 <b class="${k.reg.yoy >= 0 ? "up" : "down"}">${k.reg.yoy >= 0 ? "+" : ""}${pct(k.reg.yoy)}</b> (${fmt(k.reg.prev)} → ${fmt(k.reg.value)}명)` : "전년 비교 데이터 없음(계산 불가)"));
      regLine("k-share-reg", `${rl}<br>제주 전체 읍면동 합계 중 ${pct(k.reg.value / k.reg.all)}`);
    } else ["k-visit-reg", "k-yoy-reg", "k-share-reg"].forEach((id) => regLine(id, ""));
    if (k.inbound != null) {
      $("k-inb").textContent = fmt(k.inbound) + "명";
      $("k-inb-sub").textContent = `월별 입도 관광객(${VIS_LABEL[S.visitor]}) ${k.inbMonths.length}개월 합계 · 연령·지역 구분 없음 · 연령대 데이터와 집계 기준이 달라 직접 비교 불가`;
    } else { $("k-inb").innerHTML = '<span class="na-v">데이터 없음</span>'; $("k-inb-sub").textContent = "선택 기간에 입도 관광객 데이터가 없습니다."; }

    // 방문 추이
    const lineCfg = (rows, title, unit) => {
      const years = [...new Set(rows.map((r) => Math.floor(r.m / 100)))];
      return { type: "line",
        data: { labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
          datasets: years.map((y) => ({ label: `${y}년`, borderColor: YEAR_COLORS[y] || "#888", backgroundColor: alpha(YEAR_COLORS[y] || "#888888", 0.14), fill: true, pointRadius: 3, pointBackgroundColor: YEAR_COLORS[y] || "#888",
            data: Array.from({ length: 12 }, (_, i) => { const r = rows.find((x) => x.m === y * 100 + i + 1); return r ? r.v : null; }), tension: 0.25 })) },
        options: { plugins: { title: { display: true, text: title }, legend: { position: "top" },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw)}${unit}` } } },
          scales: { x: { title: axisTitle("월") }, y: { title: axisTitle(`방문객 수(${unit})`), ticks: { callback: (v) => fmt(v) } } } } };
    };
    const tr = calcTrend();
    badges("b-trend", [["기간", 1, "period"], ["연령대(위)", 1, "age"], ["성별(위)", 1, "sex"], ["지역(아래)", 1, "region"], ["내·외국인(아래)", 1, "visitor"]]);
    $("trend-desc").textContent = `위: 월별 ${ageLbl} 방문객 수(연령대별 방문 데이터, 지역 구분 없음) · 아래: ${regionLabel()} 읍면동 방문객 수(연령 구분 없음, ${VIS_LABEL[S.visitor]}). 두 데이터는 집계 기준이 달라 서로 비교하지 않음. 연도별로 선을 나눠 같은 월끼리 비교.`;
    if (!tr.length) { drawChart("trend", "c-trend", null); show("trend-empty", "선택 기간에 데이터가 없습니다."); }
    else {
      show("trend-empty", "");
      drawChart("trend", "c-trend", lineCfg(tr, `월별 ${ageLbl} 방문객 수`, "명"));
    }
    const trR = calcTrendReg();
    if (!trR.length) { drawChart("trendReg", "c-trend-reg", null); show("trend-reg-empty", "선택 기간에 읍면동 방문객 데이터가 없습니다."); }
    else { show("trend-reg-empty", ""); drawChart("trendReg", "c-trend-reg", lineCfg(trR, `월별 ${regionLabel()} 방문객 수 — ${VIS_LABEL[S.visitor]} (연령 구분 없음)`, "명")); }
    $("t-trend-reg").innerHTML = `<h3 class="mt">${esc(regionLabel())} 읍면동 방문객(연령 구분 없음)</h3>` + table([
      { label: "기준연월", get: (r) => ymLabel(r.m) }, { label: "방문객 수(명)", num: 1, get: (r) => fmt(r.v) },
      { label: "전년 동월(명)", num: 1, get: (r) => (r.p == null ? "데이터 없음" : fmt(r.p)) },
      { label: "전년 동월 대비", num: 1, get: (r) => (r.yoy == null ? "계산 불가" : (r.yoy >= 0 ? "+" : "") + pct(r.yoy)) }], trR);
    $("t-trend").innerHTML = `<h3 class="mt">${esc(ageLbl)} 방문객(연령대별 방문)</h3>` + table([
      { label: "기준연월", get: (r) => ymLabel(r.m) }, { label: "방문객 수(명)", num: 1, get: (r) => fmt(r.v) },
      { label: "전년 동월(명)", num: 1, get: (r) => (r.p == null ? "데이터 없음" : fmt(r.p)) },
      { label: "전년 동월 대비", num: 1, get: (r) => (r.yoy == null ? "계산 불가" : (r.yoy >= 0 ? "+" : "") + pct(r.yoy)) }], tr);

    // 지역별
    const rg = calcRegion();
    badges("b-region", [["기간", 1, "period"], ["시군구·읍면동", 1, "region"], ["내·외국인", 1, "visitor"], ["연령", 0, "age"]]);
    if (!rg.months.length) {
      drawChart("region", "c-region", null); show("region-empty", "선택 기간에 읍면동 방문객 데이터가 없습니다.");
      $("region-top5").innerHTML = "";
    } else {
      show("region-empty", "");
      // 막대는 상위 15개 + (범위 밖이면) 선택 읍면동. 전체는 상세 표
      const bars = rg.rows.slice(0, 15);
      const selRow = rg.rows.find((r) => r.name === S.emd);
      if (selRow && !bars.includes(selRow)) bars.push(selRow);
      drawChart("region", "c-region", {
        type: "bar",
        data: { labels: bars.map((r) => (r.rank > 15 ? `${r.name} (${r.rank}위)` : r.name)), datasets: [{ label: `${VIS_LABEL[S.visitor]} 방문객 수(명)`,
          data: bars.map((r) => r[S.visitor]),
          backgroundColor: bars.map((r) => (S.emd === r.name ? C.amber : r.sgg === "제주시" ? C.purple : C.teal)), borderRadius: 6 }] },
        options: { indexAxis: "y", plugins: { title: { display: true, text: `${S.sgg === "all" ? "전체 지역" : S.sgg} 읍면동 방문객 상위 ${Math.min(15, rg.rows.length)} — ${VIS_LABEL[S.visitor]} (${rg.months.length}개월 합계)` },
          legend: { display: true, labels: { generateLabels: () => [
            { text: "제주시", fillStyle: C.purple, strokeStyle: C.purple }, { text: "서귀포시", fillStyle: C.teal, strokeStyle: C.teal },
            ...(S.emd !== "all" ? [{ text: `선택: ${S.emd}`, fillStyle: C.amber, strokeStyle: C.amber }] : [])] } },
          tooltip: { callbacks: { label: (c) => `${fmt(c.raw)}명` } } },
          scales: { x: { title: axisTitle("방문객 수(명)"), ticks: { callback: (v) => fmt(v) } }, y: { title: axisTitle("읍면동"), ticks: { autoSkip: false, font: { size: 11 } } } } },
      });
      const max5 = rg.rows[0] ? rg.rows[0].share : 1;
      $("region-top5").innerHTML = rg.rows.slice(0, 5).map((r) =>
        `<li><b>${esc(r.name)}</b> <small>(${esc(r.sgg)})</small> ${pct(r.share)}<div class="bar" style="width:${(r.share / max5) * 100}%"></div></li>`).join("");
    }
    renderMap(rg);
    $("t-region").innerHTML = table([
      { label: "순위", num: 1, get: (r) => r.rank }, { label: "시군구", get: (r) => r.sgg }, { label: "읍면동", get: (r) => r.name },
      { label: "읍면동코드", get: (r) => r.code }, { label: "내국인(명)", num: 1, get: (r) => fmt(r.dom) },
      { label: "외국인(명)", num: 1, get: (r) => fmt(r.for) }, { label: "총(명)", num: 1, get: (r) => fmt(r.tot) },
      { label: "비중", num: 1, get: (r) => pct(r.share) }], rg.months.length ? rg.rows : [], (r) => r.name === S.emd);

    // 인기 장소
    const pl = calcPlaces();
    badges("b-place", [["기간", 1, "period"], ["시군구·읍면동", 1, "region"], ["집계 기준", 1, "pmetric"], ["연령", 0, "age"]]);
    $("place-desc").textContent = `${regionLbl} 목적지별 ${PM_LABEL[S.pmetric]} 합계 (단위: 건, 내비게이션 도착 기준) · 유형은 원본 '카테고리 3단계' · 연령 구분 없음`;
    if (!pl.months.length || !pl.rows.length) {
      drawChart("place", "c-place", null); show("place-empty", "선택 조건에 해당하는 장소 데이터가 없습니다."); $("place-exact").textContent = "";
    } else {
      show("place-empty", "");
      const t10 = pl.rows.slice(0, 10);
      drawChart("place", "c-place", {
        type: "bar",
        data: { labels: t10.map((r) => r.n), datasets: [{ label: `${PM_LABEL[S.pmetric]}(건)`, data: t10.map((r) => r[S.pmetric]), backgroundColor: C.purple, borderRadius: 6 }] },
        options: { indexAxis: "y", plugins: { title: { display: true, text: `인기 장소 TOP 10 — ${PM_LABEL[S.pmetric]}` },
          tooltip: { callbacks: { afterLabel: (c) => `카테고리: ${t10[c.dataIndex].cat} · ${t10[c.dataIndex].emd}` } } },
          scales: { x: { title: axisTitle(`${PM_LABEL[S.pmetric]}(건)`), ticks: { callback: (v) => fmt(v) } }, y: { title: axisTitle("목적지명") } } },
      });
      $("place-exact").textContent = pl.exact >= pl.rows.length ? `순위 검증: 상위 ${pl.rows.length}위 전체 확정 (후보 외 장소의 최대 가능값 ${fmt(pl.bound)} 이하)`
        : `순위 검증: 상위 ${pl.exact}위까지 확정. 그 아래는 사전 집계 후보 밖 장소(최대 가능값 ${fmt(pl.bound)})가 끼어들 수 있어 근사치 — 추가 확인 필요`;
    }
    $("t-place").innerHTML = table([
      { label: "순위", num: 1, get: (r) => r.rank }, { label: "목적지명", get: (r) => r.n },
      { label: "카테고리(원본)", get: (r) => r.cat + (r.cats.length > 1 ? ` 외 ${r.cats.length - 1}` : "") },
      { label: "읍면동", get: (r) => r.emd }, { label: "관광객 도착 수", num: 1, get: (r) => fmt(r.tour) },
      { label: "도민 도착 수", num: 1, get: (r) => fmt(r.res) }, { label: "도착건수", num: 1, get: (r) => fmt(r.all) },
      { label: "주소", get: (r) => r.a }], pl.months.length ? pl.rows : []);

    // 검색어
    const sr = calcSearch();
    badges("b-search", [["기간", 1, "period"], ["검색 분류", 1, "scat"], ["지역(주소 기준)", 1, "region"], ["연령", 0, "age"]]);
    const RM = D.search.regionMatch;
    $("search-scope").textContent = (sr.key === "all" ? "지역: 전체" : `지역: ${sr.key} — 주소로 판별한 항목만 집계`) +
      (sr.fallback ? ` · ${S.emd}은(는) 동 지역이라 도로명 주소로 판별할 수 없어 ${sr.key} 기준으로 표시` : "") +
      ` (주소 판별률: 시군구 ${pct(RM.sgg / RM.items)}, 읍·면 지역 ${fmt(RM.eupmyeon)}개 항목)`;
    if (!sr.months.length || !sr.rows.length) {
      drawChart("search", "c-search", null); show("search-empty", "선택 조건에 해당하는 비짓제주 데이터가 없습니다.");
      $("c-wc").hidden = true; show("wc-fallback", ""); $("search-exact").textContent = ""; $("search-cats").textContent = "";
    } else {
      show("search-empty", "");
      const t20 = sr.rows.slice(0, 20);
      drawChart("search", "c-search", {
        type: "bar",
        data: { labels: t20.map((r) => r.n), datasets: [{ label: "비짓제주 수치 합계", data: t20.map((r) => r.v), backgroundColor: C.pink, borderRadius: 6 }] },
        options: { indexAxis: "y", plugins: { title: { display: true, text: "검색 수치 상위 20 (장소·행사명)" },
          tooltip: { callbacks: { afterLabel: (c) => `분류: ${t20[c.dataIndex].c}` } } },
          scales: { x: { title: axisTitle("수치 합계(원본 단위 미표기)"), ticks: { callback: (v) => fmt(v) } }, y: { title: axisTitle("장소·행사명"), ticks: { autoSkip: false, font: { size: 11 } } } } },
      });
      const cv = $("c-wc");
      if (HAS_WC) {
        cv.hidden = false; show("wc-fallback", "");
        const maxV = sr.rows[0].v, minV = sr.rows[sr.rows.length - 1].v;
        const palette = { 관광지: C.purple, 음식점: C.amber, 숙박: C.teal, 쇼핑: C.pink, "축제/행사": C.blue };
        const byName = Object.fromEntries(sr.rows.map((r) => [r.n, r]));
        WordCloud(cv, {
          list: sr.rows.map((r) => [r.n, r.v]),
          weightFactor: (v) => 11 + 30 * Math.sqrt((v - minV) / Math.max(1, maxV - minV)),
          fontFamily: "Malgun Gothic, Apple SD Gothic Neo, sans-serif", rotateRatio: 0, gridSize: 6, shrinkToFit: false,
          color: (w) => palette[(byName[w] || {}).c] || "#555", backgroundColor: "#fff",
        });
        wcStat.total = sr.rows.length; wcStat.drawn = 0; wcStat.skipped = 0;
        $("search-cats").textContent = "워드클라우드: 상위 60개 장소·행사명, 글자 크기 = 수치 합계(제곱근 비례), 색 = 분류(관광지 보라·음식점 주황·숙박 청록·쇼핑 분홍·축제/행사 파랑). 공간이 부족한 긴 이름은 생략될 수 있음(표에서 전체 확인). ";
      } else {
        cv.hidden = true;
        show("wc-fallback", "워드클라우드 라이브러리를 불러오지 못했습니다(오프라인 등). 아래 키워드 빈도 막대그래프와 표로 대체합니다.");
        $("search-cats").textContent = "";
      }
      $("search-exact").textContent = sr.exact >= sr.rows.length ? `순위 검증: 상위 ${sr.rows.length}개 전체 확정`
        : `순위 검증: 상위 ${sr.exact}위까지 확정, 이후는 근사(후보 외 최대 가능값 ${fmt(sr.bound)}) — 추가 확인 필요`;
      $("search-cats").textContent += "※ '축제/행사' 분류는 2026년 3월부터만 데이터에 있어, 그 이전 기간과 분류 구성을 비교할 수 없음. ";
      $("search-cats").textContent += "분류별 수치 합계(선택 기간): " + sr.catTotals.map((c) => `${c.c} ${fmt(c.v)}`).join(" · ");
    }
    $("t-search").innerHTML = table([
      { label: "순위", num: 1, get: (r) => r.rank }, { label: "장소·행사명(원본 '지역명')", get: (r) => r.n }, { label: "분류", get: (r) => r.c },
      { label: "수치 합계", num: 1, get: (r) => fmt(r.v) }, { label: "원본 행 수", num: 1, get: (r) => r.rows }, { label: "주소", get: (r) => r.a }],
      sr.months.length ? sr.rows.slice(0, 30) : []);

    const rv = renderReviews();
    renderOverview(pl, sr, rv);
    renderSummary({ k, tr, rg, pl, sr, rv, ageLbl, regionLbl });
    window.DASH_RESULT = { state: { ...S }, kpi: k, trend: tr, region: rg, places: pl, search: sr, reviews: rv };
    if (typeof syncPresets === "function") syncPresets();
    renderFilterChips();
  }

  // ---------- 지역별 방문 지도(Leaflet 히트맵) ----------
  // 강도 = 읍면동 방문객 수 ÷ 표시 범위 최댓값. 점 위치는 각 읍면동 경계의 면적 중심.
  // 경계 폴리곤은 투명하게 두고 마우스가 올라가면 설명 툴팁을 띄운다.
  const HEAT_GRADIENT = { 0.2: "#2ecc71", 0.45: "#9be15d", 0.65: "#ffe14d", 0.82: "#ffa53b", 1.0: "#e8402a" };
  const HAS_HEAT = HAS_L && typeof L.heatLayer === "function";
  let map = null, geoLayer = null, heatLayer = null, legendDiv = null, mapScopeKey = null;
  const BASE_STYLE = { color: "#ffffff", weight: 0.8, opacity: 0.55, fillColor: "#000", fillOpacity: 0.01 };
  function initMap() {
    if (!D.geo) { show("map-warn", "지도 경계 파일(geo/jeju_emd_ver20260701.geojson)이 없어 지도를 표시할 수 없습니다."); $("region-map").hidden = true; return; }
    if (!HAS_L) { show("map-warn", "지도 라이브러리(Leaflet)를 불러오지 못했습니다. 막대그래프와 표로 확인하세요."); $("region-map").hidden = true; return; }
    if (!HAS_HEAT) show("map-warn", "히트맵 플러그인(Leaflet.heat)을 불러오지 못해 읍면동 색 농도로 대신 표시합니다.");
    map = L.map("region-map", { scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 14 });
    map.fitBounds(L.geoJSON(D.geo).getBounds(), { padding: [10, 10] }); // 레이어 추가 전에 화면 범위를 정해야 경계 요소가 바로 생성됨
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16, attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors · 경계: vuski/admdongkor",
    }).addTo(map);
    if (HAS_HEAT) heatLayer = L.heatLayer([], { radius: 24, blur: 20, maxZoom: 9, max: 1.3, minOpacity: 0.25, gradient: HEAT_GRADIENT }).addTo(map);
    geoLayer = L.geoJSON(D.geo, {
      style: () => BASE_STYLE,
      onEachFeature: (f, layer) => {
        layer.on("click", () => {
          const e = D.region.emds.find((x) => String(x.code) === f.properties.adm_cd2);
          if (!e) return;
          if (S.emd === e.name) S.emd = "all"; else { S.emd = e.name; S.sgg = e.sgg; }
          syncControls(); render();
        });
        layer.on("mouseover", () => { if (layer.options.weight < 2.5) layer.setStyle({ color: "#334155", weight: 2, opacity: 0.9 }); });
        layer.on("mouseout", () => { if (layer.options.weight < 2.5) layer.setStyle({ color: BASE_STYLE.color, weight: BASE_STYLE.weight, opacity: BASE_STYLE.opacity }); });
      },
    }).addTo(map);
    const legend = L.control({ position: "topright" });
    legend.onAdd = () => (legendDiv = L.DomUtil.create("div", "map-legend"));
    legend.addTo(map);
  }
  function renderMap(rg) {
    if (!map) return;
    const byCode = Object.fromEntries(rg.rows.map((r) => [String(r.code), r]));
    const maxV = Math.max(0, ...rg.rows.map((r) => r[S.visitor]));
    const minV = rg.rows.length ? Math.min(...rg.rows.map((r) => r[S.visitor])) : 0;
    const pts = rg.rows.filter((r) => r.center && maxV).map((r) => [r.center[0], r.center[1], r[S.visitor] / maxV]);
    if (heatLayer) heatLayer.setLatLngs(pts);
    const out = [];
    geoLayer.eachLayer((layer) => {
      const code = layer.feature.properties.adm_cd2, r = byCode[code];
      const sel = r && r.name === S.emd;
      const inten = r && maxV ? r[S.visitor] / maxV : null;
      const fill = HAS_HEAT ? { fillColor: "#000", fillOpacity: 0.01 } : { fillColor: "#e8402a", fillOpacity: inten ? 0.1 + 0.7 * inten : 0.03 };
      layer.setStyle(sel ? { ...fill, color: "#e0832b", weight: 3, opacity: 1 } : { ...BASE_STYLE, ...fill });
      if (sel) layer.bringToFront();
      if (layer.getElement()) layer.getElement().setAttribute("data-code", code);
      const nm = layer.feature.properties.adm_nm.replace("제주특별자치도 ", "");
      layer.unbindTooltip().bindTooltip(r
        ? `<b>${esc(nm)}</b><br>${esc(VIS_LABEL[S.visitor])} 방문객 <b>${fmt(r[S.visitor])}명</b> (${rg.months.length}개월)` +
          `<br>순위 ${r.rank}/${rg.rows.length} · 비중 ${pct(r.share)} · 강도 ${Math.round(inten * 100)}%` +
          `<br>전년 동기간 대비 ${r.yoy == null ? "계산 불가" : (r.yoy >= 0 ? "+" : "") + pct(r.yoy)}` +
          `<br><small>내국인 ${fmt(r.dom)} · 외국인 ${fmt(r.for)} · 클릭하면 이 지역으로 필터</small>`
        : `<b>${esc(nm)}</b><br>${rg.months.length ? "선택 지역 범위 밖" : "선택 기간 데이터 없음"}`, { sticky: true, direction: "top", offset: [0, -8] });
      out.push({ code, value: r ? r[S.visitor] : null, intensity: inten });
    });
    if (rg.months.length && rg.rows.length) {
      const grad = Object.entries(HEAT_GRADIENT).sort((x, y) => x[0] - y[0]).map(([k, c]) => `${c} ${Math.round(k * 100)}%`).join(", ");
      legendDiv.innerHTML = `<b>${esc(VIS_LABEL[S.visitor])} 방문 강도</b><div class="heat-legend" style="background:linear-gradient(90deg, ${grad})"></div>` +
        `<div class="heat-legend-lbl"><span>${fmt(minV)}</span><span>${fmt(maxV)}명</span></div>` +
        `<div style="color:#666">${rg.months.length}개월 합계 · 표시 범위 최댓값 기준<br>가까운 지역은 겹쳐 더 진하게 보임<br>마우스를 올리면 상세 수치</div>`;
    } else legendDiv.innerHTML = "<b>선택 기간 데이터 없음</b>";
    const key = S.sgg;
    if (key !== mapScopeKey) {
      mapScopeKey = key;
      const lays = [];
      geoLayer.eachLayer((l) => { if (S.sgg === "all" || l.feature.properties.sggnm === S.sgg) lays.push(l); });
      map.invalidateSize();
      map.fitBounds(L.featureGroup(lays).getBounds(), { padding: [10, 10] });
    }
    window.DASH_MAP = { maxV, heatPoints: pts, features: out, heat: HAS_HEAT };
  }

  // ---------- 온라인 후기 ----------
  function calcReviews() {
    const R = D.reviews;
    if (!R) return null;
    const notes = [];
    let posts = R.posts.filter((p) => S.rall || inRange(Math.floor(Number(p.date) / 100)));
    if (S.age !== 20 && S.age !== "all") { notes.push(`후기는 '20대' 글만 수집해 ${AGE_LABEL(S.age)} 선택 시 표시할 자료가 없습니다.`); posts = []; }
    const eupmyeon = S.emd !== "all" && S.emd.slice(-1) !== "동";
    if (S.emd !== "all" && eupmyeon) posts = posts.filter((p) => p.emd.includes(S.emd));
    else if (regionOn()) {
      if (S.emd !== "all") notes.push(`${S.emd}은(는) 동 지역이라 요약문 지명으로 판별할 수 없어 ${S.sgg} 기준으로 표시합니다.`);
      posts = posts.filter((p) => p.sgg.includes(S.sgg));
    }
    if (regionOn()) notes.push(`지역은 제목·요약문의 지명 언급(읍·면 이름과 대표 관광지)으로 추정 — 전체 ${R.posts.length}건 중 ${R.posts.filter((p) => p.sgg.length).length}건만 지역 판별 가능.`);
    const topics = R.topics.map((t) => {
      const hits = posts.filter((p) => p.codes[t.id]);
      return { ...t, n: hits.length, share: posts.length ? hits.length / posts.length : null, hits };
    });
    return { posts, topics, n: posts.length, notes };
  }

  function renderReviews() {
    const R = D.reviews;
    if (!R) {
      badges("b-review", [["데이터 없음", 0]]);
      $("review-desc").textContent = "";
      show("review-empty", "reviews/naver_blog_analysis.json이 없습니다. scripts/collect_naver_blog.py → analyze_reviews.py → build_data.py 순서로 실행하세요.");
      return null;
    }
    const rv = calcReviews();
    badges("b-review", [["기간(작성일)", !S.rall, "period"], ["연령(20대 글만)", 1, "age"], ["지역(지명 언급)", 1, "region"], ["성별", 0, "sex"]]);
    $("review-desc").innerHTML = `네이버 블로그 검색 API(${esc(R.collected_at)} 수집) · 검색어 ${R.queries.map((q) => `'${esc(q)}'`).join(", ")} · ` +
      `분석 대상: 제목에 20대·제주가 있고 20대 본인·일행 여행 후기로 분류된 글 <b>${rv.n}건</b>` +
      (rv.n ? ` (작성일 ${ymLabel(Math.floor(Number(rv.posts[0].date) / 100))} ~ ${ymLabel(Math.floor(Number(rv.posts[rv.n - 1].date) / 100))})` : "");
    const small = rv.n && rv.n < 30 ? `선택 조건의 후기가 ${rv.n}건뿐이라 비율 해석에 주의가 필요합니다.` : "";
    const msgs = rv.notes.slice();
    if (!rv.n) msgs.push("선택 조건에 해당하는 후기가 없습니다. '전체 수집 기간 보기'를 켜거나 지역을 넓혀 보세요.");
    else if (small) msgs.push(small);
    show("review-empty", msgs.map(esc).join("<br>"));
    const item = (t) => `<li><details><summary><span>${esc(t.name)}</span><span class="cnt">${t.n}건 · ${pct(t.share, 0)}</span></summary>` +
      `<ul class="ev">${t.hits.slice(0, 6).map((p) => `<li>“${esc(p.codes[t.id])}” <a href="${esc(p.link)}" target="_blank" rel="noopener">원문</a> <small>${esc(p.date)}</small></li>`).join("")}` +
      `${t.n > 6 ? `<li>외 ${t.n - 6}건 (아래 글 목록 참고)</li>` : ""}</ul></details>` +
      `<div class="bar" style="width:${rv.n ? (t.n / rv.n) * 100 : 0}%"></div></li>`;
    for (const g of ["activity", "satisfaction", "complaint", "context"]) {
      const list = rv.topics.filter((t) => t.group === g);
      if (g !== "context") list.sort((a, b) => b.n - a.n);
      $(`r-${g}`).innerHTML = rv.n ? list.map(item).join("") : "";
    }
    $("t-review-funnel").innerHTML = table([{ label: "단계", get: (r) => r[0] }, { label: "글 수", num: 1, get: (r) => fmt(r[1]) }], R.funnel);
    const names = Object.fromEntries(R.topics.map((t) => [t.id, t.name]));
    $("t-review").innerHTML = table([
      { label: "작성일", get: (r) => r.date }, { label: "제목", html: (r) => `<a href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.title)}</a>` },
      { label: "분류 메모", get: (r) => r.note },
      { label: "언급 주제", get: (r) => Object.keys(r.codes).map((k) => names[k]).join(", ") }], rv.posts.slice().reverse());
    return rv;
  }

  // ---------- 개요 카드 ----------
  const ringCard = (t, color) => {
    const tip = `<b>${esc(t.name)} ${pct(t.share, 1)}</b><br>20대 여행 후기 ${t.total}건 중 ${t.n}건이 언급<br>` +
      `<small>${{ activity: "주요 활동", context: "여행 형태·계기·이동" }[t.group] || ""} · 제목·요약문 키워드 규칙 기준(감성 분석 아님)<br>현재 기간·지역 필터가 적용된 글 기준</small>`;
    return `<div class="ring-card"><div class="ring" style="--p:${(t.share || 0) * 100};--c:${color}" data-tip="${esc(tip)}" tabindex="0" role="img" aria-label="${esc(t.name)} ${pct(t.share, 1)}, ${t.total}건 중 ${t.n}건"><b>${pct(t.share, 0)}</b></div>` +
      `<span>${esc(t.name)}</span><small>${t.n}건</small></div>`;
  };
  function topReviewTopics(rv, n) {
    if (!rv || !rv.n) return [];
    return rv.topics.filter((t) => (t.group === "activity" || t.group === "context") && t.n > 0)
      .sort((a, b) => b.n - a.n).slice(0, n).map((t) => ({ ...t, total: rv.n }));
  }
  function renderOverview(pl, sr, rv) {
    const list = (rows, val, extra) => {
      if (!rows.length) return '<li class="na">선택 조건에 데이터가 없습니다.</li>';
      const mx = val(rows[0]) || 1;
      return rows.slice(0, 5).map((r) => `<li><span class="nm" title="${esc(r.n)}">${esc(r.n)}<small>${esc(extra(r))}</small></span>` +
        `<span class="v">${fmt(val(r))}</span><div class="bar" style="width:${(val(r) / mx) * 100}%"></div></li>`).join("");
    };
    $("ov-places").innerHTML = list(pl.rows, (r) => r[S.pmetric], (r) => r.emd);
    $("ov-search").innerHTML = list(sr.rows, (r) => r.v, (r) => r.c);
    $("ov-search").classList.add("pink");
    const colors = [C.purple, C.pink, C.teal, C.amber, C.blue, C.purple];
    const t3 = topReviewTopics(rv, 3), t6 = topReviewTopics(rv, 6);
    const none = '<p class="na">선택 조건에 해당하는 후기가 없습니다.</p>';
    $("ov-review").innerHTML = t3.length ? t3.map((t, i) => ringCard(t, colors[i])).join("") : none;
    $("r-rings").innerHTML = t6.length ? t6.map((t, i) => ringCard(t, colors[i])).join("") : "";
  }

  // ---------- 도넛 툴팁 ----------
  const tipEl = document.createElement("div");
  tipEl.className = "tip"; tipEl.setAttribute("role", "tooltip"); tipEl.hidden = true;
  document.body.appendChild(tipEl);
  function setTip(id, html) {
    const el = $(id);
    el.dataset.tip = html; el.tabIndex = 0; el.setAttribute("role", "img");
    el.setAttribute("aria-label", html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }
  function placeTip(x, y) {
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - w - 8)) + "px";
    tipEl.style.top = (y + 16 + h > window.innerHeight ? y - h - 12 : y + 16) + "px";
  }
  const showTip = (el, x, y) => { tipEl.innerHTML = el.dataset.tip; tipEl.hidden = false; placeTip(x, y); };
  document.addEventListener("mouseover", (e) => { const el = e.target.closest("[data-tip]"); if (el) showTip(el, e.clientX, e.clientY); });
  document.addEventListener("mousemove", (e) => { if (!tipEl.hidden && e.target.closest("[data-tip]")) placeTip(e.clientX, e.clientY); });
  document.addEventListener("mouseout", (e) => { const el = e.target.closest("[data-tip]"); if (el && !el.contains(e.relatedTarget)) tipEl.hidden = true; });
  document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left, r.bottom - 8); } });
  document.addEventListener("focusout", (e) => { if (e.target.closest("[data-tip]")) tipEl.hidden = true; });
  window.addEventListener("scroll", () => { tipEl.hidden = true; }, { passive: true });

  // ---------- 필터 색 표시: 칩·사이드바 ----------
  function narrowing(key) {
    return { period: !(S.start === allMonths[0] && S.end === allMonths[allMonths.length - 1]), age: S.age !== "all", sex: S.sex !== "all",
      region: regionOn(), visitor: S.visitor !== "tot", pmetric: true, scat: S.scat !== "all" }[key];
  }
  function fValue(key) {
    return { period: `${ymLabel(S.start)} ~ ${ymLabel(S.end)}`, age: AGE_LABEL(S.age), sex: SEX_LABEL[S.sex], region: regionLabel(),
      visitor: VIS_LABEL[S.visitor], pmetric: PM_LABEL[S.pmetric], scat: S.scat === "all" ? "전체 분류" : S.scat }[key];
  }
  const CTRL_KEY = { "f-start": "period", "f-end": "period", "f-age": "age", "f-sex": "sex", "f-sgg": "region", "f-emd": "region",
    "f-visitor": "visitor", "f-pmetric": "pmetric", "f-scat": "scat" };
  const ctrlBox = (id) => $(id).closest(".sb-field, .inline-filter");
  Object.entries(CTRL_KEY).forEach(([id, key]) => { const b = ctrlBox(id); b.classList.add("fk"); b.style.setProperty("--fc", FKEY[key].color); });
  const CLEAR = { period: () => { S.start = allMonths[0]; S.end = allMonths[allMonths.length - 1]; }, age: () => { S.age = "all"; }, sex: () => { S.sex = "all"; },
    region: () => { S.sgg = "all"; S.emd = "all"; }, visitor: () => { S.visitor = "tot"; }, scat: () => { S.scat = "all"; } };
  const FOCUS = { period: "f-start", age: "f-age", sex: "f-sex", region: "f-sgg", visitor: "f-visitor", pmetric: "f-pmetric", scat: "f-scat" };
  function renderFilterChips() {
    const keys = ["period", "age", "sex", "region", "visitor", "pmetric", "scat"];
    $("fchips").innerHTML = '<span class="ttl">적용 중인 필터</span>' + keys.map((k) => {
      const on = narrowing(k), f = FKEY[k];
      return `<span class="fchip ${on ? "on" : "idle"}" style="--fc:${f.color}"><button type="button" class="go" data-key="${k}" title="${esc(f.label)} 필터로 이동">` +
        `<span class="dot"></span><span class="k">${esc(f.label)}</span>${esc(fValue(k))}</button>` +
        (on && CLEAR[k] ? `<button type="button" class="x" data-clear="${k}" aria-label="${esc(f.label)} 필터 해제" title="해제">×</button>` : "") + "</span>";
    }).join("");
    Object.entries(CTRL_KEY).forEach(([id, key]) => ctrlBox(id).classList.toggle("narrow", key !== "pmetric" && narrowing(key)));
  }
  $("fchips").addEventListener("click", (e) => {
    const x = e.target.closest("[data-clear]"), go = e.target.closest("[data-key]");
    if (x) { CLEAR[x.dataset.clear](); syncControls(); render(); return; }
    if (go) {
      const el = $(FOCUS[go.dataset.key]);
      if (el.closest(".sidebar") && window.innerWidth <= 900) setSidebar(true);
      el.scrollIntoView({ block: "center", behavior: "smooth" }); el.focus({ preventScroll: true });
    }
  });

  // ---------- 통합 검색: 장소·검색어·읍면동 ----------
  function runSearch(q) {
    const box = $("q-results");
    q = q.trim();
    if (!q) { box.hidden = true; return; }
    const pm = D.places.months.map((m, j) => (inRange(m) ? j : -1)).filter((j) => j >= 0);
    const vm = D.search.months.map((m, j) => (inRange(m) ? j : -1)).filter((j) => j >= 0);
    const emds = D.region.emds.filter((e) => e.name.includes(q)).slice(0, 5);
    const places = D.places.dests.map((d, i) => ({ d, v: sum(pm.map((j) => D.places[S.pmetric][i][j])) }))
      .filter((x) => x.d.n.includes(q) && x.v > 0).sort((a, b) => b.v - a.v).slice(0, 6);
    const items = D.search.items.map((it, i) => ({ it, v: sum(vm.map((j) => D.search.v[i][j])) }))
      .filter((x) => x.it.n.includes(q) && x.v > 0).sort((a, b) => b.v - a.v).slice(0, 6);
    const grp = (title, arr, f) => (arr.length ? `<h4>${title}</h4>` + arr.map(f).join("") : "");
    box.innerHTML = grp("읍면동 — 누르면 지역 필터", emds, (e) => `<button type="button" data-kind="emd" data-v="${esc(e.name)}"><span>${esc(e.name)} <small>${esc(e.sgg)}</small></span><span class="v">지역 선택</span></button>`) +
      grp(`인기 장소 — ${PM_LABEL[S.pmetric]}(선택 기간)`, places, (x) => `<button type="button" data-kind="place" data-v="${esc(x.d.n)}" data-emd="${esc(x.d.emd)}"><span>${esc(x.d.n)} <small>${esc(x.d.emd)}</small></span><span class="v">${fmt(x.v)}건</span></button>`) +
      grp("검색 수치(선택 기간)", items, (x) => `<button type="button" data-kind="search" data-v="${esc(x.it.n)}" data-c="${esc(x.it.c)}"><span>${esc(x.it.n)} <small>${esc(x.it.c)}</small></span><span class="v">${fmt(x.v)}</span></button>`) ||
      '<p class="empty">선택 기간에 일치하는 읍면동·장소·검색 항목이 없습니다. (장소·검색어는 사전 집계 후보 안에서만 찾습니다)</p>';
    box.hidden = false;
  }
  function flashRow(tableId, name) {
    const row = [...document.querySelectorAll(`#${tableId} tbody tr`)].find((tr) => [...tr.cells].some((td) => td.textContent === name));
    if (!row) return false;
    const det = row.closest("details"); if (det) det.open = true;
    row.classList.remove("flash"); void row.offsetWidth; row.classList.add("flash");
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  }
  let qTimer = null;
  $("q-search").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => runSearch(e.target.value), 150); });
  $("q-search").addEventListener("focus", (e) => { if (e.target.value.trim()) runSearch(e.target.value); });
  $("q-search").addEventListener("keydown", (e) => { if (e.key === "Escape") { $("q-results").hidden = true; e.target.blur(); } });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) $("q-results").hidden = true; });
  $("q-results").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-kind]");
    if (!b) return;
    $("q-results").hidden = true;
    const kind = b.dataset.kind, v = b.dataset.v;
    if (kind === "emd" || kind === "place") {
      const em = D.region.emds.find((x) => x.name === (kind === "emd" ? v : b.dataset.emd));
      if (em) { S.emd = em.name; S.sgg = em.sgg; syncControls(); render(); }
      if (kind === "emd") document.getElementById("sec-region").scrollIntoView({ behavior: "smooth" });
      else if (!flashRow("t-place", v)) document.getElementById("sec-places").scrollIntoView({ behavior: "smooth" });
    } else {
      S.scat = b.dataset.c; syncControls(); render();
      if (!flashRow("t-search", v)) document.getElementById("sec-search").scrollIntoView({ behavior: "smooth" });
    }
  });

  // ---------- 분석 결과 요약 ----------
  function renderSummary({ k, tr, rg, pl, sr, rv, ageLbl, regionLbl }) {
    const fact = [], interp = [], check = [], action = [];
    const li = (arr) => arr.map((t) => `<li>${t}</li>`).join("") || "<li>현재 필터에서 산출할 항목이 없습니다.</li>";
    if (k.months.length) {
      fact.push(`${ageLbl} 방문객 수: ${fmt(k.value)}명 (${k.months.length}개월 합계)` +
        (k.yoy != null ? `, 전년 동기간 대비 ${k.yoy >= 0 ? "+" : ""}${pct(k.yoy)}` : ", 전년 대비는 비교 데이터가 없어 계산 불가"));
      if (k.share != null) fact.push(`같은 기간 전체 연령 중 ${AGE_LABEL(S.age)} 비중 ${pct(k.share)}`);
    }
    let peak = null, low = null;
    if (tr.length >= 2) {
      peak = tr.reduce((a, b) => (b.v > a.v ? b : a)); low = tr.reduce((a, b) => (b.v < a.v ? b : a));
      fact.push(`월별 최대 ${ymLabel(peak.m)} ${fmt(peak.v)}명, 최소 ${ymLabel(low.m)} ${fmt(low.v)}명`);
    }
    if (rg.months.length && rg.rows.length)
      fact.push(`${VIS_LABEL[S.visitor]} 방문객 최다 읍면동(${esc(rg.rows.length === D.region.emds.length ? "전체 지역" : S.sgg)} 범위): ${rg.rows.slice(0, 3).map((r) => esc(r.name)).join(", ")} — 연령 무관 전체 방문객 기준`);
    if (pl.rows.length)
      fact.push(`${PM_LABEL[S.pmetric]} 상위 장소: ${pl.rows.slice(0, 3).map((r) => `${esc(r.n)}(${esc(r.cat)})`).join(", ")} — 연령 무관`);
    if (sr.rows.length)
      fact.push(`비짓제주 수치 상위: ${sr.rows.slice(0, 3).map((r) => `${esc(r.n)}(${esc(r.c)})`).join(", ")} — 검색 관심 지표이며 방문 수 아님`);

    const top = (g, n) => (rv ? rv.topics.filter((t) => t.group === g && t.n > 0).sort((a, b) => b.n - a.n).slice(0, n) : []);
    const tlist = (arr) => arr.map((t) => `${esc(t.name)} ${t.n}건`).join(", ");
    if (rv && rv.n) {
      fact.push(`20대 제주 여행 블로그 후기 ${rv.n}건에서 많이 언급된 활동: ${tlist(top("activity", 3))} (요약문 기준 언급 수)`);
      if (top("complaint", 1).length) fact.push(`불편 관련 언급: ${tlist(top("complaint", 3))} — 표본이 작아 경향으로 보기 어려움`);
    }

    if (peak) {
      const pm = peak.m % 100;
      interp.push(`${pm}월에 ${AGE_LABEL(S.age)} 방문이 가장 많아 해당 시기 수요가 높을 가능성. 연도마다 반복되는지 다른 연도와 비교해 확인 필요`);
    }
    interp.push("지역·장소·검색 데이터에는 연령 정보가 없어, 위 지역·장소 특성이 20대에게도 같게 나타나는지는 알 수 없음");
    if (rv && rv.n) {
      const ctx = Object.fromEntries(rv.topics.filter((t) => t.group === "context").map((t) => [t.id, t]));
      interp.push(`후기에서 혼자 여행(${ctx.solo.n}건)과 '20대 마지막' 기념 여행(${ctx.last20.n}건) 언급이 많음 — 혼행·기념 여행 수요가 있을 가능성(블로그 작성자 특성이 반영됐을 수 있음)`);
      if (ctx.walk.n > ctx.car.n) interp.push(`뚜벅이·대중교통(${ctx.walk.n}건) 언급이 렌터카(${ctx.car.n}건)보다 많음 — 운전하지 않는 20대의 이동 편의가 관심사일 가능성`);
    }
    const evTop = sr.rows.slice(0, 10).filter((r) => r.c === "축제/행사").length;
    if (sr.rows.length && evTop) interp.push(`검색 수치 상위 10개 중 축제/행사 ${evTop}개 — 행사·팝업에 관심이 몰릴 가능성. 실제 참여·방문 여부는 별도 자료 필요`);
    const nonTour = pl.rows.slice(0, 10).filter((r) => /공항|항|렌트|주차|편의점|아파트|빌라/.test(r.cat + r.n)).length;
    if (pl.rows.length && nonTour) interp.push(`도착 수 상위 10곳 중 ${nonTour}곳이 공항·렌터카·교통·생활 시설로, 도착 수가 관광 매력도와 같지 않을 수 있음`);

    const ratio = (() => {
      const ms = k.months.filter((m) => D.inbound.months.includes(m));
      if (!ms.length) return null;
      return sum(ms.map((m) => ageValue(m, "all", "all"))) / sum(ms.map((m) => D.inbound.tot[D.inbound.months.indexOf(m)]));
    })();
    if (ratio) check.push(`연령대별 방문객 수가 같은 기간 입도 관광객 수의 약 ${ratio.toFixed(1)}배 — 집계 기준(도민 포함 여부, 중복 집계 등) 확인 필요`);
    check.push(D.reviews ? "블로그 후기는 API 요약문(약 200자)만 분석 — 원문 전체 분석 시 만족·불편 언급이 더 많이 잡힐 수 있음. 작성자 연령은 제목 표현으로만 판단(직접 확인 불가)"
      : "온라인 후기 데이터가 없어 주요 활동·만족·불편 요인은 분석하지 못함 — 후기 수집 필요");
    check.push("20대의 지역·장소·검색 행태: 연령별로 나뉜 지역·장소 데이터 필요");
    check.push("비짓제주 원본은 월·장소마다 보통 6~7행이며 행을 구분하는 컬럼이 없음 — '수치'의 정의(조회·검색 수 등)와 행 구성 확인 필요");
    check.push(`인기 장소 원본 중 ${fmt(D.places.mismatchRows)}행은 도착건수가 관광객+도민 합보다 1~69건 많음 — 미분류 도착 여부 확인 필요`);
    check.push("와이어프레임의 2023년 기간은 제공 데이터(2024년 1월~)에 없음");

    if (peak && low) action.push(`성수기(${peak.m % 100}월) 전에 청년층 대상 콘텐츠를 집중 홍보하고, 방문이 적은 ${low.m % 100}월에 분산 프로모션 검토`);
    if (rg.rows.length) action.push(`방문이 많은 ${rg.rows.slice(0, 2).map((r) => esc(r.name)).join("·")} 중심의 코스를 기획하되, 20대 수요는 연령별 데이터로 재확인`);
    if (sr.rows.length) action.push(`검색 수치 상위 장소·행사(${esc(sr.rows[0].n)} 등)를 홍보와 연계하고, 실제 방문 전환은 도착 데이터로 확인`);
    if (rv && rv.n) action.push("혼자 여행·뚜벅이 여행자를 위한 대중교통 동선, 게스트하우스 교류 프로그램 등 후기에서 자주 나온 여행 형태에 맞춘 콘텐츠 검토");
    else action.push("후기 데이터를 수집해 만족·불편 요인을 확인한 뒤 콘텐츠를 보완");

    $("s-fact").innerHTML = li(fact); $("s-interp").innerHTML = li(interp);
    $("s-check").innerHTML = li(check); $("s-action").innerHTML = li(action);
  }

  // ---------- 데이터 기준 표 ----------
  function ageRatio() {
    const r = D.age.months.filter((m) => D.inbound.months.includes(m))
      .map((m) => ageValue(m, "all", "all") / D.inbound.tot[D.inbound.months.indexOf(m)]);
    return `${Math.min(...r).toFixed(1)}~${Math.max(...r).toFixed(1)}`;
  }
  function renderSources() {
    const span = (l) => `${ymLabel(l[0])} ~ ${ymLabel(l[l.length - 1])}`;
    const rows = [
      ["제주 연령대별 방문", span(D.age.months), "월 × 성별(M/W) × 연령(10~70, 10단위)", "방문객수(명)", "방문 규모·추이", `입도 관광객과 기준 다름(월 합계가 같은 달 입도객의 ${ageRatio()}배). 연령 코드 70이 70대 이상인지는 추가 확인 필요`],
      ["월별 입도 관광객", span(D.inbound.months), "월", "내국인·외국인·전체(명)", "참고 지표", "전체 = 내국인 + 외국인 (전 월 일치 확인)"],
      ["제주 지역별 방문객(읍면동)", span(D.region.months), `월 × 읍면동(${D.region.emds.length}개)`, "내국인·외국인·총(명)", "지역별 방문(막대·지도)", "연령 없음. 읍면동 합계는 중복 집계 가능. 지도 경계: 행정동 경계(vuski/admdongkor ver20260701)를 읍면동코드로 43개 모두 연결"],
      ["제주 지역별 인기 장소", span(D.places.months), "월 × 목적지(목적지명+주소+읍면동)", "도착건수·관광객·도민 도착 수(건)", "인기 장소", `원본 ${fmt(D.places.rows)}행. 읍면동별·월별·지표별 상위 ${D.places.K}곳 후보(${fmt(D.places.dests.length)}곳)로 사전 집계, 순위 확정 여부 표시`],
      ["비짓제주 검색어 순위", span(D.search.months), "월 × 분류 × 장소·행사명", "수치(단위 미표기)", "관광 검색어", `원본 ${fmt(D.search.totalRows)}행, 같은 월·장소 행을 모두 합산(삭제 없음). '축제/행사' 분류는 2026년 3월부터만 존재. 분류별·월별 상위 ${D.search.K}개 후보(${fmt(D.search.items.length)}개)`],
      ["입도 관광객 추이(일별)", "2024년 1월 1일 ~ 2026년 10월 21일", "일", "명", "미사용", "와이어프레임에 해당 패널 없음. 월 합계가 월별 파일과 일부 다름(출처·기준 확인 필요)"],
      ["월간 국가별 외국인 입도객", span(D.inbound.months), "월 × 국가(11개)", "명", "미사용", "와이어프레임에 해당 패널 없음. '기타'가 월마다 2행"],
      ["1인당 여행경비 · 체류기간", "2016 ~ 2025 (연간 조사)", "연도 × 내국/외국/크루즈", "금액(단위 미표기)·일", "미사용", "월 단위 분석과 기준이 달라 제외. 2020~2022 외국인·크루즈 결측"],
      D.reviews ? ["네이버 블로그 후기", `작성일 ${D.reviews.posts[0].date} ~ ${D.reviews.posts[D.reviews.posts.length - 1].date} (${D.reviews.collected_at} 수집)`, "글",
        "주제 언급 글 수(건)", "온라인 후기", `검색 API 제목·요약문만 사용. 제목에 20대·제주가 있는 글을 사람이 읽고 분류해 ${D.reviews.posts.length}건 선별(reviews/review_labels.csv), 키워드 규칙으로 주제 언급 집계`]
        : ["온라인 후기", "-", "-", "-", "온라인 후기", "제공 데이터 없음 — 추가 확인 필요"],
    ];
    $("t-sources").innerHTML = table(["데이터", "기간", "집계 단위", "값(단위)", "사용 패널", "비고"].map((l, i) => ({ label: l, get: (r) => r[i] })), rows);
    $("gen-time").textContent = `data.js 생성: ${D.generated} (scripts/build_data.py)`;
  }

  $("c-wc").addEventListener("wordclouddrawn", (e) => { if (e.detail && e.detail.drawn) wcStat.drawn++; else wcStat.skipped++; });
  $("c-wc").addEventListener("wordcloudstop", () => {
    $("wc-status").textContent = `워드클라우드 표시 ${wcStat.drawn}/${wcStat.total}개` + (wcStat.skipped ? ` (공간 부족으로 ${wcStat.skipped}개 생략)` : "");
  });
  if (!HAS_CHART) show("lib-warn", "차트 라이브러리(Chart.js)를 불러오지 못했습니다. 인터넷 연결을 확인하세요. 지표와 상세 표는 그대로 표시됩니다.");
  syncControls();
  initMap();
  renderSources();
  render();
})();
