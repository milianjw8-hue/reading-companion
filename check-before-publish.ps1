# 배포 전 안전 점검 (Windows PowerShell) — 저장소 루트에서 실행
# 사용법:  .\check-before-publish.ps1

# Google 키는 AIza + 35자(총 39자), Anthropic 키는 sk-ant- 접두.
# 앞뒤 경계를 두어 base64 데이터 안의 우연한 일치를 걸러낸다.
$pattern = '(?<![A-Za-z0-9_/+-])(AIza[0-9A-Za-z_-]{30,45}|sk-ant-[A-Za-z0-9_-]{30,})(?![A-Za-z0-9_/+-])'
$fail = $false

Write-Host "== 1. 파일 내 API 키 검사 ==" -ForegroundColor Cyan
$hits = Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\\.git\\' -and $_.Name -ne 'check-before-publish.ps1' } |
        Select-String -Pattern $pattern -CaseSensitive -ErrorAction SilentlyContinue
if ($hits) {
    Write-Host "  [위험] 키로 보이는 문자열 발견:" -ForegroundColor Red
    $hits | ForEach-Object { Write-Host ("    " + $_.Path + " : " + $_.LineNumber) }
    $fail = $true
} else {
    Write-Host "  OK - 키 없음" -ForegroundColor Green
}

Write-Host "== 2. git 커밋 이력 검사 ==" -ForegroundColor Cyan
if (Test-Path ".git") {
    $log = git log -p --all 2>$null | Select-String -Pattern $pattern -CaseSensitive
    if ($log) {
        Write-Host "  [위험] 과거 커밋에 키가 남아 있습니다." -ForegroundColor Red
        Write-Host "         해당 키를 즉시 폐기하고 새로 발급하세요." -ForegroundColor Red
        Write-Host "         이력 삭제보다 폐기가 먼저입니다." -ForegroundColor Red
        $fail = $true
    } else {
        Write-Host "  OK - 이력 깨끗" -ForegroundColor Green
    }
} else {
    Write-Host "  건너뜀 (git 저장소 아님 - 저장소 폴더에서 실행하세요)" -ForegroundColor Yellow
}

Write-Host "== 3. input value 하드코딩 검사 ==" -ForegroundColor Cyan
if (Test-Path "index.html") {
    $v = Select-String -Path "index.html" -Pattern '<input[^>]*id="key"[^>]*value='
    if ($v) {
        Write-Host "  [위험] 키 입력란에 값이 박혀 있습니다." -ForegroundColor Red
        $fail = $true
    } else {
        Write-Host "  OK - 하드코딩 없음" -ForegroundColor Green
    }
} else {
    Write-Host "  건너뜀 (index.html 없음)" -ForegroundColor Yellow
}

Write-Host ""
if ($fail) { Write-Host "문제가 있습니다. 배포하지 마세요." -ForegroundColor Red; exit 1 }
else { Write-Host "배포해도 안전합니다." -ForegroundColor Green; exit 0 }
