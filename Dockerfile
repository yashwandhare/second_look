# Single-container image for the hackathon app.
# Antideploy builds this automatically for accounts that sign in with
# GitHub or Google.

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first so Docker can cache this layer.
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy the application and the frontend it serves.
COPY backend ./backend
COPY frontend ./frontend

# Antideploy provides PORT. Bind all interfaces so the platform can reach it.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT}"]
