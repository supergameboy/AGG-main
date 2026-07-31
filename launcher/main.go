package main

// AGG-Launcher — 分发版启动器
// 优先使用内置 Node.js 便携版，无需用户单独安装

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Version 由 build-dist.ps1 通过 go build -ldflags "-X main.Version=<ver>" 注入。
// 默认 "dev" 用于本地 `go run` / `go build` 场景。
// 运行时优先读取 exe 同级 VERSION 文件（分发版中由 build-dist.ps1 拷贝），
// 保证 VERSION 文件为单一数据源——即使 ldflags 缺失也能反映正确版本。
var Version = "dev"

// resolveVersion 解析最终展示用的版本号。
// 优先级: exe 同级 VERSION 文件 > ldflags 注入值 > "dev"
func resolveVersion(rootDir string) string {
	versionFile := filepath.Join(rootDir, "VERSION")
	data, err := os.ReadFile(versionFile)
	if err == nil {
		v := strings.TrimSpace(string(data))
		if v != "" {
			return v
		}
	}
	return Version
}

func main() {
	exePath, err := os.Executable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "FATAL 无法获取 exe 路径: %v\n", err)
		pauseAndExit(1)
	}
	rootDir := filepath.Dir(exePath)
	backendDir := filepath.Join(rootDir, "backend")
	gameDataDir := filepath.Join(rootDir, "game_data")
	appVersion := resolveVersion(rootDir)

	fmt.Println("========================================")
	fmt.Printf("  AGG-Launcher  v%s\n", appVersion)
	fmt.Println("========================================")
	fmt.Println()

	// 1. 定位 Node.js：优先内置 runtime，其次系统 PATH
	nodeExe, nodeDir, npmCli := findNode(rootDir)
	if nodeExe == "" {
		fmt.Fprintln(os.Stderr, "ERROR 未找到 Node.js。请将 Node.js (https://nodejs.org) 安装并加入系统 PATH，")
		fmt.Fprintln(os.Stderr, "      或将便携版放入 <启动器目录>/runtime/node/ (含 node.exe)。")
		pauseAndExit(1)
	}
	fmt.Printf("[OK]   Node.js: %s\n", nodeExe)

	// 将 Node 目录前置到 PATH，确保 npx/npm 等子进程脚本内部能解析到 node。
	// 关键：npx.cmd / npm.cmd 内部以 `node` 调起 cli.js，若 Node 目录不在 PATH，
	// 即便指定了绝对路径执行 npx.cmd 也会报"node 不是内部或外部命令"。
	childEnv := buildChildEnv(nodeDir)

	// 2. 校验依赖（使用内置 npm）
	nodeModules := filepath.Join(rootDir, "node_modules")
	if !dirExists(nodeModules) {
		if npmCli == "" || !fileExists(npmCli) {
			fmt.Fprintln(os.Stderr, "ERROR 未找到 npm-cli.js。请确认 Node.js 安装完整（应含 node_modules/npm/bin/npm-cli.js），")
			fmt.Fprintln(os.Stderr, "      或使用内置 runtime/runtime/node/ 完整便携版。")
			pauseAndExit(1)
		}
		fmt.Println("[WAIT] 首次启动，正在安装依赖（可能需要几分钟）...")
		cmd := exec.Command(nodeExe, npmCli, "install", "--production", "--prefix", backendDir)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		cmd.Dir = backendDir
		cmd.Env = childEnv
		if err := cmd.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR npm install 失败: %v\n", err)
			pauseAndExit(1)
		}
		fmt.Println("[OK]   依赖安装完成")
	} else {
		fmt.Println("[OK]   依赖已就绪")
	}

	// 3. 校验入口文件
	entryFile := filepath.Join(backendDir, "dist", "index.js")
	if !fileExists(entryFile) {
		fmt.Fprintf(os.Stderr, "ERROR 后端入口文件不存在: %s\n", entryFile)
		fmt.Fprintln(os.Stderr, "      请重新运行 build-dist.ps1 编译")
		pauseAndExit(1)
	}

	// 4. 确保 game_data 目录
	if !dirExists(gameDataDir) {
		os.MkdirAll(gameDataDir, 0755)
	}

	// 5. 启动后端
	fmt.Println("[START] 启动后端服务...")
	fmt.Println()

	env := append(childEnv,
		"GAME_DATA_DIR="+gameDataDir,
		"FRONTEND_DIST_PATH="+filepath.Join(rootDir, "frontend", "dist"),
		"NODE_ENV=production",
		"PORT=17334",
	)

	// 直接以 node 调起 tsx CLI，跳过 npx.cmd。
	// npx.cmd 是批处理 shim，内部以 `node` 调起 npx-cli.js，若 Node 目录未加入 PATH
	// 会报"node 不是内部或外部命令"；同时 npx 还会触发 tsx 包查找/下载流程，慢且不稳。
	// tsx 已通过 build-dist.ps1 安装到 node_modules/tsx/dist/cli.mjs，直接调起最快最稳。
	tsxCli := filepath.Join(rootDir, "node_modules", "tsx", "dist", "cli.mjs")
	if !fileExists(tsxCli) {
		fmt.Fprintf(os.Stderr, "ERROR 未找到 tsx CLI: %s\n", tsxCli)
		fmt.Fprintln(os.Stderr, "      请确认 node_modules 已安装（删除 node_modules 后重试以触发自动安装）")
		pauseAndExit(1)
	}

	backendCmd := exec.Command(nodeExe, tsxCli, entryFile)
	backendCmd.Dir = backendDir
	backendCmd.Env = env
	backendCmd.Stdout = os.Stdout
	backendCmd.Stderr = os.Stderr

	if err := backendCmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "ERROR 后端启动失败: %v\n", err)
		pauseAndExit(1)
	}

	fmt.Printf("      后端 PID: %d, 端口: 17334\n", backendCmd.Process.Pid)
	fmt.Println()

	// 6. 等待服务就绪，打开浏览器
	go func() {
		time.Sleep(4 * time.Second)
		url := "http://localhost:17334"
		fmt.Printf("[OPEN]  浏览器打开 %s\n", url)
		openBrowser(url)
	}()

	// 7. 等待后端进程退出
	err = backendCmd.Wait()
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n[EXIT]  后端进程退出 (code: %v)\n", err)
	} else {
		fmt.Println("\n[EXIT]  后端进程正常退出")
	}
	pauseAndExit(0)
}

// findNode 返回 (node.exe 路径, node 所在目录, npm-cli.js 路径)
// 优先使用内置 runtime/，其次系统 PATH。
// 任一未找到时 nodeExe 返回空串，调用方需自行处理（终止流程并提示用户）。
func findNode(rootDir string) (string, string, string) {
	// 优先：内置便携版
	bundledNodeDir := filepath.Join(rootDir, "runtime", "node")
	bundledNode := filepath.Join(bundledNodeDir, "node.exe")
	bundledNpm := filepath.Join(bundledNodeDir, "node_modules", "npm", "bin", "npm-cli.js")
	if fileExists(bundledNode) && fileExists(bundledNpm) {
		return bundledNode, bundledNodeDir, bundledNpm
	}
	// 回退：系统 PATH
	sysNode, err := exec.LookPath("node")
	if err != nil || sysNode == "" {
		return "", "", ""
	}
	sysDir := filepath.Dir(sysNode)
	// 系统 Node 的 npm-cli.js 通常位于 node_modules/npm/bin/npm-cli.js
	sysNpm := filepath.Join(sysDir, "node_modules", "npm", "bin", "npm-cli.js")
	if !fileExists(sysNpm) {
		// 某些 Linux 包管理器安装的 Node，npm 在 /usr/lib/node_modules/npm/bin/
		sysNpmAlt := filepath.Join(filepath.Dir(sysDir), "lib", "node_modules", "npm", "bin", "npm-cli.js")
		if fileExists(sysNpmAlt) {
			sysNpm = sysNpmAlt
		}
	}
	return sysNode, sysDir, sysNpm
}

// buildChildEnv 构造子进程环境变量：将 nodeDir 前置到 PATH。
// 这样无论使用内置便携版还是系统 Node，子进程内部脚本（npx.cmd/npm.cmd 等）
// 调起 `node` 时都能正确解析到 node.exe。
func buildChildEnv(nodeDir string) []string {
	env := os.Environ()
	const pathKey = "PATH="
	for i, kv := range env {
		// 容错：跳过比 "PATH=" 还短的 env 项（避免切片越界）
		if len(kv) < len(pathKey) {
			continue
		}
		if strings.EqualFold(kv[:len(pathKey)], pathKey) {
			rest := kv[len(pathKey):]
			// 避免重复前置
			if strings.Contains(rest, nodeDir) {
				return env
			}
			env[i] = pathKey + nodeDir + string(os.PathListSeparator) + rest
			return env
		}
	}
	// PATH 不存在（极少见），新增一条
	env = append(env, pathKey+nodeDir)
	return env
}

// ── 工具 ──

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func openBrowser(url string) {
	switch runtime.GOOS {
	case "windows":
		exec.Command("cmd", "/c", "start", url).Start()
	case "darwin":
		exec.Command("open", url).Start()
	default:
		exec.Command("xdg-open", url).Start()
	}
}

func pauseAndExit(code int) {
	fmt.Println()
	fmt.Println("按回车键退出...")
	fmt.Scanln()
	os.Exit(code)
}
