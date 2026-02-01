# handlers/reminders.py — напоминания о нарядах (финальная, стабильная версия)

from telegram.ext import ContextTypes
from datetime import datetime, timedelta
from database import get_db
import logging

logger = logging.getLogger(__name__)

# === СОЗДАНИЕ НАПОМИНАНИЙ ДЛЯ НАРЯДОВ ===
async def create_duty_reminders(context: ContextTypes.DEFAULT_TYPE, schedule_data: list):
    """
    Создаёт напоминания о нарядах:
    - За 2 дня до наряда в 20:00
    - В день наряда в 06:00
    """
    if not schedule_data:
        logger.info("📅 Нет данных для напоминаний — график пуст")
        return

    job_queue = context.application.job_queue
    bot_data = context.application.bot_data

    # Удаляем старые напоминания
    if 'reminder_jobs' in bot_data:
        for job in bot_data['reminder_jobs']:
            job.schedule_removal()
        logger.info(f"🗑 Удалено {len(bot_data['reminder_jobs'])} старых напоминаний")

    new_jobs = []
    today = datetime.now().date()

    for duty in schedule_data:
        try:
            fio = duty.get('fio')
            duty_date_str = duty.get('date')
            role = duty.get('role', '').strip().upper()

            if not fio or not duty_date_str:
                logger.warning(f"⚠️ Пропущена запись: нет ФИО или даты — {duty}")
                continue

            try:
                duty_date = datetime.strptime(duty_date_str, '%Y-%m-%d').date()
            except ValueError as e:
                logger.error(f"❌ Неверный формат даты в наряде {duty}: {e}")
                continue

            # Ищем chat_id
            chat_id = find_chat_id_by_fio(fio)
            if not chat_id:
                logger.warning(f"❌ Не найден chat_id для: {fio}")
                continue

            # 1. Напоминание за 2 дня, 20:00
            reminder_2days = duty_date - timedelta(days=2)
            if reminder_2days >= today:
                remind_time = datetime.combine(
                    reminder_2days,
                    datetime.strptime("20:00", "%H:%M").time()
                )
                job = job_queue.run_once(
                    send_duty_reminder,
                    when=remind_time,
                    data={
                        'chat_id': chat_id,
                        'message': f"⏰ Через 2 дня ({duty_date.strftime('%d.%m.%Y')}) вы в наряде — {role}"
                    },
                    name=f"remind_2days_{fio}_{duty_date}"
                )
                new_jobs.append(job)
                logger.info(f"✅ Напоминание за 2 дня: {fio} → {remind_time}")

            # 2. Напоминание в день наряда, 06:00
            if duty_date >= today:
                remind_time = datetime.combine(
                    duty_date,
                    datetime.strptime("06:00", "%H:%M").time()
                )
                job = job_queue.run_once(
                    send_duty_reminder,
                    when=remind_time,
                    data={
                        'chat_id': chat_id,
                        'message': f"⏰ Сегодня ({duty_date.strftime('%d.%m.%Y')}) вы в наряде — {role}"
                    },
                    name=f"remind_day_{fio}_{duty_date}"
                )
                new_jobs.append(job)
                logger.info(f"✅ Напоминание в день: {fio} → {remind_time}")

        except Exception as e:
            logger.error(f"❌ Ошибка при обработке наряда {duty}: {e}", exc_info=True)

    # Сохраняем новые задачи
    bot_data['reminder_jobs'] = new_jobs
    logger.info(f"📅 Восстановлено {len(new_jobs)} напоминаний о нарядах")


# === ОТПРАВКА НАПОМИНАНИЯ ===
async def send_duty_reminder(context: ContextTypes.DEFAULT_TYPE):
    """Отправляет напоминание пользователю"""
    job_data = context.job.data
    chat_id = job_data.get('chat_id')
    message = job_data.get('message', 'Напоминание')

    if not chat_id:
        logger.warning("⚠️ Нельзя отправить: chat_id отсутствует")
        return

    try:
        await context.bot.send_message(
            chat_id=chat_id,
            text=message,
            parse_mode="HTML"
        )
        logger.info(f"📨 Отправлено: {message} → {chat_id}")

    except Exception as e:
        if "Forbidden: bot was blocked by the user" in str(e):
            logger.warning(f"🚫 Пользователь {chat_id} заблокировал бота. Напоминание не отправлено.")
        elif "Bad Request: chat not found" in str(e):
            logger.warning(f"❌ Чат не найден (удалён/не стартовал): {chat_id}")
        else:
            logger.error(f"❌ Ошибка отправки напоминания {chat_id}: {e}", exc_info=True)


# === ПОИСК ПОЛЬЗОВАТЕЛЯ ПО ФИО ===
def find_chat_id_by_fio(fio: str) -> int:
    """Находит telegram_id по фамилии из ФИО"""
    conn = None
    try:
        conn = get_db()
        parts = fio.strip().split()
        if not parts:
            return None
        last_name = parts[0]  # Берём фамилию

        cursor = conn.cursor()
        cursor.execute("SELECT telegram_id FROM users WHERE fio LIKE ?", (f"{last_name}%",))
        row = cursor.fetchone()

        if row:
            logger.debug(f"🔍 Найден: {fio} → chat_id: {row[0]}")
            return row[0]
        else:
            logger.warning(f"❌ Не найден пользователь по фамилии: {last_name}")
            return None

    except Exception as e:
        logger.error(f"❌ Ошибка при поиске по ФИО '{fio}': {e}", exc_info=True)
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception as e:
                logger.warning(f"⚠️ Ошибка при закрытии соединения: {e}")


# === ВОССТАНОВЛЕНИЕ НАПОМИНАНИЙ ПРИ ПЕРЕЗАПУСКЕ ===
async def restore_duty_reminders(context: ContextTypes.DEFAULT_TYPE):
    """Восстанавливает напоминания при старте бота"""
    try:
        bot_data = context.application.bot_data
        schedule_data = bot_data.get('duty_schedule', [])

        if not schedule_data:
            logger.info("📭 Нет активного графика — напоминания не восстанавливаются")
            return

        logger.info(f"🔄 Восстановление напоминаний для {len(schedule_data)} записей")
        await create_duty_reminders(context, schedule_data)

    except Exception as e:
        logger.critical(f"❌ Критическая ошибка при восстановлении напоминаний: {e}", exc_info=True)
