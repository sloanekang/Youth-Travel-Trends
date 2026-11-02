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
  const YEAR_COLORS = { 2024: "#2463eb", 2025: "#16a37f", 2026: "#e0832b" };

  function table(cols, rows, hlFn) {
    if (!rows.length) return '<p class="fine">표시할 데이터가 없습니다.</p>';
    const th = cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.label)}</th>`).join("");
    const tr = rows.map((r, i) => `<tr class="${hlFn && hlFn(r) ? "hl" : ""}">` +
      cols.map((c) => `<td class="${c.num ? "num" : ""}">${c.html ? c.html(r, i) : esc(c.get(r, i))}</td>`).join("") + "</tr>").join("");
    return `<div class="tbl-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
  }
  function badges(id, list) {
    $(id).innerHTML = list.map(([t, on]) => `<span class="badge ${on ? "" : "off"}">${esc(t)}</span>`).join("");
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
  const DEFAULT = { start: 202501, end: 202512, age: 20, sex: "all", sgg: "all", emd: "all", visitor: "tot", pmetric: "tour", scat: "all", rperiod: false };
  const S = Object.assign({}, DEFAULT);

  const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
  $("f-start").innerHTML = allMonths.map((m) => opt(m, ymLabel(m))).join("");
  $("f-end").innerHTML = allMonths.map((m) => opt(m, ymLabel(m))).join("");
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
    $("f-start").value = S.start; $("f-end").value = S.end; $("f-age").value = S.age;
    $("f-sex").value = S.sex; $("f-sgg").value = S.sgg; fillEmd();
    $("f-visitor").value = S.visitor; $("f-pmetric").value = S.pmetric; $("f-scat").value = S.scat;
    $("f-rperiod").checked = S.rperiod;
  }
  const bind = (id, key, num) => $(id).addEventListener("change", (e) => {
    const v = e.target.value; S[key] = num && v !== "all" ? Number(v) : v;
    if (key === "sgg") { S.emd = "all"; fillEmd(); }
    if (key === "emd" && S.emd !== "all") S.sgg = D.region.emds.find((x) => x.name === S.emd).sgg, $("f-sgg").value = S.sgg;
    render();
  });
  bind("f-start", "start", true); bind("f-end", "end", true); bind("f-age", "age", true); bind("f-sex", "sex");
  bind("f-sgg", "sgg"); bind("f-emd", "emd"); bind("f-visitor", "visitor"); bind("f-pmetric", "pmetric"); bind("f-scat", "scat");
  $("f-rperiod").addEventListener("change", (e) => { S.rperiod = e.target.checked; render(); });
  $("f-reset").addEventListener("click", () => { Object.assign(S, DEFAULT); syncControls(); render(); });

  const inRange = (m) => m >= S.start && m <= S.end;
  const rangeMonths = (list) => list.filter(inRange);

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
    out.inbound = im.length ? sum(im.map((m) => D.inbound.tot[D.inbound.months.indexOf(m)])) : null;
    return out;
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
        return { ...e, dom: g("dom"), for: g("for"), tot: g("tot") };
      })
      .sort((a, b) => b[S.visitor] - a[S.visitor]);
    const total = sum(rows.map((r) => r[S.visitor]));
    rows.forEach((r, k) => { r.rank = k + 1; r.share = total ? r[S.visitor] / total : null; });
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
    const scope = V.items.map((it, i) => ({ it, i })).filter((x) => cats.includes(x.it.c));
    const bound = Math.max(0, ...cats.map((c) => sum(idx.map((j) => V.cutoff[c][j]))));
    const r = topN(scope, (i) => sum(idx.map((j) => V.v[scope[i].i][j])), bound, 60, (x) => x.it.n);
    const rows = r.top.map((x, k) => {
      const gi = scope[x.i].i;
      return { rank: k + 1, ...scope[x.i].it, v: x.v, rows: sum(idx.map((j) => V.rows[gi][j])) };
    });
    const catTotals = V.cats.map((c) => ({ c, v: sum(idx.map((j) => V.catTotal[c][j])) }));
    return { months, rows, exact: r.exact, bound, catTotals };
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
    if (!k.months.length) {
      ["k-visit", "k-yoy", "k-share"].forEach((id) => ($(id).innerHTML = '<span class="na-v">데이터 없음</span>'));
      $("k-visit-sub").textContent = "선택 기간에 연령대별 방문 데이터가 없습니다.";
      $("k-yoy-sub").textContent = ""; $("k-share-sub").textContent = "";
    } else {
      $("k-visit").textContent = fmt(k.value) + "명";
      $("k-visit-sub").textContent = `${ageLbl} 방문객 수 합계 (${k.months.length}개월, 연령대별 방문 데이터)`;
      if (k.yoy != null) {
        $("k-yoy").innerHTML = `<span class="${k.yoy >= 0 ? "up" : "down"}">${k.yoy >= 0 ? "+" : ""}${pct(k.yoy)}</span>`;
        $("k-yoy-sub").textContent = `전년 동기간 ${fmt(k.prevValue)}명 → 선택 기간 ${fmt(k.value)}명 (같은 월끼리 비교)`;
      } else {
        $("k-yoy").innerHTML = '<span class="na-v">계산 불가</span>';
        $("k-yoy-sub").textContent = `비교 대상 전년 월 데이터 없음: ${k.missingPrev.map(ymLabel).join(", ")} (데이터는 2024년 1월부터)`;
      }
      if (k.share != null) {
        $("k-share").textContent = pct(k.share);
        $("k-share-sub").textContent = `${SEX_LABEL[S.sex]} 전체 연령(${fmt(k.allAges)}명) 중 ${AGE_LABEL(S.age)} 비중`;
      } else {
        $("k-share").innerHTML = '<span class="na-v">-</span>';
        $("k-share-sub").textContent = "연령대를 선택하면 계산됩니다.";
      }
    }
    if (k.inbound != null) {
      $("k-inb").textContent = fmt(k.inbound) + "명";
      $("k-inb-sub").textContent = `월별 입도 관광객(내+외국인) ${k.inbMonths.length}개월 합계 · 연령 구분 없음 · 연령대 데이터와 집계 기준이 달라 직접 비교 불가`;
    } else { $("k-inb").innerHTML = '<span class="na-v">데이터 없음</span>'; $("k-inb-sub").textContent = "선택 기간에 입도 관광객 데이터가 없습니다."; }

    // 방문 추이
    const tr = calcTrend();
    badges("b-trend", [["기간", 1], ["연령대", 1], ["성별", 1], ["지역", 0]]);
    $("trend-desc").textContent = `월별 ${ageLbl} 방문객 수 (단위: 명, 연령대별 방문 데이터). 연도별로 선을 나눠 같은 월끼리 비교.`;
    if (!tr.length) { drawChart("trend", "c-trend", null); show("trend-empty", "선택 기간에 데이터가 없습니다."); }
    else {
      show("trend-empty", "");
      const years = [...new Set(tr.map((r) => Math.floor(r.m / 100)))];
      drawChart("trend", "c-trend", {
        type: "line",
        data: { labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
          datasets: years.map((y) => ({ label: `${y}년`, borderColor: YEAR_COLORS[y] || "#888", backgroundColor: YEAR_COLORS[y] || "#888",
            data: Array.from({ length: 12 }, (_, i) => { const r = tr.find((x) => x.m === y * 100 + i + 1); return r ? r.v : null; }),
            spanGaps: false, tension: 0.25 })) },
        options: { plugins: { title: { display: true, text: `월별 ${ageLbl} 방문객 수` }, legend: { position: "top" },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw)}명` } } },
          scales: { x: { title: axisTitle("월") }, y: { title: axisTitle("방문객 수(명)"), ticks: { callback: (v) => fmt(v) } } } },
      });
    }
    $("t-trend").innerHTML = table([
      { label: "기준연월", get: (r) => ymLabel(r.m) }, { label: "방문객 수(명)", num: 1, get: (r) => fmt(r.v) },
      { label: "전년 동월(명)", num: 1, get: (r) => (r.p == null ? "데이터 없음" : fmt(r.p)) },
      { label: "전년 동월 대비", num: 1, get: (r) => (r.yoy == null ? "계산 불가" : (r.yoy >= 0 ? "+" : "") + pct(r.yoy)) }], tr);

    // 지역별
    const rg = calcRegion();
    badges("b-region", [["기간", 1], ["시군구", 1], ["읍면동(강조)", 1], ["내·외국인", 1], ["연령", 0]]);
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
          backgroundColor: bars.map((r) => (S.emd === r.name ? "#e0832b" : r.sgg === "제주시" ? "#2463eb" : "#16a37f")) }] },
        options: { indexAxis: "y", plugins: { title: { display: true, text: `${S.sgg === "all" ? "전체 지역" : S.sgg} 읍면동 방문객 상위 ${Math.min(15, rg.rows.length)} — ${VIS_LABEL[S.visitor]} (${rg.months.length}개월 합계)` },
          legend: { display: true, labels: { generateLabels: () => [
            { text: "제주시", fillStyle: "#2463eb", strokeStyle: "#2463eb" }, { text: "서귀포시", fillStyle: "#16a37f", strokeStyle: "#16a37f" },
            ...(S.emd !== "all" ? [{ text: `선택: ${S.emd}`, fillStyle: "#e0832b", strokeStyle: "#e0832b" }] : [])] } },
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
    badges("b-place", [["기간", 1], ["시군구·읍면동", 1], ["집계 기준", 1], ["연령", 0]]);
    $("place-desc").textContent = `${regionLbl} 목적지별 ${PM_LABEL[S.pmetric]} 합계 (단위: 건, 내비게이션 도착 기준) · 유형은 원본 '카테고리 3단계' · 연령 구분 없음`;
    if (!pl.months.length || !pl.rows.length) {
      drawChart("place", "c-place", null); show("place-empty", "선택 조건에 해당하는 장소 데이터가 없습니다."); $("place-exact").textContent = "";
    } else {
      show("place-empty", "");
      const t10 = pl.rows.slice(0, 10);
      drawChart("place", "c-place", {
        type: "bar",
        data: { labels: t10.map((r) => r.n), datasets: [{ label: `${PM_LABEL[S.pmetric]}(건)`, data: t10.map((r) => r[S.pmetric]), backgroundColor: "#2463eb" }] },
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
    badges("b-search", [["기간", 1], ["검색 분류", 1], ["지역", 0], ["연령", 0]]);
    if (!sr.months.length || !sr.rows.length) {
      drawChart("search", "c-search", null); show("search-empty", "선택 조건에 해당하는 비짓제주 데이터가 없습니다.");
      $("c-wc").hidden = true; show("wc-fallback", ""); $("search-exact").textContent = ""; $("search-cats").textContent = "";
    } else {
      show("search-empty", "");
      const t20 = sr.rows.slice(0, 20);
      drawChart("search", "c-search", {
        type: "bar",
        data: { labels: t20.map((r) => r.n), datasets: [{ label: "비짓제주 수치 합계", data: t20.map((r) => r.v), backgroundColor: "#7c5cd6" }] },
        options: { indexAxis: "y", plugins: { title: { display: true, text: "검색 수치 상위 20 (장소·행사명)" },
          tooltip: { callbacks: { afterLabel: (c) => `분류: ${t20[c.dataIndex].c}` } } },
          scales: { x: { title: axisTitle("수치 합계(원본 단위 미표기)"), ticks: { callback: (v) => fmt(v) } }, y: { title: axisTitle("장소·행사명"), ticks: { autoSkip: false, font: { size: 11 } } } } },
      });
      const cv = $("c-wc");
      if (HAS_WC) {
        cv.hidden = false; show("wc-fallback", "");
        const maxV = sr.rows[0].v, minV = sr.rows[sr.rows.length - 1].v;
        const palette = { 관광지: "#2463eb", 음식점: "#e0832b", 숙박: "#16a37f", 쇼핑: "#d23c7a", "축제/행사": "#7c5cd6" };
        const byName = Object.fromEntries(sr.rows.map((r) => [r.n, r]));
        WordCloud(cv, {
          list: sr.rows.map((r) => [r.n, r.v]),
          weightFactor: (v) => 11 + 30 * Math.sqrt((v - minV) / Math.max(1, maxV - minV)),
          fontFamily: "Malgun Gothic, Apple SD Gothic Neo, sans-serif", rotateRatio: 0, gridSize: 6, shrinkToFit: false,
          color: (w) => palette[(byName[w] || {}).c] || "#555", backgroundColor: "#fff",
        });
        wcStat.total = sr.rows.length; wcStat.drawn = 0; wcStat.skipped = 0;
        $("search-cats").textContent = "워드클라우드: 상위 60개 장소·행사명, 글자 크기 = 수치 합계(제곱근 비례), 색 = 분류(관광지 파랑·음식점 주황·숙박 초록·쇼핑 분홍·축제/행사 보라). 공간이 부족한 긴 이름은 생략될 수 있음(표에서 전체 확인). ";
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
    renderSummary({ k, tr, rg, pl, sr, rv, ageLbl, regionLbl });
    window.DASH_RESULT = { state: { ...S }, kpi: k, trend: tr, region: rg, places: pl, search: sr, reviews: rv };
  }

  // ---------- 지역별 방문 지도(Leaflet) ----------
  const MAP_COLORS = ["#deebf7", "#9ecae1", "#6baed6", "#3182bd", "#08519c"];
  let map = null, geoLayer = null, legendDiv = null, mapScopeKey = null;
  function initMap() {
    if (!D.geo) { show("map-warn", "지도 경계 파일(geo/jeju_emd_ver20260701.geojson)이 없어 지도를 표시할 수 없습니다."); $("region-map").hidden = true; return; }
    if (!HAS_L) { show("map-warn", "지도 라이브러리(Leaflet)를 불러오지 못했습니다. 막대그래프와 표로 확인하세요."); $("region-map").hidden = true; return; }
    map = L.map("region-map", { scrollWheelZoom: false, zoomSnap: 0.25, maxZoom: 14 });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 16, attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors · 경계: vuski/admdongkor",
    }).addTo(map);
    geoLayer = L.geoJSON(D.geo, {
      onEachFeature: (f, layer) => layer.on("click", () => {
        const e = D.region.emds.find((x) => String(x.code) === f.properties.adm_cd2);
        if (!e) return;
        if (S.emd === e.name) S.emd = "all"; else { S.emd = e.name; S.sgg = e.sgg; }
        syncControls(); render();
      }),
    }).addTo(map);
    const legend = L.control({ position: "topright" });
    legend.onAdd = () => (legendDiv = L.DomUtil.create("div", "map-legend"));
    legend.addTo(map);
  }
  function renderMap(rg) {
    if (!map) return;
    const byCode = Object.fromEntries(rg.rows.map((r) => [String(r.code), r]));
    const vals = rg.rows.map((r) => r[S.visitor]).sort((a, b) => a - b);
    // 5분위 경계(표시 범위 읍면동 기준). 값이 같으면 구간이 합쳐질 수 있음
    const breaks = vals.length ? [1, 2, 3, 4].map((k) => vals[Math.floor((vals.length * k) / 5)]) : [];
    const cls = (v) => breaks.filter((b) => v >= b).length;
    const out = [];
    geoLayer.eachLayer((layer) => {
      const code = layer.feature.properties.adm_cd2, r = byCode[code];
      const sel = r && r.name === S.emd;
      layer.setStyle(r ? { fillColor: MAP_COLORS[cls(r[S.visitor])], fillOpacity: 0.78, color: sel ? "#e0832b" : "#fff", weight: sel ? 3 : 1 }
        : { fillColor: "#d1d5db", fillOpacity: 0.35, color: "#fff", weight: 1 });
      if (sel) layer.bringToFront();
      if (layer.getElement()) layer.getElement().setAttribute("data-code", code);
      const nm = layer.feature.properties.adm_nm.replace("제주특별자치도 ", "");
      layer.unbindTooltip().bindTooltip(r
        ? `<b>${esc(nm)}</b><br>${esc(VIS_LABEL[S.visitor])} ${fmt(r[S.visitor])}명<br>순위 ${r.rank}/${rg.rows.length} · 비중 ${pct(r.share)}`
        : `<b>${esc(nm)}</b><br>${rg.months.length ? "선택 지역 범위 밖" : "선택 기간 데이터 없음"}`, { sticky: true });
      out.push({ code, cls: r ? cls(r[S.visitor]) : null, color: r ? MAP_COLORS[cls(r[S.visitor])] : null, value: r ? r[S.visitor] : null });
    });
    if (rg.months.length && vals.length) {
      const edges = [vals[0], ...breaks, vals[vals.length - 1]];
      legendDiv.innerHTML = `<b>${esc(VIS_LABEL[S.visitor])} 방문객(명)</b>` + MAP_COLORS.map((c, i) =>
        `<div><i style="background:${c}"></i>${fmt(edges[i])}${i < 4 ? ` ~ ${fmt(edges[i + 1])} 미만` : ` ~ ${fmt(edges[5])}`}</div>`).join("") +
        `<div><i style="background:#d1d5db"></i>범위 밖·데이터 없음</div><div style="color:#666">5분위 구간(${rg.months.length}개월 합계)</div>`;
    } else legendDiv.innerHTML = "<b>선택 기간 데이터 없음</b>";
    const key = S.sgg;
    if (key !== mapScopeKey) {
      mapScopeKey = key;
      const lays = [];
      geoLayer.eachLayer((l) => { if (S.sgg === "all" || l.feature.properties.sggnm === S.sgg) lays.push(l); });
      map.invalidateSize();
      map.fitBounds(L.featureGroup(lays).getBounds(), { padding: [10, 10] });
    }
    window.DASH_MAP = { breaks, features: out };
  }

  // ---------- 온라인 후기 ----------
  function calcReviews() {
    const R = D.reviews;
    if (!R) return null;
    const posts = R.posts.filter((p) => !S.rperiod || inRange(Math.floor(Number(p.date) / 100)));
    const topics = R.topics.map((t) => {
      const hits = posts.filter((p) => p.codes[t.id]);
      return { ...t, n: hits.length, share: posts.length ? hits.length / posts.length : null, hits };
    });
    return { posts, topics, n: posts.length };
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
    badges("b-review", [["기간(선택 시)", S.rperiod], ["연령: 제목에 20대 명시 글", 1], ["지역", 0]]);
    $("review-desc").innerHTML = `네이버 블로그 검색 API(${esc(R.collected_at)} 수집) · 검색어 ${R.queries.map((q) => `'${esc(q)}'`).join(", ")} · ` +
      `분석 대상: 제목에 20대·제주가 있고 20대 본인·일행 여행 후기로 분류된 글 <b>${rv.n}건</b>` +
      (rv.n ? ` (작성일 ${ymLabel(Math.floor(Number(rv.posts[0].date) / 100))} ~ ${ymLabel(Math.floor(Number(rv.posts[rv.n - 1].date) / 100))})` : "");
    const small = rv.n && rv.n < 30 ? `선택 조건의 후기가 ${rv.n}건뿐이라 비율 해석에 주의가 필요합니다.` : "";
    show("review-empty", rv.n ? small : "선택 기간에 작성된 분석 대상 후기가 없습니다. 기간 필터 적용을 해제하면 전체 수집 기간을 봅니다.");
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
