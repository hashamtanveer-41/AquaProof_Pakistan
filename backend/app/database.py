import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row


def connect():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise psycopg.OperationalError("DATABASE_URL is not configured")
    return psycopg.connect(
        database_url,
        row_factory=dict_row,
        connect_timeout=5,
    )


def migrate():
    directory = Path(__file__).resolve().parents[1] / "migrations"
    with connect() as connection:
        connection.execute("SELECT pg_advisory_xact_lock(89133701)")
        connection.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY)")
        applied = {
            row["name"] for row in connection.execute("SELECT name FROM schema_migrations")
        }
        for migration in sorted(directory.glob("*.sql")):
            if migration.name not in applied:
                connection.execute(migration.read_text(encoding="utf-8"))
                connection.execute("INSERT INTO schema_migrations VALUES (%s)", (migration.name,))


if __name__ == "__main__":
    migrate()
