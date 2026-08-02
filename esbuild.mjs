import { rmSync } from "node:fs";
import { build, context } from "esbuild";

const IS_PRODUCTION = process.argv.includes("--production");
const IS_WATCH = process.argv.includes("--watch");

// esbuild는 outdir을 비우지 않는다. 정리하지 않으면 dev 빌드가 남긴 .map이 minify된 산출물 옆에
// 그대로 남아 디버거가 엉뚱한 소스를 가리킨다. watch에서는 재빌드마다가 아니라 기동 시 1회만.
rmSync("dist", { recursive: true, force: true });

/**
 * esbuild의 기본 에러 출력은 여러 줄에 걸친 박스 형태라 VSCode problemMatcher로 잡기 어렵다.
 * `파일:줄:열: error: 메시지` 한 줄로 눌러서 tasks.json의 정규식 하나로 파싱되게 한다.
 */
const singleLineDiagnosticsPlugin = {
    name: "single-line-diagnostics",
    setup(pluginBuild) {
        // watch 재빌드마다 begin/end 한 쌍이 찍혀야 VSCode background task가 진단을 갱신할 수 있다
        pluginBuild.onStart(() => {
            console.log("[esbuild] build started");
        });
        pluginBuild.onEnd((result) => {
            for (const message of result.errors) {
                // location은 해석 실패(모듈 not found 등)에서 null이 될 수 있다
                const location = message.location;
                if (location == null) {
                    console.error(`error: ${message.text}`);
                    continue;
                }
                console.error(`${location.file}:${location.line}:${location.column}: error: ${message.text}`);
            }
            console.log(`[esbuild] build finished — ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
        });
    },
};

/** 확장 호스트 번들. `vscode`만 런타임이 제공하므로 external, 나머지는 전부 인라인된다 */
const EXTENSION_OPTIONS = {
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    external: ["vscode"],
    minify: IS_PRODUCTION,
    sourcemap: IS_PRODUCTION == false,
    sourcesContent: false,
    logLevel: "silent",
    plugins: [singleLineDiagnosticsPlugin],
};

/** webview 번들. 브라우저에서 <script src>로 로드되므로 iife */
const WEBVIEW_OPTIONS = {
    entryPoints: ["src/webview/main.ts"],
    outfile: "dist/webview/panel.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: IS_PRODUCTION,
    sourcemap: IS_PRODUCTION == false,
    sourcesContent: false,
    logLevel: "silent",
    plugins: [singleLineDiagnosticsPlugin],
};

/**
 * 유닛 테스트 번들. markdown/ 계층은 vscode를 import하지 않으므로 Electron 호스트 없이
 * `node --test`로 바로 돌릴 수 있다.
 */
const TEST_OPTIONS = {
    entryPoints: ["src/tests/markdown.test.ts"],
    outfile: "dist/tests/markdown.test.cjs",
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    sourcemap: "inline",
    logLevel: "silent",
    plugins: [singleLineDiagnosticsPlugin],
};

if (process.argv.includes("--tests") === true) {
    await build(TEST_OPTIONS);
    process.exit(0);
}

const ALL_OPTIONS = [EXTENSION_OPTIONS, WEBVIEW_OPTIONS];

if (IS_WATCH == true) {
    for (const options of ALL_OPTIONS) {
        const buildContext = await context(options);
        await buildContext.watch();
    }
    console.log("[esbuild] watching for changes…");
}
else {
    await Promise.all(ALL_OPTIONS.map(options => build(options)));
}
