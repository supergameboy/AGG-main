"""
按时间顺序应用snapshot仓库中的toolcall文件快照到工作区(修复版)
关键修复: 只处理 toolcall- 提交,跳过 user- 提交
  - toolcall- 提交: 工具调用产生的真实文件变更(A/M/D都有效)
  - user- 提交: 用户对话前的快照,其删除操作不代表真实意图,会误删toolcall创建的文件
"""
import subprocess
import os
import sys

REPOS = [
    ("6a48641e", r"C:\Users\super\AppData\Roaming\Trae CN\ModularData\ai-agent\snapshot\6a48641e2a53bff79a6bac20\v2"),
    ("6a486ad1", r"C:\Users\super\AppData\Roaming\Trae CN\ModularData\ai-agent\snapshot\6a486ad12a53bff79a6baf8c\v2"),
    ("6a48afc5", r"C:\Users\super\AppData\Roaming\Trae CN\ModularData\ai-agent\snapshot\6a48afc52a53bff79a6bcb41\v2"),
    ("6a48b79b", r"C:\Users\super\AppData\Roaming\Trae CN\ModularData\ai-agent\snapshot\6a48b79b2a53bff79a6bcd5c\v2"),
]

START_TIME = "2026-07-04 09:10:00"
END_TIME = "2026-07-05 04:00:00"
PROJECT_ROOT = r"c:\Users\super\Documents\trae_projects\AGG-main"

LOG_FILE = os.path.join(PROJECT_ROOT, "rebuild-apply-log-v2.txt")


def run_git(repo_dir, args):
    result = subprocess.run(
        ["git", "-C", repo_dir] + args,
        capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    return result.stdout, result.stderr, result.returncode


def run_project_git(args):
    result = subprocess.run(
        ["git", "-C", PROJECT_ROOT] + args,
        capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    return result.stdout, result.stderr, result.returncode


def normalize_path(filepath):
    if filepath.startswith("base/content/"):
        return filepath[len("base/content/"):]
    if filepath.startswith("disk/content/"):
        return filepath[len("disk/content/"):]
    if filepath.startswith("base/"):
        return filepath[len("base/"):]
    if filepath.startswith("disk/"):
        return filepath[len("disk/"):]
    return filepath


def is_metadata(filepath):
    if filepath.startswith("version_file_"):
        return True
    if filepath == "first_graph.json" or filepath == "latest_change.json":
        return True
    return False


def is_project_file(filepath):
    if is_metadata(filepath):
        return False
    if filepath.startswith("without/"):
        return False
    if filepath.startswith("tsc-"):
        return False
    if "/" not in filepath and "\\" not in filepath:
        return False
    return True


def collect_all_toolcall_commits():
    """只收集 toolcall- 提交(跳过 user- 提交)"""
    all_commits = []

    for repo_name, repo_dir in REPOS:
        if not os.path.isdir(repo_dir):
            continue

        out, _, _ = run_git(repo_dir, [
            "log", "--all", "--no-merges",
            f"--since={START_TIME}", f"--until={END_TIME}",
            "--pretty=format:%H|%aI|%s"
        ])

        for line in out.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("|", 2)
            if len(parts) != 3:
                continue
            commit_hash, commit_time, subject = parts

            # 只处理 toolcall- 提交
            if not subject.startswith("toolcall-"):
                continue

            all_commits.append({
                "time": commit_time,
                "repo": repo_name,
                "repo_dir": repo_dir,
                "hash": commit_hash,
                "subject": subject,
            })

    all_commits.sort(key=lambda x: x["time"])
    return all_commits


def get_commit_file_changes(repo_dir, commit_hash):
    """获取提交涉及的项目文件变更"""
    parent_out, _, _ = run_git(repo_dir, ["log", "-1", "--pretty=%P", commit_hash])
    parent = parent_out.strip()
    if parent:
        diff_out, _, _ = run_git(repo_dir, ["diff", "--name-status", parent, commit_hash])
    else:
        diff_out, _, _ = run_git(repo_dir, ["show", "--no-patch", "--pretty=format:",
                                            "--name-status", commit_hash])

    changes = []
    for line in diff_out.strip().split("\n"):
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status = parts[0][0]
        raw_path = parts[1]
        norm_path = normalize_path(raw_path)

        if not is_project_file(norm_path):
            continue

        changes.append({
            "status": status,
            "project_path": norm_path,
            "raw_path": raw_path,
        })

    return changes


def apply_file_from_snapshot(repo_dir, commit_hash, raw_path, project_path):
    """从snapshot提交中提取文件内容应用到项目工作区"""
    full_project_path = os.path.join(PROJECT_ROOT, project_path.replace("/", os.sep))

    target_dir = os.path.dirname(full_project_path)
    if target_dir and not os.path.isdir(target_dir):
        os.makedirs(target_dir, exist_ok=True)

    out, err, rc = run_git(repo_dir, ["show", f"{commit_hash}:{raw_path}"])

    if rc != 0:
        if os.path.exists(full_project_path):
            try:
                os.remove(full_project_path)
                return f"  [-] 删除 {project_path}"
            except OSError as e:
                return f"  [!] 删除失败 {project_path}: {e}"
        return f"  [?] 跳过 {project_path} (不存在)"

    try:
        with open(full_project_path, "wb") as f:
            f.write(out.encode("utf-8"))
        return f"  [+] 写入 {project_path}"
    except OSError as e:
        return f"  [!] 写入失败 {project_path}: {e}"


def remove_file(project_path):
    full_path = os.path.join(PROJECT_ROOT, project_path.replace("/", os.sep))
    if os.path.exists(full_path):
        try:
            os.remove(full_path)
            return f"  [-] 删除 {project_path}"
        except OSError as e:
            return f"  [!] 删除失败 {project_path}: {e}"
    return f"  [?] 跳过 {project_path} (不存在)"


def main():
    log_lines = []

    def log(msg):
        print(msg)
        log_lines.append(msg)

    log("=" * 80)
    log("按时间顺序应用snapshot文件快照(修复版: 只处理toolcall提交)")
    log("=" * 80)
    log(f"时间窗口: {START_TIME} - {END_TIME}")
    log(f"项目目录: {PROJECT_ROOT}")
    log("")

    out, _, _ = run_project_git(["branch", "--show-current"])
    current_branch = out.strip()
    log(f"当前分支: {current_branch}")
    if current_branch != "rebuild-7-4":
        log(f"[!] 警告: 当前分支不是 rebuild-7-4,而是 {current_branch}")
        log("[!] 请先切换到 rebuild-7-4 分支")
        return

    out, _, _ = run_project_git(["rev-parse", "HEAD"])
    current_head = out.strip()
    log(f"当前 HEAD: {current_head[:7]}")
    log("")

    log("[1/4] 收集所有 toolcall 提交(跳过 user- 提交)...")
    all_commits = collect_all_toolcall_commits()
    log(f"  找到 {len(all_commits)} 个 toolcall 提交")
    log("")

    log("[2/4] 按时间顺序应用文件快照...")
    log("")

    applied_count = 0
    skipped_count = 0
    last_hour = None
    files_in_hour = 0

    for i, commit in enumerate(all_commits):
        commit_time = commit["time"]
        commit_hour = commit_time[:13]

        if last_hour is not None and commit_hour != last_hour and files_in_hour > 0:
            run_project_git(["add", "-A"])
            commit_msg = f"rebuild: 应用 {last_hour} 时段的toolcall快照 ({files_in_hour} 个文件操作)"
            run_project_git(["commit", "-m", commit_msg])
            log(f"  >> 提交: {commit_msg}")
            log("")
            files_in_hour = 0

        last_hour = commit_hour

        changes = get_commit_file_changes(commit["repo_dir"], commit["hash"])

        if not changes:
            skipped_count += 1
            continue

        log(f"[{i+1}/{len(all_commits)}] {commit_time[:19]} {commit['repo']} {commit['hash'][:7]} {commit['subject'][:50]}")

        for change in changes:
            status = change["status"]
            project_path = change["project_path"]
            raw_path = change["raw_path"]

            if status == "D":
                msg = remove_file(project_path)
            else:
                msg = apply_file_from_snapshot(
                    commit["repo_dir"], commit["hash"], raw_path, project_path
                )

            log(msg)
            applied_count += 1
            files_in_hour += 1

    if files_in_hour > 0:
        run_project_git(["add", "-A"])
        commit_msg = f"rebuild: 应用 {last_hour} 时段的toolcall快照 ({files_in_hour} 个文件操作)"
        run_project_git(["commit", "-m", commit_msg])
        log(f"  >> 最终提交: {commit_msg}")

    log("")
    log("[3/4] 应用完成")
    log(f"  总提交数: {len(all_commits)}")
    log(f"  应用文件操作: {applied_count}")
    log(f"  跳过(无文件变更): {skipped_count}")
    log("")

    log("[4/4] 验证重建结果...")
    out, _, _ = run_project_git(["log", "--oneline", "-20"])
    log("最近20个提交:")
    for line in out.strip().split("\n"):
        log(f"  {line}")
    log("")

    # 验证关键文件存在
    log("关键文件验证:")
    key_files = [
        "packages/backend/src/game-systems/npc/npcservice.ts",
        "packages/backend/src/game-systems/npc/npcservicetool.ts",
        "packages/backend/src/game-systems/npc/types.ts",
        "packages/backend/src/game-systems/skill/skillservice.ts",
        "packages/backend/src/game-systems/skill/skillservicetool.ts",
        "packages/backend/src/game-systems/time/gametimeservice.ts",
        "packages/backend/src/game-systems/time/gametimeservicetool.ts",
        "packages/backend/src/game-systems/inventory/inventoryservice.ts",
        "packages/backend/src/game-systems/inventory/inventoryservicetool.ts",
        "packages/backend/config/agent-profiles/fantasy_rpg.yaml",
        "packages/backend/src/agents/agentruntime.ts",
        "packages/backend/src/agents/reactengine.ts",
        "packages/backend/src/agents/reactloop.ts",
    ]
    for f in key_files:
        full_path = os.path.join(PROJECT_ROOT, f.replace("/", os.sep))
        exists = os.path.exists(full_path)
        size = os.path.getsize(full_path) if exists else 0
        status = "OK" if exists and size > 0 else "MISSING"
        log(f"  [{status}] {f} ({size} bytes)")

    log("")

    out, _, _ = run_project_git(["ls-files"])
    tracked_files = [l for l in out.strip().split("\n") if l.strip()]
    log(f"Git跟踪的文件数: {len(tracked_files)}")

    with open(LOG_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(log_lines))

    print(f"\n[OK] 重建完成! 日志: {LOG_FILE}")


if __name__ == "__main__":
    main()
