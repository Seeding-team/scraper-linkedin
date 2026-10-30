import os
from unittest.mock import patch

from app.core.config import settings
from app.modules.all_platform.services import contract_edit_service as svc


def test_draft_download_token_roundtrip():
    contract_id = "test-contract-123"
    session_id = "test-session-456"
    with patch.object(settings, "onlyoffice_jwt_secret", "test-secret-key-1234567890"):
        token = svc.make_draft_download_token(contract_id, session_id)
        assert isinstance(token, str) and len(token) > 20

        claims = svc.verify_draft_download_token(token)
        assert claims.get("purpose") == "draft-download"
        assert claims.get("contractId") == contract_id
        assert claims.get("sessionId") == session_id


def test_editor_config_generation():
    session = {
        "id": "sess-001",
        "contract_id": "ctr-001",
        "document_key": "mk_sess_001_123456",
        "owner_user_id": "user-001",
        "converted_from_pdf": False,
    }
    contract = {
        "contract_number": "HD/2026/0010",
    }
    with patch.object(settings, "onlyoffice_jwt_secret", "test-secret-key-1234567890"):
        res = svc._editor_config_for_session(session, contract)
        assert res["sessionId"] == "sess-001"
        assert res["documentKey"] == "mk_sess_001_123456"
        
        cfg = res["editorConfig"]
        assert cfg["document"]["fileType"] == "docx"
        assert cfg["document"]["title"] == "HD-2026-0010.docx"
        assert "contracts/ctr-001/edit/draft-file?token=" in cfg["document"]["url"]
        assert "token" in cfg
        assert cfg["editorConfig"]["mode"] == "edit"


def test_backend_internal_url_override():
    session = {
        "id": "sess-002",
        "contract_id": "ctr-002",
        "document_key": "mk_sess_002_123456",
        "owner_user_id": "user-002",
        "converted_from_pdf": False,
    }
    contract = {"contract_number": "HD/2026/0020"}
    with patch.object(settings, "onlyoffice_jwt_secret", "test-secret-key-1234567890"):
        with patch.dict(os.environ, {"BACKEND_INTERNAL_URL": "http://my-custom-host:8000/api/all-platform"}):
            with patch.object(settings, "backend_internal_url", "http://my-custom-host:8000/api/all-platform"):
                res = svc._editor_config_for_session(session, contract)
                url = res["editorConfig"]["document"]["url"]
                assert url.startswith("http://my-custom-host:8000/api/all-platform/contracts/ctr-002/edit/draft-file")
