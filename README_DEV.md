# 🛠 Trans Prompt 개발 가이드

개발 중 실행·빌드·패키징 방법을 정리한 문서. 확장 기능 자체의 사용법은 [README.md](./README.md) 참고.

## 📦 사전 준비

- Node.js 20 이상 (esbuild target이 `node20`, VS Code 1.109의 Electron Node 버전 기준)
- VS Code 1.109.0 이상 (`engines.vscode`)
- 의존성 설치

```bash
npm install
```

## 🚀 개발 중 실행 (F5)

1. VS Code에서 이 프로젝트를 열고 `F5` → 실행 구성 `debug` 선택
2. `preLaunchTask`로 `watch` 태스크(= `npm run watch`)가 먼저 뜨고, esbuild가 `[esbuild] build finished` 를 출력하면 디버깅이 시작된다
3. Extension Development Host 창이 `samples/` 폴더를 워크스페이스로 열고 실행된다 → 테스트용 `.md` 파일은 여기에 넣는다
4. 브레이크포인트는 `src/**/*.ts`에 그대로 찍으면 된다 (dev 빌드는 sourcemap 포함)

변경 후 반영 방법이 코드 위치에 따라 다르다:

| 변경한 파일 | 반영 방법 |
| --- | --- |
| `src/` (확장 호스트) | 개발 호스트 창에서 `Developer: Reload Window` (`Ctrl+R`) |
| `src/webview/`, `src/shared/` | 패널을 닫고 다시 열기 (webview 리로드) |
| `media/*.css` | 번들 대상이 아니므로 빌드 없이 패널만 다시 열면 적용 |
| `package.json` (commands·menus·configuration) | 개발 호스트 창을 완전히 종료하고 `F5` 재실행 |

`F5` 없이 터미널만 쓸 경우:

```bash
npm run watch    # 파일 감시 + 증분 빌드
```

> ⚠️ watch가 도는 중에 `npm run build`를 따로 돌리지 말 것. `esbuild.mjs`는 기동 시 `dist`를 통째로 지우므로 watch 산출물이 사라진다.

## 🧱 빌드

```bash
npm run build        # 개발 빌드 (sourcemap, minify 없음)
npm run build:prod   # 배포 빌드 (minify, sourcemap 없음)
```

빌드는 전부 [esbuild.mjs](./esbuild.mjs)가 담당한다. `tsc`는 산출물을 만들지 않는다(`noEmit`).

| 번들 | 엔트리 | 산출물 | 포맷 |
| --- | --- | --- | --- |
| 확장 호스트 | [src/extension.ts](src/extension.ts) | `dist/extension.js` | cjs (node20, `vscode`만 external) |
| Webview | [src/webview/main.ts](src/webview/main.ts) | `dist/webview/panel.js` | iife (browser, es2022) |
| 유닛 테스트 | [src/tests/markdown.test.ts](src/tests/markdown.test.ts) | `dist/tests/markdown.test.cjs` | cjs (`--tests` 플래그일 때만) |

`media/`의 CSS 3종(`panel.css`, `markdown.css`, `highlight.css`)은 번들에 포함되지 않고 확장 루트에서 webview URI로 직접 로드된다.

## 🔍 타입체크

```bash
npm run typecheck
```

tsconfig가 두 개로 갈라져 있고, 두 프로젝트를 모두 검사해야 한다.

- [tsconfig.json](./tsconfig.json) — 확장 호스트. `types: ["node"]`, `src/webview` 제외
- [tsconfig.webview.json](./tsconfig.webview.json) — webview. `lib`에 `DOM` 포함, `types: []` (webview에서 `@types/vscode`를 보면 안 된다)

`Tasks: Run Task` → `typecheck`로도 실행 가능(`$tsc` problemMatcher 연결됨). `Ctrl+Shift+B`는 기본 빌드 태스크인 `watch`가 잡고 있다.

## 🧪 테스트

```bash
npm run test
```

테스트 번들을 만든 뒤 `node --test`로 바로 돌린다. `src/markdown/` 계층은 `vscode` 모듈을 import하지 않으므로 Electron 호스트 없이 순수 Node에서 실행된다. VS Code API에 의존하는 코드를 테스트해야 한다면 `@vscode/test-electron` 기반 통합 테스트를 별도로 추가해야 한다.

## 📮 패키징 & 배포

```bash
npm run package   # .vsix 생성 (npx @vscode/vsce package)
npm run publish   # 마켓플레이스 배포 (npx @vscode/vsce publish)
```

두 명령 모두 `vscode:prepublish`를 거치므로 `typecheck` → `build:prod`가 자동으로 먼저 돌아간다.

배포 전 체크리스트:

1. `package.json`의 `version` 갱신
2. [CHANGELOG.md](./CHANGELOG.md)에 변경 내역 추가
3. `npm run test` 통과 확인
4. `npm run package`로 `.vsix`를 만들어 `Extensions: Install from VSIX...`로 설치 검증

패키지에 들어갈 파일은 [.vscodeignore](./.vscodeignore)가 결정한다. `src/`, `samples/`, tsconfig, sourcemap, 테스트 산출물은 제외되고 `dist/`(테스트 제외)·`media/`·`icon.png`·문서만 포함된다.

## 🧰 디버깅 팁

- 확장 호스트 로그: 개발 호스트 창의 디버그 콘솔, 또는 `Output` 패널 → `Extension Host`
- Webview 디버깅: 개발 호스트 창에서 `Developer: Open Webview Developer Tools` → 패널의 DOM/콘솔 확인
- esbuild 에러는 `파일:줄:열: error: 메시지` 한 줄 형식으로 출력되도록 플러그인이 눌러 놓았고, [.vscode/tasks.json](.vscode/tasks.json)의 problemMatcher가 이를 Problems 패널로 잡는다
- 확장 호스트와 webview 사이 메시지 규약은 [src/shared/protocol.ts](src/shared/protocol.ts) 한 곳에 정의되어 있다

## 🗂 소스 구조

```
src/
├── extension.ts        # 컴포지션 루트 — 역할 객체 생성 및 subscriptions 등록
├── app/                # 컨트롤러, 커맨드 등록, 설정 서비스, 문서 세션, 패널 호스트
├── panel/              # 리더 패널(webview) 생성 및 복원 시리얼라이저
├── webview/            # webview 측 스크립트 (브라우저 환경)
├── shared/             # 호스트 ↔ webview 공용 메시지 타입
├── markdown/           # 파싱, 렌더, 코드 하이라이트, 번역 보호 처리
├── translate/          # Google Cloud Translation 클라이언트
├── cache/              # 번역 캐시 (globalState 기반)
├── _utils/             # 공용 유틸
└── tests/              # 유닛 테스트
```
