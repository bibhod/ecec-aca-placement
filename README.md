# ECEC Work Placement Management System
### Academies Australasia — Staff Portal v2.0

A complete, self-hostable work placement management system for the Early Childhood Education and Care (ECEC) program.

---

## Quick Start (Docker — recommended)

```bash
# 1. Copy environment file and fill in your values
cp .env.example .env

# 2. Run everything with one command
docker-compose up --build

# 3. Open the portal
open http://localhost
```

**Default login:** `b.dotel@academies.edu.au` / `aca0022z`

---

## Local Development (without Docker)

### Backend
```bash
cd backend
pip install -r requirements.txt
# Set DATABASE_URL in .env pointing to your local PostgreSQL
uvicorn app.main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

---

## Features

### Core
- **Dashboard** — live stats, upcoming appointments, expiring docs, campus/qualification charts
- **Students** — full CRUD, grid/list view, search & filter, hours progress, compliance status
- **Student Detail** — full profile, hours log, compliance docs, appointments, communications, issues
- **Appointments** — schedule visits, online/onsite/phone, confirmation emails, 48h/24h auto reminders
- **Hours Tracking** — log hours, approval workflow, milestone emails at 50% and 100%
- **Compliance** — document management, expiry tracking, colour-coded status, verification workflow
- **Communications** — compose emails, email templates, full message log
- **Issues** — raise issues, priority management, resolution tracking, coordinator email notifications
- **Reports** — hours by campus/qualification, compliance rates, CSV export
- **User Management** — staff accounts, roles (admin/coordinator/trainer), activate/deactivate
- **Centre Management** — placement centres with NQS ratings, supervisor details

### Email Notifications (automated)
| Trigger | Recipients |
|---|---|
| 48h before appointment | Student + Coordinator + Supervisor |
| 24h before appointment | Student + Coordinator + Supervisor |
| Document expiring in 30 days | Coordinator |
| Document expiring in 14 days | Coordinator |
| Document expiring in 7 days | Coordinator (URGENT) |
| New student enrolled | Student (welcome email) |
| 50% hours milestone | Student |
| 100% hours completed | Student |
| Issue raised | Coordinator |
| Appointment created | Student + Supervisor (confirmation) |

### Email Configuration
**Option A — SendGrid (recommended):**
```
SENDGRID_API_KEY=SG.your-key-here
USE_SMTP=false
```

**Option B — SMTP (Gmail etc):**
```
USE_SMTP=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASSWORD=your-app-password
```

**No email configured:** Emails are logged to console (simulation mode) — app still works fully.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Python FastAPI |
| Database | PostgreSQL 15 |
| Auth | JWT (8 hour sessions) |
| Email | SendGrid / SMTP |
| Scheduler | APScheduler (background jobs) |
| Charts | Recharts |
| Deployment | Docker Compose |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_USER` | Yes | Database username |
| `POSTGRES_PASSWORD` | Yes | Database password |
| `POSTGRES_DB` | Yes | Database name |
| `SECRET_KEY` | Yes | JWT signing key (change in production!) |
| `SENDGRID_API_KEY` | No | SendGrid API key for emails |
| `USE_SMTP` | No | Set `true` to use SMTP instead |
| `SMTP_HOST` | No | SMTP server hostname |
| `SMTP_PORT` | No | SMTP port (usually 587) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASSWORD` | No | SMTP password |
| `FROM_EMAIL` | No | Sender email address |
| `FROM_NAME` | No | Sender display name |
| `FRONTEND_URL` | No | URL for email links |

---

## API Documentation

Once running, visit: `http://localhost:8000/docs`

All endpoints require Bearer token authentication (obtained from `/api/auth/login`).

---

## Seed Data

On first run, the database is automatically seeded with:
- **3 staff accounts** (admin + 2 coordinators)
- **5 placement centres** (Sydney, Melbourne)
- **8 students** (CHC30121 and CHC50121)
- **Compliance documents** per student
- **3 appointments** (past and upcoming)
- **5 hours log entries**

---

## Production Deployment

1. Change `SECRET_KEY` to a random 32+ character string
2. Set strong database passwords
3. Configure a real email provider
4. Set `FRONTEND_URL` to your actual domain
5. Add SSL termination (nginx/Caddy in front of the containers)
6. Consider setting `--reload` off in the backend CMD for production

---

*Built for Academies Australasia — ECEC Work Placement Management System v2.0*
