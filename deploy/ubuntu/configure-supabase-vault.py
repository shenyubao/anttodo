#!/usr/bin/env python3
"""Populate the Vault values used by AntTodo reminder database hooks."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--docker-dir", type=Path, default=Path("/root/apps/supabase/docker")
    )
    parser.add_argument("--database-container", default="supabase-db")
    return parser.parse_args()


def env_values(path: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if line and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip().strip("\"'")
    return result


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> None:
    args = parse_args()
    env = env_values(args.docker_dir / ".env")
    values = {
        "anttodo_project_url": env["SUPABASE_PUBLIC_URL"].rstrip("/"),
        "anttodo_reminder_dispatch_secret": env["REMINDER_DISPATCH_SECRET"],
    }
    statements = []
    for name, value in values.items():
        statements.append(
            f"""
            select id into existing_id
              from vault.secrets where name = {sql_literal(name)} limit 1;
            if existing_id is null then
              perform vault.create_secret(
                {sql_literal(value)}, {sql_literal(name)},
                'AntTodo production configuration'
              );
            else
              perform vault.update_secret(
                existing_id, {sql_literal(value)}, {sql_literal(name)},
                'AntTodo production configuration'
              );
            end if;
            existing_id := null;
            """
        )
    sql = (
        "do $anttodo$ declare existing_id uuid; begin\n"
        + "\n".join(statements)
        + "\nend $anttodo$;"
    )
    subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            args.database_container,
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        input=sql,
        text=True,
        check=True,
        stdout=subprocess.DEVNULL,
    )
    print("Configured Vault entries: " + ", ".join(values))


if __name__ == "__main__":
    main()
