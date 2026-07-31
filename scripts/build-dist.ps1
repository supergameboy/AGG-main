#Requires -Version 7.0
<#
  build-dist.ps1 — 编译 AGG 测试分发版到 dist-release/<version>/ 目录

  版本来源: 仓库根目录 VERSION 文件（单行文本，如 "1.0.0"）
  默认产物路径: dist-release/<version>/
  显式覆盖: -OutputDir <path>（跳过版本子目录，直接使用调用者指定路径）

  产物结构:
  dist-release/<version>/
  ├── AGG-Launcher.exe       # 启动器（编译自 launcher/，版本通过 ldflags 注入）
  ├── VERSION                # 版本号文件（运行时只读，供启动器/前端读取）
  ├── backend/
  │   ├── dist/              # 后端编译产物（含 migrations）
  │   ├── config/            # 运行时配置（agent-profiles/agent-help/...）
  │   ├── .env               # 环境变量
  │   └── package.json       # 生产依赖清单
  ├── frontend/
  │   └── dist/              # 前端构建产物
  ├── node_modules/          # 生产依赖（backend+frontend 合并）
  └── game_data/             # 运行时数据目录（自动创建）

  用法:
    pwsh -File scripts/build-dist.ps1                  # 自动输出到 dist-release/<version>/
    pwsh -File scripts/build-dist.ps1 -OutputDir "x"   # 覆盖输出路径
#>

param(
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot | Split-Path -Parent
Set-Location $repoRoot

# ── 0. 读取版本号 ──
$versionFile = Join-Path $repoRoot "VERSION"
if (!(Test-Path $versionFile)) {
  throw "VERSION file not found at $versionFile"
}
$appVersion = (Get-Content $versionFile -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($appVersion)) {
  throw "VERSION file is empty"
}
# 校验版本号格式（语义化版本 x.y.z 或 x.y.z-pre，禁止路径非法字符）
if ($appVersion -notmatch '^\d+\.\d+\.\d+([-\w.]+)?$') {
  throw "Invalid version format in VERSION file: '$appVersion' (expected x.y.z)"
}

# 默认输出路径: dist-release/<version>/；显式 -OutputDir 时直接使用
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path "dist-release" $appVersion
}

Write-Host "`n=== AGG Build Dist (v$appVersion) ===" -ForegroundColor Cyan

# ── 1. 编译 shared + ai（backend 依赖它们的 dist 产物）──
Write-Host "`n[1/7] Building @ai-rpg/shared + @ai-rpg/ai ..." -ForegroundColor Yellow
pnpm --filter @ai-rpg/shared build
if ($LASTEXITCODE -ne 0) { throw "shared build failed" }
pnpm --filter @ai-rpg/ai build
if ($LASTEXITCODE -ne 0) { throw "ai build failed" }

# ── 2. 编译 backend ──
Write-Host "`n[2/7] Building @ai-rpg/backend ..." -ForegroundColor Yellow
pnpm --filter @ai-rpg/backend build
if ($LASTEXITCODE -ne 0) { throw "backend build failed" }

# ── 3. 构建前端 ──
Write-Host "`n[3/7] Building @ai-rpg/frontend ..." -ForegroundColor Yellow
pnpm --filter @ai-rpg/frontend build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

# ── 4. 组装分发版 ──
Write-Host "`n[4/7] Assembling dist-release ..." -ForegroundColor Yellow
$releaseDir = Join-Path $repoRoot $OutputDir

# 清理旧产物
if (Test-Path $releaseDir) {
  Remove-Item -Recurse -Force $releaseDir
}
New-Item -ItemType Directory -Path $releaseDir | Out-Null

# 4a. backend/dist
$backendDir = Join-Path $releaseDir "backend"
$backendDistSrc = Join-Path $repoRoot "packages\backend\dist"
$backendDistDst = Join-Path $backendDir "dist"
Write-Host "  Copying backend/dist ..."
Copy-Item -Recurse $backendDistSrc $backendDistDst
# 清理 migrations：只保留 .js 文件，删除 .d.ts/.d.ts.map/__tests__/runner.d.ts/runner.d.ts.map
$migDir = Join-Path $backendDistDst "migrations"
if (Test-Path $migDir) {
  Remove-Item -Recurse -Force (Join-Path $migDir "__tests__") -ErrorAction SilentlyContinue
  Get-ChildItem $migDir -Recurse -Include "*.d.ts","*.d.ts.map","*.js.map","*.test.js" | Remove-Item -Force
}

# 4b. backend/config（运行时必需的 YAML 配置）
$backendConfigSrc = Join-Path $repoRoot "packages\backend\config"
$backendConfigDst = Join-Path $backendDir "config"
Write-Host "  Copying backend/config ..."
Copy-Item -Recurse $backendConfigSrc $backendConfigDst

# 4c. backend/.env
$envSrc = Join-Path $repoRoot "packages\backend\.env"
$envDst = Join-Path $backendDir ".env"
if (Test-Path $envSrc) {
  Write-Host "  Copying backend/.env ..."
  Copy-Item $envSrc $envDst
}

# 4d. 生成根 package.json（只含普通 npm 依赖，不含 @ai-rpg/*——它们直拷贝到 node_modules）
$pkgSrc = Join-Path $repoRoot "packages\backend\package.json"
$pkgDst = Join-Path $backendDir "package.json"
$pkgJson = Get-Content $pkgSrc -Raw | ConvertFrom-Json
$prodDeps = @{}
foreach ($prop in $pkgJson.dependencies.PSObject.Properties) {
  $val = $prop.Value
  # 跳过 workspace 依赖——@ai-rpg/* 由 4f 步骤直拷贝到 node_modules，不经过 npm
  if ($val -like 'workspace:*') { continue }
  $prodDeps[$prop.Name] = $val
}
$tsxVer = $pkgJson.devDependencies.tsx -replace '\^',''
$prodDeps['tsx'] = "^$tsxVer"
$prodPkg = @{
  name       = "agg-release"
  version    = $appVersion
  private    = $true
  type       = "module"
  dependencies = $prodDeps
}
$rootPkgPath = Join-Path $releaseDir "package.json"
$prodPkg | ConvertTo-Json -Depth 10 | Set-Content -Path $rootPkgPath -Encoding UTF8

# backend 自己的精简 package.json（保留给文档引用）
$backendPkg = @{
  name       = "@ai-rpg/backend"
  version    = $appVersion
  type       = "module"
  main       = "./dist/index.js"
  scripts    = @{ start = "tsx dist/index.js" }
}
$backendPkg | ConvertTo-Json -Depth 10 | Set-Content -Path $pkgDst -Encoding UTF8

# 4e. frontend/dist
$frontendDir = Join-Path $releaseDir "frontend"
$frontendDistSrc = Join-Path $repoRoot "packages\frontend\dist"
$frontendDistDst = Join-Path $frontendDir "dist"
Write-Host "  Copying frontend/dist ..."
Copy-Item -Recurse $frontendDistSrc $frontendDistDst

# 4f. shared/src 镜像：backend 编译产物通过相对路径 ../../../shared/src/*.js 引用 shared 模块。
$sharedSrcMirror = Join-Path $releaseDir "shared\src"
New-Item -ItemType Directory -Path $sharedSrcMirror -Force | Out-Null
Copy-Item -Recurse (Join-Path $repoRoot "packages\shared\dist\*") $sharedSrcMirror

# 4f-2. shared/package.json（必需：shared/src/*.js 因相对路径导入被 backend/dist 引用，
#       必须声明 type:module，否则 Node.js 默认按 CommonJS 处理，ESM 命名导出失效）
$sharedMirrorPkg = @{
  name    = "@ai-rpg/shared-mirror"
  version = $appVersion
  type    = "module"
  private = $true
}
$sharedMirrorPkg | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $releaseDir "shared\package.json") -Encoding UTF8
Write-Host "  Generated shared/package.json (type:module)"

# 4g. VERSION 文件（运行时只读，供启动器/前端/后端读取）
Write-Host "  Copying VERSION ..."
Copy-Item $versionFile (Join-Path $releaseDir "VERSION") -Force

# ── 5. 附带 Node.js 便携版（必须先于 npm install——确保原生模块用同一 Node 版本编译）
# Hermetic build: 后续 npm install 必须使用和最终 runtime 完全一致的 Node 版本，
# 否则 better-sqlite3 等原生模块的 NODE_MODULE_VERSION 会与 runtime 不兼容。
Write-Host "`n[5/7] Bundling Node.js runtime ..." -ForegroundColor Yellow
$nodeVersion = "20.18.0"
$nodeZip = "node-v$nodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/v$nodeVersion/$nodeZip"
$cacheDir = Join-Path $repoRoot ".build-cache"
$runtimeDir = Join-Path $releaseDir "runtime"
New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

$cachedZip = Join-Path $cacheDir $nodeZip
if (!(Test-Path $cachedZip)) {
  Write-Host "  Downloading Node.js v$nodeVersion ..."
  Invoke-WebRequest -Uri $nodeUrl -OutFile $cachedZip -UseBasicParsing
  Write-Host "  Downloaded $([math]::Round((Get-Item $cachedZip).Length/1MB, 1)) MB"
} else {
  Write-Host "  Using cached Node.js v$nodeVersion"
}

# 解压到 runtime/node/
$nodeExtractDir = Join-Path $runtimeDir "_extract"
Remove-Item -Recurse -Force $nodeExtractDir -ErrorAction SilentlyContinue
Expand-Archive -Path $cachedZip -DestinationPath $nodeExtractDir -Force
$nodeDir = Join-Path $runtimeDir "node"
Remove-Item -Recurse -Force $nodeDir -ErrorAction SilentlyContinue
Move-Item (Join-Path $nodeExtractDir "node-v$nodeVersion-win-x64") $nodeDir
Remove-Item -Recurse -Force $nodeExtractDir -ErrorAction SilentlyContinue
$bundledNodeExe = Join-Path $nodeDir "node.exe"
$bundledNpmCli = Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js"
if ((Test-Path $bundledNodeExe) -and (Test-Path $bundledNpmCli)) {
  Write-Host "  Node.js runtime bundled successfully" -ForegroundColor Green
  Write-Host "  node.exe:  $bundledNodeExe"
  Write-Host "  npm-cli:   $bundledNpmCli"
} else {
  throw "Node.js extract failed: missing node.exe or npm-cli.js under $nodeDir"
}

# ── 6. 使用 BUNDLED Node.js 安装生产依赖（hermetic build）
# 关键：绝对不使用系统 PATH 中的 node/npm——其版本可能与 runtime 不同，
# 会导致原生模块（better-sqlite3 等）的 NODE_MODULE_VERSION 不兼容。
Write-Host "`n[6/7] Installing production dependencies (hermetic, using bundled Node $nodeVersion) ..." -ForegroundColor Yellow
Push-Location $releaseDir
# 构造子进程 PATH：仅前置 bundled Node 目录，避免调用到系统 node/npm
$originalPath = $env:PATH
$env:PATH = $nodeDir + [IO.Path]::PathSeparator + $originalPath
& $bundledNodeExe $bundledNpmCli install --production
$npmExit = $LASTEXITCODE
$env:PATH = $originalPath
Pop-Location
if ($npmExit -ne 0) { throw "npm install failed (exit=$npmExit, using bundled node $nodeVersion)" }
# 删除临时 package.json/package-lock（避免用户困惑）
Remove-Item $rootPkgPath -Force
Remove-Item (Join-Path $releaseDir "package-lock.json") -Force -ErrorAction SilentlyContinue

# 6a. 直拷贝 @ai-rpg/shared 和 @ai-rpg/ai 到 node_modules（npm install 之后，避免被清理）
# 不使用 file: 协议/ junction，纯普通目录，可随 dist-release 整体移动
Write-Host "`n[6a] Placing @ai-rpg/* into node_modules ..." -ForegroundColor Yellow
$sharedDst = Join-Path $releaseDir "node_modules\@ai-rpg\shared"
New-Item -ItemType Directory -Path $sharedDst -Force | Out-Null
Copy-Item -Recurse (Join-Path $repoRoot "packages\shared\dist") $sharedDst
$sharedPkgObj = Get-Content (Join-Path $repoRoot "packages\shared\package.json") -Raw | ConvertFrom-Json
$sharedPkgObj.scripts = @{}
$sharedPkgObj.devDependencies = @{}
$sharedPkgObj.peerDependencies = @{}
$sharedPkgObj | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $sharedDst "package.json") -Encoding UTF8

$aiDst = Join-Path $releaseDir "node_modules\@ai-rpg\ai"
New-Item -ItemType Directory -Path $aiDst -Force | Out-Null
Copy-Item -Recurse (Join-Path $repoRoot "packages\ai\dist") $aiDst
$aiPkgObj = Get-Content (Join-Path $repoRoot "packages\ai\package.json") -Raw | ConvertFrom-Json
$aiPkgObj.dependencies.'@ai-rpg/shared' = "*"
$aiPkgObj.scripts = @{}
$aiPkgObj.devDependencies = @{}
$aiPkgObj | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $aiDst "package.json") -Encoding UTF8

# 7. 编译并复制 Launcher exe（版本号通过 ldflags 注入 main.Version）
Write-Host "`n[7/7] Building launcher ..." -ForegroundColor Yellow
$launcherDir = Join-Path $repoRoot "launcher"
Push-Location $launcherDir
go build -ldflags "-s -w -X main.Version=$appVersion" -o AGG-Launcher.exe .
if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Host "  [WARN] Go build failed (go not installed?), skip" -ForegroundColor DarkYellow }
else {
  Pop-Location
  Copy-Item (Join-Path $launcherDir "AGG-Launcher.exe") (Join-Path $releaseDir "AGG-Launcher.exe") -Force
  Write-Host "  Launcher compiled successfully (v$appVersion)" -ForegroundColor Green
}

Write-Host "`n=== Build complete (v$appVersion) ===" -ForegroundColor Green
Write-Host "Output: $releaseDir" -ForegroundColor Green
Write-Host "`nTo run: Start AGG-Launcher.exe in $releaseDir" -ForegroundColor Cyan
