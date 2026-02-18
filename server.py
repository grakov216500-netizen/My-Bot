# server.py — FastAPI сервер для Mini App (финальная версия, с исправлением группы и опросником)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from datetime import datetime
import os
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
    'кпп': 'КПП'
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
async def get_duties(telegram_id: int):
    conn = get_db()
    if not conn:
        return {"error": "База данных не найдена"}

    try:
        # --- Получаем user_id ---
        user = conn.execute(
            "SELECT id FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
    except Exception as e:
        print(f"[ERROR] Ошибка при поиске user_id: {e}")
        return {"error": f"Ошибка БД: {str(e)}"}

    if not user:
        conn.close()
        return {"error": "Пользователь не найден"}

    user_id = user['id']

    try:
        # --- Проверяем структуру таблицы duties ---
        cursor = conn.execute("PRAGMA table_info(duties)")
        columns = [row['name'] for row in cursor.fetchall()]
        print(f"[INFO] Колонки в duties: {columns}")

        # --- Если есть object_type — используем, иначе пустая строка ---
        if 'object_type' in columns:
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
                    "object": row['object_type'] or "—"
                }
                for row in rows
            ]
        else:
            # Если поля object_type нет — только дата и роль
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
                    "object": "—"
                }
                for row in rows
            ]

    except Exception as e:
        print(f"[ERROR] Ошибка при запросе нарядов: {e}")
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
# 5. ОПРОСНИК (SURVEY) API
# ============================================

@app.get("/api/survey/objects")
async def get_survey_objects():
    """Возвращает список объектов для голосования (с иерархией)"""
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        # Получаем все объекты
        cursor = conn.execute("SELECT id, name, parent_id FROM duty_objects ORDER BY parent_id NULLS FIRST, name")
        rows = cursor.fetchall()
        # Преобразуем в список словарей
        objects = []
        for row in rows:
            objects.append({
                "id": row['id'],
                "name": row['name'],
                "parent_id": row['parent_id']
            })
        return objects
    except Exception as e:
        print(f"[ERROR] Ошибка получения объектов: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")
    finally:
        conn.close()


@app.post("/api/survey/vote")
async def submit_vote(data: dict):
    """Принимает голос пользователя за объект"""
    user_id = data.get('user_id')
    object_id = data.get('object_id')
    rating = data.get('rating')

    if not all([user_id, object_id, rating]) or not (1 <= rating <= 5):
        raise HTTPException(status_code=400, detail="Неверные данные")

    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")

    try:
        # Проверяем, что пользователь существует
        user = conn.execute("SELECT id FROM users WHERE telegram_id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        db_user_id = user['id']

        # Вставляем голос (unique constraint предотвратит повтор)
        conn.execute("""
            INSERT INTO survey_responses (user_id, object_id, rating)
            VALUES (?, ?, ?)
        """, (db_user_id, object_id, rating))
        conn.commit()
        return {"status": "ok", "message": "Голос учтён"}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Вы уже голосовали за этот объект")
    except Exception as e:
        print(f"[ERROR] Ошибка голосования: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")
    finally:
        conn.close()


@app.get("/api/survey/status")
async def get_survey_status():
    """Возвращает статистику опроса: сколько проголосовало из скольких"""
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        # Общее количество зарегистрированных пользователей (можно ограничить по курсу, но пока все)
        total_users = conn.execute("SELECT COUNT(*) as cnt FROM users").fetchone()['cnt']
        # Количество проголосовавших (уникальных пользователей)
        voted_users = conn.execute("SELECT COUNT(DISTINCT user_id) as cnt FROM survey_responses").fetchone()['cnt']
        return {"total": total_users, "voted": voted_users}
    except Exception as e:
        print(f"[ERROR] Ошибка статуса опроса: {e}")
        raise HTTPException(status_code=500, detail="Ошибка базы данных")
    finally:
        conn.close()


@app.post("/api/survey/finalize")
async def finalize_survey(data: dict):
    """Завершает опрос и вычисляет веса объектов (медианы)"""
    # Проверка админа (по telegram_id, переданному в data)
    admin_id = data.get('admin_id')
    if not admin_id:
        raise HTTPException(status_code=401, detail="Не авторизован")
    # Проверяем, является ли пользователь админом (по роли)
    conn = get_db()
    if not conn:
        raise HTTPException(status_code=500, detail="База данных не найдена")
    try:
        user = conn.execute("SELECT role FROM users WHERE telegram_id = ?", (admin_id,)).fetchone()
        if not user or user['role'] not in ['admin', 'assistant']:
            raise HTTPException(status_code=403, detail="Недостаточно прав")
    except Exception as e:
        raise HTTPException(status_code=500, detail="Ошибка проверки прав")
    finally:
        conn.close()

    # Получаем все объекты
    conn = get_db()
    try:
        objects = conn.execute("SELECT id FROM duty_objects").fetchall()
        for obj in objects:
            obj_id = obj['id']
            # Получаем все оценки для этого объекта
            ratings = conn.execute("SELECT rating FROM survey_responses WHERE object_id = ?", (obj_id,)).fetchall()
            if ratings:
                rating_values = [r['rating'] for r in ratings]
                median = statistics.median(rating_values)
                # Сохраняем или обновляем вес
                conn.execute("""
                    INSERT INTO object_weights (object_id, weight) VALUES (?, ?)
                    ON CONFLICT(object_id) DO UPDATE SET weight=excluded.weight, calculated_at=CURRENT_TIMESTAMP
                """, (obj_id, median))
            else:
                # Если нет голосов, можно пропустить или установить значение по умолчанию
                pass
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
        results = conn.execute("""
            SELECT o.id, o.name, o.parent_id, w.weight
            FROM duty_objects o
            LEFT JOIN object_weights w ON o.id = w.object_id
            ORDER BY o.parent_id NULLS FIRST, o.name
        """).fetchall()
        return [dict(r) for r in results]
    except Exception as e:
        print(f"[ERROR] Ошибка получения результатов: {e}")
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