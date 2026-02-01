# server.py — FastAPI сервер для Mini App

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import json
import os
from datetime import datetime

app = FastAPI()

# === Добавляем CORS для безопасности и доступа из Mini App ===
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Telegram Mini Apps не имеют фиксированного origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Настройки путей ===
DATA_DIR = "data"
SCHEDULES_FILE = os.path.join(DATA_DIR, "schedules.json")

os.makedirs(DATA_DIR, exist_ok=True)


def load_all_schedules():
    """Загружает все графики из schedules.json"""
    if not os.path.exists(SCHEDULES_FILE):
        return {}
    try:
        with open(SCHEDULES_FILE, "r", encoding="utf-8") as f:
            content = f.read().strip()
            if not content:
                return {}
            data = json.loads(content)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError as e:
        print(f"❌ Ошибка парсинга JSON в schedules.json: {e}")
        return {}
    except Exception as e:
        print(f"❌ Ошибка чтения schedules.json: {e}")
        return {}


@app.get("/schedule")
async def get_schedule(user_id: str):
    """
    Возвращает график дежурств для курсанта по user_id
    
    Пример: /schedule?user_id=123456789
    """
    schedules = load_all_schedules()
    user_schedule = []

    # Проходим по всем месяцам и записям
    for month, duties in schedules.items():
        if not isinstance(duties, list):
            continue
        for duty in duties:
            if isinstance(duty, dict) and str(duty.get('user_id')) == str(user_id):
                user_schedule.append({
                    "date": duty["date"],
                    "role": duty.get("role", "").strip(),
                    "group_name": duty.get("group_name", "").strip(),
                    "isPast": datetime.now().strftime("%Y-%m-%d") > duty["date"]
                })

    # Сортируем по дате
    user_schedule.sort(key=lambda x: x["date"])

    return {"schedule": user_schedule}
