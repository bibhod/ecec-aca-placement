"""
SMS Service (Issue 2 / 15 / 16) — Twilio integration with simulation fallback.
If TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER are not set,
messages are logged to console so development works without credentials.
"""
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)


def send_sms(to_phone: str, body: str) -> bool:
    """
    Send an SMS to `to_phone` (E.164 format, e.g. +61412345678).
    Returns True on success (or simulated success).
    """
    if not to_phone:
        logger.warning("SMS: no recipient phone — skipping")
        return False

    # Normalise Australian mobile numbers if needed
    phone = to_phone.strip().replace(" ", "")
    if phone.startswith("04"):
        phone = "+61" + phone[1:]

    try:
        if (
            settings.TWILIO_ACCOUNT_SID
            and settings.TWILIO_AUTH_TOKEN
            and settings.TWILIO_FROM_NUMBER
        ):
            return _send_via_twilio(phone, body)
        else:
            # Simulation mode — log to console
            logger.info(f"[SMS SIMULATION] To: {phone}")
            logger.info(f"[SMS BODY] {body[:160]}")
            return True
    except Exception as exc:
        logger.error(f"SMS send failed to {phone}: {exc}")
        return False


def _send_via_twilio(to_phone: str, body: str) -> bool:
    """Send SMS via Twilio REST API."""
    from twilio.rest import Client  # type: ignore

    client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    msg = client.messages.create(
        body=body[:1600],          # Twilio max is 1600 chars
        from_=settings.TWILIO_FROM_NUMBER,
        to=to_phone,
    )
    success = msg.status not in ("failed", "undelivered")
    if success:
        logger.info(f"Twilio SMS sent to {to_phone} — SID: {msg.sid}")
    else:
        logger.error(f"Twilio SMS failed to {to_phone}: {msg.status}")
    return success


# ─── Pre-built SMS templates ──────────────────────────────────────────────────

def sms_appointment_reminder(
    student_name: str,
    to_phone: str,
    appointment_title: str,
    scheduled_date: str,
    scheduled_time: str,
    hours_until: int,
) -> bool:
    """Send a short appointment reminder SMS."""
    body = (
        f"Reminder ({hours_until}h): {appointment_title} for {student_name} "
        f"on {scheduled_date} at {scheduled_time}. "
        f"Contact your coordinator if you need to reschedule."
    )
    return send_sms(to_phone, body)


def sms_hours_overdue(student_name: str, to_phone: str, weeks: int) -> bool:
    """Alert student that they haven't logged hours recently."""
    body = (
        f"Hi {student_name}, you have not logged any placement hours for "
        f"{weeks} week(s). Please log your hours in the Academies portal."
    )
    return send_sms(to_phone, body)


def sms_compliance_expiry(student_name: str, to_phone: str, doc_type: str, days: int) -> bool:
    """Notify student/supervisor that a compliance document is expiring."""
    doc_label = doc_type.replace("_", " ").title()
    body = (
        f"Hi {student_name}, your {doc_label} expires in {days} day(s). "
        f"Please renew it before your placement is affected."
    )
    return send_sms(to_phone, body)
