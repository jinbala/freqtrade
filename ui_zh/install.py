"""Install built Chinese FreqUI assets while retaining the original UI backup."""

import argparse
import shutil
from pathlib import Path
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parent.parent
INSTALLED = ROOT / "freqtrade/rpc/api_server/ui/installed"
BACKUP = ROOT / "user_data/ui-backups/frequi-original-3.1.3.zip"
DIST = ROOT / "user_data/frequi-zh/dist"


def install(restore: bool = False) -> None:
    if restore:
        if not BACKUP.is_file():
            raise FileNotFoundError("Original FreqUI backup is missing.")
        with ZipFile(BACKUP) as archive:
            for member in archive.infolist():
                destination = (INSTALLED / member.filename).resolve()
                if not destination.is_relative_to(INSTALLED.resolve()):
                    raise ValueError("Invalid path in UI backup.")
            archive.extractall(INSTALLED)
        print("Original English FreqUI restored at http://127.0.0.1:8080/")
        return

    index = DIST / "index.html"
    if not index.is_file() or 'lang="zh-CN"' not in index.read_text(encoding="utf-8"):
        raise ValueError("Build the Chinese FreqUI before installing it.")
    version = (INSTALLED / ".uiversion").read_text(encoding="utf-8").strip()
    if version not in ("3.1.3", "3.1.3-zh-CN"):
        raise ValueError(f"Expected FreqUI 3.1.3; found {version}.")
    if not BACKUP.exists():
        if version != "3.1.3":
            raise ValueError("Refusing to save a translated UI as the original backup.")
        BACKUP.parent.mkdir(parents=True, exist_ok=True)
        shutil.make_archive(str(BACKUP.with_suffix("")), "zip", INSTALLED)
    # Keep previous hashed assets so already-open tabs can finish their requests.
    for item in DIST.iterdir():
        if item.name == "index.html":
            continue
        destination = INSTALLED / item.name
        if item.is_dir():
            shutil.copytree(item, destination, dirs_exist_ok=True)
        else:
            shutil.copy2(item, destination)
    temporary = INSTALLED / "index.zh.tmp"
    shutil.copy2(index, temporary)
    temporary.replace(INSTALLED / "index.html")
    (INSTALLED / ".uiversion").write_text("3.1.3-zh-CN", encoding="utf-8")
    print("Chinese FreqUI installed at http://127.0.0.1:8080/ (refresh the page).")
    print(f"Original UI backup: {BACKUP}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--restore", action="store_true")
    install(parser.parse_args().restore)
