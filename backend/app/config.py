"""
Application configuration — reads from environment / .env file.
New settings added for Issues 2 (SMS), 7 (Google Maps), 15 (email fixes).
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # ── Database ─────────────────────────────────────────────────────────────
    DATABASE_URL: str = "postgresql://ecec:ecec_secret@localhost:5432/ecec_placement"

    # ── Auth ─────────────────────────────────────────────────────────────────
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # ── Email — SendGrid (primary) ────────────────────────────────────────────
    SENDGRID_API_KEY: Optional[str] = None
    USE_SMTP: bool = False

    # ── Email — SMTP fallback ─────────────────────────────────────────────────
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None
    SMTP_PASSWORD: Optional[str] = None

    # ── Email sender info ─────────────────────────────────────────────────────
    FROM_EMAIL: str = "noreply@academies.edu.au"
    FROM_NAME: str = "Academies Australasia"

    # ── SMS — Twilio (Issues 2, 15, 16) ──────────────────────────────────────
    TWILIO_ACCOUNT_SID: Optional[str] = None
    TWILIO_AUTH_TOKEN: Optional[str] = None
    TWILIO_FROM_NUMBER: Optional[str] = None   # e.g. +61400000000

    # ── Google Maps API (Issue 7 — address autocomplete) ─────────────────────
    GOOGLE_MAPS_API_KEY: Optional[str] = None

    # ── Frontend URL (used in email links) ───────────────────────────────────
    FRONTEND_URL: str = "http://localhost:5173"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
