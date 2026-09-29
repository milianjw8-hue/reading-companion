#!/usr/bin/env node
/*
 * engine/rc-engine.js 를 pc.html · mobile.html 의 엔진 자리에 그대로 삽입한다.
 * 두 HTML은 "파일 하나로 동작"해야 하므로 엔진을 외부 파일로 불러오지 않고 복사해 넣는다.
 *   node tools/sync-engine.js          반영
 *   node tools/sync-engine.js --check  다르면 오류 종료 (테스트·배포 전 확인용)
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const A = "/* ==== RC-ENGINE BEGIN ====", B = "/* ==== RC-ENGINE END ==== */";
const src = fs.readFileSync(path.join(ROOT, "engine/rc-engine.js"), "utf8");
const block = src.slice(src.indexOf(A), src.indexOf(B) + B.length);
const check = process.argv.includes("--check");
let bad = 0;

for (const f of ["pc.html", "mobile.html"]) {
  const p = path.join(ROOT, f);
  const html = fs.readFileSync(p, "utf8");
  const a = html.indexOf(A), b = html.indexOf(B);
  if (a < 0 || b < 0) { console.error(f + ": 엔진 표지를 찾지 못했습니다"); bad++; continue; }
  const next = html.slice(0, a) + block + html.slice(b + B.length);
  if (next === html) { console.log(f + ": 최신"); continue; }
  if (check) { console.error(f + ": 엔진이 원본과 다릅니다"); bad++; continue; }
  fs.writeFileSync(p, next);
  console.log(f + ": 반영함");
}
process.exit(bad ? 1 : 0);
