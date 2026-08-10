#!/usr/bin/env bash
# 배포 전 안전 점검 — 저장소 루트에서 실행
set -u
fail=0

echo "== 1. 파일 내 API 키 검사 =="
if grep -rInE '(^|[^A-Za-z0-9_/+-])(AIza[0-9A-Za-z_-]{30,45}|sk-ant-[A-Za-z0-9_-]{30,})([^A-Za-z0-9_/+-]|$)' . \
     --exclude-dir=.git --exclude=check-before-publish.sh 2>/dev/null; then
  echo "  [위험] 키로 보이는 문자열 발견 — 위 파일을 확인하세요."; fail=1
else
  echo "  OK — 키 없음 (base64 데이터의 우연한 일치는 걸러집니다)"
fi

echo "== 2. git 커밋 이력 검사 =="
if [ -d .git ]; then
  if git log -p --all 2>/dev/null | grep -qE '(^|[^A-Za-z0-9_/+-])(AIza[0-9A-Za-z_-]{30,45}|sk-ant-[A-Za-z0-9_-]{30,})([^A-Za-z0-9_/+-]|$)'; then
    echo "  [위험] 과거 커밋에 키가 남아 있습니다."
    echo "         → 해당 키를 즉시 폐기하고 새로 발급하세요. 이력 삭제보다 폐기가 먼저입니다."
    fail=1
  else
    echo "  OK — 이력 깨끗"
  fi
else
  echo "  건너뜀 (git 저장소 아님)"
fi

echo "== 3. input value 하드코딩 검사 =="
if grep -nE '<input[^>]*id="key"[^>]*value=' index.html 2>/dev/null; then
  echo "  [위험] 키 입력란에 값이 박혀 있습니다."; fail=1
else
  echo "  OK — 하드코딩 없음"
fi

echo
[ "$fail" -eq 0 ] && echo "배포해도 안전합니다." || echo "문제가 있습니다. 배포하지 마세요."
exit $fail
