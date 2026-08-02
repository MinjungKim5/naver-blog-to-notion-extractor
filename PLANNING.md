# 📋 Blog Extractor (네이버 블로그 자동 추출 및 포팅 시스템) 기획서

## 1. 프로젝트 개요 및 비전

### 🎯 최종 목표
* **한의원 홍보 블로그 자동화 & SEO 강화**: 네이버 블로그에 작성된 원장님/한의원의 글을 감지/추출하여, 향후 구축될 한의원 자사 홈페이지 홍보 게시판에 자동 배포.
* **DB 구축**: 한의원 홈페이지용 데이터베이스(DB)에 구조화된 포스트 데이터(텍스트, 이미지, 태그, 카테고리, 작성일 등)를 축적.

### 🚩 1차 (우선) 목표
* **네이버 블로그 ➔ 노션(Notion) 변환기 구축**
* 네이버 블로그 글의 **본문, 이미지, 서식, 구조(헤딩, 캡션, 인용구, 표 등)**를 완벽히 파싱하여 Notion 페이지 / 블록(Block) 구조로 가장 높은 유사도로 변환.
* **MCP (Model Context Protocol)** 연동 및 외부 시스템/LLM/크롤러 확장성 확보.

---

## 2. 확정된 기술 스택 (Tech Stack)

| 구분 | 기술 / 라이브러리 | 역할 |
| :--- | :--- | :--- |
| **Language & Runtime** | Node.js (v18+) + **TypeScript** | 메인 개발 언어 (NestJS 스타일 모듈 구조 적용) |
| **Scraper / Headless** | **Playwright** + Cheerio | 동적 DOM 렌더링, `mainFrame` iframe 접근 및 이미지 원본 추출 |
| **Notion Integration** | `@notionhq/client` | Notion API 연동 및 Page/Block 생성 |
| **MCP Interface** | `@modelcontextprotocol/sdk` | Claude / Antigravity 등 AI Agent 연동 MCP Server 구축 |
| **Utilities** | `dotenv`, `pino` (or `winston`), `zod` | 환경변수, 구조화된 로깅 및 스키마 검증 |

---

## 3. 파이프라인 및 아키텍처 설계

```
[ 네이버 블로그 포스트 URL ]
         │
         ▼
[ NaverBlogCrawler (Playwright) ] ── (iframe `mainFrame` 진입 & SmartEditor One 렌더링)
         │
         ▼
[ NaverBlogParser Service ] ──────── (HTML/DOM AST ➔ Unified Document Model 변환)
         │
         ├───► [ ImageDownloader Service ] ── (네이버 이미지 핫링크 문제 해결: 원본 다운로드 및 저장)
         │
         ▼
[ Unified Block Schema ] ─────────── (플랫폼 독립적 JSON 스키마: Title, Header, Paragraph, Image, Quote, Table 등)
         │
         ├───► [ Database Service (Option) ] (SQLite/PostgreSQL 등 DB 저장)
         │
         ▼
[ NotionExporter Service / MCP ] ─── (Notion API Block 구조 변환 및 Page 생성)
```

---

## 4. 폴더 및 디렉토리 구조 (NestJS 스타일 구조)

```
blog_extractor/
├── src/
│   ├── config/             # ConfigService 및 Credentials Interface (로그인 쿠키/Notion Key 관리)
│   │   ├── config.interface.ts
│   │   └── config.service.ts
│   ├── modules/
│   │   ├── crawler/        # Playwright 기반 네이버 블로그 수집 모듈 (Stealth + Cookie 주입)
│   │   ├── parser/         # SmartEditor One DOM -> Unified Block 모델 파서
│   │   ├── image/          # 이미지 다운로드 및 로컬/S3 저장 서비스
│   │   ├── notion/         # Notion Client & Notion Block 변환기
│   │   └── mcp/            # Model Context Protocol (MCP) 서버 & 툴 정의
│   ├── schema/             # Unified Document/Block Interfaces 및 Zod 스키마
│   ├── utils/              # 헬퍼 함수
│   └── index.ts            # CLI 실행 및 MCP 서버 엔트리포인트
├── storage/                # 추출된 원본 이미지 및 결과 JSON 저장소
├── .env.example            # 환경변수 예시 (NOTION_API_KEY, NAVER_COOKIES 등)
├── config.json             # (선택) 동적 Credential 설정 파일
├── tsconfig.json
├── package.json
└── PLANNING.md
```

---

## 5. Credentials & Config 주입 인터페이스 설계

`ConfigService`를 통해 다음 방식들로 로그인 정보 및 Notion 키를 자유롭게 주입/업데이트할 수 있도록 지원합니다.

### 🔑 주입 가능한 Credentials 항목
* **Naver Session Cookies**: `NID_AUT`, `NID_SES` (네이버 로그인 쿠키)
* **Notion Credentials**: `NOTION_API_KEY` (Integration Token), `NOTION_PARENT_PAGE_ID` (또는 DATABASE_ID)
* **Storage Config**: 이미지 보관 경로, 외부 S3/Upload Provider 설정 (선택)

### 🎛️ 주입 방식 (Multi-source Provider)
1. **`.env` 파일 주입**: 개발 및 로컬 테스트용
2. **`config.json` 또는 JSON 파일 주입**: 런타임 수동 주입용
3. **CLI Argument / Programmatic Options**: TypeScript 코드 내에서 `extractor.setCredentials(...)` 메서드로 직접 주입
4. **MCP Tool Parameter 주입**: MCP 실행 시 AI Agent가 런타임에 Key/Cookie를 인자로 넘겨줄 수 있는 옵션 제공

---

## 6. 마일스톤 (단계별 추진 현황)

- [x] **Phase 1: 기획 및 기술 스택 확정**
  - TypeScript, Playwright, Notion SDK, MCP SDK 확정 (`PLANNING.md` 작성 및 업데이트)
- [x] **Phase 2: 프로젝트 보일러플레이트 및 아키텍처 구축**
  - Node.js + TypeScript 프로젝트 세팅 (`package.json`, `tsconfig.json`)
  - ConfigService (동적 세션 쿠키 & Notion API Key 주입 인터페이스)
  - Unified Document / Block Schema (AST) 설계
- [x] **Phase 3: 네이버 블로그 크롤러 & 파서 개발 (`modules/crawler`, `modules/parser`, `modules/image`)**
  - Playwright 기반 Stealth 크롤러 & NID 로그인 세션 주입 지원
  - SmartEditor ONE 파서 (본문, 헤딩, 이미지, 인용구, 표, 구분선, OG 링크)
  - 네이버 Referer 이슈 해결 원본 이미지 다운로더
- [x] **Phase 4: Notion Exporter & MCP Server 연동 (`modules/notion`, `modules/mcp`)**
  - Unified Block ➔ Notion Page / Block API Exporter 구현
  - MCP Server 및 3종 Tools (`extract_naver_blog`, `export_naver_blog_to_notion`, `set_credentials`) 구현
- [ ] **Phase 5: 실제 네이버 블로그 URL 샘플 테스트 및 한의원 홈페이지 연동 준비**
  - 추출 검증 및 DB 연동 준비


---

## 6. 핵심 이슈 및 봇 인식/이미지 처리 해결 전략

### 1) 봇 인식 & 하단 안내 문구 문제 해결 전략
네이버는 Headless 브라우저의 `navigator.webdriver` 특성을 감지하여 자동화 봇 인식 경고문구를 유입시키거나 캡차를 발생시킵니다. 이를 우회하기 위해 다음 3가지 전략을 적용합니다:

1. **Playwright Stealth 모드 적용 (`playwright-extra` + `puppeteer-extra-plugin-stealth`)**
   - `navigator.webdriver = false` 설정 및 Chrome User-Agent, Canvas 핑거프린트 위장으로 봇 감지 스크립트를 무력화합니다.
2. **네이버 로그인 세션/쿠키(`NID_AUT`, `NID_SES`) 주입**
   - 블로그 주인의 로그인 쿠키 또는 로컬 브라우저 프로필(UserDataDir)을 Playwright에 주입.
   - 로그인된 블로그 본인의 정상 요청으로 인식하여 **봇 경고 문구 방지** 및 **비공개/서로이웃 글 접근권한** 확보.
3. **네이버 Post Raw Data / API 직접 접근**
   - DOM 렌더링 봇 방지 스크립트 동작을 우회하여 순수 포스트 JSON/HTML 파싱.

---

### 2) 이미지 원본 추출 & Referer 차단 대응 전략
- **문제점**: 네이버 블로그 이미지 CDN(`postfiles.naver.net`)은 외부 호출 시 `Referer` 헤더를 검사하여 노션 등 외부 플랫폼에서 엑박(Broken Image)으로 표시됩니다.
- **해결책**:
  - 추출기 동작 시 `Referer: https://blog.naver.com/` 헤더를 포함하여 **고화질 원본 이미지 다운로드** (`storage/images/` 보관).
  - 다운로드된 이미지를 노션(Notion) Attachment / S3 / Base64로 전달하여 노션 내에서 이미지 깨짐 현상을 100% 방지.

---

> 본 문서(`PLANNING.md`)는 개발 진행 상황에 따라 지속적으로 업데이트됩니다.


