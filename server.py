# server.py — FastAPI сервер для Mini App (финальная версия, с исправлением группы и опросником)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from datetime import datetime
import os
import random
import sqlite3
import statistics  # для расчёта медианы

# Импортируем функцию расчёта курса
from utils.course_calculator import get_current_course

app = FastAPI()

# === CORS (временно разрешено всё) ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
    'к': 'Комендантский',
    'дк': 'Дежурный по каморке',
    'с': 'Столовая',
    'дс': 'Дежурный по столовой',
    'ад': 'Административный',
    'п': 'Патруль',
    'ж': 'Железо',
    'т': 'Тарелки',
    'кпп': 'КПП',
    'гбр': 'ГБР (Группа быстрого реагирования)',
    'зуб': 'Зуб'
}

def get_full_role(role_code: str) -> str:
    return ROLE_NAMES.get(role_code.lower(), role_code.upper())

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

        # --- Формируем запрос динамически ---
        select_parts = [f"{name_col} as full_name", "enrollment_year"]
        if group_col:
            select_parts.append(f"{group_col} as group_name")
        else:
            select_parts.append("'' as group_name")

        query = f"SELECT {', '.join(select_parts)} FROM users WHERE telegram_id = ?"
        row = conn.execute(query, (telegram_id,)).fetchone()

        if not row:
            return {"error": "Пользователь не найден"}

        # КОПИРУЕМ ДАННЫЕ В ОБЫЧНЫЙ СЛОВАРЬ (это важно!)
        user_data = dict(row)
        print(f"[DEBUG] Данные из БД для {telegram_id}: {user_data}")

    except Exception as e:
        print(f"[ERROR] Ошибка запроса пользователя: {e}")
        return {"error": f"Ошибка БД: {str(e)}"}
    finally:
        conn.close()  # соединение закрыто, но данные уже скопированы

    # --- Расчёт курса с помощью course_calculator ---
    try:
        enrollment = int(user_data['enrollment_year'])
        course = get_current_course(enrollment)
    except Exception as e:
        print(f"[ERROR] Ошибка расчёта курса: {e}")
        course = 1

    return {
        "full_name": user_data['full_name'],
        "course": str(course),
        "group": user_data.get('group_name', '')
    }

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
    user_fio = user['fio']

    try:
        # Проверяем, какая таблица используется
        # Сначала пробуем duty_schedule (новая структура)
        try:
            cursor = conn.execute("PRAGMA table_info(duty_schedule)")
            schedule_columns = [row['name'] for row in cursor.fetchall()]
            if schedule_columns:
                # Используем duty_schedule
                if month and year:
                    # Фильтр по месяцу
                    month_start = f"{year}-{month:02d}-01"
                    if month == 12:
                        month_end = f"{year + 1}-01-01"
                    else:
                        month_end = f"{year}-{int(month) + 1:02d}-01"
                    
                    query = """
                        SELECT date, role, group_name, enrollment_year
                        FROM duty_schedule
                        WHERE fio = ? AND date >= ? AND date < ?
                        ORDER BY date
                    """
                    rows = conn.execute(query, (user_fio, month_start, month_end)).fetchall()
                else:
                    query = """
                        SELECT date, role, group_name, enrollment_year
                        FROM duty_schedule
                        WHERE fio = ?
                        ORDER BY date
                    """
                    rows = conn.execute(query, (user_fio,)).fetchall()
                
                duties_list = []
                for row in rows:
                    # Получаем участников наряда на эту дату
                    partners_query = """
                        SELECT fio, group_name
                        FROM duty_schedule
                        WHERE date = ? AND role = ? AND enrollment_year = ?
                        ORDER BY group_name, fio
                    """
                    partners = conn.execute(partners_query, (row['date'], row['role'], row['enrollment_year'])).fetchall()
                    
                    duties_list.append({
                        "date": row['date'],
                        "role": row['role'],
                        "role_full": get_full_role(row['role']),
                        "group": row['group_name'],
                        "partners": [{"fio": p['fio'], "group": p['group_name']} for p in partners]
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
async def get_duties_by_date(date: str):
    """
    Возвращает всех участников наряда на конкретную дату из всех групп.
    Формат date: YYYY-MM-DD
    """
    conn = get_db()
    if not conn:
        return {"error": "База данных не найдена"}
    
    try:
        # Пробуем duty_schedule
        try:
            query = """
                SELECT fio, role, group_name, enrollment_year, gender
                FROM duty_schedule
                WHERE date = ?
                ORDER BY role, group_name, fio
            """
            rows = conn.execute(query, (date,)).fetchall()
            
            # Группируем по ролям
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
            
            conn.close()
            return {
                "date": date,
                "by_role": by_role,
                "total": len(rows)
            }
        except Exception as e:
            print(f"[WARNING] duty_schedule не доступна: {e}")
            return {"error": "Таблица duty_schedule не найдена"}
    except Exception as e:
        print(f"[ERROR] Ошибка при запросе нарядов по дате: {e}")
        return {"error": f"Ошибка БД: {str(e)}"}
    finally:
        if conn:
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
                "SELECT id, name FROM duty_objects WHERE parent_id IS NULL ORDER BY id"
            ).fetchall()
        else:  # canteen
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
        
        objects = [{"id": r["id"], "name": r["name"]} for r in rows]
        pairs = _get_all_pairs(objects)
        if stage == "canteen" and len(pairs) > 14:
            pairs = random.sample(pairs, 14)
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


def _calc_weights_from_pair_votes(conn):
    """
    Рассчитывает веса по формуле: S = сумма баллов объекта, avg = среднее, k = S/avg, вес = 10 × k.
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
            k = s / avg if avg > 0 else 1
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
                k_sub = s / sub_avg if sub_avg > 0 else 1
                w_sub = canteen_weight * k_sub
                conn.execute("""
                    INSERT INTO object_weights (object_id, weight) VALUES (?, ?)
                    ON CONFLICT(object_id) DO UPDATE SET weight=excluded.weight, calculated_at=CURRENT_TIMESTAMP
                """, (oid, w_sub))


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
        _calc_weights_from_pair_votes(conn)
        conn.commit()
        return {"status": "ok", "message": "Веса вычислены и сохранены"}
    except Exception as e:
        print(f"[ERROR] Ошибка финализации опроса: {e}")
        raise HTTPException(status_code=500, detail="Ошибка вычисления")
    finally:
        conn.close()


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
        user = conn.execute("SELECT id FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        db_user_id = user['id']
        
        # Проверяем попарное голосование
        try:
            voted = conn.execute(
                "SELECT 1 FROM survey_pair_votes WHERE user_id = ? LIMIT 1",
                (db_user_id,)
            ).fetchone() is not None
        except Exception:
            voted = False

        if not voted:
            return {"voted": False, "message": "Вы ещё не прошли опрос"}

        # Веса объектов (рассчитанные по формуле k = S/avg)
        results = conn.execute("""
            SELECT o.id, o.name, o.parent_id, w.weight as median_weight
            FROM duty_objects o
            LEFT JOIN object_weights w ON o.id = w.object_id
            ORDER BY (o.parent_id IS NULL) DESC, o.parent_id, o.name
        """).fetchall()

        return {
            "voted": True,
            "results": [dict(r) for r in results]
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Ошибка получения результатов пользователя: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")
    finally:
        conn.close()


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