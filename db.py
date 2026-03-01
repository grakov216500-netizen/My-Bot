# db.py — единый слой доступа к БД: SQLite или PostgreSQL
# Переменные окружения для PostgreSQL: DATABASE_URL или POSTGRES_HOST + POSTGRES_DB + POSTGRES_USER + POSTGRES_PASSWORD

import os
import re

USE_POSTGRES = bool(os.getenv("DATABASE_URL") or os.getenv("POSTGRES_HOST"))

if USE_POSTGRES:
    try:
        import psycopg2
        from psycopg2.extras import RealDictCursor
        DBIntegrityError = psycopg2.IntegrityError
    except ImportError:
        raise RuntimeError("Для PostgreSQL установите: pip install psycopg2-binary")

    def _get_pg_conn():
        url = os.getenv("DATABASE_URL")
        if url:
            return psycopg2.connect(url, cursor_factory=RealDictCursor)
        host = os.getenv("POSTGRES_HOST", "localhost")
        port = os.getenv("POSTGRES_PORT", "5432")
        dbname = os.getenv("POSTGRES_DB", "vitech")
        user = os.getenv("POSTGRES_USER", "postgres")
        password = os.getenv("POSTGRES_PASSWORD", "")
        return psycopg2.connect(
            host=host, port=port, dbname=dbname, user=user, password=password,
            cursor_factory=RealDictCursor
        )

    class PgCursorWrapper:
        def __init__(self, conn, cursor, lastrowid=None, first_row=None, rest_rows=None):
            self._conn = conn
            self._cursor = cursor
            self._lastrowid = lastrowid
            self._first_row = first_row
            self._rest = rest_rows or []

        @property
        def lastrowid(self):
            return self._lastrowid

        def fetchone(self):
            if self._first_row is not None:
                r, self._first_row = self._first_row, None
                return r
            return self._cursor.fetchone() if self._cursor else None

        def fetchall(self):
            if self._first_row is not None:
                out = [self._first_row] + self._rest + (self._cursor.fetchall() if self._cursor else [])
                self._first_row = None
                self._rest = []
                return out
            if self._rest:
                out = self._rest
                self._rest = []
                return out
            return self._cursor.fetchall() if self._cursor else []

    def get_db():
        conn = _get_pg_conn()
        conn._is_pg = True
        return conn

    def _pg_execute(conn, sql, params=None):
        params = params or ()
        # Эмуляция PRAGMA table_info для совместимости с server.py
        m = re.match(r"PRAGMA\s+table_info\s*\(\s*(\w+)\s*\)", sql.strip(), re.I)
        if m:
            table = m.group(1)
            cur = conn.cursor()
            cur.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = %s ORDER BY ordinal_position",
                (table.lower(),)
            )
            rows = [{"name": r["column_name"]} for r in cur.fetchall()]
            return PgCursorWrapper(conn, cur, first_row=None, rest_rows=rows)
        raw = sql.replace("?", "%s")
        cur = conn.cursor()
        is_insert = re.match(r"\s*INSERT\s+INTO", sql, re.I) is not None
        if is_insert and "RETURNING" not in sql.upper():
            cur.execute(raw + " RETURNING id", params)
            row = cur.fetchone()
            lid = row["id"] if row else None
            return PgCursorWrapper(conn, cur, lastrowid=lid, first_row=None, rest_rows=[])
        cur.execute(raw, params)
        first = cur.fetchone()
        rest = cur.fetchall() if cur.description else []
        return PgCursorWrapper(conn, cur, first_row=first, rest_rows=rest)

else:
    import sqlite3
    DBIntegrityError = sqlite3.IntegrityError

    DB_PATH = os.path.join(os.path.dirname(__file__), "bot.db")

    def get_db():
        if not os.path.exists(DB_PATH):
            return None
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn._is_pg = False
        return conn

    def _pg_execute(conn, sql, params=None):
        return conn.execute(sql, params or ())


def execute(conn, sql, params=None):
    """Выполнить запрос; возвращает курсор с fetchone/fetchall/lastrowid (для INSERT)."""
    if getattr(conn, "_is_pg", False):
        return _pg_execute(conn, sql, params)
    return conn.execute(sql, params or ())


def table_columns(conn, table):
    """Список имён колонок таблицы (для совместимости с PRAGMA table_info)."""
    if getattr(conn, "_is_pg", False):
        cur = conn.cursor()
        cur.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = %s ORDER BY ordinal_position
        """, (table,))
        return [r["column_name"] for r in cur.fetchall()]
    cur = conn.execute("PRAGMA table_info(" + table + ")")
    return [row["name"] for row in cur.fetchall()]
