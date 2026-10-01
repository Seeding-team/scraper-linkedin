FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOST=0.0.0.0 \
    PORT=8000

WORKDIR /app

# Node 20 (zca-js chi chay duoc tren Node, khong phai Python) - can cho tinh
# nang Zalo Chat/Inbox Zalo Admin (dong bo tu crm-module 2026-09-23).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt constraints.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# npm install chay TRONG container Linux - KHONG copy node_modules tu may dev
# (tranh bug symlink Windows->Linux).
COPY package.json package-lock.json* ./
COPY vendor/zca-js ./vendor/zca-js
RUN npm install --omit=dev

COPY . .

RUN useradd --create-home appuser \
    && mkdir -p /app/artifacts/zca-auth /app/artifacts/debug \
    && chown -R appuser:appuser /app

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health').read()"

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
