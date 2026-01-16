import os
from dotenv import load_dotenv

# Печатаем текущую папку
print("🔧 Текущая папка:", os.getcwd())

# Печатаем файлы
print("📂 Файлы:", os.listdir('.'))

# Проверим, есть ли .env
if '.env' in os.listdir('.'):
    print("✅ .env НАЙДЕН")
    
    # Пробуем загрузить
    load_dotenv()
    
    token = os.getenv("TOKEN")
    admin_id = os.getenv("ADMIN_ID")
    
    print(f"🔑 TOKEN: {token}")
    print(f"🎯 ADMIN_ID: {admin_id}")
    
    if token and admin_id:
        print("🟢 УСПЕХ: переменные загружены")
    else:
        print("🔴 ОШИБКА: переменные пустые — проверьте .env")
else:
    print("❌ .env НЕ НАЙДЕН — положите его в эту папку")