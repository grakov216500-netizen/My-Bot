import os
from dotenv import load_dotenv

# Загружаем переменные из .env
load_dotenv()

TOKEN = os.getenv("TOKEN")
ADMIN_ID = int(os.getenv("ADMIN_ID")) if os.getenv("ADMIN_ID") else 1027070834
UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", "uploads")
DATABASE = os.getenv("DATABASE", "bot.db")

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Для проверки (можно убрать позже)
if not TOKEN:
    raise ValueError("❌ В .env не задан TOKEN")