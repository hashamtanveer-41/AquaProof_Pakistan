FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY migrations ./migrations
# Apply database migrations (idempotent, guarded by an advisory lock) then serve.
# Render/Fly set $PORT; local Compose overrides this command and defaults to 8000.
CMD ["sh", "-c", "python -m app.database && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
