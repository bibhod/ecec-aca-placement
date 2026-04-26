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
    try:
        if settings.BREVO_API_KEY:
            print(f"[EMAIL] Using Brevo", flush=True)
            return _send_via_brevo(to_email, to_name, subject, html_body, plain_body)
        elif settings.SENDGRID_API_KEY and not settings.USE_SMTP:
            print(f"[EMAIL] Using SendGrid", flush=True)
            return _send_via_sendgrid(to_email, to_name, subject, html_body, plain_body)
        elif settings.SMTP_USER and settings.SMTP_PASSWORD:
            print(f"[EMAIL] Using SMTP: {settings.SMTP_HOST}:{settings.SMTP_PORT}", flush=True)
            return _send_via_smtp(to_email, to_name, subject, html_body, plain_body)
        else:
            print(f"[EMAIL SIMULATION] No credentials set — email NOT sent to {to_email}", flush=True)
            return True
    except Exception as e:
        print(f"[EMAIL ERROR] Failed to send to {to_email}: {e}", flush=True)
        logger.error(f"Email send failed to {to_email}: {e}")
        return False


def _send_via_brevo(to_email, to_name, subject, html_body, plain_body):
    import urllib.request, json
    payload = json.dumps({
        "sender": {"name": settings.FROM_NAME, "email": settings.FROM_EMAIL},
        "to": [{"email": to_email, "name": to_name}],
        "subject": subject,
        "htmlContent": html_body,
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email",
        data=payload,
        headers={
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": settings.BREVO_API_KEY,
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())
        print(f"[EMAIL] Brevo sent OK: {result}", flush=True)
        return True


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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Academies Australasia</title>
<style>
  body {{ font-family: Arial, Helvetica, sans-serif; background: #f0f4f8; margin: 0; padding: 0; }}
  .wrapper {{ max-width: 640px; margin: 0 auto; padding: 24px 12px; }}
  .container {{ background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.10); }}
  .header {{ background: #1A2B5F; padding: 0; }}
  .header-top {{ padding: 24px 36px 20px; border-bottom: 3px solid #00AEEF; }}
  .header h1 {{ color: #ffffff; margin: 0 0 4px; font-size: 22px; font-weight: 700; }}
  .header .tagline {{ color: #5BBDE4; margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }}
  .header-banner {{ background: #132248; padding: 7px 36px; }}
  .header-banner p {{ color: #8aaed4; margin: 0; font-size: 11px; }}
  .body {{ padding: 36px; color: #2c3e50; line-height: 1.75; font-size: 14px; }}
  .body h2 {{ color: #1A2B5F; margin-top: 0; margin-bottom: 16px; font-size: 18px; border-bottom: 2px solid #e8f4fb; padding-bottom: 10px; }}
  .body p {{ margin: 0 0 14px; }}
  .highlight {{ background: #EAF6FC; border-left: 4px solid #00AEEF; padding: 18px 20px; border-radius: 0 6px 6px 0; margin: 20px 0; }}
  .highlight ul {{ margin: 8px 0 0; padding-left: 20px; }}
  .highlight li {{ margin: 8px 0; color: #1A2B5F; font-weight: 600; font-size: 14px; }}
  .btn {{ display: inline-block; background: #00AEEF; color: #ffffff !important; padding: 13px 30px; text-decoration: none; border-radius: 6px; margin-top: 18px; font-weight: 700; font-size: 14px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }}
  td, th {{ padding: 10px 14px; border: 1px solid #dce6ef; text-align: left; }}
  th {{ background: #f0f6fb; font-weight: 700; color: #1A2B5F; }}
  tr:nth-child(even) td {{ background: #f8fbfd; }}
  .footer {{ background: #f7f9fb; border-top: 2px solid #e2ebf3; padding: 28px 36px; }}
  .footer-name {{ color: #1A2B5F; font-weight: 700; font-size: 14px; margin: 0 0 8px; }}
  .footer-address {{ color: #5a6a7a; font-size: 12px; line-height: 1.8; margin: 0 0 14px; }}
  .footer-address a {{ color: #00AEEF; text-decoration: none; }}
  .footer-divider {{ border: none; border-top: 1px solid #dce6ef; margin: 14px 0; }}
  .footer-note {{ color: #9aaab8; font-size: 11px; line-height: 1.6; margin: 0; }}
</style>
</head>
<body>
<div class="wrapper">
<div class="container">
  <div class="header">
    <div class="header-top">
      <h1>Academies Australasia</h1>
      <p class="tagline">ECEC Work Placement Management System</p>
    </div>
    <div class="header-banner">
      <p>Early Childhood Education &amp; Care &mdash; Work Placement Portal</p>
    </div>
  </div>
  <div class="body">{content}</div>
  <div class="footer">
    <p class="footer-name">Academies Australasia</p>
    <p class="footer-address">
      Level 6, 505 George Street, Sydney NSW 2000<br>
      T: <a href="tel:+61292245500">+61 2 9224 5500</a><br>
      E: <a href="mailto:info@academies.edu.au">info@academies.edu.au</a> &nbsp;&bull;&nbsp;
      W: <a href="https://www.academies.edu.au">www.academies.edu.au</a>
    </p>
    <hr class="footer-divider">
    <p class="footer-note">
      This is an automated message from the ECEC Work Placement Management System.
      Please do not reply — contact your coordinator directly with any questions.<br>
      &copy; 2026 Academies Australasia. All rights reserved.
    </p>
  </div>
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

def email_hours_log_reminder(
    student_name: str,
    student_email: str,
    qualification: str,
    completed_hours: float,
    required_hours: float,
    remaining_hours: float,
    frontend_url: str
) -> bool:
    """Hours Log Submission Reminder — sent to students who haven't met their required hours."""
    rem_color = "red" if remaining_hours > required_hours * 0.5 else "darkorange"
    subject = "Reminder: Please Submit Your Placement Hours Log"
    content = f"""
<h2>Placement Hours Log Reminder</h2>
<p>Dear {student_name},</p>
<p>This is a reminder that your placement hours are still outstanding and need to be submitted and kept up to date.</p>
<div class="highlight">
  <table>
    <tr><th>Qualification</th><td>{qualification}</td></tr>
    <tr><th>Required Hours</th><td>{required_hours:.0f} hours</td></tr>
    <tr><th>Completed Hours</th><td>{completed_hours:.1f} hours</td></tr>
    <tr><th>Remaining Hours</th><td style="color:{rem_color};font-weight:bold">{remaining_hours:.1f} hours</td></tr>
  </table>
</div>
<p>Please ensure you are submitting your placement hours log regularly so your coordinator can track your progress and support your completion.</p>
<p>If you have recently completed placement hours that have not yet been recorded, please contact your coordinator to update your records as soon as possible.</p>
<a href="{frontend_url}/hours" class="btn">View Hours Log in Portal</a>
"""
    return send_email(student_email, student_name, subject, _base_template(content))


# Public alias for use by other modules
base_template = _base_template
