/* 엔진 단위 테스트 — 실행: node --test tests/ */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const R = require("../engine/rc-engine.js");

const ROOT = path.join(__dirname, "..");
const MARK_A = "/* ==== RC-ENGINE BEGIN ====", MARK_B = "/* ==== RC-ENGINE END ==== */";
function block(src) { const a = src.indexOf(MARK_A), b = src.indexOf(MARK_B); return a < 0 || b < 0 ? null : src.slice(a, b + MARK_B.length); }

test("엔진 블록이 pc.html · mobile.html 에 원본과 동일하게 들어 있다", () => {
  const src = block(fs.readFileSync(path.join(ROOT, "engine/rc-engine.js"), "utf8"));
  for (const f of ["pc.html", "mobile.html"]) {
    assert.equal(block(fs.readFileSync(path.join(ROOT, f), "utf8")), src, f + " 의 엔진이 원본과 다릅니다 — node tools/sync-engine.js 실행");
  }
});

/* ───── 기능 3: 과학 표기 복원 ───── */

test("단위: 물리량 단서와 차원이 맞으면 복원 (풍속 → m s⁻¹)", () => {
  const r = R.sci.restoreText("The wind speed reached 25 m s-1 near the surface.");
  assert.equal(r.display, "The wind speed reached 25 m s⁻¹ near the surface.");
  assert.equal(r.speech, "The wind speed reached 25 meters per second near the surface.");
  assert.equal(r.query, "The wind speed reached 25 m s^-1 near the surface.");
});

test("단위: 여러 인자·유니코드 마이너스·en dash", () => {
  assert.equal(R.sci.restoreText("specific heat of 1004 J kg-1 K-1").speech, "specific heat of 1004 joules per kilogram per kelvin");
  assert.equal(R.sci.restoreText("heat flux of 120 W m−2").display, "heat flux of 120 W m⁻²");
  assert.equal(R.sci.restoreText("rain rate of 30 mm h–1").query, "rain rate of 30 mm h^-1");
  assert.equal(R.sci.restoreText("kg m-2 s-1 is the unit").speech, "kilograms per square meter per second is the unit");
});

test("단위: 단서와 차원이 어긋나면 복원하지 않는다", () => {
  /* 압력 단서 뒤의 m s-1 은 차원 불일치 → 그대로 */
  assert.equal(R.sci.restoreText("the pressure was 5 m s-1").query, "the pressure was 5 m s-1");
});

test("단위: 인자 하나짜리는 단서가 있을 때만 (Fig. 3d-1 오인 방지)", () => {
  assert.equal(R.sci.restoreText("See Fig. 3d-1 for details.").query, "See Fig. 3d-1 for details.");
  assert.equal(R.sci.restoreText("number concentration of 100 cm-3").display, "number concentration of 100 cm⁻³");
});

test("화학식: 원소기호·첨자 규칙으로 검증", () => {
  const r = R.sci.restoreText("CO2, SO2, O3 and CH4 but not S1, WV3, IR1 or GK2A.");
  assert.equal(r.display, "CO₂, SO₂, O₃ and CH₄ but not S1, WV3, IR1 or GK2A.");
  assert.equal(R.sci.restoreText("CO2").speech, "C O two");
  assert.equal(R.sci.restoreText("CaCl2 seeding").speech, "calcium chloride seeding");
});

test("배치 표지: 거듭제곱·각주·변수·아래첨자", () => {
  const r = R.sci.restoreText("Vorticity of 10^{-4} s^{-1}, CO_{2} flux, Smith^{1} found r^{2} and T_{d}.");
  assert.equal(r.display, "Vorticity of 10⁻⁴ s⁻¹, CO₂ flux, Smith¹ found r² and T_d.");
  assert.equal(r.speech, "Vorticity of 10 to the power of minus 4 per second, C O two flux, Smith found r squared and T d.");
});

test("복원은 멱등이다 (질의용 표기를 다시 넣어도 같은 결과)", () => {
  const once = R.sci.restoreText("wind speed of 25 m s-1 with CO2 and 1004 J kg-1 K-1 heat capacity").query;
  assert.equal(R.sci.restoreText(once).query, once);
});

test("위치 대응: 음성 위치 → 원문 위치", () => {
  const r = R.sci.restoreText("speed of 25 m s-1 here");
  const sp = r.speech.indexOf("here");
  assert.equal(R.sci.mapOffset(r, "speech", "input", sp), "speed of 25 m s-1 here".indexOf("here"));
  const mid = r.speech.indexOf("per second");
  const back = R.sci.mapOffset(r, "speech", "input", mid);
  assert.ok(back >= 12 && back <= 17, "단위 토큰 내부로 대응 " + back);
});

test("PDF 항목: 작고 위로 뜬 글자는 위첨자, 아래로 내려간 글자는 아래첨자", () => {
  const items = [
    { str: "wind speed of 25 m s", transform: [10, 0, 0, 10, 50, 700] },
    { str: "−1", transform: [7, 0, 0, 7, 150, 704] },
    { str: " and CO", transform: [10, 0, 0, 10, 160, 700] },
    { str: "2", transform: [7, 0, 0, 7, 190, 698] },
    { str: " rose", transform: [10, 0, 0, 10, 195, 700], hasEOL: true },
    { str: "Next line smaller", transform: [8, 0, 0, 8, 50, 686] }
  ];
  const b = R.sci.fromItems(items);
  assert.equal(b.text, "wind speed of 25 m s^-1 and CO2 rose Next line smaller");
  assert.equal(b.display, "wind speed of 25 m s⁻¹ and CO₂ rose Next line smaller");
  assert.ok(b.itemTokens[1] && b.itemTokens[1][0].tok.kind === "unit", "위첨자 항목이 단위 토큰에 연결");
  assert.ok(b.itemTokens[0] && b.itemTokens[0][0].tok.kind === "unit", "기준 항목의 's' 부분도 단위 토큰에 연결");
  assert.equal(b.itemTokens[0][0].a, "wind speed of 25 ".length);
  assert.ok(b.itemTokens[3] && b.itemTokens[3][0].tok.kind === "chem");
  assert.equal(b.itemTokens[5], null);
});

/* ───── 문장 분리 ───── */

test("문장 분리: 소수점·약어·Fig. 에서 끊지 않는다", () => {
  const s = R.seg.sentences("Rain of 1.5 mm fell (Smith et al. 2020). See Fig. 3 for e.g. details. Done.");
  assert.deepEqual(s.map(x => x.text), ["Rain of 1.5 mm fell (Smith et al. 2020).", "See Fig. 3 for e.g. details.", "Done."]);
});

/* ───── 기능 1: 적응형 발화 구간 분할 ───── */

const TXT = "Mesoscale convective systems (MCSs) are responsible for a large fraction of warm-season rainfall over the central United States, and their initiation is strongly modulated by the low-level jet. The updraft velocity reached 25 m s-1 within the convective core, where graupel and hail were frequently observed by the polarimetric radar.";

test("분할: 모든 단위가 허용 길이 이내, 이어 붙이면 원문과 같다", () => {
  for (const rel of [0.2, 0.12, 0.06]) {
    const u = R.seg.plan(TXT, { relErr: rel, errBudget: 8 });
    u.forEach(x => assert.ok(x.text.length <= u.maxLen + 12, rel + " 길이 초과: " + x.text));
    assert.equal(u.map(x => x.text).join(" "), TXT);
  }
});

test("분할: 속도 모델이 정확해질수록(상대오차↓) 단위가 길어진다 — 적응형", () => {
  const n1 = R.seg.plan(TXT, { relErr: 0.2 }).length, n2 = R.seg.plan(TXT, { relErr: 0.06 }).length;
  assert.ok(n1 > n2, n1 + " > " + n2);
});

test("분할: 전문용어 직전(관사 포함)에서 끊어 용어가 단위 앞머리에 온다", () => {
  const u = R.seg.plan(TXT, { relErr: 0.12, errBudget: 8 });
  const termStarts = u.filter(x => x.why === "term").map(x => x.text.split(" ").slice(0, 2).join(" "));
  assert.ok(termStarts.length >= 1);
  termStarts.forEach(h => assert.ok(R.seg.termScore(h.split(" ")[0]) >= 3 || /^(the|a|an|this|these|its|their)$/i.test(h.split(" ")[0]), h));
});

test("분할: 과학 표기·짧은 괄호 내부는 자르지 않는다", () => {
  const t = "The observed speed was very large at 25 m s-1 in the core region of the storm system today (MCSs) here.";
  R.seg.plan(t, { relErr: 0.3, errBudget: 8, minLen: 10 }).forEach(x => {
    assert.ok(!/^s-1/.test(x.text) && !/ m$/.test(x.text), "단위 분리: " + x.text);
    assert.ok(!/^MCSs\)/.test(x.text) && !/\($/.test(x.text), "괄호 분리: " + x.text);
  });
});

test("용어 점수: 흔한 단어·숫자는 0, 약어·전문용어·단어장 단어는 높다", () => {
  assert.equal(R.seg.termScore("the"), 0);
  assert.equal(R.seg.termScore("2000"), 0);
  assert.ok(R.seg.termScore("MCSs") >= 3);
  assert.ok(R.seg.termScore("baroclinic") >= 3);
  assert.ok(R.seg.termScore("modulated", { userWords: { modulated: true } }) >= 3);
});

test("속도 모델: 관측으로 보정되고 상대오차가 줄어든다", () => {
  const c = new R.Clock();
  const k = c.key("Samantha", 1);
  assert.equal(c.cps(k, 1), 14.5);
  c.observe(k, 1, 160, 10000);                       /* 16 cps */
  for (let i = 0; i < 12; i++) c.observe(k, 1, 160, 10000);
  assert.ok(Math.abs(c.cps(k, 1) - 16) < 0.2);
  assert.ok(c.rel < 0.05, "rel " + c.rel);
  assert.equal(c.observe(k, 1, 160, 100), false, "너무 짧은 관측은 무시");
  const c2 = new R.Clock(JSON.parse(JSON.stringify(c)));
  assert.equal(c2.cps(k, 1), c.cps(k, 1));
});

test("위치 추정: 반응 지연을 빼고, 단위 시작 직후면 직전 단위의 끝", () => {
  const log = [
    { t0: 0, t1: 4000, cps: 15, speechLen: 60 },
    { t0: 4100, t1: null, cps: 15, speechLen: 50 }
  ];
  let r = R.seg.locate(log, 2400, { reaction: 400 });
  assert.equal(r.index, 0); assert.equal(Math.round(r.speechPos), 30);
  r = R.seg.locate(log, 4300, { reaction: 400 });       /* 반응 지연 적용 시 3900 → 직전 단위 */
  assert.equal(r.index, 0);
  r = R.seg.locate(log, 5500, { reaction: 400 });
  assert.equal(r.index, 1); assert.equal(Math.round(r.speechPos), 15);
});

test("용어 선택: 위치 부근의 전문용어·과학 표기를 고른다", () => {
  const u = "The updraft velocity reached 25 m s^-1 within the convective core,";
  assert.equal(R.seg.pickTerm(u, u.indexOf("25") + 4).word, "m s⁻¹");
  assert.equal(R.seg.pickTerm(u, u.indexOf("core") - 2).word, "convective");
  assert.equal(R.seg.pickTerm(u, 2).word, "updraft");
});

/* ───── 기능 2: 관련 구간 판정 ───── */

test("약어 정의 수집", () => {
  const a = R.rel.acronyms(TXT + " The low-level jet (LLJ) was strong. Weather Research and Forecasting (WRF) model.");
  assert.deepEqual(a.byAcr.MCS, ["mesoscale", "convective", "systems"]);
  assert.deepEqual(a.byAcr.LLJ, ["low-level", "jet"]);
  assert.deepEqual(a.byAcr.WRF, ["weather", "research", "forecasting"]);
});

test("관련 판정: 같은 말·변화형·약어·지시어·대명사(수 일치)", () => {
  const a = R.rel.acronyms(TXT);
  assert.equal(R.rel.related("jet", "modulated by the low-level jets.", a), 1);
  assert.equal(R.rel.related("MCS", "Several MCSs formed later.", a), 1);
  assert.equal(R.rel.related("MCS", "this convective system decayed.", a), 1);
  assert.equal(R.rel.related("convective", "the MCS decayed.", a), 1);
  assert.equal(R.rel.related("graupel", "It fell rapidly.", a), 0.6);
  assert.equal(R.rel.related("graupel", "They fell rapidly.", a), 0);
  assert.equal(R.rel.related("convective", "It fell rapidly.", a), 0, "형용사는 대명사로 받지 않는다");
  assert.equal(R.rel.related("graupel", "Winds increased.", a), 0);
});

test("다시 듣기 지점: 확실한 관련 절 우선, 없으면 바로 다음 절의 대명사, 없으면 -1", () => {
  const a = R.rel.acronyms(TXT);
  const cl = ["and their initiation is modulated,", "These systems persist.", "Several MCSs merged."];
  assert.equal(R.rel.decide("MCS", cl, a), 1);
  assert.equal(R.rel.decide("graupel", ["It melted quickly.", "Winds rose."], a), 0);
  assert.equal(R.rel.decide("graupel", ["Winds rose.", "It melted."], a), -1);
  assert.equal(R.rel.decide("jet", [], a), -1);
});
