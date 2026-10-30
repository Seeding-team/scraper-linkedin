-- "Word Editor trong AI Contract Review" (2026-10-28) - fix bug that: click-to-jump tren tab
-- tinh "Ban AI Highlight" (PDF) khong hoat dong cho annotation nguon DOCX, vi paragraph_anchor
-- cua nhung annotation do dung dinh dang "pN" (global paragraph index - chi dung de nhay bookmark
-- trong phien OnlyOffice dang mo song), KHONG phai "page:N" (dinh dang jumpToExcerpt tren tab PDF
-- tinh can). Trong khi do contract_ai_review_service da TINH SAN so trang tuong ung (meta["pages"])
-- cho CA 2 truong hop DOCX lan PDF (dung chung 1 pipeline highlight_docx/highlight_pdf_*), chi la
-- seed_ai_annotations() truoc day BO QUA gia tri nay khi is_pdf=False. Them cot rieng de luu DUNG
-- so trang do, tach biet khoi paragraph_anchor (van giu nguyen y nghia cho dieu huong bookmark).

ALTER TABLE public.contract_highlight_annotations
    ADD COLUMN IF NOT EXISTS highlight_page INT;

NOTIFY pgrst, 'reload schema';
