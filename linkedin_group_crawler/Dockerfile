FROM mcr.microsoft.com/playwright/python:v1.58.0-jammy

RUN apt-get update && apt-get install -y --no-install-recommends \
    dbus \
    dbus-daemon \
    libdbus-1-3 \
    ca-certificates \
    curl \
    libreoffice-writer \
    fonts-liberation \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    fonts-dejavu-core \
    fontconfig \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Liberation Serif (thay the Times New Roman tren Linux) thieu 1 so dau tieng Viet (o, o+, a+...) nen LibreOffice
# tu nhay sang DejaVu Serif cho dung nhung ky tu do - DejaVu nang/to hon han chu xung quanh (bug "chu dam to ngay
# cho co dau"). FreeSerif (co san tu libreoffice-writer) co du glyph tieng Viet va gan kieu Times New Roman hon -
# uu tien no truoc DejaVu Serif cho Liberation Serif/Times New Roman qua fontconfig local.conf.
COPY docker/fonts-local.conf /etc/fonts/local.conf
RUN fc-cache -f

# Kiem tra LibreOffice + font Viet ngay luc build (hong thi build fail, khong deploy duoc image thieu engine PDF)
RUN soffice --headless --version && fc-list | grep -qi "Liberation Serif" && fc-list :lang=vi family | grep -qi "DejaVu Serif"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    HEADLESS=true \
    STATE_PATH=/app/storage/linkedin_state.json \
    PLAYWRIGHT_CHROMIUM_LAUNCH_ARGS="--disable-dev-shm-usage --no-sandbox --disable-setuid-sandbox --disable-infobars --disable-crash-reporter" \
    PLAYWRIGHT_DOWNLOAD_HOST=https://github.com

WORKDIR /app

COPY requirements.txt ./

# Cài setuptools trước để đảm bảo pkg_resources có sẵn cho playwright-stealth==1.0.6
# (setuptools>=70 đã drop pkg_resources — phải pin <70)
RUN pip install --upgrade pip \
    && pip install "setuptools<70" wheel \
    && pip install -r requirements.txt \
    && pip install "setuptools<70"

COPY . .

RUN mkdir -p /app/storage/session /app/storage/runtime /app/data/raw /app/data/output \
    && chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 8000

VOLUME ["/app/storage", "/app/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health').read()"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
