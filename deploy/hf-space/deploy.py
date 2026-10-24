"""Stage the backend and push it to a Hugging Face Docker Space; LLM keys go in as private Space secrets.

    backend/.venv/Scripts/python deploy/hf-space/deploy.py <user>/<space-name>
"""
import shutil
import sys
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SECRETS = ("LLM_BASE_URL", "LLM_API_KEY", "JUDGE_MODEL", "GEN_BASE_URL", "GEN_API_KEY", "GEN_MODEL")


def read_env() -> dict[str, str]:
    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def main() -> None:
    repo = sys.argv[1]
    api = HfApi()
    api.create_repo(repo, repo_type="space", space_sdk="docker", exist_ok=True)

    env = read_env()
    for k in SECRETS:
        if env.get(k):
            api.add_space_secret(repo, k, env[k])
    print("secrets set:", [k for k in SECRETS if env.get(k)])  # names only, never values

    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp)
        shutil.copytree(ROOT / "backend" / "app", stage / "app", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copytree(ROOT / "demo", stage / "demo")
        shutil.copy(ROOT / "backend" / "requirements.txt", stage / "requirements.txt")
        for f in ("Dockerfile", "constraints.txt", "preload.py", "README.md"):
            shutil.copy(HERE / f, stage / f)
        api.upload_folder(repo_id=repo, repo_type="space", folder_path=str(stage),
                          commit_message="Deploy ARENA backend")
    print(f"pushed: https://huggingface.co/spaces/{repo}")


if __name__ == "__main__":
    main()
