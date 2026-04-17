import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
import logging

from app.config import settings

logger = logging.getLogger(__name__)


def send_email(
    to_email: str,
    to_name: str,
    subject: str,
    html_body: str,
    plain_body: Optional[str] = None
) -> bool:
    """Send email via SendGrid or SMTP fallback. Returns True on success."""
    if not to_email:
        logger.warning("No recipient email provided, skipping send")
        return False

    print(f"[EMAIL] Attempting to send to: {to_email} | Subject: {subject}", flush=True)
    print(f"[EMAIL] USE_SMTP={settings.USE_SMTP} | SMTP_USER={settings.SMTP_USER} | HAS_PASSWORD={'yes' if settings.SMTP_PASSWORD else 'no'}", flush=True)
    try:
        if settings.SENDGRID_API_KEY and not settings.USE_SMTP:
            print(f"[EMAIL] Using SendGrid", flush=True)
            return _send_via_sendgrid(to_email, to_name, subject, html_body, plain_body)
        elif settings.SMTP_USER and settings.SMTP_PASSWORD:
            print(f"[EMAIL] Using SMTP: {settings.SMTP_HOST}:{settings.SMTP_PORT}", flush=True)
            return _send_via_smtp(to_email, to_name, subject, html_body, plain_body)
        else:
            print(f"[EMAIL SIMULATION] No credentials set — email NOT sent to {to_email}", flush=True)
            logger.info(f"[EMAIL SIMULATION] To: {to_email} | Subject: {subject}")
            return True
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to send to {to_email}: {e}", flush=True)
        logger.error(f"Email send failed to {to_email}: {e}")
        return False


def _send_via_sendgrid(to_email, to_name, subject, html_body, plain_body):
    import sendgrid
    from sendgrid.helpers.mail import Mail, Email, To, Content

    sg = sendgrid.SendGridAPIClient(api_key=settings.SENDGRID_API_KEY)
    message = Mail(
        from_email=Email(settings.FROM_EMAIL, settings.FROM_NAME),
        to_emails=To(to_email, to_name),
        subject=subject,
        html_content=html_body
    )
    response = sg.send(message)
    success = response.status_code in [200, 201, 202]
    if success:
        logger.info(f"SendGrid email sent to {to_email}")
    else:
        logger.error(f"SendGrid failed: {response.status_code}")
    return success


def _send_via_smtp(to_email, to_name, subject, html_body, plain_body):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{settings.FROM_NAME} <{settings.FROM_EMAIL}>"
    msg["To"] = f"{to_name} <{to_email}>"

    if plain_body:
        msg.attach(MIMEText(plain_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        server.starttls()
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.sendmail(settings.FROM_EMAIL, to_email, msg.as_string())

    logger.info(f"SMTP email sent to {to_email}")
    return True


# ─────────────────────────────────────────────────────────────────────────────
# EMAIL TEMPLATES
# ─────────────────────────────────────────────────────────────────────────────

def _base_template(content: str) -> str:
    return f"""
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {{ font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 0; }}
  .container {{ max-width: 600px; margin: 30px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
  .header {{ background: #1A2B5F; padding: 24px 32px; }}
  .header h1 {{ color: white; margin: 0; font-size: 20px; }}
  .header p {{ color: #00AEEF; margin: 4px 0 0; font-size: 13px; }}
  .body {{ padding: 32px; color: #333; line-height: 1.6; }}
  .highlight {{ background: #EAF6FC; border-left: 4px solid #00AEEF; padding: 16px; border-radius: 4px; margin: 20px 0; }}
  .btn {{ display: inline-block; background: #00AEEF; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 16px; font-weight: bold; }}
  .footer {{ background: #f0f0f0; padding: 16px 32px; font-size: 12px; color: #888; text-align: center; }}
  table {{ width: 100%; border-collapse: collapse; margin: 16px 0; }}
  td, th {{ padding: 10px 12px; border: 1px solid #e0e0e0; text-align: left; }}
  th {{ background: #f5f5f5; font-weight: bold; }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>Academies Australasia</h1>
    <p>ECEC Work Placement Management System</p>
  </div>
  <div class="body">{content}</div>
  <div class="footer">
    This is an automated message from Academies Australasia.<br>
    Level 6, 505 George Street, Sydney NSW 2000 | T: +61 2 9224 5500
  </div>
</div>
</body>
</html>"""


def email_appointment_reminder(
    recipient_name: str,
    recipient_email: str,
    student_name: str,
    appointment_title: str,
    scheduled_date: str,
    scheduled_time: str,
    location_type: str,
    location_detail: str,
    preparation_notes: str,
    hours_until: int,
    frontend_url: str
) -> bool:
    subject = f"{'48-Hour' if hours_until >= 36 else '24-Hour'} Reminder: {appointment_title}"
    content = f"""
<h2>Appointment Reminder</h2>
<p>Dear {recipient_name},</p>
<p>This is a reminder that you have an upcoming appointment in <strong>{hours_until} hours</strong>.</p>
<div class="highlight">
  <table>
    <tr><th>Student</th><td>{student_name}</td></tr>
    <tr><th>Appointment</th><td>{appointment_title}</td></tr>
    <tr><th>Date</th><td>{scheduled_date}</td></tr>
    <tr><th>Time</th><td>{scheduled_time}</td></tr>
    <tr><th>Format</th><td>{location_type.replace('_', ' ').title()}</td></tr>
    <tr><th>{'Zoom Link' if location_type == 'online' else 'Location'}</th><td>{location_detail}</td></tr>
  </table>
</div>
{'<p><strong>Preparation Notes:</strong><br>' + preparation_notes + '</p>' if preparation_notes else ''}
<a href="{frontend_url}/appointments" class="btn">View in Portal</a>
<p style="margin-top:24px">If you need to reschedule, please contact your coordinator as soon as possible.</p>
"""
    return send_email(recipient_email, recipient_name, subject, _base_template(content))


def email_compliance_expiry(
    student_name: str,
    student_email: str,
    coordinator_name: str,
    coordinator_email: str,
    document_type: str,
    expiry_date: str,
    days_until_expiry: int,
    frontend_url: str
) -> bool:
    urgency = "URGENT: " if days_until_expiry <= 7 else ""
    doc_label = document_type.replace("_", " ").title()
    subject = f"{urgency}Compliance Document Expiring: {doc_label} - {student_name}"
    content = f"""
<h2>{'⚠️ Urgent: ' if days_until_expiry <= 7 else ''}Compliance Document Expiring Soon</h2>
<p>Dear {coordinator_name},</p>
<p>Please note that the following compliance document for student <strong>{student_name}</strong> is 
{'<strong style="color:red">expiring in {days_until_expiry} days</strong>' if days_until_expiry <= 7 else f'expiring in <strong>{days_until_expiry} days</strong>'}.</p>
<div class="highlight">
  <table>
    <tr><th>Student</th><td>{student_name}</td></tr>
    <tr><th>Document</th><td>{doc_label}</td></tr>
    <tr><th>Expiry Date</th><td>{expiry_date}</td></tr>
    <tr><th>Days Remaining</th><td style="color:{'red' if days_until_expiry <= 7 else 'orange'}">{days_until_expiry} days</td></tr>
  </table>
</div>
<p>Please contact the student to arrange renewal of this document before placement activities are affected.</p>
<a href="{frontend_url}/compliance" class="btn">View Compliance Dashboard</a>
"""
    return send_email(coordinator_email, coordinator_name, subject, _base_template(content))


def email_welcome_student(
    student_name: str,
    student_email: str,
    student_id: str,
    qualification: str,
    campus: str,
    coordinator_name: str,
    coordinator_email: str,
    frontend_url: str
) -> bool:
    qual_label = "Certificate III in ECEC" if qualification == "CHC30121" else "Diploma of ECEC"
    subject = f"Welcome to Academies Australasia — {qual_label}"
    content = f"""
<h2>Welcome to Academies Australasia!</h2>
<p>Dear {student_name},</p>
<p>Welcome! You have been enrolled in the <strong>{qual_label}</strong> at our <strong>{campus.title()} campus</strong>.</p>
<div class="highlight">
  <table>
    <tr><th>Student ID</th><td>{student_id}</td></tr>
    <tr><th>Qualification</th><td>{qual_label}</td></tr>
    <tr><th>Campus</th><td>{campus.title()}</td></tr>
    <tr><th>Your Coordinator</th><td>{coordinator_name}</td></tr>
    <tr><th>Coordinator Email</th><td>{coordinator_email}</td></tr>
  </table>
</div>
<p>Your coordinator will be in touch shortly with details about your work placement arrangements.</p>
<p>If you have any questions, please don't hesitate to contact your coordinator directly at <a href="mailto:{coordinator_email}">{coordinator_email}</a>.</p>
"""
    return send_email(student_email, student_name, subject, _base_template(content))


def email_hours_milestone(
    student_name: str,
    student_email: str,
    completed_hours: float,
    required_hours: float,
    milestone_pct: int,
    frontend_url: str
) -> bool:
    subject = f"Congratulations! You've reached {milestone_pct}% of your placement hours"
    content = f"""
<h2>🎉 Hours Milestone Reached!</h2>
<p>Dear {student_name},</p>
<p>Congratulations! You have reached <strong>{milestone_pct}%</strong> of your required placement hours.</p>
<div class="highlight">
  <table>
    <tr><th>Completed Hours</th><td>{completed_hours}</td></tr>
    <tr><th>Required Hours</th><td>{required_hours}</td></tr>
    <tr><th>Remaining Hours</th><td>{required_hours - completed_hours}</td></tr>
    <tr><th>Progress</th><td>{milestone_pct}%</td></tr>
  </table>
</div>
<p>Keep up the great work! Your coordinator will continue to support you through the remainder of your placement.</p>
"""
    return send_email(student_email, student_name, subject, _base_template(content))


def email_issue_notification(
    coordinator_name: str,
    coordinator_email: str,
    student_name: str,
    issue_title: str,
    issue_type: str,
    priority: str,
    description: str,
    frontend_url: str
) -> bool:
    priority_color = {"critical": "red", "high": "orange", "medium": "#999", "low": "green"}.get(priority, "#333")
    subject = f"[{priority.upper()}] New Issue Raised: {issue_title} — {student_name}"
    content = f"""
<h2>New Issue Raised</h2>
<p>Dear {coordinator_name},</p>
<p>A new issue has been raised for student <strong>{student_name}</strong> and requires your attention.</p>
<div class="highlight">
  <table>
    <tr><th>Student</th><td>{student_name}</td></tr>
    <tr><th>Issue</th><td>{issue_title}</td></tr>
    <tr><th>Type</th><td>{issue_type.replace('_',' ').title()}</td></tr>
    <tr><th>Priority</th><td style="color:{priority_color};font-weight:bold">{priority.upper()}</td></tr>
  </table>
</div>
<p><strong>Description:</strong><br>{description}</p>
<a href="{frontend_url}/issues" class="btn">View Issue in Portal</a>
"""
    return send_email(coordinator_email, coordinator_name, subject, _base_template(content))

# Public alias for use by other modules
base_template = _base_template
