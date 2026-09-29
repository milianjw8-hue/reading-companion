/* ==== RC-ENGINE BEGIN ====
 * Reading Companion 공통 엔진 — pc.html · mobile.html 에 그대로 삽입된다.
 * 이 파일이 원본이다. 수정한 뒤에는 `node tools/sync-engine.js` 로 두 HTML에 반영할 것.
 * DOM·네트워크에 접근하지 않는 순수 로직만 둔다 (Node에서 단위 테스트 가능).
 *
 *   RCE.sci   과학 표기 복원        — 단위(m s⁻¹, J kg⁻¹ K⁻¹)·화학식(CO₂)을 복원하고
 *                                    화면용·음성용·AI 질의용 표기와 원문 위치를 함께 만든다
 *   RCE.seg   적응형 발화 구간 분할  — 위치 추정 오차가 허용치를 넘기 전, 절 경계나
 *                                    전문용어 직전에서 낭독문을 끊는다
 *   RCE.Clock 발화 속도 모델        — 구간마다 실제 발화 시간으로 속도를 보정하고
 *                                    입력 시각으로부터 발화 위치·질의 용어를 추정한다
 *   RCE.rel   관련 구간 판정        — 설명을 기다리는 동안 읽은 절 중 질의어와 관련된
 *                                    절(같은 말·약어·지시어)을 찾는다
 */
var RCE = (function () {
  "use strict";

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function toSet(list) { var s = Object.create(null); list.forEach(function (w) { s[w] = true; }); return s; }

  /* ───────────────────────── 1. 과학 표기 복원 ───────────────────────── */

  var SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺" };
  var SUB = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
  var SUP_DIGIT = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
  var NUM_WORD = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

  function supStr(s) { return String(s).split("").map(function (c) { return SUP[c] || c; }).join(""); }
  function subStr(s) { return String(s).split("").map(function (c) { return SUB[c] || c; }).join(""); }

  /* 차원 벡터 [질량 M, 길이 L, 시간 T, 온도 Θ, 물질량 N] */
  var UNIT = {
    m: [[0, 1, 0, 0, 0], "meter"], km: [[0, 1, 0, 0, 0], "kilometer"], cm: [[0, 1, 0, 0, 0], "centimeter"],
    mm: [[0, 1, 0, 0, 0], "millimeter"], um: [[0, 1, 0, 0, 0], "micrometer"], "µm": [[0, 1, 0, 0, 0], "micrometer"],
    "μm": [[0, 1, 0, 0, 0], "micrometer"], nm: [[0, 1, 0, 0, 0], "nanometer"],
    s: [[0, 0, 1, 0, 0], "second"], min: [[0, 0, 1, 0, 0], "minute"], h: [[0, 0, 1, 0, 0], "hour"],
    hr: [[0, 0, 1, 0, 0], "hour"], d: [[0, 0, 1, 0, 0], "day"],
    kg: [[1, 0, 0, 0, 0], "kilogram"], g: [[1, 0, 0, 0, 0], "gram"],
    K: [[0, 0, 0, 1, 0], "kelvin"],
    J: [[1, 2, -2, 0, 0], "joule"], W: [[1, 2, -3, 0, 0], "watt"], N: [[1, 1, -2, 0, 0], "newton"],
    Pa: [[1, -1, -2, 0, 0], "pascal"], hPa: [[1, -1, -2, 0, 0], "hectopascal"], kPa: [[1, -1, -2, 0, 0], "kilopascal"],
    mol: [[0, 0, 0, 0, 1], "mole"], L: [[0, 3, 0, 0, 0], "liter"]
  };
  var UNIT_SYMS = Object.keys(UNIT).sort(function (a, b) { return b.length - a.length; });
  var FACTOR_RE = new RegExp("^(" + UNIT_SYMS.map(function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") +
    ")(?:\\^?\\{?([-−–⁻]?)([0-9⁰¹²³⁴⁵⁶⁷⁸⁹])\\}?)?$");

  /* 문장 속 물리량 단서 → 허용 차원. 단서가 있으면 그 차원과 일치해야 복원한다. */
  var QTY = [
    [/\b(wind|winds|velocity|velocities|speed|speeds|updraft|updrafts|downdraft|downdrafts|motion|drift|jet|current)\b/i, [[0, 1, -1, 0, 0]]],
    [/\b(precipitation|rain|rainfall|snowfall|drizzle)\b/i, [[0, 1, -1, 0, 0], [0, 1, 0, 0, 0]]],
    [/\b(vorticity|divergence|convergence|shear|deformation|frequency|frequencies)\b/i, [[0, 0, -1, 0, 0]]],
    [/\b(tendency|tendencies|heating|cooling|warming)\b/i, [[0, 0, -1, 1, 0], [0, 0, -1, 0, 0]]],
    [/\b(acceleration|gravity|gravitational)\b/i, [[0, 1, -2, 0, 0]]],
    [/\b(pressure|pressures)\b/i, [[1, -1, -2, 0, 0]]],
    [/\b(CAPE|CIN|geopotential|latent|enthalpy|specific energy|kinetic energy)\b/, [[0, 2, -2, 0, 0], [1, 2, -2, 0, 0]]],
    [/\b(specific heat|heat capacity|gas constant)\b/i, [[0, 2, -2, -1, 0]]],
    [/\b(density|densities)\b/i, [[1, -3, 0, 0, 0], [0, -3, 0, 0, 0]]],
    [/\b(flux|fluxes|irradiance|radiation|radiative forcing)\b/i, [[1, 0, -3, 0, 0], [1, -2, -1, 0, 0], [1, -1, -1, 0, 0]]],
    [/\b(lapse rate|gradient|gradients)\b/i, [[0, -1, 0, 1, 0]]],
    [/\b(concentration|concentrations)\b/i, [[0, -3, 0, 0, 0], [1, -3, 0, 0, 0], [0, -3, 0, 0, 1]]],
    [/\b(reflectivity)\b/i, [[0, 3, 0, 0, 0]]],
    [/\b(mixing ratio|specific humidity|water content)\b/i, [[0, 0, 0, 0, 0], [1, -3, 0, 0, 0]]],
    [/\b(power)\b/i, [[1, 2, -3, 0, 0]]],
    [/\b(energy)\b/i, [[1, 2, -2, 0, 0], [0, 2, -2, 0, 0]]],
    [/\b(wavenumber|wave number)\b/i, [[0, -1, 0, 0, 0]]],
    [/\b(area)\b/i, [[0, 2, 0, 0, 0]]]
  ];
  var PLAUSIBLE = [];
  QTY.forEach(function (q) { q[1].forEach(function (d) { PLAUSIBLE.push(d); }); });
  function dimEq(a, b) { for (var i = 0; i < 5; i++) if (a[i] !== b[i]) return false; return true; }
  function dimIn(d, list) { for (var i = 0; i < list.length; i++) if (dimEq(d, list[i])) return true; return false; }

  /* 원소기호 · 대기화학에서 흔한 원소 · 흔한 화학종 */
  var ELEMENTS = toSet(("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr " +
    "Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os " +
    "Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu").split(" "));
  var ATMO = toSet("C H O N S Cl F Br I P Na K Ca Mg Ag Fe Si Al Hg Pb Zn Cu".split(" "));
  var SPECIES = toSet("O2 O3 N2 H2O CO2 CH4 N2O NO2 SO2 NH3 HNO3 H2SO4 CaCl2 H2O2 HO2 N2O5 CCl4 SF6".split(" "));
  var SPECIES_NAME = { NaCl: "sodium chloride", CaCl2: "calcium chloride", H2SO4: "sulfuric acid", HNO3: "nitric acid" };

  function parseFormula(tok) {
    if (!/^(?:[A-Z][a-z]?\d{0,2})+$/.test(tok) || !/\d/.test(tok)) return null;
    var parts = [], re = /([A-Z][a-z]?)(\d{0,2})/g, m;
    while ((m = re.exec(tok))) {
      if (!ELEMENTS[m[1]]) return null;
      if (m[2] && (+m[2] < 2)) return null;              /* 아래첨자 1은 쓰지 않는다 */
      parts.push({ el: m[1], n: m[2] });
    }
    return parts;
  }
  function chemToken(tok, layout) {
    var parts = parseFormula(tok);
    if (!parts) return null;
    var known = !!SPECIES[tok];
    if (parts.length < 2 && !known) return null;           /* S1, H2 같은 단일 기호+숫자는 제외 */
    var atmoOnly = parts.every(function (p) { return ATMO[p.el]; });
    if (!known && !atmoOnly && !layout) return null;       /* WV3 같은 채널명 오인 방지 */
    var speech = SPECIES_NAME[tok] || parts.map(function (p) {
      var letters = p.el.toUpperCase().split("").join(" ");
      return p.n ? letters + " " + p.n.split("").map(function (d) { return NUM_WORD[+d]; }).join(" ") : letters;
    }).join(" ");
    return {
      kind: "chem", query: tok,
      display: parts.map(function (p) { return p.el + subStr(p.n); }).join(""),
      speech: speech
    };
  }

  function parseFactor(tok) {
    var m = FACTOR_RE.exec(tok);
    if (!m) return null;
    var digit = m[3] ? (SUP_DIGIT[m[3]] || m[3]) : "";
    var neg = !!m[2];
    return { sym: m[1], exp: digit ? (neg ? -(+digit) : +digit) : 1, explicit: !!digit };
  }
  function unitName(sym, plural) {
    var n = UNIT[sym][1];
    return plural && n !== "kelvin" ? n + "s" : n;
  }
  function powerWords(e) { return e === 2 ? "square " : e === 3 ? "cubic " : ""; }
  function unitToken(factors) {
    var dim = [0, 0, 0, 0, 0];
    factors.forEach(function (f) { var d = UNIT[f.sym][0]; for (var i = 0; i < 5; i++) dim[i] += d[i] * f.exp; });
    var pos = factors.filter(function (f) { return f.exp > 0; });
    var neg = factors.filter(function (f) { return f.exp < 0; });
    var num = pos.map(function (f, i) {
      var name = unitName(f.sym, i === pos.length - 1);
      return f.exp > 3 ? name + " to the power of " + NUM_WORD[f.exp] : powerWords(f.exp) + name;
    }).join(" ");
    var den = neg.map(function (f) {
      var e = -f.exp;
      return e > 3 ? "per " + unitName(f.sym) + " to the power of " + NUM_WORD[e] : "per " + powerWords(e) + unitName(f.sym);
    }).join(" ");
    return {
      kind: "unit", dim: dim,
      display: factors.map(function (f) { return f.sym + (f.exp === 1 ? "" : supStr(String(f.exp))); }).join(" "),
      query: factors.map(function (f) { return f.sym + (f.exp === 1 ? "" : "^" + f.exp); }).join(" "),
      speech: (num + (num && den ? " " : "") + den) || factors[0].sym
    };
  }

  function cueDims(text, at) {
    var from = Math.max(0, at - 140);
    var win = text.slice(from, at);
    var stop = Math.max(win.lastIndexOf(". "), win.lastIndexOf("! "), win.lastIndexOf("? "));
    if (stop >= 0) win = win.slice(stop + 2);
    var best = null, bestAt = -1;
    QTY.forEach(function (q) {
      var re = new RegExp(q[0].source, q[0].flags.indexOf("g") >= 0 ? q[0].flags : q[0].flags + "g"), m;
      while ((m = re.exec(win))) { if (m.index >= bestAt) { bestAt = m.index; best = q[1]; } }
    });
    return best;
  }

  function tokenize(text) {
    var out = [], re = /\S+/g, m;
    while ((m = re.exec(text))) out.push({ s: m[0], a: m.index, b: m.index + m[0].length });
    return out;
  }

  /* 한 토큰에서 앞뒤 문장부호를 떼어 핵심부 [a,b)를 돌려준다 */
  function core(t) {
    var s = t.s, a = 0, b = s.length;
    while (a < b && /[("'“‘\[]/.test(s.charAt(a))) a++;
    while (b > a && /[,.;:)"'”’\]]/.test(s.charAt(b - 1)) && !/\}$/.test(s.slice(a, b))) b--;
    return { s: s.slice(a, b), a: t.a + a, b: t.a + b, trail: b < s.length };
  }

  /*
   * 텍스트에서 과학 표기 후보를 찾고 검증한다.
   * 입력의 ^{..} / _{..} 표지는 fromItems 가 글자 크기·기준선으로 찾아낸 위·아래첨자다.
   * 반환: { query, display, speech, tokens[], segs[] }
   *   query   AI 질의·내부 처리용 (m s^-1, CO2)
   *   display 화면 표시용       (m s⁻¹, CO₂)
   *   speech  음성합성용        (meters per second, C O two)
   *   segs    원문 ↔ 각 표기의 위치 대응 (mapOffset 으로 사용)
   */
  function restoreText(text) {
    text = String(text || "");
    var toks = tokenize(text), found = [], used = [];
    var i, j;

    /* (1) 단위 묶음: 연속된 단위 토큰, 하나 이상에 지수가 있어야 후보 */
    for (i = 0; i < toks.length; i++) {
      if (used[i]) continue;
      var c0 = core(toks[i]), lead = "", body = c0.s;
      var nm = /^([+-]?\d+(?:\.\d+)?)(?=[A-Za-zµμ])/.exec(body);
      if (nm) { lead = nm[1]; body = body.slice(nm[1].length); }
      var layoutHit = false, factors = [], parsed = [];
      var f0 = parseSegmented(body);
      if (!f0) continue;
      factors = factors.concat(f0.f); layoutHit = layoutHit || f0.layout;
      parsed.push(i);
      var endTok = c0, trailing = c0.trail;
      for (j = i + 1; j < toks.length && !trailing; j++) {
        var cj = core(toks[j]);
        if (cj.a !== toks[j].a) break;                      /* 앞에 괄호 등이 붙으면 끊김 */
        var fj = parseSegmented(cj.s);
        if (!fj) break;
        factors = factors.concat(fj.f); layoutHit = layoutHit || fj.layout;
        parsed.push(j); endTok = cj; trailing = cj.trail;
      }
      if (!factors.some(function (f) { return f.explicit; })) continue;
      var tok = unitToken(factors);
      var startAt = c0.a + lead.length;
      var cues = cueDims(text, startAt);
      var ok;
      if (cues) ok = dimIn(tok.dim, cues);
      else ok = (factors.length >= 2 || layoutHit) && dimIn(tok.dim, PLAUSIBLE);
      if (!ok) continue;
      tok.a = startAt; tok.b = endTok.b; tok.layout = layoutHit;
      found.push(tok);
      parsed.forEach(function (k) { used[k] = true; });
      i = parsed[parsed.length - 1];
    }

    /* (2) 화학식 */
    for (i = 0; i < toks.length; i++) {
      if (used[i]) continue;
      var c = core(toks[i]);
      var layout = /_\{\d+\}/.test(c.s);
      var flat = c.s.replace(/_\{(\d+)\}/g, "$1").replace(/[₀-₉]/g, function (ch) { return String(ch.charCodeAt(0) - 0x2080); });
      var ct = chemToken(flat, layout);
      if (ct) { ct.a = c.a; ct.b = c.b; found.push(ct); used[i] = true; }
    }

    /* (3) 남은 첨자 표지: 숫자 거듭제곱 · 변수 거듭제곱 · 각주 번호 · 아래첨자 */
    var markRe = /([A-Za-z0-9.]*)\^\{([^}]*)\}|([A-Za-z]+)_\{([^}]*)\}/g, mm;
    while ((mm = markRe.exec(text))) {
      var a0 = mm.index, b0 = mm.index + mm[0].length;
      if (found.some(function (t) { return a0 < t.b && b0 > t.a; })) continue;
      if (mm[3] !== undefined) {                            /* 아래첨자 T_{d} */
        found.push({ kind: "sub", a: a0, b: b0, query: mm[3] + "_" + mm[4], display: mm[3] + "_" + mm[4], speech: mm[3] + " " + mm[4] });
        continue;
      }
      var base = mm[1], sup = mm[2].replace(/[−–]/g, "-");
      if (/^\d+(\.\d+)?$/.test(base) && /^-?\d+$/.test(sup)) {
        found.push({ kind: "num", a: a0, b: b0, query: base + "^" + sup, display: base + supStr(sup),
          speech: base + " to the power of " + (sup.charAt(0) === "-" ? "minus " + sup.slice(1) : sup) });
      } else if (/^[A-Za-z]$/.test(base) && /^\d$/.test(sup)) {
        found.push({ kind: "pow", a: a0, b: b0, query: base + "^" + sup, display: base + supStr(sup),
          speech: base + (sup === "2" ? " squared" : sup === "3" ? " cubed" : " to the power of " + sup) });
      } else {                                              /* 각주·인용 번호: 읽지 않는다 */
        found.push({ kind: "foot", a: a0, b: b0, query: base + (/^\w{1,3}$/.test(sup) ? "" : sup),
          display: base + (/^[0-9+-]+$/.test(sup) ? supStr(sup) : sup), speech: base });
      }
    }

    found.sort(function (x, y) { return x.a - y.a; });
    var out = { query: "", display: "", speech: "", tokens: [], segs: [] }, p = 0;
    function emit(a, b, tk) {
      var seg = { i0: a, i1: b, tok: tk || null };
      ["query", "display", "speech"].forEach(function (k) {
        var s = tk ? tk[k] : text.slice(a, b);
        seg[k] = [out[k].length, out[k].length + s.length];
        out[k] += s;
      });
      out.segs.push(seg);
      if (tk) out.tokens.push(tk);
    }
    found.forEach(function (tk) {
      if (tk.a < p) return;
      if (tk.a > p) emit(p, tk.a);
      emit(tk.a, tk.b, tk);
      p = tk.b;
    });
    if (p < text.length) emit(p, text.length);
    return out;
  }

  /* "kg·m^{-3}" 같은 토큰 하나를 인자 목록으로 */
  function parseSegmented(s) {
    if (!s) return null;
    var parts = s.split(/[·⋅]/), f = [], layout = false;
    for (var k = 0; k < parts.length; k++) {
      var q = parts[k];
      if (/\^\{/.test(q)) layout = true;
      var x = parseFactor(q);
      if (!x) return null;
      f.push(x);
    }
    return { f: f, layout: layout };
  }

  /* 출력 표기 which 의 위치 ↔ 입력 위치 */
  function mapOffset(res, from, to, off) {
    var segs = res.segs;
    for (var k = 0; k < segs.length; k++) {
      var sg = segs[k], r = from === "input" ? [sg.i0, sg.i1] : sg[from];
      if (off <= r[1] || k === segs.length - 1) {
        var frac = r[1] > r[0] ? clamp((off - r[0]) / (r[1] - r[0]), 0, 1) : 0;
        var t = to === "input" ? [sg.i0, sg.i1] : sg[to];
        if (!sg.tok) return t[0] + clamp(off - r[0], 0, t[1] - t[0]);
        return Math.round(t[0] + frac * (t[1] - t[0]));
      }
    }
    return 0;
  }

  /*
   * PDF.js getTextContent() 항목 → 첨자 표지가 붙은 텍스트.
   * 같은 줄 기준 글자보다 작고(85% 미만) 기준선이 위로 뜬 항목은 ^{..}, 아래로 내려간 항목은 _{..}.
   * itemRange[i] 는 i번째 항목이 결과 텍스트에서 차지하는 범위 (텍스트 레이어 span 과 1:1).
   */
  function fromItems(items) {
    var raw = "", ranges = [], base = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {}, s = it.str == null ? "" : String(it.str);
      var tr = it.transform || [1, 0, 0, 1, 0, 0];
      var size = Math.sqrt(tr[2] * tr[2] + tr[3] * tr[3]) || it.height || 0;
      var y = tr[5], x = tr[4];
      var role = "n";
      if (base && s.trim() && size > 0 && size < base.size * 0.85 &&
          Math.abs(y - base.y) < base.size * 0.9 && x >= base.x - 1) {
        var dy = y - base.y;
        if (dy > base.size * 0.15) role = "sup";
        else if (dy < -base.size * 0.07) role = "sub";
      }
      var start;
      if (role === "n") {
        if (s.trim()) base = { size: size, y: y, x: x };
        if (raw && !/\s$/.test(raw) && s && !/^\s/.test(s)) raw += " ";
        start = raw.length; raw += s;
      } else {
        raw = raw.replace(/\s+$/, "");
        start = raw.length; raw += (role === "sup" ? "^{" : "_{") + s.trim() + "}";
      }
      ranges[i] = [start, raw.length, role];
      if (it.hasEOL && !/\s$/.test(raw)) raw += " ";
    }
    /* 공백 정리 (위치 대응 유지) */
    var text = "", map = new Array(raw.length + 1), sp = false;
    for (var k = 0; k < raw.length; k++) {
      var ch = raw.charAt(k), ws = /\s/.test(ch);
      map[k] = text.length;
      if (ws) { if (!sp && text) { text += " "; } sp = true; }
      else { text += ch; sp = false; }
    }
    map[raw.length] = text.length;
    var trimmed = text.replace(/\s+$/, "");
    var res = restoreText(trimmed);
    var itemTokens = ranges.map(function (r, idx) {
      if (!r) return null;
      var a = map[r[0]], b = map[r[1]], hits = [];
      res.segs.forEach(function (sg) {
        if (!sg.tok || sg.i1 <= a || sg.i0 >= b) return;
        var la = r[2] === "n" ? clamp(sg.i0 - a, 0, b - a) : 0;
        var lb = r[2] === "n" ? clamp(sg.i1 - a, 0, b - a) : String(items[idx].str || "").length;
        hits.push({ a: la, b: lb, tok: sg.tok });
      });
      return hits.length ? hits : null;
    });
    return { text: res.query, display: res.display, res: res, itemTokens: itemTokens };
  }

  /* ───────────────────────── 문장 분리 ───────────────────────── */

  var ABBR = toSet("e.g i.e et al fig figs eq eqs ref refs vs etc approx cf no sect ch vol pp mr mrs dr st".split(" "));
  function sentences(text) {
    var out = [], start = 0, re = /[.!?…]+["'”’)\]]*(?=\s|$)/g, m;
    while ((m = re.exec(text))) {
      var end = m.index + m[0].length;
      var before = text.slice(start, m.index);
      var lastWord = (/([A-Za-z.]+)$/.exec(before) || ["", ""])[1].toLowerCase().replace(/\.$/, "");
      var next = text.slice(end).replace(/^\s+/, "");
      if (m[0].charAt(0) === "." && ABBR[lastWord]) continue;                 /* e.g. / Fig. / et al. */
      if (m[0].charAt(0) === "." && /^[a-z0-9(]/.test(next)) continue;       /* 소문자·숫자로 이어지면 문장 중간 */
      push(start, end);
      start = end;
    }
    push(start, text.length);
    function push(a, b) {
      while (a < b && /\s/.test(text.charAt(a))) a++;
      while (b > a && /\s/.test(text.charAt(b - 1))) b--;
      if (b - a > 1) out.push({ text: text.slice(a, b), start: a, end: b });
    }
    return out;
  }

  /* ───────────────────────── 2. 적응형 발화 구간 분할 ───────────────────────── */

  var COMMON = toSet(("the be to of and a in that have i it for not on with he as you do at this but his by from they we say " +
    "her she or an will my one all would there their what so up out if about who get which go me when make can like time no " +
    "just him know take people into year your good some could them see other than then now look only come its over think also " +
    "back after use two how our work first well way even new want because any these give day most us is are was were been has " +
    "had did said however results result using used based data model models study show shown shows between each such both where " +
    "while during within without through under more less very same different large small high low higher lower number values " +
    "value case cases found may might must should since thus therefore although whereas those three four five figure table " +
    "section paper present presented here further significant observed period periods area areas region regions level levels").split(" "));
  var GLOSS = ("convect mesoscal synopt barocl barotrop advect vortic diverg converg reflectiv microphys graupel hail supercell " +
    "squall derecho orograph parameteriz parametris assimil ensembl reanalys isentrop geopotent adiabat lapse inversion aerosol " +
    "nucleat hygroscop condensat evapor sublim precipit radiosond troposph stratosph tropopaus monsoon typhoon cyclon anticyclon " +
    "frontogen helicit buoyan entrain detrain downburst updraft downdraft hydrometeor nowcast extratrop subtrop geostroph " +
    "ageostroph hydrostat thermodynam instabil radar lidar dropsond polarimetr doppler cumulonimb stratiform cirrus anvil " +
    "graupel riming aggregat collision coalescen accretion autoconvers supercool glaciat").split(" ");
  var CONJ = toSet("which that where when while because although whereas and but or if since unless whose".split(" "));
  var DET = toSet("the a an this these that those its their our such".split(" "));

  /* 이용자가 질의할 가능성 (0 = 거의 없음, 3 이상 = 높음) */
  function termScore(word, o) {
    o = o || {};
    var w = String(word || "").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (w.length < 2 || /^[\d.,\-−]+$/.test(w)) return 0;     /* 숫자는 질의 대상이 아니다 */
    var lw = w.toLowerCase(), s = 0;
    if (o.userWords && o.userWords[lw]) s += 3;
    if (COMMON[lw] && !s) return 0;
    s += 1;
    if (/^[A-Z]{2,}[a-z]?s?$/.test(w)) s += 2;
    if (/\d|\^|_\{/.test(w) || o.sci) s += 2;
    if (w.length >= 10) s += 1.5; else if (w.length >= 7) s += 0.8;
    for (var i = 0; i < GLOSS.length; i++) if (lw.indexOf(GLOSS[i]) === 0) { s += 2; break; }
    return s;
  }
  var TERM_T = 3;

  function words(text) {
    var out = [], re = /[A-Za-z0-9][A-Za-z0-9'’^{}_.\-−]*[A-Za-z0-9}]|[A-Za-z0-9]/g, m;
    while ((m = re.exec(text))) out.push({ w: m[0], a: m.index, b: m.index + m[0].length });
    return out;
  }

  /*
   * 낭독문을 발화 단위로 나눈다.
   *   maxLen = errBudget / relErr  — 한 단위 안에서 누적 위치 오차가 허용치(errBudget 글자)를 넘지 않는 길이
   *   분할 위치 우선순위: ① 질의 가능성 높은 용어 바로 앞(그 용어가 다음 단위의 맨 앞, 즉 오차≈0 지점에 오도록)
   *                      ② 절 경계(쉼표·세미콜론·접속사 앞)  ③ 단어 경계
   *   과학 표기 토큰 내부는 절대 자르지 않는다.
   */
  function plan(text, o) {
    o = o || {};
    var rel = Math.max(o.relErr || 0.12, 0.03), budget = o.errBudget || 8;
    var cap = o.capLen || 180, minLen = o.minLen || 28;
    var maxLen = clamp(Math.round(budget / rel), minLen, cap);
    var ts = o.termScore || function (w) { return termScore(w, o); };
    var sci = restoreText(text).tokens;
    var units = [];
    /* 자를 수 없는 위치: 과학 표기 내부, "(MCSs)" 같은 짧은 괄호 안 */
    function inToken(p) {
      if (sci.some(function (t) { return p > t.a && p < t.b; })) return true;
      var open = text.lastIndexOf("(", p), close = text.lastIndexOf(")", p - 1);
      if (open >= 0 && open > close && p - open <= 12) return true;
      return text.charAt(p - 1) === "(" || /^\(\S{1,10}\)/.test(text.slice(p));
    }
    /* 용어 앞 관사·한정사가 있으면 그 앞에서 자른다 ("the | convective core" 대신 "| the convective core") */
    function shiftBeforeDet(ws, k, a) {
      var p = ws[k].a;
      if (k > 0 && DET[ws[k - 1].w.toLowerCase()] && ws[k - 1].a - a >= minLen) p = ws[k - 1].a;
      while (p > a && !/\s/.test(text.charAt(p - 1))) p--;
      return p;
    }

    sentences(text).forEach(function (se) {
      var ws = words(text.slice(se.start, se.end)).map(function (w) { return { w: w.w, a: w.a + se.start, b: w.b + se.start }; });
      var a = se.start, b = se.end;
      while (a < b) {
        var rest = b - a, cut = -1, why = "";
        /* ① 전문용어 직전 — 오차가 커지기 시작하는 지점(허용 길이의 55%) 이후의 첫 용어 */
        for (var k = 0; k < ws.length; k++) {
          var w = ws[k], off = w.a - a;
          if (w.a <= a || off > maxLen) continue;
          if (off < Math.max(minLen, 0.55 * maxLen) || b - w.a < 10 || inToken(w.a)) continue;
          if (ts(w.w) >= TERM_T) { cut = shiftBeforeDet(ws, k, a); why = "term"; break; }
        }
        if (cut < 0 && rest <= maxLen) { pushUnit(a, b, "end"); break; }
        /* ② ③ 경계 점수 */
        if (cut < 0) {
          var best = -1e9;
          for (k = 0; k < ws.length; k++) {
            w = ws[k]; off = w.a - a;
            if (w.a <= a || off < minLen || off > maxLen || b - w.a < 10 || inToken(w.a)) continue;
            var prev = text.slice(a, w.a).replace(/\s+$/, "");
            var sc = 1 + 0.6 * (off / maxLen);
            if (/[,;:]$/.test(prev)) sc += 3;
            else if (/[—–(]$/.test(prev)) sc += 2;
            if (CONJ[w.w.toLowerCase()]) sc += 2;
            var tsc = ts(w.w);
            if (tsc >= TERM_T) sc += 4 + Math.min(2, tsc - TERM_T);
            if (sc > best) {
              best = sc;
              cut = tsc >= TERM_T ? shiftBeforeDet(ws, k, a) : w.a;
              why = /[,;:]$/.test(prev) ? "clause" : tsc >= TERM_T ? "term" : "word";
            }
          }
        }
        if (cut < 0) { cut = Math.min(b, a + maxLen); why = "hard"; }
        pushUnit(a, cut, why);
        a = cut;
      }
    });
    function pushUnit(a, b, why) {
      while (a < b && /\s/.test(text.charAt(a))) a++;
      var e = b;
      while (e > a && /\s/.test(text.charAt(e - 1))) e--;
      if (e > a) units.push({ text: text.slice(a, e), start: a, end: e, why: why });
    }
    units.maxLen = maxLen;
    return units;
  }

  /* 발화 단위의 음성용 텍스트와 위치 대응 */
  function speechOf(unitText) {
    var r = restoreText(unitText);
    return { speech: r.speech, res: r };
  }

  /* ───────────────────────── 발화 속도 모델 · 위치 추정 ───────────────────────── */

  var DEFAULT_CPS = 14.5;                                     /* 영어 TTS 1.0배속 ≈ 초당 14~15자 */
  function Clock(state) {
    this.m = {};
    this.rel = 0.12;
    if (state && typeof state === "object") {
      if (state.m && typeof state.m === "object") this.m = state.m;
      if (typeof state.rel === "number") this.rel = clamp(state.rel, 0.03, 0.4);
    }
  }
  Clock.prototype.key = function (voiceName, rate) { return (voiceName || "default") + "|" + rate; };
  Clock.prototype.cps = function (key, rate) {
    var e = this.m[key];
    return e && e.cps > 0 ? e.cps : DEFAULT_CPS * (rate || 1);
  };
  /* 한 발화 단위가 끝날 때마다 실제 소요 시간으로 속도와 상대 오차를 갱신 (적응형) */
  Clock.prototype.observe = function (key, rate, len, ms) {
    if (!(ms > 300) || len < 10) return false;
    var c = len / (ms / 1000);
    if (c < 3 || c > 60) return false;                        /* 일시정지·오류로 인한 이상값 */
    var e = this.m[key];
    if (!e) { this.m[key] = { cps: c, n: 1 }; return true; }
    var err = Math.abs(c - e.cps) / e.cps;
    this.rel = clamp(0.75 * this.rel + 0.25 * err, 0.03, 0.4);
    e.cps = 0.7 * e.cps + 0.3 * c;
    e.n = (e.n || 0) + 1;
    return true;
  };
  Clock.prototype.toJSON = function () { return { m: this.m, rel: this.rel }; };

  /*
   * 입력 시각 → 발화 위치.
   * log: [{ t0, t1|null, cps, speechLen, ... }]  (t 는 performance.now() 기준 ms)
   * 반응 지연을 뺀 시각이 현재 단위 시작 전이면 직전 단위(의 끝)를 가리킨다.
   */
  function locate(log, tIn, o) {
    o = o || {};
    var t = tIn - (o.reaction == null ? 400 : o.reaction);
    for (var i = log.length - 1; i >= 0; i--) if (log[i].t0 <= t) break;
    if (i < 0) { if (!log.length) return null; i = 0; t = log[0].t0; }
    var e = log[i];
    var len = e.speechLen || 0;
    var pos = (e.t1 != null && t >= e.t1) ? len : ((t - e.t0) / 1000) * (e.cps || DEFAULT_CPS);
    return { index: i, entry: e, speechPos: clamp(pos, 0, len) };
  }

  /* 추정 위치 부근에서 질의 대상 용어 선택: 아직 들리지 않은 뒤쪽 단어는 2배 감점 */
  function pickTerm(text, pos, o) {
    o = o || {};
    var budget = o.errBudget || 8;
    var ts = o.termScore || function (w) { return termScore(w, o); };
    var sci = restoreText(text);
    var cands = words(text).filter(function (w) {
      return !sci.tokens.some(function (t) { return w.a >= t.a && w.b <= t.b; });
    }).map(function (w) { return { w: w.w, a: w.a, b: w.b, sci: null }; });
    sci.tokens.forEach(function (t) {
      if (t.kind === "unit" || t.kind === "chem") cands.push({ w: t.display, a: t.a, b: t.b, sci: t });
    });
    var best = null;
    cands.forEach(function (c) {
      var d = pos < c.a ? (c.a - pos) * 2 : pos > c.b ? pos - c.b : 0;
      if (pos < c.a && c.a - pos > budget * 1.5) return;
      if (pos > c.b && pos - c.b > budget * 4) return;
      var s = (c.sci ? TERM_T + 1 : ts(c.w)) - d / budget;
      if (!best || s > best.score) best = { word: c.w, a: c.a, b: c.b, score: s, sci: c.sci };
    });
    if (!best) {                                             /* 창 안에 없으면 가장 가까운 단어 */
      cands.forEach(function (c) {
        var d = Math.abs((c.a + c.b) / 2 - pos);
        if (!best || d < best.d) best = { word: c.w, a: c.a, b: c.b, d: d, score: 0, sci: c.sci };
      });
    }
    return best;
  }

  /* ───────────────────────── 3. 관련 구간 판정 (선택적 다시 듣기) ───────────────────────── */

  var STOP = toSet("of the and for in on to a an by with at from".split(" "));
  function stem(w) {
    w = String(w || "").toLowerCase().replace(/[’']s$/, "");
    if (w.length > 5 && /ies$/.test(w)) return w.slice(0, -3) + "y";
    if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) && !/us$/.test(w)) w = w.slice(0, -1);
    if (w.length > 6 && /ing$/.test(w)) return w.slice(0, -3);
    if (w.length > 5 && /ed$/.test(w)) return w.slice(0, -2);
    return w;
  }

  /* 문서에서 "Long Form Words (LFW)" 형태의 약어 정의를 모은다 */
  function acronyms(text) {
    var byAcr = Object.create(null), byWord = Object.create(null);
    var re = /((?:[A-Za-z][A-Za-z-]*\s+){0,8}[A-Za-z][A-Za-z-]*)\s*\(\s*([A-Z][A-Za-z]{1,8})\s*\)/g, m;
    while ((m = re.exec(String(text || "")))) {
      var acr = m[2].replace(/s$/, ""), letters = acr.toUpperCase();
      if (letters.length < 2 || letters.length > 8) continue;
      var ws = m[1].split(/\s+/);
      for (var n = 1; n <= Math.min(ws.length, letters.length + 3); n++) {
        var tail = ws.slice(ws.length - n);
        var content = tail.filter(function (w) { return !STOP[w.toLowerCase()]; });
        var initials = content.map(function (w) { return w.split("-").map(function (p) { return p.charAt(0); }).join(""); }).join("").toUpperCase();
        var initials1 = content.map(function (w) { return w.charAt(0); }).join("").toUpperCase();
        if (!STOP[tail[0].toLowerCase()] && (initials === letters || initials1 === letters)) {
          var lf = content.map(function (w) { return w.toLowerCase(); });
          byAcr[letters] = lf;
          lf.forEach(function (w) { byWord[stem(w)] = letters; });
          break;
        }
      }
    }
    return { byAcr: byAcr, byWord: byWord };
  }

  var DEMONST = toSet("this these that those such said".split(" "));
  var PRONOUN = /^\W*(?:(?:and|but|so|which|while|because|thus|hence|however)\W+)?(it|its|they|their|them|this|these|such)\b/i;
  var SINGULAR_PRON = toSet("it its this such".split(" "));
  var PLURAL_PRON = toSet("they their them these such".split(" "));
  /* 형용사·부사 어미가 아니면 명사로 본다 (약어는 명사) */
  function nounish(t) {
    if (/^[A-Z]{2,}s?$/.test(t)) return true;
    return !/(ive|al|ous|ic|ly|ful|less|able|ible|ed|ing|ary|ant|ent)$/i.test(t);
  }

  /* 지시어(this/these/such…) 뒤 세 단어 안에 head 가 나오는가 — "this convective system" */
  function demonstrates(ws, head) {
    for (var i = 0; i < ws.length; i++) {
      if (!DEMONST[ws[i].toLowerCase()]) continue;
      for (var k = i + 1; k <= i + 3 && k < ws.length; k++) if (stem(ws[k]) === head) return true;
    }
    return false;
  }

  /* 절 하나가 질의어와 관련된 정도 — 1: 확실(같은 말·약어), 0.6: 약함(지시·대명사) */
  function related(term, clause, acr) {
    acr = acr || { byAcr: {}, byWord: {} };
    var t = String(term || "").replace(/[^A-Za-z0-9-]/g, "");
    if (!t) return 0;
    var ts = stem(t);
    var ws = String(clause || "").match(/[A-Za-z][A-Za-z'’-]*/g) || [];
    var st = ws.map(stem);
    if (st.indexOf(ts) >= 0) return 1;
    var isAcr = /^[A-Z]{2,}s?$/.test(t);
    var up = isAcr ? t.replace(/s$/, "") : t.toUpperCase();
    if (isAcr && ws.some(function (w) { return w.replace(/s$/, "") === up; })) return 1;   /* MCS ↔ MCSs */
    var lf = isAcr ? acr.byAcr[up] : null;
    if (lf) {
      var lfStems = lf.map(stem);
      if (lfStems.every(function (x) { return st.indexOf(x) >= 0; })) return 1;
      if (demonstrates(ws, lfStems[lfStems.length - 1])) return 1;                   /* "this system" */
    }
    var acrOfTerm = acr.byWord[ts];
    if (acrOfTerm && ws.some(function (w) { return w.replace(/s$/, "") === acrOfTerm; })) return 1;
    /* 약한 관련: 절 첫머리의 대명사·지시어 — 질의어가 명사일 때만, 단수/복수가 맞을 때만 */
    var pm = PRONOUN.exec(clause);
    if (pm && nounish(t)) {
      var p = pm[1].toLowerCase();
      var plural = /s$/.test(t) && !/ss$/.test(t);
      if (plural ? PLURAL_PRON[p] : SINGULAR_PRON[p]) return 0.6;
    }
    return 0;
  }

  /*
   * 설명을 기다리는 동안 읽은 절들(clauses, 읽은 순서) 가운데 다시 들을 지점.
   * 확실한 관련 절이 있으면 그 중 가장 앞 절, 없고 바로 다음 절이 지시어·대명사로 시작하면 그 절.
   * 관련 절이 없으면 -1 (현재 위치에서 계속).
   */
  function decide(term, clauses, acr, o) {
    o = o || {};
    var n = Math.min(clauses.length, o.maxN || 6);
    for (var i = 0; i < n; i++) if (related(term, clauses[i], acr) >= 1) return i;
    if (n > 0 && related(term, clauses[0], acr) >= 0.6) return 0;
    return -1;
  }

  return {
    sci: { restoreText: restoreText, fromItems: fromItems, mapOffset: mapOffset, chemToken: chemToken, unitToken: unitToken },
    seg: { plan: plan, sentences: sentences, termScore: termScore, TERM_T: TERM_T, speechOf: speechOf, locate: locate, pickTerm: pickTerm, words: words },
    Clock: Clock,
    rel: { stem: stem, acronyms: acronyms, related: related, decide: decide },
    version: "1.0.0"
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = RCE;
/* ==== RC-ENGINE END ==== */
