"""Check staged Git blobs without displaying any secret values."""

import argparse
import json
import re
import subprocess
from pathlib import Path, PurePosixPath


TOKEN_PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "github_token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    "aws_access_key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "openai_key": re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{35,}\b"),
    "telegram_token": re.compile(rb"\b[0-9]{8,12}:[A-Za-z0-9_-]{35}\b"),
}
ASSIGNMENT = re.compile(
    rb"(?i)[\"']?(?:api[_-]?key|secret|password|access[_-]?token|jwt_secret_key|ws_token)"
    rb"[\"']?\s*[:=]\s*[\"']([^\"'\r\n]{8,})[\"']"
)
PLACEHOLDER = re.compile(
    rb"(?i)^(?:your[_ -]|test[_ -]|dummy|example|placeholder|somethingrandom|changeme|"
    rb"change_me|supersecurepassword|not[_ -]?a[_ -]?real|x{8,}$|\*{8,}$)"
)


def git(root: Path, *args: str, input_data: bytes | None = None) -> bytes:
    return subprocess.check_output(["git", *args], cwd=root, input=input_data)


def sensitive_path(name: str) -> bool:
    path = PurePosixPath(name.lower())
    if path.name == ".gitkeep":
        return False
    if path.parts[0] in ("user_data", ".venv", "env", "node_modules", ".aws", ".ssh", ".secrets", "secrets", ".credentials"):
        return True
    if ".local." in path.name or ".private." in path.name:
        return True
    if path.name.startswith(".env") and path.name not in (".env.example", ".env.sample", ".env.template"):
        return True
    if path.name in ("id_rsa", "id_ed25519"):
        return True
    if not name.startswith("tests/") and (
        ".sqlite" in path.name or path.suffix in (".db", ".pem", ".key", ".p12", ".pfx", ".log", ".pid", ".har")
        or path.name.endswith((".db-wal", ".db-shm"))
    ):
        return True
    if path.name.startswith("config") and path.suffix in (".json", ".yaml", ".yml"):
        return not (name.startswith(("tests/", ".github/")) or (name.startswith("config_examples/") and ".example." in path.name))
    return False


def content_findings(data: bytes, local_values: list[tuple[str, bytes]]) -> list[str]:
    findings = [label for label, pattern in TOKEN_PATTERNS.items() if pattern.search(data)]
    findings.extend(label for label, value in local_values if len(value) >= 8 and value in data)
    for match in ASSIGNMENT.finditer(data):
        value = match.group(1)
        if not PLACEHOLDER.search(value) and not value.startswith((b"${", b"{{", b"os.", b"process.", b"[")):
            findings.append("credential_literal_review")
            break
    return sorted(set(findings))


def local_private_values(root: Path) -> list[tuple[str, bytes]]:
    values = []
    config = root / "user_data/config-btc-dryrun.json"
    if config.is_file():
        source = json.loads(config.read_text(encoding="utf-8-sig"))

        def walk(obj):
            if isinstance(obj, dict):
                for key, value in obj.items():
                    if key.lower() in {"password", "secret", "key", "api_key", "token", "jwt_secret_key", "ws_token", "chat_id"} and isinstance(value, str) and len(value) >= 8:
                        values.append(("actual_local_credential", value.encode()))
                    walk(value)
            elif isinstance(obj, list):
                for value in obj:
                    walk(value)

        walk(source)
    email = subprocess.run(["git", "config", "user.email"], cwd=root, capture_output=True).stdout.strip()
    if len(email) >= 8:
        values.append(("personal_author_email_in_file", email))
    for variant in (str(root), str(root).replace("\\", "/"), str(root).replace("\\", "\\\\")):
        values.append(("local_absolute_workspace_path", variant.encode()))
    return values


def index_blobs(root: Path, names: set[str] | None = None):
    entries = []
    for record in git(root, "ls-files", "--stage", "-z").split(b"\0"):
        if not record:
            continue
        meta, raw_name = record.split(b"\t", 1)
        _, oid, stage = meta.split()
        name = raw_name.decode("utf-8")
        if stage != b"0":
            raise RuntimeError("Resolve Git merge conflicts before privacy checks.")
        if names is None or name in names:
            entries.append((name, oid))
    if not entries:
        return
    output = git(root, "cat-file", "--batch", input_data=b"\n".join(oid for _, oid in entries) + b"\n")
    cursor = 0
    for name, _ in entries:
        header_end = output.index(b"\n", cursor)
        header = output[cursor:header_end].split()
        if header[1] != b"blob":
            raise RuntimeError(f"Unsupported staged object: {name}")
        size = int(header[2])
        data = output[header_end + 1:header_end + 1 + size]
        cursor = header_end + size + 2
        yield name, data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="Audit all currently tracked files")
    parser.add_argument("--json", action="store_true", help="Print only paths and finding categories")
    args = parser.parse_args()
    root = Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())
    names = None if args.all else {
        name.decode("utf-8") for name in git(root, "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split(b"\0") if name
    }
    known = local_private_values(root)
    findings, checked = [], 0
    for name, data in index_blobs(root, names):
        checked += 1
        kinds = content_findings(data, known)
        if sensitive_path(name):
            kinds.append("private_runtime_file")
        if kinds:
            findings.append({"path": name, "categories": sorted(set(kinds))})
    if args.json:
        print(json.dumps({"checked": checked, "findings": findings}, ensure_ascii=False, indent=2))
    elif findings:
        print("Privacy check blocked the commit. File paths and categories only:")
        for item in findings:
            print(f"  {item['path']}: {', '.join(item['categories'])}")
        print("Remove private files from the index or replace secret values with placeholders.")
    else:
        print(f"Privacy check passed: {checked} staged files; no detected private files or credentials.")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
