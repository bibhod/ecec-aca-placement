# Combined build: Vite frontend + FastAPI backend served from one container/port.
# Place this file at the REPO ROOT (replacing the need for separate
# frontend/Dockerfile and backend/Dockerfile as two Railway services).

# ---- Stage 1: build the React/Vite frontend ----
FROM node:20-alpine AS frontend-builder
WORKDIR /frontend

# VITE_API_URL is left empty on purpose: frontend/src/utils/api.js already
# falls back to the relative path "/api" when this is unset, which is what
# we want once frontend and backend are served from the same origin.
ARG VITE_API_URL=""
ARG VITE_GOOGLE_MAPS_API_KEY=""
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend + serve built frontend ----
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .
RUN mkdir -p /app/uploads

# Built frontend assets land in /app/static, picked up by the
# StaticFiles mount + catch-all route added to backend/app/main.py.
COPY --from=frontend-builder /frontend/dist ./static

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
