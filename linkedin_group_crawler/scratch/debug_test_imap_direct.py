"""Goi truc tiep test_imap_connection() trong process (khong qua HTTP) de
bat FULL traceback that neu co ngoai le bi nuot mat message. Day la THAT SU
kiem tra ket noi IMAP that (giong het khi bam nut "Kiem tra IMAP" tren UI) -
khong mutation gi khac ngoai ghi lai imap_connection_status (dung hanh vi
that cua tinh nang).
"""
import sys, io, traceback
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import app.core.config  # noqa: F401
from app.modules.all_platform.services import quote_email_provider_service as svc

print("=== Goi truc tiep test_imap_connection() (dung credential da luu) ===")
try:
    result = svc.test_imap_connection(None, None)
    print("KET QUA (khong co exception nao thoat ra ngoai):", result)
except Exception:
    print("CO EXCEPTION THOAT RA NGOAI test_imap_connection() (day chinh la nguyen nhan message rong):")
    traceback.print_exc()
