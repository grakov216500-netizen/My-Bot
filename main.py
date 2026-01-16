# main.py — финальная версия (2025), всё работает + гарантированное восстановление

import logging
import os
import sys
from datetime import datetime
from typing import Dict, Any

# Проверка импортов
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
    print("✅ Все импорты из telegram.ext успешны")
except ImportError as e:
    print(f"❌ Ошибка импорта: {e}")
    print("Установите: pip install python-telegram-bot --upgrade")
    sys.exit(1)

from dotenv import load_dotenv
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

# === Загрузка .env ===
load_dotenv()

# === Настройка логирования ===
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# === Переменные из .env ===
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

    # База данных
    try:
        from database import check_and_update_courses, init_db, get_db
        logger.info("✅ database загружен")
    except Exception as e:
        logger.critical(f"❌ Ошибка загрузки database: {e}")
        sys.exit(1)

    # Напоминания
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

    # Обработчики
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

# Загружаем модули
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
    """Загружает всех пользователей с role в bot_data['editors']"""
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

    # --- Инициализация БД ---
    try:
        init_db()
        logger.info("✅ БД инициализирована")
    except Exception as e:
        logger.critical(f"❌ Ошибка инициализации БД: {e}", exc_info=True)
        return

    # --- Автообновление курсов ---
    try:
        updated = check_and_update_courses()
        logger.info(f"🔄 Автообновление курсов: {updated} пользователей")
    except Exception as e:
        logger.error(f"⚠️ Ошибка автообновления курсов: {e}", exc_info=True)

    # --- Планировщик ---
    try:
        scheduler = AsyncIOScheduler()
        scheduler.add_job(
            check_and_update_courses,
            CronTrigger(hour=0, minute=1),
            id="daily_course_check"
        )
        scheduler.start()
        logger.info("⏰ Планировщик: проверка курсов запущена")
    except Exception as e:
        logger.error(f"❌ Ошибка запуска планировщика: {e}", exc_info=True)

    # --- Напоминания о задачах ---
    try:
        application.job_queue.run_repeating(
            check_task_reminders,
            interval=30,
            first=5
        )
        logger.info("⏰ Напоминания о задачах: добавлены")
    except Exception as e:
        logger.error(f"❌ Ошибка добавления напоминаний о задачах: {e}", exc_info=True)

    # --- Загрузка графиков ---
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

    # --- Восстановление напоминаний о нарядах ---
    try:
        context = application.context_types.context(application)
        await restore_duty_reminders(context)
        logger.info("✅ Напоминания о нарядах восстановлены")
    except Exception as e:
        logger.error(f"❌ Ошибка восстановления напоминаний: {e}", exc_info=True)

    # --- Загрузка редакторов ---
    try:
        load_editors_from_db(application)
    except Exception as e:
        logger.error(f"❌ Ошибка загрузки редакторов: {e}", exc_info=True)

    # 🔥 ГАРАНТИРОВАННОЕ СОХРАНЕНИЕ bot_data.pkl
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

# === Запуск бота ===
def main():
    try:
        logger.info("🚀 Начало запуска бота...")
        logger.info(f"📁 Рабочая директория: {os.getcwd()}")

        # Удалить bot_data.pkl (для чистого старта — раскомментировать)
        # if os.path.exists("bot_data.pkl"):
        #     os.remove("bot_data.pkl")
        #     logger.info("🗑 bot_data.pkl удалён")

        persistence = PicklePersistence(filepath="bot_data.pkl")

        app = ApplicationBuilder() \
            .token(TOKEN) \
            .persistence(persistence) \
            .post_init(post_init) \
            .build()

        # --- Регистрация обработчиков ---
        logger.info("📝 Регистрация обработчиков...")

        app.add_handler(CommandHandler("start", start))

        # Основные роутеры
        for handler in menu_router:
            app.add_handler(handler)
        app.add_handler(back_router)

        for handler in my_duties_router:
            app.add_handler(handler)

        for handler in tasks_router:
            app.add_handler(handler)

        if excel_router:
            app.add_handler(excel_router)

        if get_registration_handler:
            app.add_handler(get_registration_handler())

        for handler in profile_router:
            app.add_handler(handler)
        if 'get_profile_edit_handler' in globals() and get_profile_edit_handler:
            app.add_handler(get_profile_edit_handler())

        for handler in admin_router:
            app.add_handler(handler)

        for handler in assistant_router:
            app.add_handler(handler)

        app.add_handler(edit_schedule_handler)

        # Текстовые сообщения
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))

        app.add_error_handler(error_handler)

        logger.info("✅ Все обработчики зарегистрированы")

        # === Запуск ===
        logger.info("🚀 Бот запущен. Ожидание обновлений...")
        app.run_polling(
            allowed_updates=Update.ALL_TYPES,
            drop_pending_updates=True
        )

    except Exception as e:
        logger.critical(f"❌ Критическая ошибка: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
