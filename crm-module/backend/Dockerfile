FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOST=0.0.0.0 \
    PORT=8000

WORKDIR /app

# Node 20 (zca-js chi chay duoc tren Node, khong phai Python) - can cho tinh
# nang Zalo Chat/Inbox Zalo Admin (2026-09-23, xem router.py). Cai qua NodeSource
# tren base Python thuong, khong dung base Playwright vi module nay khong crawl.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# LibreOffice Writer + font tieng Viet: engine DUY NHAT xuat DOCX -> PDF cho AI Contract Copilot (local = production, dung chung image nay).
# Font tuong thich so lieu: Times New Roman->Liberation Serif, Arial->Liberation Sans, Calibri->Carlito, Cambria->Caladea. KHONG cai LibreOffice tren may Windows ca nhan.
RUN apt-get update     && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fontconfig     && rm -rf /var/lib/apt/lists/*

# Fontconfig override: "Liberation Serif" (thay the Times New Roman) THIEU vai dau tieng Viet
# (o, o, a, O, U, U, O...) nen bi fallback sang "DejaVu Serif" - khac han do dam/kich thuoc,
# nhin nhu "dam/to ngay cho co dau". "FreeSerif" co du glyph tieng Viet va gan Times New Roman
# hon - uu tien no TRUOC DejaVu Serif (xem docker/fonts-local.conf).
COPY docker/fonts-local.conf /etc/fonts/local.conf
RUN fc-cache -f

RUN soffice --headless --version     && fc-list | grep -qi "Liberation Serif" && fc-list :lang=vi family | grep -qi "DejaVu Serif"

COPY requirements.txt constraints.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Chromium cho render PDF bao gia gui khach (quote_telegram_service._render_quote_pdf). Cai o duong dan chung de appuser doc duoc.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN playwright install --with-deps chromium && chmod -R a+rX /ms-playwright && rm -rf /var/lib/apt/lists/*

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
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health').read()"

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
