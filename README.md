# 📝 Naver Blog to Notion Extractor Studio

> **네이버 블로그 포스트를 고품질 Notion(노션) 문서 및 데이터베이스(DB)로 자동 수집·변환·이전하는 스튜디오 시스템**

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?style=flat-square&logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=flat-square&logo=typescript)
![Playwright](https://img.shields.io/badge/Playwright-Stealth-orange?style=flat-square&logo=playwright)
![Notion API](https://img.shields.io/badge/Notion%20API-v2.2-black?style=flat-square&logo=notion)

---

## 🌟 주요 특징 (Key Features)

- **🌐 웹 입력 인터페이스 (Port: 13109)**  
  `.env` 또는 설정 파일을 직접 수정할 필요 없이, 실행 후 브라우저(`http://localhost:13109`)에서 Notion API Key, 세션 쿠키, 대상 URL을 손쉽게 입력 및 관리할 수 있습니다.
- **📊 노션 데이터베이스 칼럼(속성) 자동 매핑**  
  수집된 게시물의 메타데이터를 노션 DB의 속성으로 자동 할당하며, DB에 칼럼이 없으면 자동으로 생성합니다:
  - `게시일` (Date)
  - `카테고리` (Select)
  - `원문링크` (URL)
  - `작성자` (Text)
  - `발행` (Checkbox - 기본값 `true`)
  - `태그` (Multi-select)
- **📑 SmartEditor ONE 스마트 파싱**  
  본문 텍스트, 헤딩(H1/H2/H3), 인용구, 표(Table), 콜아웃, 구분선, 외부 링크(OG Card) 등 네이버 블로그 구조를 높의 유사도로 보존하여 노션 블록으로 변환합니다.
- **🖼️ 이미지 원본 보존 & Referer 문제 해결**  
  네이버 블로그 이미지 CDN(`postfiles.naver.net`)의 외부 호출 차단(Referer 이슈)을 우회하여 노션 내에서 이미지 엑박(Broken Image) 없이 고화질로 표시됩니다.
- **⚡ 실시간 터미널 모니터링 (SSE)**  
  Server-Sent Events 기술을 통해 웹 화면 하단 터미널 콘솔에서 크롤링, 파싱, 노션 생성 과정이 실시간 스트리밍으로 출력됩니다.
- **🤖 MCP (Model Context Protocol) 지원**  
  AI 에이전트(Claude, Antigravity 등)와 직접 연동하여 툴 기반으로 블로그 추출을 제어할 수 있는 MCP Server를 내장하고 있습니다.

---

## 🛠️ 설치 방법 (Installation)

### 1. 리포지토리 클론
```bash
git clone https://github.com/MinjungKim5/naver-blog-to-notion-extractor.git
cd naver-blog-to-notion-extractor
```

### 2. 패키지 설치
```bash
npm install
```

### 3. Playwright 브라우저 설치
```bash
npx playwright install chromium
```

---

## 🚀 실행 방법 (Usage)

### 1. Web UI 모드 (권장 - 포트 13109)
프로그램을 실행하면 백그라운드 웹 서버가 구동되고, 자동으로 브라우저(`http://localhost:13109`)가 열립니다.

```bash
npm run dev
# 또는
npm run web
```

- 브라우저 화면에서 **Notion API Key**와 **Notion Parent Page / Database ID**를 입력하고 저장합니다.
- **단건 추출** 또는 **최근 글 배치 수집** 탭에서 URL/블로그 ID를 입력한 후 실행 버튼을 누르면 작업이 완료됩니다.

---

### 2. CLI 모드 (Command Line Interface)

#### 📌 단건 포스트 추출 및 노션 내보내기
```bash
npm run dev <NAVER_BLOG_SINGLE_POST_URL> --notion
```
*예시:*
```bash
npm run dev https://blog.naver.com/sample_id/223123456789 --notion
```

#### 📚 최근 포스트 배치 수집 (Notion DB 이전)
```bash
npm run dev batch <BLOG_ID_OR_URL> <NOTION_DB_ID> [--count 5] [--page 1]
```
*예시:*
```bash
npm run dev batch https://blog.naver.com/sample_id 3a51bce929b680ce9a37f8ac039e0123 --count 10
```

---

### 3. MCP (Model Context Protocol) 서버 모드
AI 에이전트 프레임워크와 연동하여 Stdio 인터페이스로 동작시킬 수 있습니다.

```bash
npm run dev -- --mcp
```

---

## ⚙️ 설정 파일 안내 (Configuration)

웹 UI 화면에서 설정을 저장하면 프로젝트 루트에 `config.json`이 자동 생성되어 재실행 시에도 설정이 유지됩니다.

```json
{
  "notionApiKey": "secret_************************************",
  "notionParentPageId": "32자리_노션_페이지_또는_DB_ID",
  "naverNidAut": "선택사항_네이버_쿠키_NID_AUT",
  "naverNidSes": "선택사항_네이버_쿠키_NID_SES"
}
```

*보안 안내: `.env` 및 `config.json` 파일은 `.gitignore`에 등록되어 있어 Git 리포지토리에 올라가지 않습니다.*

---

## 📄 라이선스 (License)

[MIT License](LICENSE)
