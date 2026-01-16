# main.py — финальная версия: работает и локально, и на Replit

import logging
import os
import sys
from datetime import datetime
from typing import Dict, Any

# === Импорты (все вместе, включая AsyncIOScheduler) ===
try:
    from telegram import Update
    from telegram.ext import (
        ApplicationBuilder,
        CommandHandler,
        CallbackQueryHandler,
        MessageHandler,
        filters,
        ContextTypes,
        PicklePersistence,
    )
    from apscheduler.schedulers.asyncio import AsyncIOScheduler  # ✅ Добавлено
    from apscheduler.triggers.cron import CronTrigger
    print("✅ Все импорты из telegram.ext и apscheduler успешны")
except ImportError as e:
    print(f"❌ Ошибка импорта: {e}")
    print("Установите: pip install python-telegram-bot python-dotenv apscheduler pandas openpyxl")
    sys.exit(1)

# === Попробуем использовать .env (только локально) ===
try:
    from dotenv import load_dotenv
    load_dotenv()  # Только если установлен python-dotenv
    print("📁 .env загружен (локальный режим)")
except ImportError:
    print("📁 .env не найден — работает в облаке (Replit)")

# === Настройка логирования ===
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# === Определяем, где запущен: локально или в облаке ===
IS_REPLIT = "REPL_SLUG" in os.environ  # Replit устанавливает эту переменную
IS_LOCAL = not IS_REPLIT

# === Загружаем переменные: в зависимости от среды ===
TOKEN = os.getenv("TOKEN")
ADMIN_ID_STR = os.getenv("ADMIN_ID", "1027070834")

try:
    ADMIN_ID = int(ADMIN_ID_STR)
except ValueError:
    logger.critical(f"❌ Неверный формат ADMIN_ID: {ADMIN_ID_STR}")
    sys.exit(1)

UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", "uploads")
DATABASE = os.getenv("DATABASE", "bot.db")

# Исправление опечатки
if DATABASE == "bot.dbP":
    DATABASE = "bot.db"

# Создаём папки
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs("utils", exist_ok=True)
os.makedirs("handlers", exist_ok=True)

# === Отложенные импорты ===
def import_modules():
    global check_and_update_courses, init_db, get_db
    global check_task_reminders, restore_duty_reminders
    global start_command, get_registration_handler
    global menu_router, back_router, my_duties_router
    global excel_router, tasks_router, profile_router, get_profile_edit_handler
    global admin_router, assistant_router, edit_schedule_handler
    global load_all_schedules

    try:
        from database import check_and_update_courses, init_db, get_db
        logger.info("✅ database загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки database: {e}")
        sys.exit(1)

    try:
        from handlers.task_reminders import check_task_reminders
        logger.info("✅ task_reminders загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки task_reminders: {e}")
        sys.exit(1)

    try:
        from handlers.reminders import restore_duty_reminders
        logger.info("✅ reminders загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки reminders: {e}")
        sys.exit(1)

    try:
        from handlers.menu import start_command, router as menu_router, back_router
        logger.info("✅ menu загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки menu: {e}")
        sys.exit(1)

    try:
        from handlers.my_duties import my_duties_router
        logger.info("✅ my_duties загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки my_duties: {e}")
        sys.exit(1)

    try:
        from handlers.excel import excel_router
        logger.info("✅ excel загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки excel: {e}")
        sys.exit(1)

    try:
        from handlers.tasks import router as tasks_router
        logger.info("✅ tasks загружен")
    except Exception as e:
        logger.warning(f"⚠️ Модуль tasks не загружен: {e}")
        tasks_router = []

    try:
        from handlers.registration import get_registration_handler
        logger.info("✅ registration загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки registration: {e}")
        get_registration_handler = None

    try:
        from handlers.profile import profile_router, get_profile_edit_handler
        logger.info("✅ profile загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки profile: {e}")
        sys.exit(1)

    try:
        from handlers.admin import admin_router
        logger.info("✅ admin загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки admin: {e}")
        sys.exit(1)

    try:
        from handlers.assistant import assistant_router
        logger.info("✅ assistant загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки assistant: {e}")
        sys.exit(1)

    try:
        from handlers.edit_schedule import edit_schedule_handler
        logger.info("✅ edit_schedule загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки edit_schedule: {e}")
        sys.exit(1)

    try:
        from utils.storage import load_all_schedules
        logger.info("✅ utils.storage загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки utils.storage: {e}")
        sys.exit(1)

import_modules()

# === Команда /start ===
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        await start_command(update, context)
    except Exception as e:
        logger.error(f"❌ Ошибка в /start: {e}")
        try:
            await update.message.reply_text("Бот запущен. Используйте /menu для главного меню.")
        except:
            pass

# === Единый обработчик текста ===
async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_data = context.user_data

    try:
        if user_data.get('awaiting_duty_date'):
            from handlers.my_duties import handle_duty_date_input
            return await handle_duty_date_input(update, context)

        if user_data.get('awaiting_global_duty_date'):
            from handlers.my_duties import handle_global_duty_date_input
            return await handle_global_duty_date_input(update, context)

        if user_data.get('awaiting_task_text'):
            from handlers.tasks import task_enter_text
            return await task_enter_text(update, context)

        if user_data.get('awaiting_reminder_date'):
            from handlers.tasks import task_enter_reminder_date
            return await task_enter_reminder_date(update, context)

        if user_data.get('awaiting_edit_reminder'):
            from handlers.tasks import task_enter_edit_reminder
            return await task_enter_edit_reminder(update, context)

        logger.info(f"💬 Пользователь {update.effective_user.id} написал: '{update.message.text}' — не обрабатывается")

    except Exception as e:
        logger.error(f"❌ Ошибка в handle_text: {e}", exc_info=True)

# === Загрузка editors из БД ===
def load_editors_from_db(application):
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT telegram_id, role, group_name 
            FROM users 
            WHERE role IN ('admin', 'assistant', 'sergeant', 'female_editor')
        """)
        rows = cursor.fetchall()
        conn.close()

        editors = {}
        for row in rows:
            user_id = row['telegram_id']
            editors[user_id] = {
                'role': row['role'],
                'group': row['group_name']
            }

        # Гарантируем, что ADMIN_ID — админ
        editors[ADMIN_ID] = {'role': 'admin', 'group': 'Администратор'}
        application.bot_data['editors'] = editors
        logger.info(f"🟢 Загружено {len(editors)} редакторов")
    except Exception as e:
        logger.error(f"❌ Ошибка загрузки editors: {e}", exc_info=True)

# === post_init — инициализация при старте ===
async def post_init(application):
    logger.info("🔄 Начало инициализации post_init...")

    try:
        init_db()
        logger.info("✅ БД инициализирована")
    except Exception as e:
        logger.critical(f"❌ Ошибка инициализации БД: {e}", exc_info=True)
        return

    try:
        updated = check_and_update_courses()
        logger.info(f"🔄 Автообновление курсов: {updated} пользователей")
    except Exception as e:
        logger.error(f"⚠️ Ошибка автообновления курсов: {e}", exc_info=True)

    try:
        scheduler = AsyncIOScheduler()
        scheduler.add_job(check_and_update_courses, CronTrigger(hour=0, minute=1), id="daily_course_check")
        scheduler.start()
        logger.info("⏰ Планировщик: проверка курсов запущена")
    except Exception as e:
        logger.error(f"❌ Ошибка запуска планировщика: {e}", exc_info=True)

    try:
        application.job_queue.run_repeating(check_task_reminders, interval=30, first=5)
        logger.info("⏰ Напоминания о задачах: добавлены")
    except Exception as e:
        logger.error(f"❌ Ошибка добавления напоминаний о задачах: {e}", exc_info=True)

    try:
        schedules = load_all_schedules()
        if schedules:
            application.bot_data['schedules'] = schedules
            sorted_months = sorted(schedules.keys(), reverse=True)
            latest_month = sorted_months[0]
            application.bot_data['current_schedule'] = latest_month
            application.bot_data['duty_schedule'] = schedules[latest_month]
            logger.info(f"📅 Загружено {len(schedules)} расписаний. Активно: {latest_month}")
        else:
            application.bot_data['schedules'] = {}
            application.bot_data['duty_schedule'] = []
            application.bot_data['current_schedule'] = None
            logger.info("⚠️ Нет сохранённых графиков")
    except Exception as e:
        logger.error(f"❌ Ошибка загрузки графиков: {e}", exc_info=True)

    try:
        context = application.context_types.context(application)
        await restore_duty_reminders(context)
        logger.info("✅ Напоминания о нарядах восстановлены")
    except Exception as e:
        logger.error(f"❌ Ошибка восстановления напоминаний: {e}", exc_info=True)

    try:
        load_editors_from_db(application)
    except Exception as e:
        logger.error(f"❌ Ошибка загрузки редакторов: {e}", exc_info=True)

    try:
        application.bot_data.setdefault('persistence_init', True)
        application.bot_data.setdefault('boot_time', datetime.now().isoformat())
        await application.persistence.flush()
        logger.info("💾 bot_data.pkl УСПЕШНО СОЗДАН И СОХРАНЁН!")
    except Exception as e:
        logger.critical(f"❌ КРИТИЧЕСКАЯ ОШИБКА: не удалось сохранить bot_data.pkl: {e}")
        logger.error(f"📁 Путь: {os.path.abspath('bot_data.pkl')}")

    logger.info("✅ post_init завершён")

# === Обработчик ошибок ===
async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    logger.error("❗ Произошла ошибка", exc_info=context.error)

# === Веб-сервер только для Replit ===
if IS_REPLIT:
    try:
        from flask import Flask
        from threading import Thread

        app = Flask('')

        @app.route('/')
        def home():
            return '''
            <h1>✅ Бот работает!</h1>
            <p><strong>Course Duty Bot</strong> запущен 24/7</p>
            <p>Режим: <strong>Replit</strong></p>
            '''

        def run():
            app.run(host='0.0.0.0', port=8080)

        Thread(target=run, daemon=True).start()
        logger.info("🌐 Веб-сервер запущен (Replit)")
    except ImportError:
        logger.warning("⚠️ Flask не установлен — веб-сервер не запущен")

# === Запуск бота ===
def main():
    try:
        logger.info("🚀 Начало запуска бота...")
        logger.info(f"📁 Рабочая директория: {os.getcwd()}")
        logger.info(f"☁️ Режим: {'Replit' if IS_REPLIT else 'Локальный'}")

        persistence = PicklePersistence(filepath="bot_data.pkl")

        application = ApplicationBuilder() \
            .token(TOKEN) \
            .persistence(persistence) \
            .post_init(post_init) \
            .build()

        # === 🔥 РЕГИСТРАЦИЯ — В НАЧАЛЕ, ПЕРЕД ОБЩИМИ ОБРАБОТЧИКАМИ ===
        application.add_handler(CommandHandler("start", start))

        if get_registration_handler:
            application.add_handler(get_registration_handler())  # ✅ Раньше всех

        # === Другие ConversationHandler ===
        application.add_handler(edit_schedule_handler)
        application.add_handler(back_router)

        # === Остальные роутеры ===
        for handler in menu_router:
            application.add_handler(handler)

        for handler in my_duties_router:
            application.add_handler(handler)

        for handler in tasks_router:
            application.add_handler(handler)

        if excel_router:
            application.add_handler(excel_router)

        for handler in profile_router:
            application.add_handler(handler)

        if 'get_profile_edit_handler' in globals() and get_profile_edit_handler:
            application.add_handler(get_profile_edit_handler())

        for handler in admin_router:
            application.add_handler(handler)

        for handler in assistant_router:
            application.add_handler(handler)

        # === В КОНЦЕ — общий текст ===
        application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

        application.add_error_handler(error_handler)

        logger.info("✅ Все обработчики зарегистрированы")
        logger.info("🚀 Бот запущен. Ожидание обновлений...")
        application.run_polling(allowed_updates=Update.ALL_TYPES, drop_pending_updates=True)

    except Exception as e:
        logger.critical(f"❌ Критическая ошибка: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
