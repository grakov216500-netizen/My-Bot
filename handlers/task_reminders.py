# handlers/task_reminders.py — умные напоминания (исправленная версия)

from telegram.ext import ContextTypes
from datetime import datetime, timedelta
from database import get_db
import logging

logger = logging.getLogger(__name__)

# 🔁 РЕЖИМ РАБОТЫ: выбери ОДИН из двух
REMINDER_MODE = "exact"  # "15min" — за 15 минут | "exact" — точно в момент

async def check_task_reminders(context: ContextTypes.DEFAULT_TYPE):
    """
    Умная проверка напоминаний:
    - либо за ~15 минут до дедлайна
    - либо точно в момент дедлайна
    """
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()

        now = datetime.now()
        tasks = []

        # === РЕЖИМ 1: Напоминание за ~15 минут до дедлайна ===
        if REMINDER_MODE == "15min":
            time_lower = now + timedelta(minutes=14, seconds=30)
            time_upper = now + timedelta(minutes=15, seconds=30)
            lower_str = time_lower.strftime('%Y-%m-%d %H:%M:%S')
            upper_str = time_upper.strftime('%Y-%m-%d %H:%M:%S')

            logger.info(f"🔍 Проверка: за 15 мин до дедлайна | Окно: {lower_str} → {upper_str}")

            cursor.execute('''
                SELECT t.id, t.text, t.deadline, t.user_id
                FROM tasks t
                WHERE t.done = 0 
                  AND t.reminded = 0
                  AND t.deadline IS NOT NULL
                  AND datetime(t.deadline) >= datetime(?)
                  AND datetime(t.deadline) < datetime(?)
            ''', (lower_str, upper_str))

            tasks = cursor.fetchall()

        # === РЕЖИМ 2: Напоминание ТОЧНО в момент дедлайна ===
        elif REMINDER_MODE == "exact":
            # Окно ±15 секунд от текущего времени
            time_lower = now - timedelta(seconds=15)
            time_upper = now + timedelta(seconds=15)
            lower_str = time_lower.strftime('%Y-%m-%d %H:%M:%S')
            upper_str = time_upper.strftime('%Y-%m-%d %H:%M:%S')

            logger.info(f"⏰ Проверка: напоминание СЕЙЧАС? Окно: {lower_str} → {upper_str}")

            cursor.execute('''
                SELECT t.id, t.text, t.deadline, t.user_id
                FROM tasks t
                WHERE t.done = 0 
                  AND t.reminded = 0
                  AND t.deadline IS NOT NULL
                  AND datetime(t.deadline) >= datetime(?)
                  AND datetime(t.deadline) < datetime(?)
            ''', (lower_str, upper_str))

            tasks = cursor.fetchall()

        # === ПОКАЗ АКТИВНЫХ ЗАДАЧ ===
        try:
            all_active = cursor.execute('''
                SELECT id, text, deadline, done, reminded 
                FROM tasks 
                WHERE done = 0 AND reminded = 0 AND deadline IS NOT NULL
            ''').fetchall()

            logger.info(f"📋 Активные задачи в БД: {len(all_active)}")
            for t in all_active:
                logger.info(f"  🔹 {t['id']} | '{t['text'][:30]}...' | {t['deadline']}")
        except Exception as e:
            logger.warning(f"⚠️ Ошибка при получении активных задач: {e}")

        # === ОТПРАВКА НАПОМИНАНИЙ ===
        logger.info(f"📊 Найдено для напоминания: {len(tasks)}")

        for task in tasks:
            try:
                user_id = task['user_id']
                task_text = task['text']
                task_id = task['id']

                # Формируем сообщение
                if REMINDER_MODE == "15min":
                    msg = f"⏰ <b>Напоминание о задаче</b>\n\n{task_text}"
                else:
                    msg = f"⏰ <b>Время настало!</b>\n\n{task_text}"

                # Отправляем напоминание
                await context.bot.send_message(
                    chat_id=user_id,
                    text=msg,
                    parse_mode="HTML"
                )
                logger.info(f"✅ Напоминание отправлено: задача {task_id} → {user_id}")

                # Отмечаем, что напоминание отправлено
                cursor.execute("UPDATE tasks SET reminded = 1 WHERE id = ?", (task_id,))
                conn.commit()

            except Exception as e:
                # Частые ошибки
                if "Forbidden: bot was blocked by the user" in str(e):
                    logger.warning(f"🚫 Пользователь {user_id} заблокировал бота. Пропускаем задачу {task_id}.")
                elif "Bad Request: chat not found" in str(e):
                    logger.warning(f"❌ Чат не найден (удалён) для пользователя {user_id}. Пропускаем задачу {task_id}.")
                elif "Timed out" in str(e):
                    logger.warning(f"⏳ Таймаут при отправке напоминания {task_id}. Повторим позже.")
                else:
                    logger.error(f"❌ Ошибка при отправке задачи {task_id} пользователю {user_id}: {e}", exc_info=True)

    except Exception as e:
        logger.critical(f"❌ Критическая ошибка в check_task_reminders: {e}", exc_info=True)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception as e:
                logger.warning(f"⚠️ Ошибка при закрытии соединения с БД: {e}")
