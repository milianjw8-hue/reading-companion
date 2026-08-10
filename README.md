# Reading Companion

영어 원서와 학술 논문을 브라우저에서 읽으며, 모르는 구절과 그림을 그 자리에서
물어보는 도구. 서버 없음, 설치 없음, HTML 파일 하나로 동작.

## 특징

- **구절 선택 질의** — 문장을 드래그하면 번역 / 쉽게 설명 / 단어·표현 버튼
- **그림·표 질의** — 영역을 잘라내면 그 페이지 본문과 함께 전송되어, 캡션과
  본문 서술을 근거로 그림을 읽음
- **페이지 문맥 자동 첨부** — 현재 페이지 원문 + 이전 페이지 끝부분
- **BYOK** — 사용자가 자기 API 키를 넣음. 키는 브라우저에만 저장
- **비용 0원** — Google AI Studio 무료 한도 내에서 동작

## 빠른 시작

1. https://aistudio.google.com/apikey 에서 API 키 발급 (카드 불필요)
2. `index.html` 더블클릭
3. 키 입력 → `사용 가능한 모델 불러오기` → Flash 계열 선택 → `저장`
4. `연결 테스트` → "연결 성공" 확인
5. `PDF 선택`

자세한 내용은 `manual.html` 참조.

## 파일 구성

| 파일 | 내용 |
|---|---|
| `index.html` | 앱 본체 (단일 파일, 의존성은 CDN의 PDF.js뿐) |
| `manual.html` | 사용자 설명서 (단독 실행, 외부 의존성 없음) |
| `README.md` | 이 문서 |
| `LICENSE` | MIT |
| `check-before-publish.sh` | 배포 전 점검 (macOS/Linux/WSL) |
| `check-before-publish.ps1` | 배포 전 점검 (Windows PowerShell) |
| `publish-to-github.ps1` | GitHub Pages 배포 준비 자동화 (Windows) |
| `blogger-post.html` | 블로그 발행용 소개글 (복사 버튼 포함) |

## 배포

정적 파일이므로 빌드가 필요 없다.

**배포 전 반드시 안전 점검을 돌릴 것.**

```bash
./check-before-publish.sh          # macOS / Linux / WSL
```

```powershell
.\check-before-publish.ps1        # Windows PowerShell
```

파일 내 키, git 커밋 이력의 키, 입력란 value 하드코딩을 검사한다.
과거 커밋에서 키가 발견되면 **이력 삭제보다 키 폐기가 먼저다** —
AI Studio에서 해당 키를 즉시 폐기하고 새로 발급할 것.

```bash
# GitHub Pages
git init && git add . && git commit -m "Reading Companion"
git branch -M main
git remote add origin https://github.com/<계정>/reading-companion.git
git push -u origin main
# Settings > Pages > Source: main
```

파일로 직접 열었을 때 문제가 생기면 로컬 서버로:

```bash
python -m http.server 8000   # http://localhost:8000/
```

## 데이터 취급

| 대상 | 전송 여부 |
|---|---|
| PDF 파일 | 전송 없음. 브라우저 메모리에서만 처리 |
| API 키 | 브라우저 저장소(localStorage)에만 보관. **HTML 파일에는 기록되지 않음** |
| 질문·페이지 텍스트 | Google Gemini API로 전송 |
| 잘라낸 그림 | Google Gemini API로 전송 |

**무료 티어는 입력이 모델 개선에 사용될 수 있다. 미공개 원고, 심사 중인 논문,
대외비 문서는 넣지 말 것.**

## 알려진 한계

- 문맥이 페이지 단위 — 문서 전체를 아우르는 질문에는 답하지 못함
- OCR 없음 — 스캔본 PDF는 선택·질문 불가 (앱이 자동 경고)
- 2단 조판에서 텍스트 추출 순서가 섞일 수 있음 — 해당 문단을 직접 선택하면 해결
- 수식은 추출 시 깨지는 경우가 많음 — 그림으로 잘라서 질의 권장

## 문제 해결

앱 설정 화면의 `진단 정보` 패널에 HTTP 상태 코드와 원문 오류가 기록된다.

| 코드 | 원인 |
|---|---|
| 400 / 403 | 키 문제 |
| 404 | 모델 ID 없음 → 목록에서 재선택 |
| 429 | 무료 한도 초과 |
| fetch 실패 | 네트워크·방화벽 차단 |

## 라이선스

MIT. 포함 라이브러리: PDF.js (Apache License 2.0, Mozilla).
언어모델은 틀릴 수 있으므로 전문 용어와 수치는 원문과 대조할 것.
