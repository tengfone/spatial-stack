from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def load_environment() -> None:
    """Load local .env values without overriding process or Lambda env vars."""

    for env_file in _env_file_candidates():
        if not env_file.is_file():
            continue

        if _load_with_python_dotenv(env_file):
            continue

        _load_simple_dotenv(env_file)


def env_value(name: str, default: str = "") -> str:
    load_environment()
    return os.getenv(name, default)


def env_flag(name: str, default: bool = False) -> bool:
    value = env_value(name, "true" if default else "false").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _env_file_candidates() -> list[Path]:
    app_dir = Path(__file__).resolve().parent
    backend_dir = app_dir.parent
    repo_dir = backend_dir.parent
    candidates = [
        Path.cwd() / ".env",
        backend_dir / ".env",
        repo_dir / ".env",
    ]

    unique: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(resolved)
    return unique


def _load_with_python_dotenv(env_file: Path) -> bool:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return False

    load_dotenv(env_file, override=False)
    return True


def _load_simple_dotenv(env_file: Path) -> None:
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue

        os.environ[key] = _clean_env_value(value)


def _clean_env_value(value: str) -> str:
    cleaned = value.strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"'", '"'}:
        return cleaned[1:-1]
    return cleaned

