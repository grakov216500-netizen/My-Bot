from telegram.ext import ContextTypes
from datetime import datetime, timedelta
from database import get_db
import logging

logger = logging.getLogger(__name__)

# Режим напоминания: "exact" — точно в момент, "15min" — за 15 минут
REMINDER_MODE = "exact"


async def check_task_reminders(context: ContextTypes.DEFAULT_TYPE):
    """Проверка и отправка напоминаний о задачах (каждые 30 сек)"""
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()

        now = datetime.now()
        tasks = []

        if REMINDER_MODE == "15min":
            # За ~15 минут до дедлайна
            time_lower = now + timedelta(minutes=14, seconds=30)
            time_upper = now + timedelta(minutes=15, seconds=30)
            lower_str = time_lower.strftime('%Y-%m-%d %H:%M:%S')
            upper_str = time_upper.strftime('%Y-%m-%d %H:%M:%S')

            cursor.execute('''
                SELECT id, text, deadline, user_id FROM tasks
                WHERE done = 0 AND reminded = 0 AND deadline IS NOT NULL
                  AND datetime(deadline) >= datetime(?) AND datetime(deadline) < datetime(?)
            ''', (lower_str, upper_str))

        elif REMINDER_MODE == "exact":
            # Окно ±90 сек: интервал проверки 30 сек, сдвиг времени сервера, задержки
            time_lower = now - timedelta(seconds=90)
            time_upper = now + timedelta(seconds=90)
            lower_str = time_lower.strftime('%Y-%m-%d %H:%M:%S')
            upper_str = time_upper.strftime('%Y-%m-%d %H:%M:%S')

            cursor.execute('''
                SELECT id, text, deadline, user_id FROM tasks
                WHERE done = 0 AND reminded = 0 AND deadline IS NOT NULL
                  AND datetime(deadline) >= datetime(?) AND datetime(deadline) <= datetime(?)
            ''', (lower_str, upper_str))

        tasks = cursor.fetchall()
        if tasks:
            logger.info("📊 Найдено задач для напоминания: %s (сейчас: %s)", len(tasks), now.strftime('%Y-%m-%d %H:%M:%S'))

        for task in tasks:
            try:
                task_id = task['id']
                user_id = task['user_id']
                task_text = task['text']

                msg = f"⏰ <b>Время выполнить задачу!</b>\n\n{task_text}"

                await context.bot.send_message(
                    chat_id=user_id,
                    text=msg,
                    parse_mode="HTML"
                )
                logger.info(f"✅ Напоминание отправлено: задача {task_id} → {user_id}")

                # Отмечаем как напомянутое
                cursor.execute("UPDATE tasks SET reminded = 1 WHERE id = ?", (task_id,))
                conn.commit()

            except Exception as e:
                if "bot was blocked" in str(e).lower():
                    logger.warning(f"🚫 Пользователь {user_id} заблокировал бота")
                else:
                    logger.error(f"❌ Ошибка отправки напоминания {task_id}: {e}")

    except Exception as e:
        logger.critical(f"❌ Критическая ошибка в check_task_reminders: {e}")
    finally:
        if conn:
            conn.close()


# === ВОССТАНОВЛЕНИЕ ЗАДАЧ ПРИ ПЕРЕЗАПУСКЕ ===
async def restore_task_reminders(context: ContextTypes.DEFAULT_TYPE):
    """
    При старте бота — пересоздаёт job'ы для всех активных задач
    """
    job_queue = context.application.job_queue
    conn = None
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, text, deadline, user_id FROM tasks
            WHERE done = 0 AND reminded = 0 AND deadline IS NOT NULL
        ''')
        pending_tasks = cursor.fetchall()

        now = datetime.now()
        restored_count = 0
        skipped_count = 0

        for task in pending_tasks:
            try:
                dl = (task['deadline'] or '').strip()
                if not dl:
                    continue
                deadline = datetime.fromisoformat(dl.replace('Z', '+00:00')[:19])

                # 🔒 Если дедлайн уже прошёл — не ставим job, просто отмечаем
                if deadline < now:
                    cursor.execute("UPDATE tasks SET reminded = 1 WHERE id = ?", (task['id'],))
                    conn.commit()
                    skipped_count += 1
                    logger.info(f"⏭️ Пропущено (просрочено): задача {task['id']}")
                    continue

                # ✅ Ставим напоминание на точное время
                job_queue.run_once(
                    send_delayed_task_reminder,
                    when=deadline,
                    data={
                        'user_id': task['user_id'],
                        'task_text': task['text'],
                        'task_id': task['id']
                    },
                    name=f"task_reminder_{task['id']}"
                )
                restored_count += 1

            except Exception as e:
                logger.warning(f"⚠️ Не удалось восстановить напоминание для задачи {task['id']}: {e}")

        logger.info(f"🔄 Восстановлено {restored_count} напоминаний")
        if skipped_count:
            logger.info(f"⏭️ Пропущено {skipped_count} (просрочены)")

    except Exception as e:
        logger.error(f"❌ Ошибка при восстановлении напоминаний: {e}")
    finally:
        if conn:
            conn.close()


# === ОТПРАВКА ЧЕРЕЗ run_once (для точного времени) ===
async def send_delayed_task_reminder(context: ContextTypes.DEFAULT_TYPE):
    job_data = context.job.data
    user_id = job_data['user_id']
    task_text = job_data['task_text']
    task_id = job_data['task_id']

    try:
        # 🔍 Проверим, не было ли уже напоминания (на всякий случай)
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT reminded FROM tasks WHERE id = ?", (task_id,))
        row = cur.fetchone()
        if row and row['reminded']:
            logger.info(f"ℹ️ Напоминание уже отправлено ранее: задача {task_id}")
            return
        conn.close()

        await context.bot.send_message(
            chat_id=user_id,
            text=f"⏰ <b>Напоминание:</b>\n\n{task_text}",
            parse_mode="HTML"
        )
        logger.info(f"✅ Отправлено отложенное напоминание: задача {task_id}")

        # ✅ Отмечаем как напомянутое
        conn = get_db()
        conn.execute("UPDATE tasks SET reminded = 1 WHERE id = ?", (task_id,))
        conn.commit()
        conn.close()

    except Exception as e:
        if "bot was blocked" in str(e).lower():
            logger.warning(f"🚫 Пользователь {user_id} заблокировал бота")
        else:
            logger.error(f"❌ Ошибка при отправке отложенного напоминания {task_id}: {e}")
