/* Plugin cau noi OnlyOffice <-> trang host (ContractAiReviewPanel) qua postMessage.
 * Port tu POC da verify PASS 6/6 (xem C:\Users\Asus\.claude\plans\proud-stargazing-pixel.md,
 * muc "Ket qua Phase 0"). Day la co che THAT DUY NHAT de chay lenh trong phien OnlyOffice
 * dang mo song tu ben ngoai iframe o Community Edition - khong co connector.callCommand.
 *
 * Lenh ho tro (chi nhung gi can cho hanh dong THAT SU phai chay trong phien song - bookmark
 * da chen san o server luc tao draft qua contract_docx_engine, AI highlight cung da to san o
 * server; plugin nay CHI can jump-to-bookmark va xoa highlight that trong phien dang mo):
 *   ping                                              -> "pong"
 *   selectBookmark      {name}                        -> nhay toi bookmark da chen san
 *   removeHighlightRange {paragraphIndex, start, end} -> xoa mau highlight dung vung ky tu
 *   triggerSave                                       -> dispatch Ctrl+S THAT vao dung
 *       document cua man hinh editor chinh (xem ghi chu BUG THAT duoi day)
 *
 * BUG THAT DA GAP + DA SUA (2026-10-27): OnlyOffice Command Service "forcesave" (goi server-to-
 * server tu backend qua CommandService.ashx) LUON tra "error 4" (khong co thay doi de luu) du
 * Sale vua go chu that - trang thai "dirty" noi bo cua OnlyOffice khong dong bo kip voi journal
 * ma Command Service doc. Da verify bang Playwright: dispatch 1 KeyboardEvent Ctrl+S (dung that,
 * khong can OS that bam) truc tiep vao document cua man hinh editor CHINH (khong phai document
 * cua iframe plugin nay, vi plugin nam trong iframe long rieng, khong co phim tat cua editor) ->
 * OnlyOffice tu luu that qua dung luong cua no, co noi dung that. callCommand() chay code trong
 * dung ngu canh cua man hinh editor chinh (noi Api.GetDocument() hoat dong duoc) nen "document"
 * trong ham duoi day la document DUNG can thiet - khac voi "document" o scope ngoai (addEventListener
 * message) von la document cua iframe plugin, KHONG co hieu luc voi phim tat editor.
 *
 * GHI CHU RUI RO (can QA that o giai doan FE, xem bao cao fork): gia dinh thu tu
 * Api.GetDocument().GetAllParagraphs() KHOP VOI contract_docx_engine._all_paragraph_elements()
 * (duyet <w:p> theo thu tu xuat hien, gom ca doan trong bang). Chua verify truc tiep tren 1
 * file co CA bang LAN doan ngoai bang trong cung 1 phien lam viec song - lam lai buoc nay khi
 * noi plugin vao FE that.
 */
(function (window, undefined) {

    function reply(id, ok, result) {
        try {
            window.top.postMessage({ __mkEditReply: id, ok: ok, result: result }, "*");
        } catch (e) { /* no-op */ }
    }

    window.Asc.plugin.init = function () {
        try {
            window.top.postMessage({ __mkEditPlugin: "ready" }, "*");
        } catch (e) { /* no-op */ }
    };

    window.addEventListener("message", function (ev) {
        var data = ev.data;
        if (!data || typeof data.__mkEditCmd === "undefined") return;
        var cmd = data.__mkEditCmd;
        var id = data.__mkEditId;

        if (cmd === "ping") {
            reply(id, true, "pong");
            return;
        }

        if (cmd === "selectBookmark") {
            Asc.scope.name = data.name;
            window.Asc.plugin.callCommand(function () {
                try {
                    var oDocument = Api.GetDocument();
                    var oRange = oDocument.GetBookmarkRange ? oDocument.GetBookmarkRange(Asc.scope.name) : null;
                    if (!oRange) return { ok: false, error: "bookmark-not-found" };
                    oRange.Select();
                    return { ok: true };
                } catch (e) {
                    return { ok: false, error: String(e && e.message || e) };
                }
            }, false, false, function (ret) { reply(id, !!(ret && ret.ok), ret); });
            return;
        }

        if (cmd === "removeHighlightRange") {
            Asc.scope.paragraphIndex = data.paragraphIndex;
            Asc.scope.start = data.start;
            Asc.scope.end = data.end;
            window.Asc.plugin.callCommand(function () {
                try {
                    var oDocument = Api.GetDocument();
                    var paras = oDocument.GetAllParagraphs();
                    var oParagraph = paras[Asc.scope.paragraphIndex];
                    if (!oParagraph) return { ok: false, error: "paragraph-not-found" };
                    var sText = oParagraph.GetText();
                    var end = (Asc.scope.end === -1 || Asc.scope.end > sText.length) ? sText.length : Asc.scope.end;
                    var oRange = oParagraph.GetRange(Asc.scope.start, end);
                    if (!oRange) return { ok: false, error: "range-null" };
                    oRange.SetHighlight("none");
                    return { ok: true };
                } catch (e) {
                    return { ok: false, error: String(e && e.message || e) };
                }
            }, false, false, function (ret) { reply(id, !!(ret && ret.ok), ret); });
            return;
        }

        if (cmd === "triggerSave") {
            window.Asc.plugin.callCommand(function () {
                try {
                    var target = document.activeElement || document.body;
                    var opts = { key: "s", code: "KeyS", keyCode: 83, which: 83, ctrlKey: true, bubbles: true, cancelable: true };
                    target.dispatchEvent(new KeyboardEvent("keydown", opts));
                    target.dispatchEvent(new KeyboardEvent("keypress", opts));
                    target.dispatchEvent(new KeyboardEvent("keyup", opts));
                    return { ok: true };
                } catch (e) {
                    return { ok: false, error: String(e && e.message || e) };
                }
            }, false, false, function (ret) { reply(id, !!(ret && ret.ok), ret); });
            return;
        }
    });

})(window, undefined);
