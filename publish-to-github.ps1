# GitHub Pages 배포 준비 (Windows PowerShell)
# 사용법:  .\publish-to-github.ps1
#
# 이 스크립트가 하는 일:
#   1) 키 유출 안전 점검
#   2) git 저장소 초기화 및 첫 커밋
#   3) 다음에 실행할 push 명령을 화면에 출력
#
# GitHub 저장소 생성과 push는 직접 하셔야 합니다 (계정 인증 필요).

$ErrorActionPreference = "Stop"

Write-Host "=== Reading Companion — GitHub Pages 배포 준비 ===" -ForegroundColor Cyan
Write-Host ""

# ── 0. 위치 확인 ────────────────────────────────────────────
if (-not (Test-Path "index.html")) {
    Write-Host "[중단] index.html 이 없습니다." -ForegroundColor Red
    Write-Host "       패키지 폴더에서 실행하세요. 예:" -ForegroundColor Yellow
    Write-Host "       cd C:\AI_Dev\APP-Dev\reading-companion-package\reading-companion" -ForegroundColor Yellow
    exit 1
}
Write-Host "현재 위치: $(Get-Location)" -ForegroundColor Gray
Write-Host ""

# ── 1. git 설치 확인 ────────────────────────────────────────
Write-Host "[1/4] git 설치 확인" -ForegroundColor Cyan
try {
    $v = git --version
    Write-Host "  OK - $v" -ForegroundColor Green
} catch {
    Write-Host "  [중단] git이 설치되어 있지 않습니다." -ForegroundColor Red
    Write-Host "         https://git-scm.com/download/win 에서 설치 후 PowerShell을 재시작하세요." -ForegroundColor Yellow
    exit 1
}
Write-Host ""

# ── 2. 안전 점검 ────────────────────────────────────────────
Write-Host "[2/4] 키 유출 안전 점검" -ForegroundColor Cyan
if (Test-Path ".\check-before-publish.ps1") {
    & .\check-before-publish.ps1
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "[중단] 안전 점검을 통과하지 못했습니다. 배포하지 마세요." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  [경고] check-before-publish.ps1 이 없어 점검을 건너뜁니다." -ForegroundColor Yellow
}
Write-Host ""

# ── 3. git 저장소 준비 ──────────────────────────────────────
Write-Host "[3/4] git 저장소 준비" -ForegroundColor Cyan
if (Test-Path ".git") {
    Write-Host "  이미 git 저장소입니다. 변경분만 커밋합니다." -ForegroundColor Gray
} else {
    git init | Out-Null
    Write-Host "  저장소 초기화 완료" -ForegroundColor Green
}

# 사용자 정보가 없으면 안내
$uname = git config user.name
if (-not $uname) {
    Write-Host ""
    Write-Host "  git 사용자 정보가 없습니다. 아래를 먼저 실행하세요:" -ForegroundColor Yellow
    Write-Host '    git config --global user.name "이름"' -ForegroundColor Yellow
    Write-Host '    git config --global user.email "메일주소"' -ForegroundColor Yellow
    exit 1
}

git add .
$staged = git diff --cached --name-only
if (-not $staged) {
    Write-Host "  커밋할 변경사항이 없습니다." -ForegroundColor Gray
} else {
    git commit -m "Reading Companion - PDF reading assistant" | Out-Null
    Write-Host "  커밋 완료 ($(($staged -split "`n").Count)개 파일)" -ForegroundColor Green
}
git branch -M main
Write-Host ""

# ── 4. 다음 단계 안내 ───────────────────────────────────────
Write-Host "[4/4] 남은 작업 - 아래를 순서대로 진행하세요" -ForegroundColor Cyan
Write-Host ""
Write-Host "  A. GitHub에서 새 저장소 생성" -ForegroundColor White
Write-Host "     https://github.com/new" -ForegroundColor Gray
Write-Host "     - Repository name : reading-companion" -ForegroundColor Gray
Write-Host "     - Public 선택 (Pages 사용에 필요)" -ForegroundColor Gray
Write-Host "     - README/gitignore/license 체크는 모두 해제" -ForegroundColor Gray
Write-Host ""
Write-Host "  B. 아래 두 줄 실행 (<계정>을 본인 GitHub ID로 바꾸세요)" -ForegroundColor White
Write-Host "     git remote add origin https://github.com/<계정>/reading-companion.git" -ForegroundColor Yellow
Write-Host "     git push -u origin main" -ForegroundColor Yellow
Write-Host ""
Write-Host "  C. GitHub Pages 켜기" -ForegroundColor White
Write-Host "     저장소 > Settings > Pages" -ForegroundColor Gray
Write-Host "     - Source : Deploy from a branch" -ForegroundColor Gray
Write-Host "     - Branch : main / (root) > Save" -ForegroundColor Gray
Write-Host ""
Write-Host "  D. 2~3분 뒤 접속 확인" -ForegroundColor White
Write-Host "     앱      : https://<계정>.github.io/reading-companion/" -ForegroundColor Green
Write-Host "     설명서  : https://<계정>.github.io/reading-companion/manual.html" -ForegroundColor Green
Write-Host ""
Write-Host "준비 완료. 위 A~D를 진행하세요." -ForegroundColor Cyan
