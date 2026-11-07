/* 분석보고서 PDF — 대시보드의 현재 필터 결과로 보고서를 작성해 내려받는다(서버 없이 브라우저에서 생성).
 * - 수치·요약 문장은 화면이 쓰는 계산 결과(window.DASH_RESULT)를 그대로 써서 화면과 보고서가 어긋나지 않게 한다.
 * - pdfmake(CDN)와 폰트(vendor/report-fonts.js)는 용량이 커서 버튼을 처음 누를 때 불러온다.
 * - 차트는 인쇄용으로 다시 그린 이미지, 표·문장은 PDF 텍스트(선택·검색 가능)다. */
(function () {
  "use strict";
  // 0.3.13 이상을 쓸 것: 그보다 낮은 판은 글자 종류가 256개를 넘으면 Chrome·Edge에서 PDF 본문 복사·검색이 깨진다(pdfkit ToUnicode 버그)
  const PDFMAKE_URL = "https://cdn.jsdelivr.net/npm/pdfmake@0.3.13/build/pdfmake.min.js";
  const FONTS_URL = "vendor/report-fonts.js";

  // 조사 기본정보의 고정 문구. 조사 내용이 바뀌면 여기만 고치면 된다.
  const STUDY = {
    name: "청년층 제주 관광 동향",
    question: "청년층은 제주에서 어떤 여행을 하고 있을까?",
    target: "제주를 방문한 20대 청년층(연령대별 방문 데이터 중 20대), 전체 관광객(지역·장소·검색어 데이터, 연령 구분 없음), 20대 제주 여행 블로그 후기",
    source: "제주 관광 데이터 파일 7종(제주 AI 관광데이터허브), 비짓제주, 네이버 블로그 검색 API(제목·요약문)",
    method: "제공 데이터를 월별로 집계한 뒤 선택한 필터 조건으로 다시 계산했습니다. 증감률은 전년 같은 달끼리 비교하고, 블로그 후기는 사람이 선별한 글에서 주제 키워드 언급을 집계했습니다.",
  };

  const INK = "#211b3d", MUTED = "#6b6488", LINE = "#e6e1f5", ACCENT = "#5b3fd0", SOFT = "#f3f0fc", HL = "#fff3c9";
  const PAGE_W = 515; // A4 폭 595pt - 좌우 여백 40pt
  const PX = 3; // 차트 이미지 해상도 배율(1pt = 3px)
  const YEAR_MARK = ["circle", "rect", "triangle", "rectRot"]; // 흑백 인쇄에서도 연도를 구분
  const MAP_SEA = "#d3d4d9", MAP_LAND = "#f1f1ef", MAP_SEL = "#e0832b"; // 지도 타일 대신 쓰는 바다·육지 색, 선택 읍면동 테두리
  const SCREEN_MAP = { w: 640, h: 420, pad: 10, snap: 0.25, maxZoom: 14 }; // 대시보드 지도 크기·맞춤 설정(히트맵 반경 환산용)

  const $ = (id) => document.getElementById(id);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const compact = (v, fmt) => (Math.abs(v) >= 10000 ? (v / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "만" : fmt(v));
  const signed = (v, pct) => (v == null ? "계산 불가" : (v >= 0 ? "+" : "") + pct(v));

  // 화면에 표시된 문장을 그대로 가져온다(숨겨진 요소는 빈 값)
  function domText(id) {
    const el = $(id);
    if (!el || el.hidden) return "";
    const copy = el.cloneNode(true);
    copy.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
    return copy.textContent.trim();
  }

  // 대시보드 설계 단계의 내부 문구는 보고서에서 뺀다(화면 문구는 그대로 둔다)
  const INTERNAL = /와이어프레임/;
  const publicNote = (s) => String(s).replace(/와이어프레임에 해당 패널 없음\.\s*/, "이 보고서에서 사용하지 않음. ");

  // ---------- 글자 처리 ----------
  // Pretendard에 없는 문자: 한자는 보조 폰트로 표시하고, 이모지는 빼고, 깨진 문자(U+FFFD)는 □로 둔다
  const HANJA = /([⺀-⿟㐀-䶿一-鿿豈-﫿]+)/;
  const clean = (s) => String(s == null ? "" : s).replace(/[\u{10000}-\u{10FFFF}‍︎️]/gu, "").replace(/�/g, "□");
  const pieces = (s, extra) => s.split(HANJA).filter(Boolean).map((t) => ({ text: t, ...(HANJA.test(t) ? { font: "Hanja" } : {}), ...extra }));
  // 표 칸용: 좁은 칸에서도 넘치지 않게 글자 단위로 줄바꿈
  function runs(s) {
    const t = clean(s);
    return HANJA.test(t) ? pieces(t) : t;
  }
  // 문단용: 단어 중간에서 줄이 끊기지 않게 어절 단위로 줄바꿈
  const words = (s) => clean(s).split(/(?<=\s)/).flatMap((w) => pieces(w, { noWrap: true }));

  // ---------- 문서 조각 ----------
  const h1 = (t) => ({ text: t, style: "h1" });
  const h2 = (t) => ({ text: t, style: "h2" });
  const lead = (t) => ({ text: words(t), style: "lead" });
  const note = (t) => ({ text: words(t), style: "note" });
  const caption = (t) => ({ text: runs(t), style: "cap" });
  const keep = (...nodes) => ({ stack: nodes.filter(Boolean), unbreakable: true });
  function notice(t) {
    return { table: { widths: ["*"], body: [[{ text: words(t), fontSize: 8.5, color: "#a2560c", fillColor: "#fff4e6", margin: [4, 2, 4, 2] }]] }, layout: "noBorders", margin: [0, 3, 0, 5] };
  }
  function bullets(list) {
    const items = list.length ? list : ["현재 필터에서 산출할 항목이 없습니다."];
    return { ul: items.map((t) => ({ text: words(t), margin: [0, 0, 0, 2.5] })), fontSize: 9, markerColor: ACCENT };
  }
  // 적용된 필터와 적용되지 않는 필터를 섹션마다 밝혀, 어떤 조건의 수치인지 바로 알 수 있게 한다
  function scope(on, off) {
    const t = [{ text: "적용 필터  ", bold: true }, ...pieces(clean(on.join(" · ")))];
    if (off) t.push({ text: "    미적용  ", bold: true }, off);
    return { text: t, style: "scope" };
  }

  const GRID = {
    hLineWidth: (i, n) => (i === 0 || i === 1 || i === n.table.body.length ? 0.7 : 0.4),
    vLineWidth: () => 0,
    hLineColor: (i) => (i <= 1 ? "#c9c2e6" : LINE),
    fillColor: (row) => (row === 0 ? SOFT : null),
    paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 2.5, paddingBottom: () => 2.5,
  };
  const KV = {
    hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => LINE,
    fillColor: (row, node, col) => (col === 0 ? SOFT : null),
    paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 3.5, paddingBottom: () => 3.5,
  };
  // cols: { label, get(row), width?, num?, strong? }
  function table(cols, rows, { hl, size = 8 } = {}) {
    const head = cols.map((c) => ({ text: c.label, bold: true, color: MUTED, fontSize: size, alignment: c.num ? "right" : "left" }));
    const body = rows.map((r) => cols.map((c) => {
      const v = c.get(r);
      const cell = v && v.canvas ? { ...v } : { text: runs(v), fontSize: size, alignment: c.num ? "right" : "left", bold: !!c.strong };
      if (hl && hl(r)) cell.fillColor = HL;
      return cell;
    }));
    return { table: { headerRows: 1, dontBreakRows: true, widths: cols.map((c) => c.width || "*"), body: [head, ...body] }, layout: GRID };
  }
  function keyValue(rows) {
    return { table: { widths: [78, "*"], dontBreakRows: true, body: rows.map(([k, v]) => [{ text: k, bold: true, color: MUTED, fontSize: 8.5 }, { text: words(v), fontSize: 8.5 }]) }, layout: KV };
  }

  // ---------- 차트 이미지 ----------
  function chartImage(cfg, w, h) {
    if (!window.Chart) return null;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cfg.options = { responsive: false, animation: false, devicePixelRatio: PX, ...cfg.options };
    cfg.plugins = [{ id: "paper", beforeDraw: (c) => { c.ctx.save(); c.ctx.fillStyle = "#fff"; c.ctx.fillRect(0, 0, c.width, c.height); c.ctx.restore(); } }];
    const chart = new Chart(cv, cfg);
    const url = cv.toDataURL("image/png");
    chart.destroy();
    return url;
  }
  const small = (size = 8) => ({ font: { size } });
  function yearLines(rows, A, w, h) {
    if (rows.length < 2) return null; // 점 하나는 차트로 볼 내용이 없어 표로만 제공
    const years = [...new Set(rows.map((r) => Math.floor(r.m / 100)))];
    const url = chartImage({
      type: "line",
      data: {
        labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
        datasets: years.map((y, k) => ({
          label: `${y}년`, borderColor: A.YEAR_COLORS[y] || "#888888", backgroundColor: A.YEAR_COLORS[y] || "#888888", borderWidth: 1.6, tension: 0.25,
          pointStyle: YEAR_MARK[k % YEAR_MARK.length], pointRadius: 2.6, pointBorderWidth: 0, spanGaps: false,
          data: Array.from({ length: 12 }, (_, i) => { const r = rows.find((x) => x.m === y * 100 + i + 1); return r ? r.v : null; }),
        })),
      },
      options: {
        layout: { padding: { right: 6 } },
        plugins: { legend: { display: years.length > 1, position: "top", align: "end", labels: { usePointStyle: true, boxWidth: 6, boxHeight: 6, ...small() } }, tooltip: { enabled: false } },
        scales: {
          x: { grid: { display: false }, ticks: small() },
          y: { grid: { lineWidth: 0.6 }, border: { display: false }, ticks: { ...small(), maxTicksLimit: 6, callback: (v) => compact(v, A.fmt) } },
        },
      },
    }, w, h);
    return url && { image: url, width: w, margin: [0, 0, 0, 6] };
  }
  function rankBars(items, A, w, h, opts = {}) {
    if (!items.length) return null;
    const url = chartImage({
      type: "bar",
      data: { labels: items.map((x) => clip(clean(x.label), opts.labelMax || 18)), datasets: [{ data: items.map((x) => x.v), backgroundColor: items.map((x) => x.color), borderRadius: 3, barPercentage: 0.72, categoryPercentage: 0.92 }] },
      options: {
        indexAxis: "y", layout: { padding: { right: 8 } },
        plugins: { legend: opts.legend ? { display: true, position: "top", align: "end", labels: { boxWidth: 8, boxHeight: 8, ...small(), generateLabels: () => opts.legend.map(([text, c]) => ({ text, fillStyle: c, strokeStyle: c, lineWidth: 0 })) } } : { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { beginAtZero: true, grid: { lineWidth: 0.6 }, border: { display: false }, ticks: { ...small(), maxTicksLimit: 5, callback: (v) => compact(v, A.fmt) } },
          y: { grid: { display: false }, ticks: { ...small(), autoSkip: false } },
        },
      },
    }, w, h);
    return url && { image: url, width: w, margin: [0, 0, 0, 6] };
  }

  // 읍면동 방문 지도: 대시보드 히트맵을 같은 값·같은 설정(A.HEAT)으로 다시 그린다.
  // 다른 점은 배경뿐이다. 지도 타일 대신 경계 데이터로 육지를 칠하고, 본섬에서 먼 추자면은 왼쪽 위에 따로 넣는다.
  const rings = (f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
  function extent(feats) {
    const b = { x0: 180, x1: -180, y0: 90, y1: -90 };
    feats.forEach((f) => rings(f).forEach((p) => p.forEach((ring) => ring.forEach(([x, y]) => {
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
    }))));
    return b;
  }
  // 대시보드 지도가 이 범위를 화면에 맞출 때의 확대 단계(Leaflet fitBounds와 같은 계산)
  function screenZoom(feats) {
    const b = extent(feats), merc = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)), M = SCREEN_MAP;
    const w = (b.x1 - b.x0) / 360 * 256, h = (merc(b.y1) - merc(b.y0)) / (2 * Math.PI) * 256;
    const z = Math.log2(Math.min((M.w - 2 * M.pad) / w, (M.h - 2 * M.pad) / h));
    return Math.min(M.maxZoom, Math.floor(z / M.snap) * M.snap);
  }
  // leaflet.heat이 하는 일과 같다: 가까운 점을 칸으로 묶어 강도를 더한 뒤 simpleheat로 그린다
  function heatCanvas(points, w, h, ratio, zoom, H0) {
    const radius = H0.radius * ratio, blur = H0.blur * ratio, cell = (radius + blur) / 2;
    const fade = 1 / Math.pow(2, Math.max(0, Math.min(H0.maxZoom - zoom, 12)));
    const grid = new Map();
    points.forEach(([x, y, a]) => {
      const id = Math.floor(x / cell) + "," + Math.floor(y / cell), k = a * fade, c = grid.get(id);
      if (!c) { grid.set(id, [x, y, k]); return; }
      c[0] = (c[0] * c[2] + x * k) / (c[2] + k); c[1] = (c[1] * c[2] + y * k) / (c[2] + k); c[2] += k;
    });
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const heat = simpleheat(cv);
    heat.radius(radius, blur); heat.gradient(H0.gradient); heat.max(H0.max);
    heat.data([...grid.values()].map((c) => [Math.round(c[0]), Math.round(c[1]), Math.min(c[2], H0.max)]));
    heat.draw(H0.minOpacity);
    return cv;
  }
  function regionMap(R, A, W) {
    const D = A.data, S = R.state, rg = R.region, key = S.visitor, H0 = A.HEAT;
    if (!D.geo || !rg.rows.length) return null;
    const MAP_H = W * 0.64, LEG_H = 38, H = MAP_H + LEG_H, K = Math.cos(33.4 * Math.PI / 180);
    const cv = document.createElement("canvas");
    cv.width = W * PX; cv.height = H * PX;
    const g = cv.getContext("2d");
    g.scale(PX, PX);
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);

    const byCode = Object.fromEntries(rg.rows.map((r) => [String(r.code), r]));
    const maxV = Math.max(0, ...rg.rows.map((r) => r[key]));
    const minV = Math.min(...rg.rows.map((r) => r[key]));
    const fit = (feats, b) => {
      const e = extent(feats), s = Math.min(b.w / ((e.x1 - e.x0) * K), b.h / (e.y1 - e.y0));
      const ox = b.x + (b.w - (e.x1 - e.x0) * K * s) / 2, oy = b.y + (b.h - (e.y1 - e.y0) * s) / 2;
      const proj = (x, y) => [ox + (x - e.x0) * K * s, oy + (e.y1 - y) * s];
      proj.perLon = K * s; // 경도 1도의 길이(pt)
      return proj;
    };
    const trace = (f, pj) => {
      g.beginPath();
      rings(f).forEach((p) => p.forEach((ring) => {
        ring.forEach(([x, y], i) => { const [a, b] = pj(x, y); if (i) g.lineTo(a, b); else g.moveTo(a, b); });
        g.closePath();
      }));
    };
    const isChuja = (f) => f.properties.adm_nm.endsWith("추자면");
    const main = D.geo.features.filter((f) => !isChuja(f)), chuja = D.geo.features.filter(isChuja);
    const proj = fit(main, { x: 6, y: 6, w: W - 12, h: MAP_H - 12 });
    const box = { x: 5, y: 5, w: W * 0.17, h: W * 0.14 };
    const projC = chuja.length ? fit(chuja, { x: box.x + 5, y: box.y + 11, w: box.w - 10, h: box.h - 15 }) : null;

    // 대시보드 지도의 확대 단계에서 히트맵 반경이 섬 크기의 몇 분의 일인지를 그대로 옮긴다
    const scopeFeats = D.geo.features.filter((f) => S.sgg === "all" || f.properties.sggnm === S.sgg);
    const zoom = screenZoom(scopeFeats);
    const ratio = proj.perLon * PX / (256 * Math.pow(2, zoom) / 360);
    const canHeat = typeof window.simpleheat === "function" && maxV > 0;
    const heatOf = (rows, pj) => heatCanvas(rows.filter((r) => r.center).map((r) => {
      const [x, y] = pj(r.center[1], r.center[0]);
      return [x * PX, y * PX, r[key] / maxV];
    }), W * PX, Math.round(MAP_H * PX), ratio, zoom, H0);

    const land = (feats, pj) => feats.forEach((f) => {
      trace(f, pj);
      g.fillStyle = MAP_LAND; g.fill("evenodd");
      if (!canHeat) { // 히트맵 도구가 없을 때는 대시보드와 같은 방식으로 읍면동 색 농도로 표시
        const r = byCode[f.properties.adm_cd2];
        g.globalAlpha = r && maxV ? 0.1 + 0.7 * r[key] / maxV : 0.03;
        g.fillStyle = "#e8402a"; g.fill("evenodd"); g.globalAlpha = 1;
      }
    });
    const lines = (feats, pj) => {
      g.globalAlpha = 0.65; g.strokeStyle = "#fff"; g.lineWidth = 0.6;
      feats.forEach((f) => { trace(f, pj); g.stroke(); });
      g.globalAlpha = 1;
    };
    const mainRows = rg.rows.filter((r) => r.name !== "추자면"), chujaRows = rg.rows.filter((r) => r.name === "추자면");

    g.fillStyle = MAP_SEA; g.fillRect(0, 0, W, MAP_H);
    land(main, proj);
    if (canHeat) g.drawImage(heatOf(mainRows, proj), 0, 0, W, MAP_H);
    lines(main, proj);
    if (projC) {
      g.save();
      g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
      g.fillStyle = MAP_SEA; g.fillRect(box.x, box.y, box.w, box.h);
      land(chuja, projC);
      if (canHeat && chujaRows.length) g.drawImage(heatOf(chujaRows, projC), 0, 0, W, MAP_H);
      lines(chuja, projC);
      g.restore();
      g.strokeStyle = "#fff"; g.lineWidth = 0.8; g.strokeRect(box.x, box.y, box.w, box.h);
      g.fillStyle = INK; g.font = '6.5px "Malgun Gothic", sans-serif'; g.textBaseline = "top"; g.textAlign = "left";
      g.fillText("추자면", box.x + 3, box.y + 2.5);
    }
    D.geo.features.forEach((f) => { // 선택 읍면동 강조
      const r = byCode[f.properties.adm_cd2];
      if (r && r.name === S.emd) { trace(f, isChuja(f) ? projC : proj); g.strokeStyle = MAP_SEL; g.lineWidth = 1.5; g.stroke(); }
    });

    // 범례: 대시보드 지도와 같은 내용
    const y0 = MAP_H + 7, stops = Object.entries(H0.gradient).sort((a, b) => a[0] - b[0]);
    g.textAlign = "left"; g.textBaseline = "middle"; g.font = 'bold 7px "Malgun Gothic", sans-serif'; g.fillStyle = INK;
    g.fillText(`${clean(A.VIS_LABEL[key])} 방문 강도 (${rg.months.length}개월 합계)`, 2, y0);
    const bar = g.createLinearGradient(2, 0, 112, 0);
    stops.forEach(([k, c]) => bar.addColorStop(Number(k), c));
    g.fillStyle = bar; g.fillRect(2, y0 + 6, 110, 6);
    g.font = '6.5px "Malgun Gothic", sans-serif'; g.fillStyle = INK;
    g.fillText(A.fmt(minV), 2, y0 + 17);
    g.textAlign = "right"; g.fillText(`${A.fmt(maxV)}명`, 112, y0 + 17);
    g.textAlign = "left"; g.fillStyle = MUTED;
    g.fillText("표시 범위 최댓값 기준", 120, y0 + 7);
    g.fillText("가까운 지역은 겹쳐 더 진하게 보임", 120, y0 + 16);
    if (S.emd !== "all") {
      g.strokeStyle = MAP_SEL; g.lineWidth = 1.2; g.strokeRect(2, y0 + 23, 9, 6);
      g.fillText(`선택: ${S.emd}`, 14, y0 + 26.5);
    }
    return { image: cv.toDataURL("image/png"), width: W };
  }

  // ---------- 필터에 따라 쓰는 문장 ----------
  function trendLead(R, A) {
    const tr = R.trend;
    if (!tr.length) return "";
    const parts = [`${R.ageLbl} 방문객은 ${tr.length}개월 동안 월평균 ${A.fmt(sum(tr.map((r) => r.v)) / tr.length)}명입니다.`];
    if (tr.length >= 2) {
      const hi = tr.reduce((a, b) => (b.v > a.v ? b : a)), lo = tr.reduce((a, b) => (b.v < a.v ? b : a));
      parts.push(`가장 많은 달은 ${A.ymLabel(hi.m)}(${A.fmt(hi.v)}명), 가장 적은 달은 ${A.ymLabel(lo.m)}(${A.fmt(lo.v)}명)입니다.`);
    }
    const cmp = tr.filter((r) => r.yoy != null);
    if (cmp.length) parts.push(`전년 같은 달과 비교할 수 있는 ${cmp.length}개월 중 ${cmp.filter((r) => r.yoy > 0).length}개월은 증가, ${cmp.filter((r) => r.yoy < 0).length}개월은 감소했습니다.`);
    return parts.join(" ");
  }
  function regionLead(R, A) {
    const rg = R.region, S = R.state, top = rg.rows.slice(0, 3), who = S.visitor === "tot" ? "" : `${A.VIS_LABEL[S.visitor]} `;
    const parts = [`${S.sgg === "all" ? "제주 전체" : S.sgg} ${rg.rows.length}개 읍면동 가운데 ${who}방문객이 많은 곳은 ${top.map((r) => r.name).join(", ")} 순이며, 이 ${top.length}곳이 합계의 ${A.pct(sum(top.map((r) => r.share || 0)))}를 차지합니다.`];
    const tot = sum(rg.rows.map((r) => r.tot));
    if (tot) parts.push(`외국인 방문객 비중은 ${A.pct(sum(rg.rows.map((r) => r.for)) / tot)}입니다.`);
    const sel = rg.rows.find((r) => r.name === S.emd);
    if (sel) parts.push(`선택한 ${sel.name}은 ${sel.rank}위(비중 ${A.pct(sel.share)})입니다.`);
    return parts.join(" ");
  }
  function placeLead(R, A) {
    const S = R.state, rows = R.places.rows, t = rows[0], next = rows.slice(1, 3).map((r) => clean(r.n));
    return `${R.regionLbl}의 ${A.PM_LABEL[S.pmetric]} 1위는 ${A.fmt(t[S.pmetric])}건을 기록한 ${t.n.trim()}(${t.cat}, ${t.emd})입니다.` + (next.length ? ` 그다음은 ${next.join(", ")} 순입니다.` : "");
  }
  function searchLead(R, A) {
    const sr = R.search, t = sr.rows[0], cats = sr.catTotals.filter((c) => c.v > 0).sort((a, b) => b.v - a.v);
    let s = `검색 수치 1위는 합계 ${A.fmt(t.v)}인 ${t.n.trim()}(${t.c})입니다.`;
    if (cats.length > 1) s += ` 분류별로는 ${cats[0].c} 수치가 전체의 ${A.pct(cats[0].v / sum(cats.map((c) => c.v)))}로 가장 큽니다.`;
    return s;
  }
  function reviewLead(R, A) {
    const rv = R.reviews;
    const top = (g) => rv.topics.filter((t) => t.group === g && t.n > 0).sort((a, b) => b.n - a.n)[0];
    const said = (t) => `${t.name}(${t.n}건, ${A.pct(t.share, 0)})`;
    const a = top("activity"), good = top("satisfaction"), bad = top("complaint");
    const parts = [`분석 대상 후기는 ${rv.n}건입니다.`];
    if (a) parts.push(`가장 많이 언급된 활동은 ${said(a)}입니다.`);
    const most = [good && `만족 요인은 ${said(good)}`, bad && `불편 사항은 ${said(bad)}`].filter(Boolean);
    if (most.length) parts.push(`${most.join(", ")} 언급이 가장 많습니다.`);
    return parts.join(" ");
  }

  // ---------- 섹션 ----------
  function secStudy(c) {
    const { A } = c, D = A.data;
    const spans = [["연령대별 방문·입도·읍면동 방문", D.age.months], ["인기 장소", D.places.months], ["비짓제주", D.search.months]].map(([n, l]) => `${n} ${A.span(l)}`);
    if (D.reviews) spans.push(`블로그 후기(작성일) ${A.span([D.reviews.posts[0], D.reviews.posts[D.reviews.posts.length - 1]].map((p) => Math.floor(Number(p.date) / 100)))}`);
    const size = [`인기 장소 원본 ${A.fmt(D.places.rows)}행`, `비짓제주 원본 ${A.fmt(D.search.totalRows)}행`, `읍면동 ${D.region.emds.length}개`];
    if (D.reviews) size.push(`블로그 글 ${A.fmt(D.reviews.funnel[0][1])}건 수집 후 후기 ${D.reviews.posts.length}건 분석`);
    return [
      h1("1. 조사 기본정보"),
      keyValue([
        ["조사명", STUDY.name], ["조사 질문", STUDY.question], ["분석 대상", STUDY.target],
        ["분석 기간", `${c.period} (${A.monthCount()}개월, 선택한 필터 기준)`],
        ["데이터 출처", STUDY.source], ["데이터 제공 기간", spans.join(" / ")], ["데이터 규모", size.join(" · ")],
        ["분석 방법", STUDY.method], ["데이터 집계일", D.generated],
      ]),
    ];
  }
  function secFilter(c) {
    const { A, R, S } = c;
    const st = (on) => (on ? { text: "적용 중", bold: true, color: ACCENT, fontSize: 8 } : { text: "전체", color: MUTED, fontSize: 8 });
    const rows = [
      ["기간", `${c.period} (${A.monthCount()}개월)`, st(A.narrowing("period")), "모든 섹션(온라인 후기는 작성일 기준)"],
      ["연령대", A.AGE_LABEL(S.age), st(S.age !== "all"), "방문 규모, 방문 추이, 온라인 후기"],
      ["성별", A.SEX_LABEL[S.sex], st(S.sex !== "all"), "방문 규모, 방문 추이"],
      ["시군구", S.sgg === "all" ? "전체 지역" : S.sgg, st(S.sgg !== "all"), "지역 방문 추이, 지역별 방문, 인기 장소, 관광 검색어, 온라인 후기"],
      ["읍면동", S.emd === "all" ? "전체 읍면동" : S.emd, st(S.emd !== "all"), "지역 방문 추이, 인기 장소(지역별 방문은 강조 표시, 검색어·후기는 읍·면만)"],
      ["내·외국인", A.VIS_LABEL[S.visitor], st(S.visitor !== "tot"), "입도 관광객, 지역 방문 추이, 지역별 방문"],
      ["장소 집계 기준", A.PM_LABEL[S.pmetric], { text: "기준 선택", color: MUTED, fontSize: 8 }, "인기 장소"],
      ["검색 분류", S.scat === "all" ? "전체 분류" : S.scat, st(S.scat !== "all"), "관광 검색어"],
      ["후기 기간", S.rall ? "전체 수집 기간(기간 필터 무시)" : "기간 필터 적용", { text: S.rall ? "기간 무시" : "기간 적용", color: MUTED, fontSize: 8 }, "온라인 후기"],
    ];
    const cell = (v, o) => ({ text: runs(v), fontSize: 8, ...o });
    const head = ["필터", "선택값", "상태", "적용 범위"].map((t) => ({ text: t, bold: true, color: MUTED, fontSize: 8 }));
    const out = [
      h1("2. 필터 정보"),
      { text: words("이 보고서의 수치·차트·문장은 아래 조건으로 작성했습니다. 필터는 데이터에 해당 정보가 있을 때만 적용되며, 섹션마다 제목 아래에 적용 여부를 표시했습니다."), style: "lead" },
      { table: { headerRows: 1, dontBreakRows: true, widths: [62, 130, 40, "*"], body: [head, ...rows.map((r) => [cell(r[0], { bold: true }), cell(r[1]), r[2], cell(r[3], { color: MUTED })])] }, layout: GRID },
    ];
    if (R.warnings.length) out.push(notice("기간 범위 안내 — " + R.warnings.join(" / ")));
    return out;
  }
  function secKpi(c) {
    const { R } = c;
    const kpis = [
      ["방문 규모", "k-visit", "k-visit-sub", "k-visit-reg"], ["전년 동월 대비 증감률", "k-yoy", "k-yoy-sub", "k-yoy-reg"],
      ["전체 연령 중 비중", "k-share", "k-share-sub", "k-share-reg"], ["여름(7~8월) 집중도", "k-summer", "k-summer-sub"], ["참고: 입도 관광객 수", "k-inb", "k-inb-sub"],
    ].map(([name, big, sub, reg]) => ({ name, big: domText(big), sub: [domText(sub), reg ? domText(reg) : ""].filter(Boolean).join("\n") }));
    const head = ["지표", "값", "산출 기준"].map((t) => ({ text: t, bold: true, color: MUTED, fontSize: 8 }));
    const body = kpis.map((k) => [{ text: k.name, fontSize: 8.5, bold: true }, { text: k.big, fontSize: 11, bold: true, color: ACCENT }, { text: runs(k.sub), fontSize: 7.5, color: MUTED }]);
    return [
      keep(h1("3. 핵심 지표와 주요 결과"),
        { table: { headerRows: 1, dontBreakRows: true, widths: [86, 76, "*"], body: [head, ...body] }, layout: GRID }),
      h2("확인된 사실"),
      bullets(R.summary.fact),
    ];
  }
  function secTrend(c) {
    const { A, R, S } = c, tr = R.trend, trR = R.trendReg;
    const out = [];
    const a = yearLines(tr, A, PAGE_W, 138), b = yearLines(trR, A, PAGE_W, 128);
    const head = [
      h1("4. 방문 추이"),
      scope([`기간 ${c.period}`, `연령·성별 ${R.ageLbl}(위 차트)`, `지역 ${R.regionLbl}·${A.VIS_LABEL[S.visitor]}(아래 차트)`]),
    ];
    if (!tr.length) head.push(notice("선택 기간에 연령대별 방문 데이터가 없습니다."));
    else head.push(lead(trendLead(R, A)));
    out.push(keep(...head, a && caption(`월별 ${R.ageLbl} 방문객 수 (연령대별 방문 데이터, 지역 구분 없음)`), a));
    if (b) out.push(keep(caption(`월별 ${R.regionLbl} 방문객 수 — ${A.VIS_LABEL[S.visitor]} (읍면동 방문객 데이터, 연령 구분 없음)`), b));
    const months = [...new Set([...tr, ...trR].map((r) => r.m))].sort((x, y) => x - y);
    if (months.length) {
      const find = (list, m) => list.find((r) => r.m === m);
      const rows = months.map((m) => ({ m, a: find(tr, m), b: find(trR, m) }));
      const val = (r) => (r ? A.fmt(r.v) : "데이터 없음"), yoy = (r) => (r ? signed(r.yoy, A.pct) : "-");
      out.push(table([
        { label: "기준연월", width: 70, get: (r) => A.ymLabel(r.m) },
        { label: `${R.ageLbl} 방문객(명)`, num: 1, get: (r) => val(r.a) }, { label: "전년 동월 대비", num: 1, width: 72, get: (r) => yoy(r.a) },
        { label: `${R.regionLbl} 방문객(명)`, num: 1, get: (r) => val(r.b) }, { label: "전년 동월 대비", num: 1, width: 72, get: (r) => yoy(r.b) },
      ], rows));
      out.push(note("두 방문객 수는 집계 기준이 달라 서로 비교하지 않습니다."));
    }
    return out;
  }
  function secRegion(c) {
    const { A, R, S } = c, rg = R.region, key = S.visitor;
    const head = [h1("5. 지역별 방문"), scope([`기간 ${c.period}`, `지역 ${S.sgg === "all" ? "전체 지역" : S.sgg}${S.emd !== "all" ? `(${S.emd} 강조)` : ""}`, A.VIS_LABEL[key]], "연령·성별(데이터에 정보 없음)")];
    if (!rg.months.length || !rg.rows.length) return [keep(...head, notice("선택 기간에 읍면동 방문객 데이터가 없습니다."))];
    const bars = rg.rows.slice(0, 10);
    const sel = rg.rows.find((r) => r.name === S.emd);
    if (sel && !bars.includes(sel)) bars.push(sel);
    const sggs = [...new Set(bars.map((r) => r.sgg))];
    const sggColor = (s) => (s === "제주시" ? A.C.purple : A.C.teal);
    const legend = sggs.map((s) => [s, sggColor(s)]);
    if (sel) legend.push([`선택: ${sel.name}`, A.C.amber]);
    const mapW = 276, barW = PAGE_W - mapW - 12, map = regionMap(R, A, mapW);
    const bar = rankBars(bars.map((r) => ({ label: r.rank > 10 ? `${r.name} (${r.rank}위)` : r.name, v: r[key], color: S.emd === r.name ? A.C.amber : sggColor(r.sgg) })), A, barW, 220, { legend, labelMax: 12 });
    const top = rg.rows.slice(0, 15);
    if (sel && !top.includes(sel)) top.push(sel);
    return [
      keep(...head, lead(regionLead(R, A)),
        { columns: [{ width: mapW, stack: [caption("읍면동별 방문객 수 지도"), map].filter(Boolean) }, { width: barW, stack: [caption("방문객 상위 10개 읍면동"), bar].filter(Boolean) }], columnGap: 12, margin: [0, 0, 0, 6] }),
      table([
        { label: "순위", num: 1, width: 24, get: (r) => r.rank }, { label: "시군구", width: 44, get: (r) => r.sgg }, { label: "읍면동", get: (r) => r.name },
        { label: "내국인(명)", num: 1, strong: key === "dom", get: (r) => A.fmt(r.dom) }, { label: "외국인(명)", num: 1, strong: key === "for", get: (r) => A.fmt(r.for) },
        { label: "총(명)", num: 1, strong: key === "tot", get: (r) => A.fmt(r.tot) }, { label: "비중", num: 1, width: 38, get: (r) => A.pct(r.share) },
        { label: "전년 동기간 대비", num: 1, width: 62, get: (r) => signed(r.yoy, A.pct) },
      ], top, { hl: (r) => r.name === S.emd }),
      note(`표는 상위 ${Math.min(15, rg.rows.length)}개 읍면동${sel && sel.rank > 15 ? "과 선택 읍면동" : ""}입니다. 비중은 표시 범위 읍면동 합계(${A.VIS_LABEL[key]}) 대비이며, 한 사람이 여러 읍면동에서 집계될 수 있어 인원 비율이 아닙니다.`),
    ];
  }
  function secPlaces(c) {
    const { A, R, S } = c, pl = R.places, key = S.pmetric;
    const head = [h1("6. 인기 장소"), scope([`기간 ${c.period}`, `지역 ${R.regionLbl}`, `기준 ${A.PM_LABEL[key]}`], "연령·성별·내외국인(데이터에 정보 없음)")];
    if (!pl.months.length || !pl.rows.length) return [keep(...head, notice("선택 조건에 해당하는 장소 데이터가 없습니다."))];
    const t10 = pl.rows.slice(0, 10);
    const bar = rankBars(t10.map((r) => ({ label: r.n, v: r[key], color: A.C.purple })), A, PAGE_W, 172);
    return [
      keep(...head, lead(placeLead(R, A)), bar && caption(`${A.PM_LABEL[key]} 상위 ${t10.length}곳 (단위: 건, 내비게이션 도착 기준)`), bar),
      table([
        { label: "순위", num: 1, width: 24, get: (r) => r.rank }, { label: "목적지명", get: (r) => r.n },
        { label: "카테고리", width: 76, get: (r) => r.cat + (r.cats.length > 1 ? ` 외 ${r.cats.length - 1}` : "") }, { label: "읍면동", width: 46, get: (r) => r.emd },
        { label: "관광객 도착 수", num: 1, width: 58, strong: key === "tour", get: (r) => A.fmt(r.tour) }, { label: "도민 도착 수", num: 1, width: 52, strong: key === "res", get: (r) => A.fmt(r.res) },
        { label: "도착건수", num: 1, width: 48, strong: key === "all", get: (r) => A.fmt(r.all) },
      ], pl.rows),
      note(domText("place-exact")),
    ];
  }
  function secSearch(c) {
    const { A, R, S } = c, sr = R.search;
    const head = [h1("7. 관광 검색어"), scope([`기간 ${c.period}`, `분류 ${S.scat === "all" ? "전체 분류" : S.scat}`, domText("search-scope").split(" (주소")[0]], "연령·성별·내외국인(데이터에 정보 없음)")];
    if (!sr.months.length || !sr.rows.length) return [keep(...head, notice("선택 조건에 해당하는 비짓제주 데이터가 없습니다."))];
    const t10 = sr.rows.slice(0, 10);
    const bar = rankBars(t10.map((r) => ({ label: r.n, v: r.v, color: A.C.pink })), A, PAGE_W, 172, { labelMax: 24 });
    const total = sum(sr.catTotals.map((x) => x.v));
    return [
      keep(...head, lead(searchLead(R, A)), bar && caption(`검색 수치 상위 ${t10.length}개 장소·행사`), bar),
      table([
        { label: "순위", num: 1, width: 24, get: (r) => r.rank }, { label: "장소·행사명", get: (r) => r.n }, { label: "분류", width: 56, get: (r) => r.c },
        { label: "수치 합계", num: 1, width: 66, strong: 1, get: (r) => A.fmt(r.v) },
      ], sr.rows.slice(0, 20)),
      keep(h2("분류별 수치 합계"), table([
        { label: "분류", get: (r) => r.c }, { label: "수치 합계", num: 1, get: (r) => A.fmt(r.v) }, { label: "비중", num: 1, get: (r) => (total ? A.pct(r.v / total) : "-") },
      ], sr.catTotals)),
      note(`검색 수치는 비짓제주 장소·행사명별 합계이며 관심의 지표일 뿐 실제 방문·선호를 뜻하지 않습니다. 분류별 합계는 분류 필터와 관계없이 모든 분류를 보여 줍니다. '축제/행사' 분류는 2026년 3월부터만 데이터에 있습니다. ${domText("search-exact")}`),
    ];
  }
  function secReviews(c) {
    const { A, R, S } = c, rv = R.reviews;
    const head = [h1("8. 온라인 후기"), scope([S.rall ? "기간 전체 수집 기간" : `작성일 ${c.period}`, `연령 ${A.AGE_LABEL(S.age)}(20대 글만 수집)`, `지역 ${R.regionLbl}(지명 언급 기준)`], "성별·내외국인")];
    if (!rv) return [keep(...head, notice("온라인 후기 데이터가 없습니다."))];
    const msgs = rv.notes.slice();
    if (!rv.n) msgs.push("선택 조건에 해당하는 후기가 없습니다.");
    else if (rv.n < 30) msgs.push(`선택 조건의 후기가 ${rv.n}건뿐이라 비율 해석에 주의가 필요합니다.`);
    const top = [...head];
    if (rv.n) top.push(lead(reviewLead(R, A)));
    msgs.forEach((m) => top.push(notice(m)));
    if (!rv.n) return [keep(...top)];
    const block = (title, group) => {
      const list = rv.topics.filter((t) => t.group === group);
      if (group !== "context") list.sort((a, b) => b.n - a.n);
      const bar = (t) => ({ canvas: [{ type: "rect", x: 0, y: 2.5, w: Math.max(0.5, (t.share || 0) * 56), h: 4.5, r: 1.5, color: "#8f74f0" }] });
      return { stack: [h2(title), table([
        { label: "주제", get: (t) => t.name }, { label: "글 수", num: 1, width: 26, get: (t) => `${t.n}건` }, { label: "비율", num: 1, width: 26, get: (t) => A.pct(t.share, 0) }, { label: "", width: 56, get: bar },
      ], list)] };
    };
    return [
      keep(...top, { columns: [block("주요 활동", "activity"), block("여행 형태·계기·이동", "context")], columnGap: 14 }),
      keep({ columns: [block("만족 요인", "satisfaction"), block("불편 사항", "complaint")], columnGap: 14 }),
      note(`비율은 분석 대상 글 ${rv.n}건 중 해당 주제 키워드가 제목·요약문에 나온 글의 비율입니다. 감성 분석이 아니라 언급 집계이며, 요약문이 약 200자로 짧아 실제 언급보다 적게 잡힙니다. 근거 문장과 원문 링크는 대시보드에서 볼 수 있습니다.`),
    ];
  }
  function secNext(c) {
    const { summary } = c.R;
    return [
      keep(h1("9. 해석과 제안"), h2("해석 및 가설 (검증 전)"), bullets(summary.interp)),
      keep(h2("실행 제안 (효과 검증 전)"), bullets(summary.action)),
      keep(h2("추가 확인 사항"), bullets(summary.check.filter((t) => !INTERNAL.test(t)))),
    ];
  }
  function secSources(c) {
    const { A } = c, D = A.data;
    const widths = [70, 66, 62, 56, 50, undefined];
    const out = [
      keep(h1("10. 데이터 기준과 집계 방식"), lead("이 보고서가 사용한 데이터의 기간, 집계 단위와 한계입니다.")),
      table(A.SOURCE_COLS.map((label, i) => ({ label, width: widths[i], get: (r) => publicNote(r[i]) })), A.sourceRows(), { size: 7 }),
    ];
    if (D.reviews) out.push(keep(h2("온라인 후기 수집·선별 과정"), table([{ label: "단계", get: (r) => r[0] }, { label: "글 수", num: 1, width: 50, get: (r) => A.fmt(r[1]) }], D.reviews.funnel, { size: 7.5 })));
    return out;
  }

  function buildDoc() {
    const A = window.DASH_REPORT, R = window.DASH_RESULT, S = R.state;
    const now = new Date(), two = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`;
    const period = S.start === S.end ? A.ymLabel(S.start) : `${A.ymLabel(S.start)} ~ ${A.ymLabel(S.end)}`;
    const c = { A, R, S, period };
    const filterLine = [period, R.ageLbl, R.regionLbl, A.VIS_LABEL[S.visitor]].join(" · ");
    const title = `${STUDY.name} 분석보고서`;
    return {
      pageSize: "A4", pageMargins: [40, 50, 40, 44], language: "ko-KR",
      info: { title, subject: filterLine, creator: "청년층 제주 관광 동향 대시보드", producer: "청년층 제주 관광 동향 대시보드" },
      defaultStyle: { font: "Pretendard", fontSize: 9, lineHeight: 1.3, color: INK },
      styles: {
        h1: { fontSize: 13, bold: true, color: ACCENT, margin: [0, 15, 0, 5] },
        h2: { fontSize: 9.5, bold: true, margin: [0, 8, 0, 3] },
        lead: { fontSize: 9.5, lineHeight: 1.4, margin: [0, 1, 0, 6] },
        scope: { fontSize: 7.5, color: MUTED, margin: [0, 0, 0, 4] },
        note: { fontSize: 7.5, color: MUTED, margin: [0, 4, 0, 0] },
        cap: { fontSize: 8, bold: true, color: MUTED, margin: [0, 2, 0, 2] },
      },
      header: (page) => (page === 1 ? null : {
        columns: [{ text: title, bold: true, color: ACCENT }, { text: runs(filterLine), alignment: "right", color: MUTED }],
        fontSize: 7.5, margin: [40, 24, 40, 0],
      }),
      footer: (page, count) => ({
        columns: [{ text: `생성 ${stamp} · 수치와 문장은 필터 조건에 따라 자동 작성됨`, color: MUTED }, { text: `${page} / ${count}`, alignment: "right", color: MUTED }],
        fontSize: 7.5, margin: [40, 16, 40, 0],
      }),
      content: [
        {
          table: { widths: ["*"], body: [[{
            fillColor: ACCENT, margin: [14, 12, 14, 12], stack: [
              { text: "분석보고서", fontSize: 9, bold: true, color: "#d9cffb" },
              { text: STUDY.name, fontSize: 22, bold: true, color: "#ffffff", margin: [0, 2, 0, 4] },
              { text: runs(filterLine), fontSize: 9.5, color: "#efeafe" },
              { text: `보고서 생성 ${stamp}`, fontSize: 8, color: "#d9cffb", margin: [0, 3, 0, 0] },
            ],
          }]] }, layout: "noBorders",
        },
        ...secStudy(c), ...secFilter(c), ...secKpi(c), ...secTrend(c), ...secRegion(c),
        ...secPlaces(c), ...secSearch(c), ...secReviews(c), ...secNext(c), ...secSources(c),
      ],
    };
  }

  function fileName() {
    const A = window.DASH_REPORT, R = window.DASH_RESULT, S = R.state;
    const now = new Date(), day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const age = S.age === "all" ? "전체연령" : `${S.age}대`;
    return `청년층_제주관광_분석보고서_${S.start}-${S.end}_${age}_${R.regionLbl}_${day}.pdf`.replace(/[\\/:*?"<>|\s]+/g, "");
  }

  // ---------- 불러오기·내려받기 ----------
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.src = src; s.onload = ok;
        s.onerror = () => { delete loaded[src]; s.remove(); fail(new Error("load " + src)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }
  async function prepare() {
    await Promise.all([loadScript(PDFMAKE_URL), loadScript(FONTS_URL)]);
    if (prepare.done) return;
    pdfMake.addVirtualFileSystem(window.REPORT_FONTS);
    pdfMake.addFonts({
      Pretendard: { normal: "Pretendard-Regular.otf", bold: "Pretendard-Bold.otf", italics: "Pretendard-Regular.otf", bolditalics: "Pretendard-Bold.otf" },
      Hanja: { normal: "NotoSansKR-Hanja.ttf", bold: "NotoSansKR-Hanja.ttf", italics: "NotoSansKR-Hanja.ttf", bolditalics: "NotoSansKR-Hanja.ttf" },
    });
    prepare.done = true;
  }

  let hideMsg = null;
  function message(text, isError) {
    const el = $("report-msg");
    clearTimeout(hideMsg);
    el.hidden = !text; el.textContent = text || ""; el.classList.toggle("err", !!isError);
    if (isError) hideMsg = setTimeout(() => { el.hidden = true; }, 8000);
  }
  const buttons = () => document.querySelectorAll("[data-report]");
  let busy = false;
  async function download() {
    if (busy || !window.DASH_RESULT) return;
    busy = true;
    buttons().forEach((b) => { b.disabled = true; b.setAttribute("aria-busy", "true"); });
    message("분석보고서를 만들고 있습니다. 처음에는 폰트를 내려받아 시간이 조금 걸립니다.");
    try {
      await prepare();
      await new Promise((ok) => setTimeout(ok, 30)); // 안내 문구가 먼저 그려지게 한 뒤 생성
      await pdfMake.createPdf(buildDoc()).download(fileName());
      message("");
    } catch (e) {
      console.error("분석보고서 생성 실패", e);
      message(String(e.message).startsWith("load ") ? "보고서 도구를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요." : "보고서를 만들지 못했습니다. 다시 시도하세요.", true);
    } finally {
      busy = false;
      buttons().forEach((b) => { b.disabled = false; b.removeAttribute("aria-busy"); });
    }
  }
  buttons().forEach((b) => b.addEventListener("click", download));
})();
