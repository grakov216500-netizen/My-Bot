# server.py — FastAPI сервер для Mini App (финальная версия)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import json
import os
from datetime import datetime
from database import get_db

app = FastAPI()

# === Настройки CORS ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Пути ===
DATA_DIR = "data"
SCHEDULES_FILE = os.path.join(DATA_DIR, "schedules.json")
os.makedirs(DATA_DIR, exist_ok=True)

# === Словарь для расшифровки ролей ===
ROLE_NAMES = {
    'к': 'Комендантский',
    'дк': 'Дежурный по каморке',
    'с': 'Столовая',
    'дс': 'Дежурный по столовой',
    'ад': 'Административный',
    'п': 'Патруль'
}

def load_all_schedules():
    """Загружает schedules.json"""
    if not os.path.exists(SCHEDULES_FILE):
        return {}
    try:
        with open(SCHEDULES_FILE, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if not content:
                return {}
            data = json.loads(content)
        return data if isinstance(data, dict) else {}
    except Exception as e:
        print(f"❌ Ошибка чтения schedules.json: {e}")
        return {}

def get_full_role(role: str) -> str:
    """Возвращает полное название роли"""
    return ROLE_NAMES.get(role.lower(), role.title())

# === API: Получить профиль пользователя ===
@app.get("/api/user")
async def get_user(telegram_id: int):
    conn = get_db()
    cursor = conn.cursor()
    # 🔧 Исправлено: запрашиваем enrollment_year вместо course
    cursor.execute(
        "SELECT fio, enrollment_year, group_name FROM users WHERE telegram_id = ?", 
        (telegram_id,)
    )
    row = cursor.fetchone()
    conn.close()

    if not row:
        return {"error": "Пользователь не найден"}

    # 🔢 Рассчитываем курс динамически
    try:
        from utils.course_calculator import get_current_course
        current_course = get_current_course(row['enrollment_year'])
    except ImportError:
        # На случай, если папка utils не найдена
        current_year = datetime.now().year
        current_course = max(1, min(6, current_year - row['enrollment_year'] + 1))

    return {
        "fio": row['fio'],
        "course": str(current_course),
        "group": row['group_name']
    }

# === API: Получить наряды пользователя ===
@app.get("/api/duties")
async def get_duties(telegram_id: int):
    schedules = load_all_schedules()
    if not schedules:
        return {"error": "График ещё не загружен"}

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT fio FROM users WHERE telegram_id = ?", (telegram_id,))
    user = cursor.fetchone()
    conn.close()

    if not user:
        return {"error": "Пользователь не найден"}

    fio = user['fio']

    all_duties = []
    for month, groups in schedules.items():
        for group_name, duties in groups.items():
            if isinstance(duties, list):
                for duty in duties:
                    if duty.get('fio') == fio:
                        all_duties.append({
                            "date": duty['date'],
                            "role": duty['role'],
                            "role_full": get_full_role(duty['role']),
                            "group": group_name
                        })

    all_duties.sort(key=lambda x: x['date'])
    today = datetime.now().strftime("%Y-%m-%d")
    upcoming = [d for d in all_duties if d['date'] >= today]
    next_duty = upcoming[0] if upcoming else None

    return {
        "duties": all_duties,
        "next_duty": next_duty,
        "total": len(all_duties)
    }

# === API: Получить всё расписание ===
@app.get("/api/schedule/all")
async def get_full_schedule(month: str = None):
    schedules = load_all_schedules()
    if not schedules:
        return {"error": "Нет данных"}

    target_month = month or sorted(schedules.keys(), reverse=True)[0]
    return schedules.get(target_month, {})

# === Монтируем статику: /static/style.css → работает ===
app.mount("/static", StaticFiles(directory="app"), name="static")

# === Главная страница Mini App ===
@app.get("/app", response_class=HTMLResponse)
async def serve_app():
    file_path = os.path.join("app", "index.html")
    if not os.path.exists(file_path):
        return HTMLResponse(content="<h1>❌ index.html не найден</h1>", status_code=404)
    
    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # 🔧 Надёжная замена путей к CSS/JS
    content = content.replace('href="style.css"', 'href="/static/style.css"')
    content = content.replace("href='style.css'", "href='/static/style.css'")
    content = content.replace('src="script.js"', 'src="/static/script.js"')
    content = content.replace("src='script.js'", "src='/static/script.js'")

    return HTMLResponse(content=content)
