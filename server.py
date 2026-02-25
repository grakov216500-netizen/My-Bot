# server.py — FastAPI сервер для Mini App (финальная версия, с исправлением группы и опросником)

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from datetime import datetime
import os
import random
import sqlite3
import statistics  # для расчёта медианы
import tempfile

# Импортируем функцию расчёта курса
from utils.course_calculator import get_current_course

app = FastAPI()

# === CORS: Mini App на GitHub Pages и локальная разработка ===
# При allow_credentials=True нельзя использовать "*" — указываем явные origins
CORS_ORIGINS = [
    "https://grakov216500-netizen.github.io",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]


class ForceCORSHeadersMiddleware(BaseHTTPMiddleware):
    """Добавляет CORS-заголовки ко всем ответам (в т.ч. при 4xx/5xx), чтобы браузер не блокировал из-за CORS."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        origin = request.headers.get("origin")
        if origin and origin in CORS_ORIGINS:
            response.headers["Access-Control-Allow-Origin"] = origin
        response.headers.setdefault("Access-Control-Allow-Credentials", "true")
        response.headers.setdefault("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
        response.headers.setdefault("Access-Control-Allow-Headers", "Content-Type, Authorization")
        return response


# Сначала добавляем наш middleware (он выполнится последним при отправке ответа и допишет CORS)
app.add_middleware(ForceCORSHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# === Путь к БД ===
DB_PATH = os.path.join(os.path.dirname(__file__), "bot.db")


@app.on_event("startup")
async def startup_init_db():
    """При старте сервера создаём таблицы и объекты для опроса, если их ещё нет."""
    try:
        import database
        database.DB_NAME = DB_PATH
        database.init_db()
        database.init_survey_objects()
    except Exception as e:
        print(f"[WARN] Инициализация БД при старте: {e}")

# === Словарь ролей ===
ROLE_NAMES = {
    'к': 'Курс',
    'дк': 'Дежурный по курсу',
    'с': 'Столовая',
    'дс': 'Дежурный по столовой',
    'ад': 'Административный',
    'п': 'Патруль',
    'ж': 'Железо',
    'т': 'Тарелки',
    'кпп': 'КПП',
    'гбр': 'ГБР (Группа быстрого реагирования)',
    'зуб': 'ЗУБ',
    'ото': 'ОТО',
    'м': 'Медчасть',
    'путсо': 'ПУТСО',
}

def get_full_role(role_code: str) -> str:
    return ROLE_NAMES.get(role_code.lower(), role_code.upper())


def _fio_match_variants(full_fio: str) -> list:
    """Строит варианты ФИО для сопоставления: полное и в виде инициалов (Граков В.А.)."""
    if not full_fio or not full_fio.strip():
        return []
    parts = [p.strip() for p in full_fio.strip().split() if p.strip()]
    if not parts:
        return []
    variants = [full_fio.strip()]
    if len(parts) >= 3:
        surname, name, patronymic = parts[0], parts[1], parts[2]
        variants.append(f"{surname} {name[0]}.{patronymic[0]}.")
        variants.append(f"{surname} {name[0]}.{patronymic[0]}")
        variants.append(f"{surname} {name[0]} {patronymic[0]}")
        variants.append(f"{surname} {name[0]}. {patronymic[0]}.")
    elif len(parts) == 2:
        variants.append(f"{parts[0]} {parts[1][0]}.")
    return list(dict.fromkeys(variants))


def _get_duty_points_map(conn) -> dict:
    """Роль (код) -> очки по опросу. Основные наряды: Курс, ГБР, Столовая, ЗУБ."""
    role_to_name = {'к': 'Курс', 'гбр': 'ГБР', 'с': 'Столовая', 'зуб': 'ЗУБ'}
    try:
        rows = conn.execute("""
            SELECT o.name, COALESCE(w.weight, 10) as w
            FROM duty_objects o
            LEFT JOIN object_weights w ON o.id = w.object_id
            WHERE o.parent_id IS NULL AND o.name IN ('Курс', 'ГБР', 'Столовая', 'ЗУБ')
        """).fetchall()
        name_to_weight = {r['name']: max(7, min(20, float(r['w'] or 10))) for r in rows}
        return {code: round(name_to_weight.get(name, 10)) for code, name in role_to_name.items()}
    except Exception:
        return {code: 10 for code in role_to_name}

def get_db():
    """Соединение с БД + Row фабрика"""
    if not os.path.exists(DB_PATH):
        print(f"❌ Файл БД не найден: {DB_PATH}")
        return None
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# ============================================
# 1. ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ (ИСПРАВЛЕНО)
# ============================================
@app.get("/api/user")
async def get_user(telegram_id: int):
    conn = get_db()
    if not conn:
        return {"error": "База данных не найдена"}

    try:
        # --- Узнаём, какие колонки есть в таблице users ---
        cursor = conn.execute("PRAGMA table_info(users)")
        columns = [row['name'] for row in cursor.fetchall()]
        print(f"[INFO] Колонки в users: {columns}")

        # --- Определяем имя поля с ФИО ---
        if 'full_name' in columns:
            name_col = 'full_name'
        elif 'fio' in columns:
            name_col = 'fio'
        else:
            return {"error": "В таблице users нет поля для ФИО"}

        # --- Определяем имя поля с группой ---
        if 'group_name' in columns:
            group_col = 'group_name'
        elif 'group' in columns:
            group_col = 'group'
        else:
            group_col = None   # необязательное поле

        select_parts = [f"{name_col} as full_name", "enrollment_year"]
        if group_col:
            select_parts.append(f"{group_col} as group_name")
        else:
            select_parts.append("'' as group_name")
        try:
            cursor = conn.execute("PRAGMA table_info(users)")
            cols = [r['name'] for r in cursor.fetchall()]
            if 'role' in cols:
                select_parts.append("role")
        except Exception:
            pass

        query = f"SELECT {', '.join(select_parts)} FROM users WHERE telegram_id = ?"
        row = conn.execute(query, (telegram_id,)).fetchone()

        if not row:
            return {"error": "Пользователь не найден"}

        user_data = dict(row)
        print(f"[DEBUG] Данные из БД для {telegram_id}: {user_data}")

    except Exception as e:
        print(f"[ERROR] Ошибка запроса пользователя: {e}")
        return {"error": f"Ошибка БД: {str(e)}"}
    finally:
        conn.close()

    try:
        enrollment = int(user_data['enrollment_year'])
        course = get_current_course(enrollment)
    except Exception as e:
        print(f"[ERROR] Ошибка расчёта курса: {e}")
        course = 1

    course_label = "Выпускник" if course >= 5 else str(course)
    out = {
        "full_name": user_data['full_name'],
        "course": str(course),
        "course_label": course_label,
        "enrollment_year": int(user_data.get('enrollment_year', 0)) if user_data.get('enrollment_year') else None,
        "group": user_data.get('group_name', ''),
        "role": user_data.get('role', 'user')
    }
    return out


@app.patch("/api/user")
async def update_user(data: dict):
    """Обновление своего профиля: ФИО, группа, год набора (курс). telegram_id — кто редактирует."""
    telegram_id = data.get("telegram_id")
    fio = data.get("fio")
    group_name = data.get("group_name")
    enrollment_year = data.get("enrollment_year")
    if not telegram_id:
        raise HTTPException(status_code=400, detail="telegram_id обязателен")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        cursor = conn.execute("PRAGMA table_info(users)")
        cols = [r["name"] for r in cursor.fetchall()]
        updates = []
        params = []
        if fio is not None and str(fio).strip():
            name_col = "fio" if "fio" in cols else "full_name"
            updates.append(f"{name_col} = ?")
            params.append(str(fio).strip())
        if group_name is not None:
            updates.append("group_name = ?")
            params.append(str(group_name).strip() if group_name else "")
        if enrollment_year is not None:
            try:
                y = int(enrollment_year)
                if 2020 <= y <= 2030:
                    updates.append("enrollment_year = ?")
                    params.append(y)
            except (TypeError, ValueError):
                pass
        if not updates:
            conn.close()
            return {"status": "ok"}
        params.append(telegram_id)
        conn.execute(
            f"UPDATE users SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?",
            params
        )
        conn.commit()
        return {"status": "ok"}
    except Exception as e:
        print(f"[ERROR] update_user: {e}")
        raise HTTPException(status_code=500, detail="Ошибка обновления профиля")
    finally:
        conn.close()


@app.get("/api/profile/duty-stats")
async def get_profile_duty_stats(telegram_id: int):
    """Статистика курсанта: сколько раз болел (замены по болезни + самоотчёты), сколько раз заменял других."""
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute("SELECT fio FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
        if not user:
            conn.close()
            return {"times_sick": 0, "times_replaced": 0}
        fio = (user["fio"] or "").strip()
        times_sick_replace = conn.execute(
            "SELECT COUNT(*) FROM duty_replacements WHERE fio_removed = ? AND reason = 'заболел'",
            (fio,)
        ).fetchone()[0]
        times_sick_self = conn.execute(
            "SELECT COUNT(*) FROM sick_leave_reports WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()[0]
        times_replaced = conn.execute(
            "SELECT COUNT(*) FROM duty_replacements WHERE fio_replacement = ?",
            (fio,)
        ).fetchone()[0]
        conn.close()
        return {"times_sick": times_sick_replace + times_sick_self, "times_replaced": times_replaced}
    except Exception as e:
        print(f"[ERROR] duty-stats: {e}")
        raise HTTPException(status_code=500, detail="Ошибка загрузки статистики")


@app.post("/api/sick-leave/report")
async def report_sick_leave(data: dict):
    """Курсант указывает свой больничный (дата)."""
    telegram_id = data.get("telegram_id")
    report_date = data.get("report_date")
    if not telegram_id or not report_date:
        raise HTTPException(status_code=400, detail="Нужны telegram_id и report_date (YYYY-MM-DD)")
    if len(report_date) != 10 or report_date[4] != "-" or report_date[7] != "-":
        raise HTTPException(status_code=400, detail="Формат даты: YYYY-MM-DD")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        conn.execute(
            "INSERT INTO sick_leave_reports (telegram_id, report_date) VALUES (?, ?)",
            (telegram_id, report_date)
        )
        conn.commit()
        conn.close()
        return {"status": "ok", "message": "Больничный учтён"}
    except Exception as e:
        print(f"[ERROR] sick-leave report: {e}")
        raise HTTPException(status_code=500, detail="Ошибка сохранения")


def _user_role_from_db(telegram_id: int):
    """Роль из БД (admin, assistant, sergeant, user)."""
    conn = get_db()
    if not conn:
        return None
    row = conn.execute("SELECT role FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
    conn.close()
    return row["role"] if row else None


@app.get("/api/users")
async def list_users(
    actor_telegram_id: int,
    enrollment_year: int = None,
    group_name: str = None,
    search: str = None
):
    """Список пользователей для админа (все) или помощника (свой курс). Сортировка: курс (год набора), группа, ФИО."""
    role = _user_role_from_db(actor_telegram_id)
    if role not in ("admin", "assistant"):
        raise HTTPException(status_code=403, detail="Доступ только для админа или помощника")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        name_col = "fio" if "fio" in [r["name"] for r in conn.execute("PRAGMA table_info(users)").fetchall()] else "full_name"
        if role == "assistant":
            row = conn.execute(
                "SELECT enrollment_year, group_name FROM users WHERE telegram_id = ?",
                (actor_telegram_id,)
            ).fetchone()
            if not row:
                conn.close()
                return {"users": []}
            ayear, agroup = row["enrollment_year"], row["group_name"]
            query = f"""
                SELECT telegram_id, {name_col} as fio, group_name, enrollment_year, role
                FROM users WHERE enrollment_year = ? AND status = 'активен'
            """
            params = [ayear]
            if search and search.strip():
                query += f" AND ({name_col} LIKE ?)"
                params.append(f"%{search.strip()}%")
            query += " ORDER BY group_name, fio"
            rows = conn.execute(query, params).fetchall()
        else:
            query = f"""
                SELECT telegram_id, {name_col} as fio, group_name, enrollment_year, role
                FROM users WHERE status = 'активен'
            """
            params = []
            if enrollment_year is not None:
                query += " AND enrollment_year = ?"
                params.append(enrollment_year)
            if group_name and group_name.strip():
                query += " AND group_name = ?"
                params.append(group_name.strip())
            if search and search.strip():
                query += f" AND ({name_col} LIKE ?)"
                params.append(f"%{search.strip()}%")
            query += " ORDER BY enrollment_year DESC, group_name, fio"
            rows = conn.execute(query, params).fetchall()
        users = [
            {
                "telegram_id": r["telegram_id"],
                "fio": r["fio"],
                "group_name": r["group_name"],
                "enrollment_year": r["enrollment_year"],
                "role": r["role"] or "user"
            }
            for r in rows
        ]
        conn.close()
        return {"users": users}
    except Exception as e:
        print(f"[ERROR] list_users: {e}")
        raise HTTPException(status_code=500, detail="Ошибка списка пользователей")


@app.post("/api/users/set-role")
async def set_user_role(data: dict):
    """Назначить/снять роль: admin — помощник или сержант; assistant — только сержант."""
    actor_id = data.get("actor_telegram_id")
    target_id = data.get("target_telegram_id")
    new_role = data.get("role")  # assistant | sergeant | user
    if not actor_id or not target_id or new_role not in ("assistant", "sergeant", "user"):
        raise HTTPException(status_code=400, detail="Нужны actor_telegram_id, target_telegram_id и role (assistant|sergeant|user)")
    actor_role = _user_role_from_db(actor_id)
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    if actor_role == "admin":
        pass  # может назначать без ограничений
    elif actor_role == "assistant":
        a_row = conn.execute("SELECT enrollment_year FROM users WHERE telegram_id = ?", (actor_id,)).fetchone()
        t_row = conn.execute("SELECT enrollment_year, group_name FROM users WHERE telegram_id = ?", (target_id,)).fetchone()
        if not a_row or not t_row or a_row["enrollment_year"] != t_row["enrollment_year"]:
            conn.close()
            raise HTTPException(status_code=403, detail="Можно менять только пользователей своего курса")
        if new_role == "assistant":
            cnt = conn.execute(
                "SELECT COUNT(*) FROM users WHERE enrollment_year = ? AND role = 'assistant'",
                (t_row["enrollment_year"],)
            ).fetchone()[0]
            if cnt >= 6:
                conn.close()
                raise HTTPException(status_code=403, detail="На курсе уже 6 помощников (лимит)")
        elif new_role == "sergeant":
            grp = t_row["group_name"] or ""
            cnt = conn.execute(
                "SELECT COUNT(*) FROM users WHERE group_name = ? AND role = 'sergeant'",
                (grp,)
            ).fetchone()[0]
            if cnt >= 4:
                conn.close()
                raise HTTPException(status_code=403, detail="В группе уже 4 сержанта (лимит)")
    else:
        conn.close()
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    try:
        conn.execute("UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?", (new_role, target_id))
        conn.commit()
        conn.close()
        return {"status": "ok", "role": new_role}
    except Exception as e:
        print(f"[ERROR] set_user_role: {e}")
        raise HTTPException(status_code=500, detail="Ошибка назначения роли")


# ============================================
# 2. НАРЯДЫ ПОЛЬЗОВАТЕЛЯ
# ============================================
@app.get("/api/duties")
async def get_duties(telegram_id: int, month: str = None, year: int = None):
    """
    Получает наряды пользователя.
    Если указаны month и year - возвращает наряды за конкретный месяц.
    Иначе возвращает все наряды и ближайший.
    """
    conn = get_db()
    if not conn:
        return {"error": "База данных не найдена"}

    try:
        # --- Получаем user_id и ФИО ---
        user = conn.execute(
            "SELECT id, fio FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
    except Exception as e:
        print(f"[ERROR] Ошибка при поиске user_id: {e}")
        return {"error": f"Ошибка БД: {str(e)}"}

    if not user:
        conn.close()
        return {"error": "Пользователь не найден"}

    user_id = user['id']
    user_fio = user['fio']  # ФИО из users — в Excel (duty_schedule) должно быть то же написание

    try:
        # Проверяем, какая таблица используется
        # Сначала пробуем duty_schedule (новая структура)
        try:
            cursor = conn.execute("PRAGMA table_info(duty_schedule)")
            schedule_columns = [row['name'] for row in cursor.fetchall()]
            if schedule_columns:
                # Используем duty_schedule
                if month is not None and year is not None:
                    # Фильтр по месяцу (month/year могут прийти строками из query)
                    try:
                        m = int(month)
                        y = int(year)
                    except (TypeError, ValueError):
                        m, y = None, None
                    if m is not None and y is not None and 1 <= m <= 12:
                        month_start = f"{y}-{m:02d}-01"
                        if m == 12:
                            month_end = f"{y + 1}-01-01"
                        else:
                            month_end = f"{y}-{m + 1:02d}-01"
                    else:
                        month_start = month_end = None
                    if month_start and month_end:
                        fio_variants = _fio_match_variants(user_fio) or [user_fio or ""]
                        placeholders = ",".join(["?"] * len(fio_variants))
                        query = f"""
                            SELECT date, role, group_name, enrollment_year
                            FROM duty_schedule
                            WHERE fio IN ({placeholders}) AND date >= ? AND date < ?
                            ORDER BY date
                        """
                        rows = conn.execute(query, (*fio_variants, month_start, month_end)).fetchall()
                    else:
                        fio_variants = _fio_match_variants(user_fio) or [user_fio or ""]
                        placeholders = ",".join(["?"] * len(fio_variants))
                        rows = conn.execute(
                            f"SELECT date, role, group_name, enrollment_year FROM duty_schedule WHERE fio IN ({placeholders}) ORDER BY date",
                            tuple(fio_variants),
                        ).fetchall()
                else:
                    fio_variants = _fio_match_variants(user_fio) or [user_fio or ""]
                    placeholders = ",".join(["?"] * len(fio_variants))
                    query = f"""
                        SELECT date, role, group_name, enrollment_year
                        FROM duty_schedule
                        WHERE fio IN ({placeholders})
                        ORDER BY date
                    """
                    rows = conn.execute(query, tuple(fio_variants)).fetchall()
                
                duties_list = []
                points_map = _get_duty_points_map(conn)
                for row in rows:
                    # Получаем участников наряда на эту дату
                    partners_query = """
                        SELECT fio, group_name
                        FROM duty_schedule
                        WHERE date = ? AND role = ? AND enrollment_year = ?
                        ORDER BY group_name, fio
                    """
                    partners = conn.execute(partners_query, (row['date'], row['role'], row['enrollment_year'])).fetchall()
                    role_lower = (row['role'] or '').strip().lower()
                    points = points_map.get(role_lower, 10)
                    duties_list.append({
                        "date": row['date'],
                        "role": row['role'],
                        "role_full": get_full_role(row['role']),
                        "group": row['group_name'],
                        "partners": [{"fio": p['fio'], "group": p['group_name']} for p in partners],
                        "points": points,
                    })
                
                conn.close()
                
                # Ближайший наряд (если не указан месяц)
                if not month:
                    today = datetime.now().strftime("%Y-%m-%d")
                    upcoming = [d for d in duties_list if d['date'] >= today]
                    next_duty = upcoming[0] if upcoming else None
                else:
                    next_duty = None
                
                return {
                    "duties": duties_list,
                    "next_duty": next_duty,
                    "total": len(duties_list)
                }
        except Exception:
            pass

        # Если duty_schedule не работает, пробуем duties (старая структура)
        try:
            cursor = conn.execute("PRAGMA table_info(duties)")
            columns = [row['name'] for row in cursor.fetchall()]
        except Exception:
            conn.close()
            return {
                "duties": [],
                "next_duty": None,
                "total": 0,
                "error": "График нарядов ещё не загружен. Когда данные появятся, здесь отобразятся ваши наряды."
            }

        if columns and 'object_type' in columns:
            query = """
                SELECT date, role, object_type
                FROM duties
                WHERE user_id = ?
                ORDER BY date
            """
            rows = conn.execute(query, (user_id,)).fetchall()
            duties_list = [
                {
                    "date": row['date'],
                    "role": row['role'],
                    "role_full": get_full_role(row['role']),
                    "object": row['object_type'] or "—",
                    "partners": []  # Старая структура не поддерживает участников
                }
                for row in rows
            ]
        else:
            query = """
                SELECT date, role
                FROM duties
                WHERE user_id = ?
                ORDER BY date
            """
            rows = conn.execute(query, (user_id,)).fetchall()
            duties_list = [
                {
                    "date": row['date'],
                    "role": row['role'],
                    "role_full": get_full_role(row['role']),
                    "object": "—",
                    "partners": []
                }
                for row in rows
            ]

    except Exception as e:
        print(f"[ERROR] Ошибка при запросе нарядов: {e}")
        err_msg = str(e).lower()
        if "no such table" in err_msg or "duties" in err_msg:
            conn.close()
            return {
                "duties": [],
                "next_duty": None,
                "total": 0,
                "error": "График нарядов ещё не загружен. Когда данные появятся, здесь отобразятся ваши наряды."
            }
        return {"error": f"Ошибка БД: {str(e)}"}
    finally:
        conn.close()

    # --- Ближайший наряд ---
    today = datetime.now().strftime("%Y-%m-%d")
    upcoming = [d for d in duties_list if d['date'] >= today]
    next_duty = upcoming[0] if upcoming else None

    return {
        "duties": duties_list,
        "next_duty": next_duty,
        "total": len(duties_list)
    }


@app.get("/api/duties/by-date")
async def get_duties_by_date(date: str, telegram_id: int = 0):
    """
    Возвращает всех участников наряда на конкретную дату.
    Если telegram_id передан — фильтрует по курсу (enrollment_year) пользователя.
    """
    conn = get_db()
    if not conn:
        return {"error": "База данных не найдена"}
    
    try:
        ey = None
        if telegram_id:
            user = conn.execute("SELECT enrollment_year FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
            if user:
                ey = user["enrollment_year"]

        if ey:
            query = """
                SELECT fio, role, group_name, enrollment_year, gender
                FROM duty_schedule
                WHERE date = ? AND enrollment_year = ?
                ORDER BY role, group_name, fio
            """
            rows = conn.execute(query, (date, ey)).fetchall()
        else:
            query = """
                SELECT fio, role, group_name, enrollment_year, gender
                FROM duty_schedule
                WHERE date = ?
                ORDER BY role, group_name, fio
            """
            rows = conn.execute(query, (date,)).fetchall()
        
        by_role = {}
        for row in rows:
            role = row['role']
            if role not in by_role:
                by_role[role] = []
            by_role[role].append({
                "fio": row['fio'],
                "group": row['group_name'],
                "course": row['enrollment_year'],
                "gender": row['gender']
            })
        
        return {
            "date": date,
            "by_role": by_role,
            "total": len(rows)
        }
    except Exception as e:
        print(f"[ERROR] Ошибка при запросе нарядов по дате: {e}")
        return {"error": f"Ошибка БД: {str(e)}"}
    finally:
        if conn:
            conn.close()

@app.get("/api/duties/available-months")
async def get_available_months(telegram_id: int):
    """Возвращает список месяцев (YYYY-MM), для которых есть загруженные графики в рамках курса пользователя."""
    conn = get_db()
    if not conn:
        return {"months": []}
    try:
        user = conn.execute(
            "SELECT enrollment_year FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not user:
            return {"months": []}
        ey = user["enrollment_year"]
        rows = conn.execute("""
            SELECT DISTINCT substr(date, 1, 7) as ym
            FROM duty_schedule
            WHERE enrollment_year = ?
            ORDER BY ym
        """, (ey,)).fetchall()
        return {"months": [r["ym"] for r in rows]}
    except Exception as e:
        print(f"[ERROR] available-months: {e}")
        return {"months": []}
    finally:
        conn.close()


@app.get("/api/duties/day-detail")
async def get_duty_day_detail(date: str, role: str, telegram_id: int):
    """Подробная информация о конкретном наряде (роль) на конкретную дату: все участники того же курса."""
    conn = get_db()
    if not conn:
        return {"error": "БД не найдена"}
    try:
        user = conn.execute(
            "SELECT enrollment_year FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not user:
            return {"error": "Пользователь не найден"}
        ey = user["enrollment_year"]
        rows = conn.execute("""
            SELECT ds.fio, ds.group_name, ds.gender, u.telegram_id
            FROM duty_schedule ds
            LEFT JOIN users u ON u.fio = ds.fio AND u.status = 'активен'
            WHERE ds.date = ? AND ds.role = ? AND ds.enrollment_year = ?
            ORDER BY ds.group_name, ds.fio
        """, (date, role, ey)).fetchall()
        participants = [
            {"fio": r["fio"], "group": r["group_name"], "gender": r["gender"], "telegram_id": r["telegram_id"]}
            for r in rows
        ]
        
        shift_data = []
        canteen_data = []
        if role in ("к", "гбр"):
            try:
                s_rows = conn.execute("""
                    SELECT fio, shift FROM duty_shift_assignments
                    WHERE date = ? AND role = ? AND enrollment_year = ?
                    ORDER BY shift, fio
                """, (date, role, ey)).fetchall()
                shift_data = [{"fio": r["fio"], "shift": r["shift"]} for r in s_rows]
            except Exception:
                pass
        elif role == "с":
            try:
                c_rows = conn.execute("""
                    SELECT fio, object_name FROM duty_canteen_assignments
                    WHERE date = ? AND enrollment_year = ?
                    ORDER BY object_name, fio
                """, (date, ey)).fetchall()
                canteen_data = [{"fio": r["fio"], "object": r["object_name"]} for r in c_rows]
            except Exception:
                pass
        
        return {
            "date": date,
            "role": role,
            "role_full": get_full_role(role),
            "participants": participants,
            "count": len(participants),
            "shifts": shift_data,
            "canteen": canteen_data,
        }
    except Exception as e:
        print(f"[ERROR] day-detail: {e}")
        return {"error": str(e)}
    finally:
        conn.close()


# ============================================
# 2.5. РАСПРЕДЕЛЕНИЕ ПО СМЕНАМ И ОБЪЕКТАМ
# ============================================

CANTEEN_OBJECTS = ["ГЦ", "овощи", "тарелки", "железо", "стаканы", "лента"]

def distribute_shifts_for_date(date_str: str, role: str, ey: int, conn):
    """Распределяет людей по сменам для Курс/ГБР. Возвращает список назначений."""
    rows = conn.execute("""
        SELECT fio, group_name FROM duty_schedule
        WHERE date = ? AND role = ? AND enrollment_year = ?
        ORDER BY fio
    """, (date_str, role, ey)).fetchall()
    people = [r["fio"] for r in rows]
    if not people:
        return []
    
    random.shuffle(people)
    assignments = []
    
    if role == "к":
        for i, fio in enumerate(people):
            if i < 3:
                shift = i + 1
            else:
                shift = 0  # дежурный
            assignments.append({"fio": fio, "shift": shift})
    elif role == "гбр":
        for i, fio in enumerate(people):
            shift = (i // 2) + 1
            assignments.append({"fio": fio, "shift": shift})
    else:
        for i, fio in enumerate(people):
            shift = (i % 3) + 1
            assignments.append({"fio": fio, "shift": shift})
    
    conn.execute("DELETE FROM duty_shift_assignments WHERE date = ? AND role = ? AND enrollment_year = ?",
                 (date_str, role, ey))
    for a in assignments:
        conn.execute("""
            INSERT OR REPLACE INTO duty_shift_assignments (date, role, fio, shift, enrollment_year)
            VALUES (?, ?, ?, ?, ?)
        """, (date_str, role, a["fio"], a["shift"], ey))
        conn.execute("""
            INSERT INTO duty_assignment_history (fio, date, role, shift, enrollment_year)
            VALUES (?, ?, ?, ?, ?)
        """, (a["fio"], date_str, role, a["shift"], ey))
    conn.commit()
    return assignments


def distribute_canteen_for_date(date_str: str, ey: int, conn):
    """Распределяет людей по объектам столовой с учётом рейтинга и истории."""
    rows = conn.execute("""
        SELECT fio, group_name FROM duty_schedule
        WHERE date = ? AND role = 'с' AND enrollment_year = ?
        ORDER BY fio
    """, (date_str, ey)).fetchall()
    people = [r["fio"] for r in rows]
    if not people:
        return []

    scores = {}
    for fio in people:
        user_row = conn.execute("SELECT global_score FROM users WHERE fio = ? AND enrollment_year = ?",
                                (fio, ey)).fetchone()
        gs = user_row["global_score"] if user_row and user_row["global_score"] else 0
        
        hist = conn.execute("""
            SELECT sub_object FROM duty_assignment_history
            WHERE fio = ? AND role = 'с' AND enrollment_year = ?
            ORDER BY date DESC LIMIT 5
        """, (fio, ey)).fetchall()
        history = [h["sub_object"] for h in hist if h["sub_object"]]
        
        streak_penalty = 0
        if len(history) >= 2:
            weights_map = {}
            try:
                w_rows = conn.execute("""
                    SELECT do.name, ow.weight FROM duty_objects do
                    JOIN object_weights ow ON do.id = ow.object_id
                """).fetchall()
                weights_map = {r["name"]: r["weight"] for r in w_rows}
            except Exception:
                pass
            
            heavy = [o for o in CANTEEN_OBJECTS if weights_map.get(o, 10) >= 12]
            if history[0] in heavy and len(history) > 1 and history[1] in heavy:
                streak_penalty = 5
        
        scores[fio] = 0.5 * gs + streak_penalty
    
    sorted_people = sorted(people, key=lambda f: scores.get(f, 0))
    
    weights_map = {}
    try:
        w_rows = conn.execute("""
            SELECT do.name, ow.weight FROM duty_objects do
            JOIN object_weights ow ON do.id = ow.object_id
        """).fetchall()
        weights_map = {r["name"]: r["weight"] for r in w_rows}
    except Exception:
        pass
    
    objects_sorted = sorted(CANTEEN_OBJECTS, key=lambda o: weights_map.get(o, 10), reverse=True)
    
    assignments = []
    obj_idx = 0
    for fio in sorted_people:
        obj = objects_sorted[obj_idx % len(objects_sorted)]
        obj_idx += 1
        assignments.append({"fio": fio, "object": obj})
    
    conn.execute("DELETE FROM duty_canteen_assignments WHERE date = ? AND enrollment_year = ?",
                 (date_str, ey))
    for a in assignments:
        conn.execute("""
            INSERT OR REPLACE INTO duty_canteen_assignments (date, fio, object_name, enrollment_year)
            VALUES (?, ?, ?, ?)
        """, (date_str, a["fio"], a["object"], ey))
        conn.execute("""
            INSERT INTO duty_assignment_history (fio, date, role, sub_object, enrollment_year)
            VALUES (?, ?, 'с', ?, ?)
        """, (a["fio"], date_str, a["object"], ey))
    conn.commit()
    return assignments


@app.post("/api/duties/distribute")
async def distribute_duty(date: str = Form(...), role: str = Form(...), telegram_id: int = Form(...)):
    """Ручной запуск распределения по сменам/объектам (для сержантов/админов)."""
    conn = get_db()
    if not conn:
        raise HTTPException(500, detail="БД не найдена")
    try:
        user = conn.execute("SELECT enrollment_year, role as user_role FROM users WHERE telegram_id = ?",
                            (telegram_id,)).fetchone()
        if not user:
            raise HTTPException(404, detail="Пользователь не найден")
        if user["user_role"] not in ("admin", "sergeant", "assistant"):
            raise HTTPException(403, detail="Недостаточно прав")
        ey = user["enrollment_year"]
        
        if role == "с":
            result = distribute_canteen_for_date(date, ey, conn)
            return {"status": "ok", "type": "canteen", "assignments": result, "count": len(result)}
        else:
            result = distribute_shifts_for_date(date, role, ey, conn)
            return {"status": "ok", "type": "shift", "assignments": result, "count": len(result)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] distribute: {e}")
        raise HTTPException(500, detail=str(e))
    finally:
        conn.close()


@app.get("/api/duties/shifts")
async def get_duty_shifts(date: str, role: str, telegram_id: int):
    """Получить распределение по сменам на дату."""
    conn = get_db()
    if not conn:
        return {"assignments": []}
    try:
        user = conn.execute("SELECT enrollment_year FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
        if not user:
            return {"assignments": []}
        ey = user["enrollment_year"]
        rows = conn.execute("""
            SELECT fio, shift FROM duty_shift_assignments
            WHERE date = ? AND role = ? AND enrollment_year = ?
            ORDER BY shift, fio
        """, (date, role, ey)).fetchall()
        return {"date": date, "role": role, "assignments": [{"fio": r["fio"], "shift": r["shift"]} for r in rows]}
    except Exception as e:
        return {"assignments": [], "error": str(e)}
    finally:
        conn.close()


@app.get("/api/duties/canteen-assignments")
async def get_canteen_assignments(date: str, telegram_id: int):
    """Получить распределение по объектам столовой."""
    conn = get_db()
    if not conn:
        return {"assignments": []}
    try:
        user = conn.execute("SELECT enrollment_year FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
        if not user:
            return {"assignments": []}
        ey = user["enrollment_year"]
        rows = conn.execute("""
            SELECT fio, object_name FROM duty_canteen_assignments
            WHERE date = ? AND enrollment_year = ?
            ORDER BY object_name, fio
        """, (date, ey)).fetchall()
        return {"date": date, "assignments": [{"fio": r["fio"], "object": r["object_name"]} for r in rows]}
    except Exception as e:
        return {"assignments": [], "error": str(e)}
    finally:
        conn.close()


# ============================================
# 3. ЗАДАЧНИК: API ДЛЯ WEBAPP
# ============================================

@app.get("/api/tasks")
async def get_tasks(user_id: int):
    conn = get_db()
    if not conn:
        return {"error": "База данных не найдена"}

    try:
        # Проверим, есть ли таблица tasks
        cursor = conn.execute("PRAGMA table_info(tasks)")
        columns = [row['name'] for row in cursor.fetchall()]
        if not columns:
            print("[ERROR] Таблица tasks не найдена")
            return {"error": "Таблица задач не найдена"}

        # Выбираем задачи
        query = """
            SELECT id, text, done, deadline 
            FROM tasks 
            WHERE user_id = ? 
            ORDER BY done, deadline IS NULL, deadline
        """
        rows = conn.execute(query, (user_id,)).fetchall()
        tasks = []
        for row in rows:
            task = dict(row)
            # Форматируем deadline для отображения
            if task['deadline']:
                try:
                    dt = datetime.fromisoformat(task['deadline'])
                    task['formatted_deadline'] = dt.strftime('%d %H:%M')
                except:
                    task['formatted_deadline'] = None
            else:
                task['formatted_deadline'] = None
            tasks.append(task)
        return tasks

    except Exception as e:
        print(f"[ERROR] Ошибка загрузки задач: {e}")
        return {"error": f"Ошибка БД: {str(e)}"}
    finally:
        conn.close()


@app.post("/api/add_task")
async def add_task(data: dict):
    user_id = data.get('user_id')
    text = data.get('text')

    if not user_id or not text:
        raise HTTPException(status_code=400, detail="user_id и text обязательны")

    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")

    try:
        conn.execute("""
            INSERT INTO tasks (user_id, text, done, reminded, deadline) 
            VALUES (?, ?, 0, 0, NULL)
        """, (user_id, text.strip()))
        conn.commit()
        print(f"✅ Добавлена задача: '{text}' для user_id={user_id}")
        return {"status": "ok"}
    except Exception as e:
        print(f"[ERROR] Ошибка добавления задачи: {e}")
        raise HTTPException(status_code=500, detail="Не удалось добавить задачу")
    finally:
        conn.close()


@app.post("/api/done_task")
async def done_task(data: dict):
    task_id = data.get('task_id')
    user_id = data.get('user_id')
    done = data.get('done', True)

    if not task_id or not user_id:
        raise HTTPException(status_code=400, detail="task_id и user_id обязательны")

    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")

    try:
        conn.execute("UPDATE tasks SET done = ? WHERE id = ? AND user_id = ?", (int(done), task_id, user_id))
        conn.commit()
        action = "выполнена" if done else "восстановлена"
        print(f"✅ Задача {task_id} отмечена как {action}")
        return {"status": "ok"}
    except Exception as e:
        print(f"[ERROR] Ошибка обновления статуса задачи: {e}")
        raise HTTPException(status_code=500, detail="Не удалось обновить задачу")
    finally:
        conn.close()


@app.post("/api/delete_task")
async def delete_task(data: dict):
    task_id = data.get('task_id')
    user_id = data.get('user_id')

    if not task_id or not user_id:
        raise HTTPException(status_code=400, detail="task_id и user_id обязательны")

    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")

    try:
        conn.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
        conn.commit()
        print(f"✅ Задача {task_id} удалена")
        return {"status": "ok"}
    except Exception as e:
        print(f"[ERROR] Ошибка удаления задачи: {e}")
        raise HTTPException(status_code=500, detail="Не удалось удалить задачу")
    finally:
        conn.close()


@app.post("/api/edit_task")
async def edit_task(data: dict):
    task_id = data.get('task_id')
    text = data.get('text')
    user_id = data.get('user_id')

    if not task_id or not text or not user_id:
        raise HTTPException(status_code=400, detail="task_id, text и user_id обязательны")

    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")

    try:
        conn.execute("UPDATE tasks SET text = ? WHERE id = ? AND user_id = ?", (text.strip(), task_id, user_id))
        conn.commit()
        print(f"✅ Задача {task_id} отредактирована: '{text}'")
        return {"status": "ok"}
    except Exception as e:
        print(f"[ERROR] Ошибка редактирования задачи: {e}")
        raise HTTPException(status_code=500, detail="Не удалось редактировать задачу")
    finally:
        conn.close()


@app.post("/api/set_reminder")
async def set_reminder(data: dict):
    task_id = data.get('task_id')
    deadline = data.get('deadline')  # 'YYYY-MM-DD HH:MM:SS'
    user_id = data.get('user_id')

    if not task_id or not deadline or not user_id:
        raise HTTPException(status_code=400, detail="task_id, deadline и user_id обязательны")

    # Валидация формата
    try:
        datetime.fromisoformat(deadline)
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный формат даты. Используйте YYYY-MM-DD HH:MM:SS")

    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")

    try:
        conn.execute("""
            UPDATE tasks 
            SET deadline = ?, reminded = 0 
            WHERE id = ? AND user_id = ?
        """, (deadline, task_id, user_id))
        conn.commit()
        print(f"✅ Напоминание установлено: задача {task_id} → {deadline}")
        return {"status": "ok"}
    except Exception as e:
        print(f"[ERROR] Ошибка установки напоминания: {e}")
        raise HTTPException(status_code=500, detail="Не удалось установить напоминание")
    finally:
        conn.close()


# ============================================
# 4. ВСЁ РАСПИСАНИЕ (заглушка)
# ============================================
@app.get("/api/schedule/all")
async def get_full_schedule():
    return {"info": "Модуль в разработке"}


@app.get("/api/schedule/check_month")
async def check_schedule_month(group: str, enrollment_year: int, month: str):
    """Проверка: есть ли уже график за указанный месяц для группы. month = YYYY-MM."""
    if len(month) != 7 or month[4] != "-":
        raise HTTPException(status_code=400, detail="month должен быть в формате YYYY-MM")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        start = month + "-01"
        try:
            dt = datetime.strptime(month, "%Y-%m")
            if dt.month == 12:
                end = f"{dt.year + 1}-01-01"
            else:
                end = f"{dt.year}-{dt.month + 1:02d}-01"
        except Exception:
            end = start
        row = conn.execute("""
            SELECT 1 FROM duty_schedule
            WHERE group_name = ? AND enrollment_year = ?
            AND date >= ? AND date < ?
            LIMIT 1
        """, (group, enrollment_year, start, end)).fetchone()
        return {"has_data": row is not None, "month": month, "group": group}
    finally:
        conn.close()


SCHEDULE_TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "graph_ИО6 — копия.xlsx")


def _generate_schedule_template_bytes():
    """
    Возвращает .xlsx шаблон графика нарядов.
    В первую очередь пытаемся отдать пользовательский файл SCHEDULE_TEMPLATE_PATH,
    чтобы курсанты скачивали именно ваш актуальный шаблон.
    Если файла нет или произошла ошибка чтения — генерируем запасной шаблон
    тем же форматом, который ожидает парсер (группа E1, год AO4, ФИО F6:H21,
    месяц I4, дни I5:AM5, ячейки I6:AM21).
    """
    # 1. Пользовательский шаблон с диска
    try:
        if os.path.exists(SCHEDULE_TEMPLATE_PATH):
            with open(SCHEDULE_TEMPLATE_PATH, "rb") as f:
                return f.read()
    except Exception as e:
        print(f"[WARN] Не удалось прочитать пользовательский шаблон: {e}")

    # 2. Резервный генератор (старый вариант через openpyxl)
    try:
        import openpyxl
    except ImportError:
        return None

    wb = openpyxl.Workbook()
    ws = wb.active
    if ws.title == "Sheet":
        ws.title = "График"
    # Группа — E1
    ws["E1"] = "Группа (напр. ИО61)"
    ws["E2"] = ""
    # Год — AO4 (клише =$AO$4: в этой ячейке год, чтобы графики не терялись)
    from datetime import date as _date
    ws["AO4"] = _date.today().year
    # Заголовки месяц/дни — I4:AM5
    ws.cell(4, 9, "месяц (напр. январь)")
    for c in range(1, 32):
        ws.cell(5, 8 + c, c)
    # ФИО — колонки F,G,H строки 6-21
    ws.cell(6, 6, "Фамилия")
    ws.cell(6, 7, "Имя")
    ws.cell(6, 8, "Отчество")
    for r in range(7, 22):
        for c in range(6, 9):
            ws.cell(r, c, "")
    ws.cell(22, 1, "Роли: к, дк, с, ад, гбр, зуб, столовая и т.д.")

    import io
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


@app.get("/api/schedule/template")
async def get_schedule_template():
    """Скачать шаблон .xlsx для графика нарядов."""
    data = _generate_schedule_template_bytes()
    if not data:
        raise HTTPException(status_code=500, detail="openpyxl не установлен")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=schedule_template.xlsx"}
    )


@app.post("/api/schedule/upload")
async def upload_schedule(
    file: UploadFile = File(...),
    telegram_id: int = Form(...),
    overwrite: int = Form(0),
):
    """Загрузка графика из .xlsx. Доступно сержанту (своя группа), помощнику/админу."""
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Нужен файл .xlsx")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute(
            "SELECT role, group_name, enrollment_year FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
        if not user or user["role"] not in ("sergeant", "assistant", "admin"):
            raise HTTPException(status_code=403, detail="Нет прав на загрузку графика")
    finally:
        conn.close()

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Файл пустой")
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as f:
            f.write(content)
            tmp = f.name
        from utils.parse_excel import parse_excel_schedule_with_validation
        result = parse_excel_schedule_with_validation(tmp)
    finally:
        if tmp and os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except Exception:
                pass

    if not result["success"]:
        errors = result.get("errors", [])[:5]
        raise HTTPException(status_code=400, detail="; ".join(errors))

    schedule_data = result["data"]
    group = result["group"]
    conn = get_db()
    try:
        enrollment_year = user["enrollment_year"]
        if user["role"] == "assistant" or user["role"] == "admin":
            row = conn.execute(
                "SELECT enrollment_year FROM users WHERE group_name = ? LIMIT 1",
                (group,)
            ).fetchone()
            enrollment_year = row["enrollment_year"] if row else user["enrollment_year"]
        elif user["role"] == "sergeant" and group != user["group_name"]:
            conn.close()
            raise HTTPException(
                status_code=403,
                detail=f"Сержант может загружать график только своей группы. Ваша группа: {user['group_name']}"
            )

        dates = {d["date"] for d in schedule_data}
        if not dates:
            conn.close()
            return {"status": "ok", "message": "Нет записей", "count": 0}
        month_start = min(dates)
        month_ym = month_start[:7]
        from datetime import datetime as dt_klass
        try:
            dt = dt_klass.strptime(month_start, "%Y-%m-%d")
            if dt.month == 12:
                month_end_next = f"{dt.year + 1}-01-01"
            else:
                month_end_next = f"{dt.year}-{dt.month + 1:02d}-01"
        except Exception:
            month_end_next = month_start

        if overwrite != 1:
            existing = conn.execute("""
                SELECT 1 FROM duty_schedule
                WHERE group_name = ? AND enrollment_year = ?
                AND date >= ? AND date < ?
                LIMIT 1
            """, (group, enrollment_year, month_ym + "-01", month_end_next)).fetchone()
            if existing:
                conn.close()
                month_names_ru = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]
                try:
                    m = int(month_ym.split("-")[1])
                    month_name = month_names_ru[m - 1]
                except Exception:
                    month_name = month_ym
                raise HTTPException(
                    status_code=409,
                    detail=f"График за {month_name} {month_ym[:4]} уже существует. Заменить?"
                )

        conn.execute(
            """DELETE FROM duty_schedule
               WHERE group_name = ? AND enrollment_year = ?
               AND date >= ? AND date < ?""",
            (group, enrollment_year, month_ym + "-01", month_end_next)
        )
        for d in schedule_data:
            conn.execute(
                """INSERT OR REPLACE INTO duty_schedule (fio, date, role, group_name, enrollment_year, gender)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (d["fio"], d["date"], d["role"], d["group"], enrollment_year, d.get("gender", "male"))
            )
        conn.commit()
        conn.close()
        month_names_ru = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]
        try:
            m = int(month_ym.split("-")[1])
            month_name = month_names_ru[m - 1]
            year_str = month_ym[:4]
        except Exception:
            month_name = month_ym
            year_str = ""
        return {
            "status": "ok",
            "message": f"График за {month_name} {year_str} г. загружен. Добавлено записей: {len(schedule_data)}",
            "count": len(schedule_data),
            "month_label": f"{month_name} {year_str}",
            "month_ym": month_ym,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Сохранение графика: {e}")
        raise HTTPException(status_code=500, detail="Ошибка сохранения графика")


@app.delete("/api/schedule/month")
async def delete_schedule_month(ym: str, telegram_id: int):
    """Удалить график за месяц YYYY-MM. Сержант — только свою группу, помощник/админ — весь курс."""
    if not ym or len(ym) != 7 or ym[4] != "-":
        raise HTTPException(status_code=400, detail="Формат: YYYY-MM")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute(
            "SELECT role, group_name, enrollment_year FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
        if not user or user["role"] not in ("sergeant", "assistant", "admin"):
            raise HTTPException(status_code=403, detail="Нет прав")
        month_start = ym + "-01"
        try:
            y, m = int(ym[:4]), int(ym[5:7])
            if m == 12:
                month_end = f"{y + 1}-01-01"
            else:
                month_end = f"{y}-{m + 1:02d}-01"
        except Exception:
            raise HTTPException(status_code=400, detail="Неверный месяц")
        if user["role"] == "sergeant":
            conn.execute("""
                DELETE FROM duty_schedule
                WHERE enrollment_year = ? AND group_name = ? AND date >= ? AND date < ?
            """, (user["enrollment_year"], user["group_name"] or "", month_start, month_end))
        else:
            conn.execute("""
                DELETE FROM duty_schedule
                WHERE enrollment_year = ? AND date >= ? AND date < ?
            """, (user["enrollment_year"], month_start, month_end))
        conn.commit()
        conn.close()
        return {"status": "ok", "message": f"График за {ym} удалён"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] delete schedule month: {e}")
        raise HTTPException(status_code=500, detail="Ошибка удаления")


# ============================================
# 2.6. ПРАВКА ГРАФИКА: заменить/добавить наряд, контекст для форм
# ============================================

DUTY_REMOVAL_REASONS = ["заболел", "командировка", "рапорт", "другое"]


@app.get("/api/duties/edit-context")
async def get_duty_edit_context(ym: str, telegram_id: int):
    """Для правки графика за месяц: курсанты в графике и пользователи по группам (для выбора «кто заменяет»)."""
    if not ym or len(ym) != 7:
        raise HTTPException(status_code=400, detail="Формат: YYYY-MM")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute(
            "SELECT role, group_name, enrollment_year FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not user or user["role"] not in ("sergeant", "assistant", "admin"):
            conn.close()
            raise HTTPException(status_code=403, detail="Нет прав на правку графика")
        month_start = ym + "-01"
        try:
            y, m = int(ym[:4]), int(ym[5:7])
            month_end = f"{y + 1}-01-01" if m == 12 else f"{y}-{m + 1:02d}-01"
        except Exception:
            conn.close()
            raise HTTPException(status_code=400, detail="Неверный месяц")
        ey = user["enrollment_year"]
        grp = user["group_name"] or ""
        if user["role"] == "sergeant":
            schedule_rows = conn.execute("""
                SELECT DISTINCT fio, group_name FROM duty_schedule
                WHERE enrollment_year = ? AND group_name = ? AND date >= ? AND date < ?
                ORDER BY group_name, fio
            """, (ey, grp, month_start, month_end)).fetchall()
            users_rows = conn.execute("""
                SELECT fio, group_name, telegram_id FROM users
                WHERE enrollment_year = ? AND group_name = ? AND status = 'активен'
                ORDER BY fio
            """, (ey, grp)).fetchall()
        else:
            schedule_rows = conn.execute("""
                SELECT DISTINCT fio, group_name FROM duty_schedule
                WHERE enrollment_year = ? AND date >= ? AND date < ?
                ORDER BY group_name, fio
            """, (ey, month_start, month_end)).fetchall()
            users_rows = conn.execute("""
                SELECT fio, group_name, telegram_id FROM users
                WHERE enrollment_year = ? AND status = 'активен'
                ORDER BY group_name, fio
            """, (ey,)).fetchall()
        cadets_in_schedule = [{"fio": r["fio"], "group_name": r["group_name"]} for r in schedule_rows]
        group_users = [{"fio": r["fio"], "group_name": r["group_name"], "telegram_id": r["telegram_id"]} for r in users_rows]
        conn.close()
        return {"ym": ym, "cadets_in_schedule": cadets_in_schedule, "group_users": group_users, "reasons": DUTY_REMOVAL_REASONS}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] edit-context: {e}")
        raise HTTPException(status_code=500, detail="Ошибка загрузки контекста")


@app.post("/api/duties/remove-and-replace")
async def duty_remove_and_replace(data: dict):
    """Удалить курсанта из наряда на дату и поставить вместо него другого. Запись в duty_replacements."""
    telegram_id = data.get("telegram_id")
    date = data.get("date")
    role = data.get("role")
    fio_removed = (data.get("fio_removed") or "").strip()
    fio_replacement = (data.get("fio_replacement") or "").strip()
    reason = (data.get("reason") or "заболел").strip().lower()
    if not telegram_id or not date or not role or not fio_removed or not fio_replacement:
        raise HTTPException(status_code=400, detail="Нужны: telegram_id, date, role, fio_removed, fio_replacement")
    if reason not in DUTY_REMOVAL_REASONS:
        reason = "другое"
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute(
            "SELECT role, group_name, enrollment_year FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not user or user["role"] not in ("sergeant", "assistant", "admin"):
            conn.close()
            raise HTTPException(status_code=403, detail="Нет прав")
        ey = user["enrollment_year"]
        row = conn.execute("""
            SELECT id, group_name FROM duty_schedule
            WHERE date = ? AND role = ? AND enrollment_year = ? AND fio = ?
        """, (date, role, ey, fio_removed)).fetchone()
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Запись не найдена в графике на эту дату")
        grp = row["group_name"]
        if user["role"] == "sergeant" and grp != (user["group_name"] or ""):
            conn.close()
            raise HTTPException(status_code=403, detail="Можно править только свою группу")
        conn.execute("""
            UPDATE duty_schedule SET fio = ? WHERE date = ? AND role = ? AND enrollment_year = ? AND fio = ?
        """, (fio_replacement, date, role, ey, fio_removed))
        conn.execute("""
            INSERT INTO duty_replacements (date, role, group_name, enrollment_year, fio_removed, fio_replacement, reason, created_by_telegram_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (date, role, grp, ey, fio_removed, fio_replacement, reason, telegram_id))
        try:
            conn.execute(
                "UPDATE duty_shift_assignments SET fio = ? WHERE date = ? AND role = ? AND enrollment_year = ? AND fio = ?",
                (fio_replacement, date, role, ey, fio_removed)
            )
            conn.execute(
                "UPDATE duty_canteen_assignments SET fio = ? WHERE date = ? AND enrollment_year = ? AND fio = ?",
                (fio_replacement, date, ey, fio_removed)
            )
        except Exception:
            pass
        conn.commit()
        conn.close()
        return {"status": "ok", "message": "Замена выполнена"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] remove-and-replace: {e}")
        raise HTTPException(status_code=500, detail="Ошибка замены")


@app.post("/api/duties/add")
async def duty_add(data: dict):
    """Добавить наряд: курсант, дата, роль. Опционально — замена больному (логируем в duty_replacements)."""
    telegram_id = data.get("telegram_id")
    date = data.get("date")
    role = data.get("role")
    fio = (data.get("fio") or "").strip()
    group_name = (data.get("group_name") or "").strip()
    reason_replacing = (data.get("reason_replacing_sick") or "").strip()
    fio_replaced = (data.get("fio_replaced") or "").strip()
    if not telegram_id or not date or not role or not fio or not group_name:
        raise HTTPException(status_code=400, detail="Нужны: telegram_id, date, role, fio, group_name")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute(
            "SELECT role, group_name, enrollment_year FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not user or user["role"] not in ("sergeant", "assistant", "admin"):
            conn.close()
            raise HTTPException(status_code=403, detail="Нет прав")
        ey = user["enrollment_year"]
        if user["role"] == "sergeant" and group_name != (user["group_name"] or ""):
            conn.close()
            raise HTTPException(status_code=403, detail="Можно добавлять только в свою группу")
        gender_row = conn.execute("SELECT gender FROM users WHERE fio = ? LIMIT 1", (fio,)).fetchone()
        gender = gender_row["gender"] if gender_row else "male"
        conn.execute("""
            INSERT OR REPLACE INTO duty_schedule (fio, date, role, group_name, enrollment_year, gender)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (fio, date, role, group_name, ey, gender))
        if reason_replacing and fio_replaced and reason_replacing.lower() in ("заболел", "1", "да", "true"):
            conn.execute("""
                INSERT INTO duty_replacements (date, role, group_name, enrollment_year, fio_removed, fio_replacement, reason, created_by_telegram_id)
                VALUES (?, ?, ?, ?, ?, ?, 'заболел', ?)
            """, (date, role, group_name, ey, fio_replaced, fio, telegram_id))
        conn.commit()
        conn.close()
        return {"status": "ok", "message": "Наряд добавлен"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] duty add: {e}")
        raise HTTPException(status_code=500, detail="Ошибка добавления")


@app.post("/api/duties/remove")
async def duty_remove(data: dict):
    """Удалить наряд за дату у курсанта (без замены)."""
    telegram_id = data.get("telegram_id")
    date = data.get("date")
    fio_removed = (data.get("fio_removed") or "").strip()
    role = (data.get("role") or "").strip()
    if not telegram_id or not date or not fio_removed or not role:
        raise HTTPException(status_code=400, detail="Нужны: telegram_id, date, fio_removed, role")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute(
            "SELECT role, group_name, enrollment_year FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not user or user["role"] not in ("sergeant", "assistant", "admin"):
            conn.close()
            raise HTTPException(status_code=403, detail="Нет прав")
        ey = user["enrollment_year"]
        row = conn.execute("""
            SELECT group_name FROM duty_schedule
            WHERE date = ? AND role = ? AND enrollment_year = ? AND fio = ?
        """, (date, role, ey, fio_removed)).fetchone()
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Запись не найдена в графике на эту дату")
        if user["role"] == "sergeant" and row["group_name"] != (user["group_name"] or ""):
            conn.close()
            raise HTTPException(status_code=403, detail="Можно править только свою группу")
        conn.execute("""
            DELETE FROM duty_schedule
            WHERE date = ? AND role = ? AND enrollment_year = ? AND fio = ?
        """, (date, role, ey, fio_removed))
        try:
            conn.execute("DELETE FROM duty_shift_assignments WHERE date = ? AND role = ? AND enrollment_year = ? AND fio = ?",
                         (date, role, ey, fio_removed))
            conn.execute("DELETE FROM duty_canteen_assignments WHERE date = ? AND enrollment_year = ? AND fio = ?",
                         (date, ey, fio_removed))
        except Exception:
            pass
        conn.commit()
        conn.close()
        return {"status": "ok", "message": "Наряд удалён"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] duty remove: {e}")
        raise HTTPException(status_code=500, detail="Ошибка удаления")


@app.post("/api/duties/change-role")
async def duty_change_role(data: dict):
    """Изменить роль курсанта на дату (например: был Курс — стал ГБР)."""
    telegram_id = data.get("telegram_id")
    date = data.get("date")
    fio = (data.get("fio") or "").strip()
    new_role = (data.get("new_role") or "").strip().lower()
    if not telegram_id or not date or not fio or not new_role:
        raise HTTPException(status_code=400, detail="Нужны: telegram_id, date, fio, new_role")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute(
            "SELECT role, group_name, enrollment_year FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not user or user["role"] not in ("sergeant", "assistant", "admin"):
            conn.close()
            raise HTTPException(status_code=403, detail="Нет прав")
        ey = user["enrollment_year"]
        row = conn.execute("""
            SELECT role, group_name FROM duty_schedule
            WHERE date = ? AND enrollment_year = ? AND fio = ?
        """, (date, ey, fio)).fetchone()
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Наряд на эту дату не найден")
        if user["role"] == "sergeant" and row["group_name"] != (user["group_name"] or ""):
            conn.close()
            raise HTTPException(status_code=403, detail="Можно править только свою группу")
        conn.execute("""
            UPDATE duty_schedule SET role = ? WHERE date = ? AND enrollment_year = ? AND fio = ?
        """, (new_role, date, ey, fio))
        try:
            conn.execute("DELETE FROM duty_shift_assignments WHERE date = ? AND enrollment_year = ? AND fio = ?", (date, ey, fio))
            conn.execute("DELETE FROM duty_canteen_assignments WHERE date = ? AND enrollment_year = ? AND fio = ?", (date, ey, fio))
        except Exception:
            pass
        conn.commit()
        conn.close()
        return {"status": "ok", "message": "Роль изменена"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] duty change-role: {e}")
        raise HTTPException(status_code=500, detail="Ошибка изменения")


# ============================================
# 5. ОПРОСНИК (SURVEY) API — попарное сравнение 2/1/0
# ============================================

def _get_all_pairs(objects):
    """Генерирует все пары из списка объектов [(id, name), ...]"""
    pairs = []
    for i in range(len(objects)):
        for j in range(i + 1, len(objects)):
            pairs.append({
                "object_a": {"id": objects[i]["id"], "name": objects[i]["name"]},
                "object_b": {"id": objects[j]["id"], "name": objects[j]["name"]}
            })
    return pairs


@app.get("/api/survey/list")
async def get_survey_list(telegram_id: int):
    """Список опросов: системные (юноши/девушки) и пользовательские для группы/курса."""
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute(
            "SELECT gender, group_name, enrollment_year, role FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
        if not user:
            conn.close()
            return {"system": [], "custom": []}
        gender = user["gender"] or "male"
        group_name = user["group_name"] or ""
        enrollment_year = user["enrollment_year"]
        role = user["role"] or "user"

        system = [
            {"id": "male", "title": "Опрос для парней (сложность нарядов)", "for_gender": "male"},
            {"id": "female", "title": "Опрос для девушек (ПУТСО, Столовая, Медчасть)", "for_gender": "female"},
        ]

        custom_rows = conn.execute("""
            SELECT s.id, s.title, s.scope_type, s.scope_value, s.created_by_telegram_id, s.ends_at, s.completed_at
            FROM custom_surveys s
            WHERE s.completed_at IS NULL
            AND (
                (s.scope_type = 'group' AND s.scope_value = ?)
                OR (s.scope_type = 'course' AND s.scope_value = ?)
                OR (s.scope_type = 'system')
            )
            ORDER BY s.created_at DESC
        """, (group_name, str(enrollment_year))).fetchall()
        custom = []
        for r in custom_rows:
            custom.append({
                "id": r["id"],
                "title": r["title"],
                "scope_type": r["scope_type"],
                "scope_value": r["scope_value"],
                "created_by_telegram_id": r["created_by_telegram_id"],
                "ends_at": r["ends_at"],
                "completed_at": r["completed_at"],
                "can_complete": r["created_by_telegram_id"] == telegram_id or role in ("admin", "assistant"),
            })
        conn.close()
        return {"system": system, "custom": custom, "user_gender": gender}
    except Exception as e:
        print(f"[ERROR] Ошибка списка опросов: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")


@app.get("/api/survey/pairs")
async def get_survey_pairs(stage: str = "main"):
    """
    Возвращает пары для попарного голосования.
    stage: 'main' — 4 основных наряда (6 пар), 'canteen' — 14 случайных пар из 11 объектов столовой.
    """
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        if stage == "main":
            rows = conn.execute(
                "SELECT id, name FROM duty_objects WHERE parent_id IS NULL AND name != 'Опрос девушек' ORDER BY id"
            ).fetchall()
        elif stage == "female":
            female_parent = conn.execute(
                "SELECT id FROM duty_objects WHERE name = 'Опрос девушек' AND parent_id IS NULL"
            ).fetchone()
            if not female_parent:
                conn.close()
                return {"pairs": [], "stage": stage}
            rows = conn.execute(
                "SELECT id, name FROM duty_objects WHERE parent_id = ? ORDER BY id",
                (female_parent["id"],)
            ).fetchall()
            objects = [{"id": r["id"], "name": r["name"]} for r in rows]
            pairs = _get_all_pairs(objects)
            conn.close()
            return {"pairs": pairs, "stage": stage}
        else:  # canteen — 6 объектов столовой, все возможные пары без повторений (15 пар)
            CANTEEN_OBJECT_NAMES = [
                "Горячий цех", "Овощной цех", "Стаканы", "Железо", "Лента", "Тарелки"
            ]
            canteen = conn.execute(
                "SELECT id FROM duty_objects WHERE name='Столовая' AND parent_id IS NULL"
            ).fetchone()
            if not canteen:
                conn.close()
                return {"pairs": [], "stage": stage}
            rows = conn.execute(
                "SELECT id, name FROM duty_objects WHERE parent_id = ? ORDER BY id",
                (canteen["id"],)
            ).fetchall()
            by_name = {r["name"]: r for r in rows}
            objects = []
            for display_name in CANTEEN_OBJECT_NAMES:
                r = by_name.get(display_name) or (by_name.get("Мойка-тарелки") if display_name == "Тарелки" else None)
                if r:
                    objects.append({"id": r["id"], "name": display_name})
            seen = set()
            objects = [o for o in objects if o["id"] not in seen and not seen.add(o["id"])]
            pairs = _get_all_pairs(objects)
            random.shuffle(pairs)
            conn.close()
            return {"pairs": pairs, "stage": stage}
        
        objects = [{"id": r["id"], "name": r["name"]} for r in rows]
        pairs = _get_all_pairs(objects)
        random.shuffle(pairs)
        conn.close()
        return {"pairs": pairs, "stage": stage}
    except Exception as e:
        print(f"[ERROR] Ошибка получения пар: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")


@app.post("/api/survey/pair-vote")
async def submit_pair_vote(data: dict):
    """
    Принимает голос попарного сравнения.
    choice: 'a' — первый сложнее (2/0), 'b' — второй сложнее (0/2), 'equal' — одинаково (1/1)
    """
    user_id = data.get('user_id')
    object_a_id = data.get('object_a_id')
    object_b_id = data.get('object_b_id')
    choice = data.get('choice')
    stage = data.get('stage', 'main')
    if stage not in ('main', 'canteen', 'female'):
        stage = 'main'

    if not all([user_id, object_a_id, object_b_id, choice]) or choice not in ('a', 'b', 'equal'):
        raise HTTPException(status_code=400, detail="Неверные данные")

    # Упорядочиваем пару: object_a_id < object_b_id для уникальности
    oa, ob = int(object_a_id), int(object_b_id)
    if oa > ob:
        oa, ob = ob, oa
        choice = 'b' if choice == 'a' else ('a' if choice == 'b' else 'equal')

    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")

    try:
        user = conn.execute("SELECT id FROM users WHERE telegram_id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        db_user_id = user['id']

        conn.execute("""
            INSERT INTO survey_pair_votes (user_id, object_a_id, object_b_id, choice, stage)
            VALUES (?, ?, ?, ?, ?)
        """, (db_user_id, oa, ob, choice, stage))
        conn.commit()

        # Количество уникальных проголосовавших
        voted_count = conn.execute(
            "SELECT COUNT(DISTINCT user_id) as cnt FROM survey_pair_votes"
        ).fetchone()['cnt']

        # При 100 голосах можно автоматически финализировать (вызывать расчёт весов)
        # Пока оставляем ручную финализацию через админа
        conn.close()
        return {"status": "ok", "message": "Голос учтён", "total_voted": voted_count}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Вы уже голосовали за эту пару")
    except Exception as e:
        print(f"[ERROR] Ошибка голосования: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")
    finally:
        if conn:
            conn.close()


@app.get("/api/survey/status")
async def get_survey_status():
    """Возвращает статистику опроса: сколько проголосовало из скольких"""
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        total_users = conn.execute("SELECT COUNT(*) as cnt FROM users WHERE status='активен'").fetchone()['cnt']
        try:
            voted_users = conn.execute(
                "SELECT COUNT(DISTINCT user_id) as cnt FROM survey_pair_votes"
            ).fetchone()['cnt']
        except Exception:
            voted_users = 0
        return {"total": total_users, "voted": voted_users}
    except Exception as e:
        print(f"[ERROR] Ошибка статуса опроса: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")
    finally:
        conn.close()


def _clamp_coef(k: float, max_k: float = 2.0) -> float:
    """Нижнее значение 0.8, верхний — max_k (основные наряды 2.0, столовые 1.5)."""
    return max(0.8, min(max_k, k))


def _calc_weights_from_pair_votes(conn):
    """
    Рассчитывает веса по формуле: S = сумма баллов объекта, avg = среднее, k = S/avg, вес = 10 × k.
    Коэффициент k ограничен: от 0.8 до 2.0.
    Этап 1: основные наряды (4 шт.). Этап 2: объекты столовой (6 шт.).
    """
    # Этап 1: основные наряды
    main_ids = [r['id'] for r in conn.execute(
        "SELECT id FROM duty_objects WHERE parent_id IS NULL ORDER BY id"
    ).fetchall()]

    # Считаем баллы: choice 'a' → object_a +2, object_b +0; 'b' → object_a +0, object_b +2; 'equal' → +1 каждому
    scores = {oid: 0.0 for oid in main_ids}
    votes = conn.execute(
        "SELECT object_a_id, object_b_id, choice FROM survey_pair_votes WHERE stage='main'"
    ).fetchall()
    for v in votes:
        a, b = v['object_a_id'], v['object_b_id']
        if v['choice'] == 'a':
            scores[a] = scores.get(a, 0) + 2
            scores[b] = scores.get(b, 0) + 0
        elif v['choice'] == 'b':
            scores[a] = scores.get(a, 0) + 0
            scores[b] = scores.get(b, 0) + 2
        else:
            scores[a] = scores.get(a, 0) + 1
            scores[b] = scores.get(b, 0) + 1

    if len(main_ids) > 0:
        total = sum(scores.get(i, 0) for i in main_ids)
        avg = total / len(main_ids) if total > 0 else 1
        for oid in main_ids:
            s = scores.get(oid, 0)
            k = (s / avg) if (avg > 0 and s > 0) else 0.8
            k = _clamp_coef(k)
            w = 10 * k
            conn.execute("""
                INSERT INTO object_weights (object_id, weight) VALUES (?, ?)
                ON CONFLICT(object_id) DO UPDATE SET weight=excluded.weight, calculated_at=CURRENT_TIMESTAMP
            """, (oid, w))

    # Этап 2: объекты столовой — веса относительные к весу столовой
    canteen_row = conn.execute(
        "SELECT id FROM duty_objects WHERE name='Столовая' AND parent_id IS NULL"
    ).fetchone()
    if canteen_row:
        canteen_id = canteen_row['id']
        canteen_weight_row = conn.execute(
            "SELECT weight FROM object_weights WHERE object_id = ?", (canteen_id,)
        ).fetchone()
        canteen_weight = canteen_weight_row['weight'] if canteen_weight_row else 10

        sub_ids = [r['id'] for r in conn.execute(
            "SELECT id FROM duty_objects WHERE parent_id = ? ORDER BY id", (canteen_id,)
        ).fetchall()]

        sub_scores = {oid: 0.0 for oid in sub_ids}
        sub_votes = conn.execute(
            "SELECT object_a_id, object_b_id, choice FROM survey_pair_votes WHERE stage='canteen'"
        ).fetchall()
        for v in sub_votes:
            a, b = v['object_a_id'], v['object_b_id']
            if v['choice'] == 'a':
                sub_scores[a] = sub_scores.get(a, 0) + 2
                sub_scores[b] = sub_scores.get(b, 0) + 0
            elif v['choice'] == 'b':
                sub_scores[a] = sub_scores.get(a, 0) + 0
                sub_scores[b] = sub_scores.get(b, 0) + 2
            else:
                sub_scores[a] = sub_scores.get(a, 0) + 1
                sub_scores[b] = sub_scores.get(b, 0) + 1

        if len(sub_ids) > 0:
            sub_total = sum(sub_scores.get(i, 0) for i in sub_ids)
            sub_avg = sub_total / len(sub_ids) if sub_total > 0 else 1
            for oid in sub_ids:
                s = sub_scores.get(oid, 0)
                k_sub = (s / sub_avg) if (sub_avg > 0 and s > 0) else 0.8
                k_sub = _clamp_coef(k_sub, max_k=1.6)
                w_sub = canteen_weight * k_sub
                conn.execute("""
                    INSERT INTO object_weights (object_id, weight) VALUES (?, ?)
                    ON CONFLICT(object_id) DO UPDATE SET weight=excluded.weight, calculated_at=CURRENT_TIMESTAMP
                """, (oid, w_sub))

    # Этап 3: опрос для девушек (ПУТСО, Столовая, Медчасть)
    female_parent = conn.execute(
        "SELECT id FROM duty_objects WHERE name = 'Опрос девушек' AND parent_id IS NULL"
    ).fetchone()
    if female_parent:
        female_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM duty_objects WHERE parent_id = ? ORDER BY id", (female_parent["id"],)
        ).fetchall()]
        if female_ids:
            f_scores = {oid: 0.0 for oid in female_ids}
            f_votes = conn.execute(
                "SELECT object_a_id, object_b_id, choice FROM survey_pair_votes WHERE stage = 'female'"
            ).fetchall()
            for v in f_votes:
                a, b = v["object_a_id"], v["object_b_id"]
                if v["choice"] == "a":
                    f_scores[a] = f_scores.get(a, 0) + 2
                    f_scores[b] = f_scores.get(b, 0) + 0
                elif v["choice"] == "b":
                    f_scores[a] = f_scores.get(a, 0) + 0
                    f_scores[b] = f_scores.get(b, 0) + 2
                else:
                    f_scores[a] = f_scores.get(a, 0) + 1
                    f_scores[b] = f_scores.get(b, 0) + 1
            f_total = sum(f_scores.get(i, 0) for i in female_ids)
            f_avg = f_total / len(female_ids) if f_total > 0 else 1
            for oid in female_ids:
                s = f_scores.get(oid, 0)
                k = (s / f_avg) if (f_avg > 0 and s > 0) else 0.8
                k = _clamp_coef(k, max_k=1.6)
                w = 10 * k
                conn.execute("""
                    INSERT INTO object_weights (object_id, weight) VALUES (?, ?)
                    ON CONFLICT(object_id) DO UPDATE SET weight=excluded.weight, calculated_at=CURRENT_TIMESTAMP
                """, (oid, w))


@app.post("/api/survey/finalize")
async def finalize_survey(data: dict):
    """Завершает опрос и вычисляет веса по формуле k = S/avg, итог = 10 × k"""
    admin_id = data.get('admin_id')
    if not admin_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute("SELECT role FROM users WHERE telegram_id = ?", (admin_id,)).fetchone()
        if not user or user['role'] not in ('admin', 'assistant'):
            raise HTTPException(status_code=403, detail="Недостаточно прав")
    except Exception:
        raise HTTPException(status_code=500, detail="Ошибка проверки прав")
    finally:
        conn.close()

    conn = get_db()
    try:
        voted = conn.execute("SELECT COUNT(DISTINCT user_id) as cnt FROM survey_pair_votes").fetchone()["cnt"]
        _calc_weights_from_pair_votes(conn)
        conn.commit()
        return {"status": "ok", "message": "Веса вычислены и сохранены", "total_voted": voted}
    except Exception as e:
        print(f"[ERROR] Ошибка финализации опроса: {e}")
        raise HTTPException(status_code=500, detail="Ошибка вычисления")
    finally:
        conn.close()


@app.get("/api/survey/pair-stats")
async def get_survey_pair_stats(stage: str = "main"):
    """Для визуализации: по каждой паре — число ответов A сложнее / равно / B сложнее и доли в %."""
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        if stage == "female":
            female_parent = conn.execute(
                "SELECT id FROM duty_objects WHERE name = 'Опрос девушек' AND parent_id IS NULL"
            ).fetchone()
            if not female_parent:
                conn.close()
                return {"pairs": []}
            rows = conn.execute(
                "SELECT id, name FROM duty_objects WHERE parent_id = ? ORDER BY id",
                (female_parent["id"],)
            ).fetchall()
        elif stage == "canteen":
            canteen = conn.execute(
                "SELECT id FROM duty_objects WHERE name = 'Столовая' AND parent_id IS NULL"
            ).fetchone()
            if not canteen:
                conn.close()
                return {"pairs": []}
            rows = conn.execute(
                "SELECT id, name FROM duty_objects WHERE parent_id = ? ORDER BY id",
                (canteen["id"],)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name FROM duty_objects WHERE parent_id IS NULL AND name != 'Опрос девушек' ORDER BY id"
            ).fetchall()
        id2name = {r["id"]: r["name"] for r in rows}
        votes = conn.execute(
            "SELECT object_a_id, object_b_id, choice FROM survey_pair_votes WHERE stage = ?",
            (stage,)
        ).fetchall()
        from collections import defaultdict
        pair_counts = defaultdict(lambda: {"a": 0, "b": 0, "equal": 0})
        for v in votes:
            a, b = v["object_a_id"], v["object_b_id"]
            key = (min(a, b), max(a, b))
            pair_counts[key][v["choice"]] += 1
        pairs = []
        for (oa, ob), counts in pair_counts.items():
            total = counts["a"] + counts["b"] + counts["equal"]
            if total == 0:
                continue
            name_a = id2name.get(oa, "?")
            name_b = id2name.get(ob, "?")
            pairs.append({
                "object_a_name": name_a,
                "object_b_name": name_b,
                "count_a": counts["a"],
                "count_b": counts["b"],
                "count_equal": counts["equal"],
                "total": total,
                "pct_a": round(100 * counts["a"] / total, 1),
                "pct_b": round(100 * counts["b"] / total, 1),
                "pct_equal": round(100 * counts["equal"] / total, 1),
            })
        conn.close()
        return {"pairs": pairs, "stage": stage}
    except Exception as e:
        print(f"[ERROR] pair-stats: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")


@app.get("/api/survey/results")
async def get_survey_results():
    """Возвращает вычисленные веса объектов для отображения"""
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        # Возвращаем все объекты с их весами (если есть)
        # SQLite не поддерживает NULLS FIRST, поэтому сортируем так:
        # сначала объекты без родителя (parent_id IS NULL), потом с родителем
        results = conn.execute("""
            SELECT o.id, o.name, o.parent_id, w.weight
            FROM duty_objects o
            LEFT JOIN object_weights w ON o.id = w.object_id
            ORDER BY o.parent_id IS NULL DESC, o.parent_id, o.name
        """).fetchall()
        return [dict(r) for r in results]
    except Exception as e:
        print(f"[ERROR] Ошибка получения результатов: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")
    finally:
        conn.close()


@app.get("/api/survey/user-results")
async def get_user_survey_results(telegram_id: int):
    """Возвращает результаты опроса для конкретного пользователя (если он прошёл опрос)"""
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        # Проверяем, проходил ли пользователь опрос
        user = conn.execute(
            "SELECT id, gender FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        db_user_id = user["id"]
        user_gender = (user["gender"] or "male").strip().lower()

        # Для девушек — считаем пройденным опрос stage=female; для юношей — main/canteen
        if user_gender == "female":
            voted = conn.execute(
                "SELECT 1 FROM survey_pair_votes WHERE user_id = ? AND stage = 'female' LIMIT 1",
                (db_user_id,)
            ).fetchone() is not None
            female_parent = conn.execute(
                "SELECT id FROM duty_objects WHERE name = 'Опрос девушек' AND parent_id IS NULL"
            ).fetchone()
            if voted and female_parent:
                results = conn.execute("""
                    SELECT o.id, o.name, o.parent_id, w.weight as median_weight
                    FROM duty_objects o
                    LEFT JOIN object_weights w ON o.id = w.object_id
                    WHERE o.parent_id = ?
                    ORDER BY o.name
                """, (female_parent["id"],)).fetchall()
                conn.close()
                return {"voted": True, "results": [dict(r) for r in results], "survey_stage": "female"}
        else:
            voted = conn.execute(
                "SELECT 1 FROM survey_pair_votes WHERE user_id = ? AND stage IN ('main', 'canteen') LIMIT 1",
                (db_user_id,)
            ).fetchone() is not None
        if not voted:
            conn.close()
            return {"voted": False, "message": "Вы ещё не прошли опрос"}

        # Юноши: веса основных нарядов и столовой (исключаем блок «Опрос девушек»)
        female_parent = conn.execute(
            "SELECT id FROM duty_objects WHERE name = 'Опрос девушек' AND parent_id IS NULL"
        ).fetchone()
        female_id = female_parent["id"] if female_parent else -1
        results = conn.execute("""
            SELECT o.id, o.name, o.parent_id, w.weight as median_weight
            FROM duty_objects o
            LEFT JOIN object_weights w ON o.id = w.object_id
            WHERE o.id != ? AND (o.parent_id IS NULL OR o.parent_id != ?)
            ORDER BY (o.parent_id IS NULL) DESC, o.parent_id, o.name
        """, (female_id, female_id)).fetchall()

        return {
            "voted": True,
            "results": [dict(r) for r in results],
            "survey_stage": "main"
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Ошибка получения результатов пользователя: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")
    finally:
        conn.close()


# ============================================
# 5b. ПОЛЬЗОВАТЕЛЬСКИЕ ОПРОСЫ (custom)
# ============================================
@app.post("/api/survey/custom")
async def create_custom_survey(data: dict):
    """Создать опрос: сержант — группа, помощник — курс, админ — группа/курс/системный."""
    telegram_id = data.get("telegram_id")
    title = (data.get("title") or "").strip()
    scope_type = data.get("scope_type")  # 'group' | 'course' | 'system'
    options = data.get("options") or []  # ["Вариант 1", "Вариант 2", ...]
    ends_at = data.get("ends_at")  # optional ISO date/datetime
    if not telegram_id or not title or scope_type not in ("group", "course", "system") or len(options) < 2:
        raise HTTPException(status_code=400, detail="Нужны: telegram_id, title, scope_type (group|course|system), options (минимум 2)")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute(
            "SELECT role, group_name, enrollment_year FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
        if not user or user["role"] not in ("sergeant", "assistant", "admin"):
            raise HTTPException(status_code=403, detail="Только сержант/помощник/админ могут создавать опросы")
        if scope_type == "system" and user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Системный опрос может создать только админ")
        if scope_type == "group" and user["role"] not in ("sergeant", "admin"):
            raise HTTPException(status_code=403, detail="Опрос по группе может создать только сержант или админ")
        scope_value = "system" if scope_type == "system" else (user["group_name"] if scope_type == "group" else str(user["enrollment_year"]))
        cursor = conn.execute(
            "INSERT INTO custom_surveys (title, scope_type, scope_value, created_by_telegram_id, ends_at) VALUES (?, ?, ?, ?, ?)",
            (title, scope_type, scope_value, telegram_id, ends_at or None)
        )
        survey_id = cursor.lastrowid
        for i, text in enumerate(options):
            if (str(text) or "").strip():
                conn.execute(
                    "INSERT INTO custom_survey_options (survey_id, option_text, sort_order) VALUES (?, ?, ?)",
                    (survey_id, str(text).strip(), i)
                )
        conn.commit()
        conn.close()
        return {"status": "ok", "survey_id": survey_id}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Создание опроса: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")


@app.get("/api/survey/custom/{survey_id}")
async def get_custom_survey(survey_id: int, telegram_id: int):
    """Опции опроса, статус завершения, свой голос (если есть)."""
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        s = conn.execute(
            "SELECT id, title, scope_type, scope_value, created_by_telegram_id, ends_at, completed_at FROM custom_surveys WHERE id = ?",
            (survey_id,)
        ).fetchone()
        if not s:
            raise HTTPException(status_code=404, detail="Опрос не найден")
        options = conn.execute(
            "SELECT id, option_text, sort_order FROM custom_survey_options WHERE survey_id = ? ORDER BY sort_order",
            (survey_id,)
        ).fetchall()
        my_vote = conn.execute(
            "SELECT option_id FROM custom_survey_votes WHERE survey_id = ? AND user_telegram_id = ?",
            (survey_id, telegram_id)
        ).fetchone()
        counts = {}
        for opt in options:
            c = conn.execute(
                "SELECT COUNT(*) FROM custom_survey_votes WHERE survey_id = ? AND option_id = ?",
                (survey_id, opt["id"])
            ).fetchone()
            counts[opt["id"]] = c[0]
        user_row = conn.execute("SELECT role FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
        role = user_row["role"] if user_row else "user"
        can_complete = s["completed_at"] is None and (
            s["created_by_telegram_id"] == telegram_id or role in ("admin", "assistant")
        )
        conn.close()
        return {
            "id": s["id"],
            "title": s["title"],
            "completed_at": s["completed_at"],
            "ends_at": s["ends_at"],
            "created_by_telegram_id": s["created_by_telegram_id"],
            "options": [{"id": o["id"], "text": o["option_text"], "votes": counts.get(o["id"], 0)} for o in options],
            "my_option_id": my_vote["option_id"] if my_vote else None,
            "can_complete": can_complete,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Опрос: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")


@app.post("/api/survey/custom/{survey_id}/vote")
async def vote_custom_survey(survey_id: int, data: dict):
    """Проголосовать за один вариант (заменяет предыдущий голос)."""
    telegram_id = data.get("telegram_id")
    option_id = data.get("option_id")
    if not telegram_id or not option_id:
        raise HTTPException(status_code=400, detail="Нужны telegram_id и option_id")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        s = conn.execute("SELECT id, completed_at FROM custom_surveys WHERE id = ?", (survey_id,)).fetchone()
        if not s:
            raise HTTPException(status_code=404, detail="Опрос не найден")
        if s["completed_at"]:
            raise HTTPException(status_code=400, detail="Опрос уже завершён")
        opt = conn.execute("SELECT id FROM custom_survey_options WHERE survey_id = ? AND id = ?", (survey_id, option_id)).fetchone()
        if not opt:
            raise HTTPException(status_code=400, detail="Вариант не найден")
        conn.execute(
            "INSERT OR REPLACE INTO custom_survey_votes (survey_id, user_telegram_id, option_id) VALUES (?, ?, ?)",
            (survey_id, telegram_id, option_id)
        )
        conn.commit()
        conn.close()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Голос: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")


@app.post("/api/survey/custom/{survey_id}/complete")
async def complete_custom_survey(survey_id: int, data: dict):
    """Завершить опрос досрочно (только создатель или админ/помощник)."""
    telegram_id = data.get("telegram_id")
    if not telegram_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        s = conn.execute(
            "SELECT created_by_telegram_id, completed_at FROM custom_surveys WHERE id = ?", (survey_id,)
        ).fetchone()
        if not s:
            raise HTTPException(status_code=404, detail="Опрос не найден")
        if s["completed_at"]:
            conn.close()
            return {"status": "ok", "message": "Уже завершён"}
        user = conn.execute("SELECT role FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
        if not user or (user["role"] not in ("admin", "assistant") and s["created_by_telegram_id"] != telegram_id):
            raise HTTPException(status_code=403, detail="Завершить может только создатель или админ/помощник")
        from datetime import datetime
        conn.execute(
            "UPDATE custom_surveys SET completed_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), survey_id)
        )
        conn.commit()
        conn.close()
        return {"status": "ok"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Завершение опроса: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")


# ============================================
# 6. СТАТИКА И ГЛАВНАЯ (исправлено: не подменяем пути)
# ============================================
@app.get("/app", response_class=HTMLResponse)
async def serve_app():
    file_path = os.path.join("app", "index.html")
    if not os.path.exists(file_path):
        return HTMLResponse("<h1>❌ index.html не найден</h1>", 404)

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    # НИКАКОЙ ПОДМЕНЫ — оставляем пути как в исходном HTML
    return HTMLResponse(content=content)


# ============================================
# 7. ЗАПУСК
# ============================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)