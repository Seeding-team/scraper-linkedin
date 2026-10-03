"use client";

/**
 * "Ghi nhận hợp đồng có sẵn" — đăng ký 1 Hợp đồng đã ký/tạo BÊN NGOÀI CRM
 * (file scan, Google Drive/Docs link,...) thành 1 Contract canonical THẬT
 * (bảng `contracts`, migration 136: source='external'). KHÔNG redirect,
 * KHÔNG mở "Sửa thông tin Deal" - day la drawer rieng, doc lap.
 *
 * Dùng LẠI đúng endpoint tạo Contract hiện có (POST /contracts, cùng 1 bảng/
 * 1 API với "+ Tạo hợp đồng") - chỉ khác ở source + cho phép nhập tay
 * contract_number (hợp đồng ngoài đã có số riêng, không dùng số tự sinh của
 * CRM). Nhờ vậy Customer 360/module Hợp đồng toàn cục tự động resolve ĐÚNG
 * CÙNG 1 Contract ID, không có khái niệm "hợp đồng ngoài" tách biệt.
 *
 * File upload dùng lại NGUYÊN endpoint upload đính kèm đã có sẵn
 * (customerLeadService.uploadAttachment, prefix="contract") - không tạo
 * storage/endpoint mới.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Upload, Loader2, Eye, Check, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { customerLeadService, type Customer } from "@/services/customer-lead.service";
import { seedingContractRepository } from "@/modules/contracts/repositories/SeedingContractRepository";
import { CONTRACT_STATUS_LABELS } from "@/modules/contracts/constants/contractConfig";
import { CurrencyInput } from "@/components/CurrencyInput";
import type { Contract, ContractOcrReconcileResult, ContractStatus } from "@/modules/contracts";
import { seedingQuoteRepository } from "@/modules/quotes";
import type { Quote } from "@/modules/quotes";
import { internalQuoteStatusLabel } from "@/modules/quotes/constants/quoteConfig";
import { QuoteQuickViewDrawer } from "./QuoteQuickViewDrawer";

interface DealOption {
  id: string;
  customer_name?: string | null;
  project_id?: string | null;
  primary_contact_id?: string | null;
}

interface Props {
  open: boolean;
  deal: Customer; // "Customer" type ở đây thực chất là 1 dòng Deal (xem customer-lead.service.ts)
  onClose: () => void;
  onCreated: (contract: Contract) => void;
  /** Ten Khach hang CRM CANONICAL that (crm_customers.company_name/
   * customer_name) - BUG THAT DA GAP: truoc day field "Khách hàng" doc nham
   * deal.customer_name (do la ten CƠ HỘI, khong phai ten Khach hang - trung
   * ten voi field "Cơ hội" ben duoi gay nham lan "sao 2 o giong het nhau").
   * Neu khong truyen, fallback ve deal.company_name nhu cu. */
  customerLabel?: string;
  /** BUG THAT DA GAP: truoc day Cơ hội bi CUNG 1 gia tri (readonly, khong sua
   * duoc) - neu Khach hang co NHIEU Co hoi/Du an/Lien he, nguoi dung khong
   * the chon dung Co hoi can ghi nhan hop dong. Danh sach cac Deal cua CUNG
   * 1 Khach hang (Customer 360 da fetch san qua /related, tai su dung KHONG
   * goi lai API) - > 1 phan tu moi hien dropdown, <=1 van hien readonly nhu
   * cu de khong doi UX luc chi co dung 1 lua chon. */
  dealOptions?: DealOption[];
  /** Danh sach Nguoi lien he cua Khach hang (Customer 360 da fetch san qua
   * allContacts) - dropdown moi, chon 1 Lien he se loc lai dropdown "Cơ hội"
   * ben duoi CHI con cac Deal co primary_contact_id = lien he do (nguoc lai
   * khi doi Cơ hội truc tiep thi Lien he cung tu dong khop theo). */
  contactOptions?: Array<{ id: string; name: string }>;
  /** Danh sach Du an cua Khach hang (Customer 360 da fetch san qua
   * projectsSummary.projects) - dropdown moi, cung vai tro loc "Cơ hội" nhu
   * Lien he o tren (giao 2 dieu kien loc). Contract KHONG co cot project_id
   * rieng - field nay CHI dung de loc "Cơ hội", khong luu them gi khac. */
  projectOptions?: Array<{ id: string; projectCode: string; name: string }>;
  /** "Thuộc báo giá nào" (feedback 2026-09-25, PDF mục 7) - danh sách CHUỖI
   * báo giá của khách hàng (Customer 360 đã fetch sẵn qua allQuoteChains, mỗi
   * phần tử = 1 chuỗi version_chain_id, `id`/`label` là của bản CURRENT/mới
   * nhất trong chuỗi). Chọn 1 chuỗi sẽ ghi vào `quote_id` của hợp đồng (đã có
   * sẵn trong CreateContractInput/Contract type) - mặc định dùng bản mới nhất,
   * nhưng nếu `versionCount > 1` modal sẽ tự gọi getQuoteVersions(id) để cho
   * chọn ĐÚNG 1 phiên bản cụ thể trong chuỗi (feedback 2026-09-30: "chọn báo
   * giá phải chọn được đúng phiên bản, không phải lúc nào cũng bản mới nhất").
   * Khi báo giá đó đã duyệt xong, hợp đồng sẽ tự hiện trong "Bản tóm tắt báo
   * giá" của báo giá đó. */
  quoteOptions?: Array<{ id: string; label: string; dealId?: string | null; projectId?: string | null; versionCount?: number }>;
}

const STATUS_OPTIONS: ContractStatus[] = ["signed", "active", "completed", "draft", "pending_signature", "terminated"];
const ALL = "__all__";
const NONE_QUOTE = "__none__";

function formatVND(value?: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);
}

/** Suy ra ten san pham/dich vu CHINH cua 1 bao gia (feedback 2026-10-01: ten
 * hop dong tu sinh phai la ten nghiep vu that, khong phai cum "cung cấp dịch
 * vụ" chung chung) - uu tien lan luot, CHI dung du lieu THAT co san tren
 * Quote, khong bia them field nao:
 *  1. `data.quoteTitle` - tieu de bao gia (thuong da mo ta ro san pham, vd
 *     "CHAT BOT TƯ VẤN KHÓA HỌC").
 *  2. `data.solutionItems` chi co DUNG 1 phan tu - dung ten bundle/goi giai
 *     phap chinh do (nhieu hon 1 thi khong ro cai nao la "chinh", bo qua).
 *  3. Toan bo hang muc THAT (rowType='item') deu cung thuoc 1 Section (Muc
 *     cha, parentItemId) DUY NHAT - dung ten Section do lam ten giai phap
 *     chung (KHONG dung ten tung SKU ky thuat rieng le nhu "MCHAT-CORE...").
 * Tra ve null neu khong xac dinh duoc - goi ham se tu fallback ve cum
 * "cung cấp dịch vụ" nhu cu. */
function deriveQuoteProductName(quote: Quote | null): string | null {
  if (!quote) return null;

  // Tieu de/ten toan chu HOA (thuong go tay kieu "SHOUTING", vd bao gia mau
  // "CHAT BOT TƯ VẤN KHÓA HỌC") -> doi ve cau binh thuong (chi viet hoa chu
  // dau) de ghep vao ten Hop dong tu nhien hon - KHONG doi ten da co chu
  // thuong san (giu nguyen y da go), KHONG tach/ghep lai tu (chi doi case).
  const normalize = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (trimmed === trimmed.toUpperCase() && /[A-ZÀ-Ỹ]/.test(trimmed)) {
      const lower = trimmed.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    }
    return trimmed;
  };

  const quoteTitle = quote.data?.quoteTitle;
  if (quoteTitle && quoteTitle.trim()) return normalize(quoteTitle);

  const solutionItems = quote.data?.solutionItems;
  if (solutionItems && solutionItems.length === 1 && solutionItems[0]?.name?.trim()) {
    return normalize(solutionItems[0].name);
  }

  const allItems = quote.items || [];
  const realItems = allItems.filter(item => item.rowType !== "section");
  if (realItems.length > 0) {
    const parentIds = new Set(realItems.map(item => item.parentItemId).filter((id): id is string => Boolean(id)));
    if (parentIds.size === 1) {
      const sectionId = [...parentIds][0];
      const section = allItems.find(item => item.id === sectionId && item.rowType === "section");
      if (section?.description?.trim()) return normalize(section.description);
    }
  }

  return null;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("vi-VN");
}

/** Pill nho canh label (redesign 2026-10-01, khop mockup "Tự động"/"Tự điền"/
 * "Theo báo giá"/"OCR kiểm tra") - CHI la trang tri UI, khong doi validation/
 * hanh vi field. tone="muted" danh cho pill can noi that ro tinh nang chua
 * kha dung (OCR) thay vi to mau xanh y nhu da xong. */
function Pill({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "muted" }) {
  const cls = tone === "muted" ? "bg-slate-100 text-slate-500" : "bg-blue-100 text-blue-600";
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${cls}`}>{children}</span>;
}

function SectionHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2 pt-1 first:pt-0">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">{n}</span>
      <h3 className="text-sm font-bold text-slate-700">{title}</h3>
    </div>
  );
}

export function RegisterExternalContractModal({ open, deal, onClose, onCreated, customerLabel, dealOptions, contactOptions, projectOptions, quoteOptions }: Props) {
  const [title, setTitle] = useState("");
  const [contractNumber, setContractNumber] = useState("");
  const [contractValue, setContractValue] = useState<number | null>(null);
  const [status, setStatus] = useState<ContractStatus>("signed");
  const [signedAt, setSignedAt] = useState("");
  const [endDate, setEndDate] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  // "Đối chiếu tự động qua OCR" (2026-10-01) - file gốc vừa chọn (giữ lại RAM,
  // KHÔNG đọc lại từ Storage) để gửi kèm quote_id cho endpoint đối chiếu ngay
  // khi cả 2 điều kiện đã sẵn sàng: đã tải file lên VÀ đã chọn báo giá/phiên
  // bản. Đổi file khác hoặc bỏ chọn báo giá sẽ tự xoá state cũ (xem effect
  // dưới) - không giữ lại kết quả đối chiếu của tổ hợp file/báo giá cũ.
  const [ocrFile, setOcrFile] = useState<File | null>(null);
  const [ocrStatus, setOcrStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [ocrResult, setOcrResult] = useState<ContractOcrReconcileResult | null>(null);
  const [ocrError, setOcrError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedDealId, setSelectedDealId] = useState(deal.id);
  const [activeContactId, setActiveContactId] = useState(deal.primary_contact_id || ALL);
  const [activeProjectId, setActiveProjectId] = useState(deal.project_id || ALL);
  const [selectedQuoteId, setSelectedQuoteId] = useState(NONE_QUOTE);
  // Toan bo phien ban (V1/V2/...) cua CHUOI dang chon (tu getQuoteVersions) -
  // chi fetch khi 1 chuoi that su duoc chon (khac NONE_QUOTE). Luon fetch (ke
  // ca chuoi chi co 1 phien ban) vi day cung la nguon du lieu DA CHUAN HOA
  // (quoteOwner/technicalOwner ten that, customerPriceBeforeVat da tinh) cho
  // panel tom tat - RelatedQuoteRow (raw quotes.*) o CrmCustomerDetailPage
  // KHONG co du cac field nay (xem quoteOptions).
  const [chainVersions, setChainVersions] = useState<Quote[] | null>(null);
  const [chainVersionsLoading, setChainVersionsLoading] = useState(false);
  const [chainVersionsError, setChainVersionsError] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  // "Điều chỉnh giá trị hợp đồng" (redesign 2026-10-01, mockup mục "Giá trị
  // hợp đồng"): khong co cot DB rieng cho ly do dieu chinh - khi gia tri nay
  // khac gia bao gia da chon, bat buoc nhap ly do va NOI vao dau `note` hien
  // co luc submit (xem handleSubmit) thay vi bia them cot moi khong ton tai.
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [showAdjustReason, setShowAdjustReason] = useState(false);
  // "Tên hợp đồng"/"Giá trị hợp đồng" tu dong dien theo Khach hang/Bao gia da
  // chon (feedback 2026-09-30: "phải tự gõ tay hết, dropdown chọn báo giá
  // xong không tự điền gì cả") - CHI ghi de khi gia tri hien tai dung la gia
  // tri lan truoc TU DONG dien (== ref) hoac con rong, tranh xoa mat gia tri
  // nguoi dung da tu sua tay (giong quy uoc "!title" cua ManualContractModal,
  // nhung dung ref thay vi chi check rong de con cap nhat duoc SAU KHI da tu
  // dien 1 lan, luc doi sang bao gia/phien ban khac).
  const lastAutoTitleRef = useRef("");
  const lastAutoValueRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setContractNumber("");
    setContractValue(null);
    setStatus("signed");
    setSignedAt("");
    setEndDate("");
    setFileUrl("");
    setLinkInput("");
    setNote("");
    setError("");
    setOcrFile(null);
    setOcrStatus("idle");
    setOcrResult(null);
    setOcrError("");
    setSelectedDealId(deal.id);
    setActiveContactId(deal.primary_contact_id || ALL);
    setActiveProjectId(deal.project_id || ALL);
    setSelectedQuoteId(NONE_QUOTE);
    setChainVersions(null);
    setChainVersionsError("");
    setSelectedVersionId("");
    setAdjustmentReason("");
    setShowAdjustReason(false);
    setQuickViewOpen(false);
    lastAutoTitleRef.current = "";
    lastAutoValueRef.current = null;
  }, [open, deal.id, deal.primary_contact_id, deal.project_id]);

  // Chi goi y bao gia THUOC dung Co hoi/Du an dang chon (giong cach loc Cơ hội
  // theo Lien he/Du an o tren) - neu doi Cơ hội/Du an sang cai khac, bao gia
  // da chon (neu khong thuoc nua) se bi bo chon lai o effect ben duoi thay vi
  // gui nham quote_id cua 1 Cơ hội/Du an khac.
  const filteredQuotes = useMemo(
    () => (quoteOptions || []).filter(
      q => (!q.dealId || q.dealId === selectedDealId) && (activeProjectId === ALL || !q.projectId || q.projectId === activeProjectId)
    ),
    [quoteOptions, selectedDealId, activeProjectId]
  );

  useEffect(() => {
    if (!open) return;
    if (selectedQuoteId !== NONE_QUOTE && !filteredQuotes.some(q => q.id === selectedQuoteId)) {
      setSelectedQuoteId(NONE_QUOTE);
    }
  }, [open, filteredQuotes, selectedQuoteId]);

  // Tai TOAN BO phien ban cua chuoi vua chon (kem ten Presale/Sale that, Gia
  // khach da tinh) - dung LAI DUNG endpoint GET /quotes/{id}/versions da co san
  // (list_quote_versions, xem QuoteHistoryPage/QuoteCenterPage "xem phien ban
  // cu"), KHONG tao API rieng. Mac dinh chon phien ban MOI NHAT (versions[0],
  // backend da tra ve sap xep version_number giam dan).
  useEffect(() => {
    if (!open || !selectedQuoteId || selectedQuoteId === NONE_QUOTE) {
      setChainVersions(null);
      setSelectedVersionId("");
      setChainVersionsError("");
      return;
    }
    let alive = true;
    setChainVersionsLoading(true);
    setChainVersionsError("");
    seedingQuoteRepository.getQuoteVersions(selectedQuoteId)
      .then(versions => {
        if (!alive) return;
        setChainVersions(versions);
        setSelectedVersionId(versions[0]?.id || selectedQuoteId);
      })
      .catch(err => {
        if (!alive) return;
        setChainVersions(null);
        // Van giu selectedQuoteId de nguoi dung CO THE chon bao gia nay (chi
        // thieu panel tom tat/chon phien ban cu the) - KHONG chan hoi (feedback
        // 2026-10-01: "xem dữ liệu là read action, không nên biến mất chỉ vì
        // không có quyền edit"). Rieng truong hop bao gia NHAP ma nguoi dung
        // khong co quyen sua (loi that tu backend, dung nguyen luat quyen chung
        // toan he thong - KHONG doi luat do o day) thi doi thanh 1 dong ghi chu
        // nhe nhang thay vi hien nhu 1 loi that su.
        const message = err instanceof Error ? err.message : "";
        setSelectedVersionId(selectedQuoteId);
        setChainVersionsError(
          message === "Không có quyền xem báo giá này"
            ? "Báo giá này đang ở dạng nháp và bạn chưa có quyền xem chi tiết — vẫn chọn được để gắn vào hợp đồng."
            : message || "Không tải được chi tiết báo giá."
        );
      })
      .finally(() => { if (alive) setChainVersionsLoading(false); });
    return () => { alive = false; };
  }, [open, selectedQuoteId]);

  const selectedVersion = chainVersions?.find(v => v.id === selectedVersionId) || null;
  // Fallback (feedback 2026-10-01): bao gia co the thieu contactId (bao gia
  // cu) - lan luot thu: contactId cua bao gia -> primary_contact_id cua Cơ
  // hội dang chon -> (Khach hang KHONG co field primary_contact_id rieng o
  // cap Customer, xem comment ContactAssignCell trong CrmCustomerDetailPage -
  // "primary_contact_id NAM TREN Deal, khong phai Customer") nen fallback gan
  // nhat la: Khach hang chi co DUNG 1 Lien he -> dung luon nguoi do -> "—".
  // Dung CHUNG 1 gia tri cho ca panel tom tat trong form nay VA panel
  // "Xem nhanh báo giá" (QuoteQuickViewDrawer, prop primaryContactName) -
  // khong fork lai logic resolve lan thu hai.
  const resolvedContactName = selectedVersion
    ? contactOptions?.find(c => c.id === (
        selectedVersion.contactId
        || (dealOptions || []).find(d => d.id === selectedDealId)?.primary_contact_id
        || (contactOptions.length === 1 ? contactOptions[0].id : undefined)
      ))?.name || null
    : null;
  // "Theo báo giá" / "Điều chỉnh giá trị hợp đồng" (redesign 2026-10-01) - so
  // sanh gia tri dang nhap voi gia bao gia da chon (CUNG 1 cong thuc voi effect
  // tu dien "Giá trị hợp đồng" ben duoi: customerPriceBeforeVat, fallback
  // totalAmount) de biet co can bat buoc ly do dieu chinh hay khong.
  const quotePrice = selectedVersion ? (selectedVersion.customerPriceBeforeVat ?? selectedVersion.totalAmount ?? null) : null;
  const valueDiffersFromQuote = quotePrice != null && contractValue != null && contractValue !== quotePrice;
  const isLatestVersion = chainVersions && chainVersions.length > 0 ? chainVersions[0]?.id === selectedVersionId : true;

  // "Đối chiếu tự động qua OCR" (2026-10-01, thay placeholder cũ) - tự chạy
  // NGAY khi cả 2 điều kiện đã có: đã tải file lên (ocrFile) VÀ đã chọn 1 báo
  // giá/phiên bản cụ thể (selectedVersionId) - không cần thêm 1 click nào,
  // khớp đúng luồng "chọn báo giá xong đã thấy panel tóm tắt tự điền" đã có
  // sẵn trong modal này. Đổi sang file khác hoặc đổi báo giá/phiên bản khác
  // sẽ tự chạy lại (dependency đủ cả 2), không giữ kết quả của tổ hợp cũ.
  useEffect(() => {
    if (!open || !ocrFile || !selectedVersionId) return;
    let alive = true;
    setOcrStatus("loading");
    setOcrError("");
    seedingContractRepository
      .ocrReconcile(ocrFile, selectedVersionId)
      .then(result => {
        if (!alive) return;
        setOcrResult(result);
        setOcrStatus("done");
      })
      .catch(err => {
        if (!alive) return;
        setOcrResult(null);
        setOcrStatus("error");
        setOcrError(err instanceof Error ? err.message : "Không đối chiếu được hợp đồng.");
      });
    return () => { alive = false; };
  }, [open, ocrFile, selectedVersionId]);

  // Tu dong dien "Tên hợp đồng" theo San pham/dich vu CHINH cua Bao gia da
  // chon + Khach hang (feedback 2026-10-01: "Hợp đồng {tên sản phẩm/dịch vụ
  // phù hợp} – {tên khách hàng}", KHONG con la cum "cung cấp dịch vụ" chung
  // chung nhu cu - xem deriveQuoteProductName() cho thu tu uu tien) - chi
  // ghi de khi nguoi dung CHUA tu sua (title con rong hoac dung == lan tu
  // dien truoc do), khong bao gio xoa noi dung nguoi dung da go tay.
  useEffect(() => {
    if (!open) return;
    const customerName = (customerLabel || deal.customer_name || deal.company_name || "").trim();
    if (!customerName) return;
    const productName = deriveQuoteProductName(selectedVersion);
    const generated = productName
      ? `Hợp đồng ${productName} – ${customerName}`
      : `Hợp đồng cung cấp dịch vụ — ${customerName}`;
    setTitle(current => {
      if (current !== "" && current !== lastAutoTitleRef.current) return current;
      lastAutoTitleRef.current = generated;
      return generated;
    });
  }, [open, customerLabel, deal.customer_name, deal.company_name, selectedVersion]);

  // Tu dong dien "Giá trị hợp đồng" = Gia khach cua bao gia da chon (cung 1
  // gia tri hien trong panel tom tat ben duoi va o cot "GIÁ KHÁCH" cua Quote
  // Center) - chi ghi de khi nguoi dung CHUA tu sua gia tri nay.
  useEffect(() => {
    if (!open || !selectedVersion) return;
    const price = selectedVersion.customerPriceBeforeVat ?? selectedVersion.totalAmount ?? null;
    if (price == null) return;
    setContractValue(current => {
      if (current !== null && current !== lastAutoValueRef.current) return current;
      lastAutoValueRef.current = price;
      return price;
    });
  }, [open, selectedVersion]);

  // Danh sach Cơ hội hien theo dung 2 bo loc Lien he/Du an dang chon (giao 2
  // dieu kien) - "Tất cả" (ALL) o 1 hoac ca 2 bo loc thi coi nhu khong loc
  // theo dieu kien do. Neu giao rong (vd doi Lien he sang 1 nguoi chua gan
  // Chi co DUNG 1 Du an -> tu dong chon luon (khong de "Tất cả dự án" mac
  // dinh) de Cơ hội/Báo giá ben duoi loc dung theo Du an do ngay tu dau,
  // dung yeu cau "auto nhập nếu 1 dự án" (2026-09-30).
  useEffect(() => {
    if (!open) return;
    if (projectOptions && projectOptions.length === 1 && activeProjectId !== projectOptions[0].id) {
      setActiveProjectId(projectOptions[0].id);
    }
  }, [open, projectOptions, activeProjectId]);

  // Cơ hội nao) thi fallback ve toan bo dealOptions - KHONG duoc de dropdown
  // Cơ hội trong rong khong co gi de chon.
  const filteredDeals = useMemo(() => {
    const all = dealOptions || [];
    const byContact = activeContactId === ALL ? all : all.filter(d => d.primary_contact_id === activeContactId);
    const byBoth = activeProjectId === ALL ? byContact : byContact.filter(d => d.project_id === activeProjectId);
    return byBoth.length > 0 ? byBoth : all;
  }, [dealOptions, activeContactId, activeProjectId]);

  // Neu Cơ hội dang chon khong con thuoc danh sach da loc (doi Lien he/Du an
  // lam thu hep lua chon), tu dong nhay sang phan tu dau tien hop le - tranh
  // gui dealId khong khop voi bo loc dang hien thi tren UI.
  useEffect(() => {
    if (!open) return;
    if (!filteredDeals.some(d => d.id === selectedDealId) && filteredDeals.length > 0) {
      setSelectedDealId(filteredDeals[0].id);
    }
  }, [open, filteredDeals, selectedDealId]);

  function handleDealChange(newDealId: string) {
    setSelectedDealId(newDealId);
    const found = (dealOptions || []).find(d => d.id === newDealId);
    if (found) {
      setActiveContactId(found.primary_contact_id || ALL);
      setActiveProjectId(found.project_id || ALL);
    }
  }

  if (!open) return null;

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    // File mới - bỏ kết quả đối chiếu cũ (nếu có) ngay lập tức, tránh hiển thị
    // nhầm kết quả của file trước đó trong lúc file mới đang tải lên.
    setOcrStatus("idle");
    setOcrResult(null);
    setOcrError("");
    try {
      const result = await customerLeadService.uploadAttachment(file, "contract", deal.customer_id || undefined);
      setFileUrl(result.url);
      setLinkInput("");
      // Giữ lại nguyên File object (không đọc lại từ Storage) để gửi cho
      // endpoint đối chiếu OCR ngay khi đã có báo giá được chọn (xem effect
      // "Đối chiếu tự động" bên dưới).
      setOcrFile(file);
      toast.success("Đã tải file lên");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Tải file thất bại");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("Vui lòng nhập tên hợp đồng.");
      return;
    }
    // Feedback mentor (2026-10-03): "Báo giá / phiên bản" phải bắt buộc chọn,
    // khong con cho phep "Không gắn báo giá" nua.
    if (selectedQuoteId === NONE_QUOTE) {
      setError("Vui lòng chọn báo giá.");
      return;
    }
    // "Điều chỉnh giá trị hợp đồng" (redesign 2026-10-01) - bat buoc ly do khi
    // gia tri nguoi dung nhap khac gia bao gia da chon, giong y het khuon
    // validation "!title.trim()" o tren.
    if (valueDiffersFromQuote && !adjustmentReason.trim()) {
      setError("Giá trị hợp đồng khác báo giá đã chọn — vui lòng nhập lý do điều chỉnh.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Khong co cot DB rieng cho "ly do dieu chinh gia tri" - noi vao dau
      // `note` hien co (field da duoc gui len backend san) thay vi bia them
      // cot moi khong ton tai.
      const finalNote = valueDiffersFromQuote && adjustmentReason.trim()
        ? `Điều chỉnh giá trị hợp đồng: ${adjustmentReason.trim()}${note.trim() ? `\n${note.trim()}` : ""}`
        : note.trim() || undefined;
      const contract = await seedingContractRepository.createContract({
        dealId: selectedDealId,
        // Gui DUNG id phien ban da chon (selectedVersionId) - KHAC selectedQuoteId
        // (id cua bản CURRENT trong chuoi, chi dung de loc dropdown) khi nguoi
        // dung da doi sang 1 phien ban cu hon qua dropdown "Phiên bản".
        quoteId: selectedQuoteId === NONE_QUOTE ? undefined : (selectedVersionId || selectedQuoteId),
        contractNumber: contractNumber.trim() || undefined,
        title: title.trim(),
        status,
        signedAt: signedAt || undefined,
        contractValue: contractValue ?? 0,
        endDate: endDate || undefined,
        source: "external",
        fileUrl: fileUrl || linkInput.trim() || undefined,
        note: finalNote,
      });
      toast.success("Đã ghi nhận hợp đồng");
      onCreated(contract);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không ghi nhận được hợp đồng.");
    } finally {
      setSaving(false);
    }
  }

  const customerNameResolved = customerLabel || deal.customer_name || deal.company_name || "";
  const dealNameResolved = (dealOptions || []).find(d => d.id === selectedDealId)?.customer_name || deal.customer_name;
  const projectCount = projectOptions?.length || 0;
  const projectHint = projectCount > 1
    ? `Có ${projectCount} dự án, vui lòng chọn.`
    : projectCount === 1
      ? "Chỉ có 1 dự án."
      : "Khách hàng chưa có dự án nào.";
  // Panel "Xem nhanh báo giá" chi mo rong duoc khi da co 1 phien ban that de
  // xem (redesign 2026-10-01: split-panel thay vi overlay full man hinh).
  const showQuickViewPanel = quickViewOpen && Boolean(selectedVersion);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-[99984] bg-black/40 backdrop-blur-sm" />
      {/* Feedback 2026-10-01 (3 lan): (1) "để khi mở báo giá k bị giật" ->
       * (2) "to quá... chỉ mở thêm kế bên chứ k phải dồn content ra" -> (3)
       * "t mún form nó to như ảnh nè nma bỏ cái xem nhanh đi... khi bấm xem
       * nhanh nó hiện thêm chứ nó k từ nhỏ ra to rồi hiện". Ket luan DUNG:
       * form PHAI la 1 CHIEU RONG CO DINH (khong con max-w+mx-auto co the
       * bi keo gian boi flex-1, xem <div> cot form duoi) - GIONG HET luc
       * dang mo panel (kich thuoc "ảnh nè" nguoi dung tro toi), ke ca luc
       * dong panel. <aside> KHONG con set max-w co dieu kien nua - de
       * position:fixed (chi set `right-0`, khong set `left-0`) tu shrink-
       * to-fit theo TONG chieu rong cac cot con that su co mat (form co
       * dinh + panel "Xem nhanh báo giá" NEU dang mo) - panel mo ra dung la
       * "hiện thêm" 1 cot ben trai, form khong bao gio doi kich thuoc. */}
      <aside className="fixed right-0 top-0 z-[99985] flex h-screen flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex h-full min-h-0 flex-1">
          {/* "Xem nhanh báo giá" giờ hiện SONG SONG bên trái form (mockup
           * 2026-10-01) thay vì 1 drawer overlay thứ hai đè hết màn hình -
           * dùng lại NGUYÊN QuoteQuickViewDrawer (mode="embedded", prop mới
           * chỉ caller này dùng - DealWorkspaceTabs không truyền `mode` nên
           * giao diện/hành vi drawer overlay của nó KHÔNG đổi). Truyền thêm
           * `versions`/`onSelectVersion` để mục "Lịch sử phiên bản" trong
           * panel này đổi được NGAY selectedVersionId của form bên phải. */}
          {showQuickViewPanel ? (
            <div className="hidden h-full w-[38rem] shrink-0 border-r border-slate-200 md:block">
              <QuoteQuickViewDrawer
                quote={selectedVersion}
                open
                mode="embedded"
                versions={chainVersions}
                selectedVersionId={selectedVersionId}
                onSelectVersion={setSelectedVersionId}
                customerName={customerNameResolved}
                dealName={dealNameResolved}
                primaryContactName={resolvedContactName}
                onClose={() => setQuickViewOpen(false)}
              />
            </div>
          ) : null}

          {/* Chieu rong CO DINH (xem comment o <aside>) - khong con flex-1
           * (se tu keo gian/co lai theo <aside>), day chinh la chieu rong
           * "ảnh nè" nguoi dung muon giu nguyen du dong/mo panel. */}
          <div className="flex h-full w-[46rem] shrink-0 flex-col">
            <header className="flex shrink-0 items-start justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Ghi nhận hợp đồng có sẵn</h2>
                <p className="mt-0.5 text-xs text-slate-500">Thêm hợp đồng đã ký bên ngoài vào CRM</p>
              </div>
              <button onClick={onClose} className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                <X className="size-4" />
              </button>
            </header>

            <form id="registerExternalContractForm" className="crm-scroll-hidden w-full flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm" onSubmit={handleSubmit}>
              <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                Hợp đồng này đã được ký/làm bên ngoài. Vui lòng nhập các thông tin cơ bản và đính kèm file hoặc link.
              </div>

              {error ? <p className="text-red-600">{error}</p> : null}

              <SectionHeader n={1} title="Liên kết dữ liệu CRM" />

              {/* Nhóm field đã có sẵn giá trị mặc định (feedback 2026-09-25, PDF
               * mục 7: "những phần được set là điền mặc định, sẽ cho lên hàng
               * trên hết") - đứng trước nhóm phải nhập tay bên dưới. */}
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  Khách hàng
                  <Pill>Tự động</Pill>
                </span>
                <input value={customerNameResolved} disabled readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
                <p className="mt-1 text-[11px] text-slate-400">Đang tạo hợp đồng trong Không gian khách hàng {customerNameResolved}.</p>
              </label>

              {contactOptions && contactOptions.length > 0 ? (
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Người liên hệ</span>
                  <select
                    value={activeContactId}
                    onChange={e => setActiveContactId(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value={ALL}>Tất cả liên hệ</option>
                    {contactOptions.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              {/* Dự án + Cơ hội SONG SONG 2 cột (redesign 2026-10-01, mockup) -
               * vẫn cùng logic loc/auto-fill 2 chieu voi nhau nhu cu, chi doi
               * layout tu xep chong (block) sang grid-cols-2. */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Dự án</span>
                  {projectOptions && projectOptions.length > 1 ? (
                    <select
                      value={activeProjectId}
                      onChange={e => setActiveProjectId(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value={ALL}>Tất cả dự án</option>
                      {projectOptions.map(p => (
                        <option key={p.id} value={p.id}>{p.projectCode} · {p.name}</option>
                      ))}
                    </select>
                  ) : projectOptions && projectOptions.length === 1 ? (
                    <input value={`${projectOptions[0].projectCode} · ${projectOptions[0].name}`} disabled readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
                  ) : (
                    <select disabled className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400">
                      <option>Khách hàng chưa có dự án nào</option>
                    </select>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">{projectHint}</p>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Cơ hội</span>
                  {dealOptions && dealOptions.length > 1 ? (
                    <select
                      value={selectedDealId}
                      onChange={e => handleDealChange(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    >
                      {filteredDeals.map(d => (
                        <option key={d.id} value={d.id}>{d.customer_name || d.id}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={deal.customer_name || ""} disabled readOnly className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500" />
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">Được lọc theo dự án đã chọn.</p>
                </label>
              </div>

              {/* "Báo giá / phiên bản" (redesign 2026-10-01) - gop 2 dropdown
               * "Thuộc báo giá nào" + "Phiên bản" thanh 1 nhom field hien thi
               * gia tri gop dang "SO BAO GIA · V.. · GIA · Mới nhất/cũ" (dung
               * y het cong thuc/nguon du lieu cu, CHI doi cach hien thi - van
               * loai bao gia huy/xoa, van loc theo Du an/Cơ hội dang chon,
               * van mac dinh phien ban moi nhat qua effect getQuoteVersions
               * o tren). */}
              <div className="rounded-md border border-slate-300 p-3">
                <span className="mb-2 block text-xs font-semibold text-slate-600">Báo giá / phiên bản *</span>
                {selectedVersion ? (
                  <div className="mb-2 text-sm font-semibold text-slate-800">
                    {selectedVersion.quoteNumber} · V{selectedVersion.versionNumber || 1} · {formatVND(quotePrice)} · {isLatestVersion ? "Mới nhất" : "Phiên bản cũ"}
                  </div>
                ) : (
                  <div className="mb-2 text-sm text-slate-400">{filteredQuotes.length ? "Chưa chọn báo giá" : "Khách hàng chưa có báo giá nào"}</div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={selectedQuoteId}
                    onChange={e => setSelectedQuoteId(e.target.value)}
                    disabled={!filteredQuotes.length}
                    className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value={NONE_QUOTE} disabled>{filteredQuotes.length ? '-- Chọn báo giá --' : 'Khách hàng chưa có báo giá nào'}</option>
                    {filteredQuotes.map(q => (
                      <option key={q.id} value={q.id}>{q.label}{q.versionCount && q.versionCount > 1 ? ` (${q.versionCount} phiên bản)` : ''}</option>
                    ))}
                  </select>
                  {selectedQuoteId !== NONE_QUOTE && chainVersions && chainVersions.length > 1 ? (
                    <select
                      value={selectedVersionId}
                      onChange={e => setSelectedVersionId(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
                    >
                      {chainVersions.map((v, idx) => (
                        <option key={v.id} value={v.id}>
                          V{v.versionNumber || 1}{idx === 0 ? ' (mới nhất)' : ''} · {internalQuoteStatusLabel(v.status)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                {selectedQuoteId !== NONE_QUOTE && chainVersionsLoading ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="size-3 animate-spin" /> Đang tải chi tiết báo giá...</p>
                ) : null}
                {selectedQuoteId !== NONE_QUOTE && chainVersionsError ? (
                  <p className="mt-2 text-xs text-amber-600">{chainVersionsError}</p>
                ) : null}
                <p className="mt-2 text-[11px] text-slate-400">Mặc định chọn phiên bản mới nhất. Chỉ hiển thị báo giá thuộc Dự án/Cơ hội đang chọn.</p>
              </div>

              {/* Panel tom tat bao gia da chon (feedback 2026-09-30: "chọn xong
               * phải thấy được liên hệ chính/phụ trách/giá/trạng thái của báo giá
               * đó, không phải bấm mở báo giá mới biết") - CHI hien field co that
               * tren record bao gia (khong bia them field moi). "Giá khách" dung
               * DUNG alias customerPriceBeforeVat (netRevenue) - cung 1 gia tri
               * voi cot "GIÁ KHÁCH" o Quote Center (QuoteCenterPage.tsx), fallback
               * totalAmount khi backend chua tinh duoc (vd bao gia rong hang muc).
               * "LIÊN KẾT" (redesign 2026-10-01) - du lieu that da co san
               * (customerNameResolved/dealNameResolved), khong phai bia them. */}
              {selectedVersion ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-800">{selectedVersion.quoteNumber} · V{selectedVersion.versionNumber || 1}</span>
                    <button
                      type="button"
                      onClick={() => setQuickViewOpen(true)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <Eye className="size-3" /> Xem nhanh báo giá →
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <div className="text-slate-400">GIÁ KHÁCH</div>
                      <div className="font-medium text-slate-700">{formatVND(selectedVersion.customerPriceBeforeVat ?? selectedVersion.totalAmount ?? null)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">LIÊN HỆ CHÍNH</div>
                      <div className="font-medium text-slate-700">{resolvedContactName || "—"}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">PHỤ TRÁCH</div>
                      <div className="font-medium text-slate-700">{selectedVersion.quoteOwner?.name || selectedVersion.technicalOwner?.name || "—"}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">TRẠNG THÁI</div>
                      <div className="font-medium text-slate-700">{internalQuoteStatusLabel(selectedVersion.status)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">CẬP NHẬT</div>
                      <div className="font-medium text-slate-700">{formatDateTime(selectedVersion.updatedAt)}</div>
                    </div>
                    <div>
                      <div className="text-slate-400">LIÊN KẾT</div>
                      <div className="truncate font-medium text-slate-700">{customerNameResolved} / {dealNameResolved || "—"}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              <SectionHeader n={2} title="Thông tin hợp đồng" />

              {/* Nhóm field phải nhập tay (feedback 2026-09-25, PDF mục 7) - Tên
               * hợp đồng/Giá trị hợp đồng nay TU DONG dien theo Khach hang/Bao gia
               * da chon (feedback 2026-09-30), van sua tay duoc binh thuong. */}
              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  Tên hợp đồng *
                  <Pill>Tự điền</Pill>
                </span>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Hợp đồng triển khai..."
                />
                <p className="mt-1 text-[11px] text-slate-400">Sinh tự động từ sản phẩm/dịch vụ và khách hàng. Có thể chỉnh sửa.</p>
              </label>

              <label className="block">
                <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  Giá trị hợp đồng
                  <Pill>Theo báo giá</Pill>
                </span>
                {/* CurrencyInput: tu dong them dau cham ngan 3 so luc go (feedback
                 * 2026-09-25) - day la tien VND, dung chung component format tien
                 * da co san trong app thay vi input number tho. Gia tri tu dong
                 * dien = Gia khach cua bao gia da chon (xem effect tren), van sua
                 * tay duoc binh thuong. */}
                <CurrencyInput
                  value={contractValue}
                  onChange={setContractValue}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="0"
                />
                {quotePrice != null ? (
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">Theo {selectedVersion?.quoteNumber} · V{selectedVersion?.versionNumber || 1}</span>
                    {!showAdjustReason && !valueDiffersFromQuote ? (
                      <button type="button" onClick={() => setShowAdjustReason(true)} className="text-[11px] font-semibold text-primary hover:underline">
                        Điều chỉnh
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <p className="mt-1 text-[11px] text-slate-400">Nếu giá trị thực tế khác báo giá, hệ thống sẽ yêu cầu lý do điều chỉnh.</p>
                {/* "Lý do điều chỉnh giá trị hợp đồng" (redesign 2026-10-01) -
                 * tinh nang that: bat buoc nhap khi gia tri khac gia bao gia
                 * (xem valueDiffersFromQuote + validation trong handleSubmit),
                 * gia tri nay duoc NOI vao dau `note` gui backend - KHONG co
                 * cot DB rieng, khong bia them cot moi. */}
                {showAdjustReason || valueDiffersFromQuote ? (
                  <div className="mt-2">
                    <span className="mb-1 block text-[11px] font-semibold text-slate-600">
                      Lý do điều chỉnh giá trị hợp đồng {valueDiffersFromQuote ? "*" : ""}
                    </span>
                    <input
                      value={adjustmentReason}
                      onChange={e => setAdjustmentReason(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Vì sao giá trị hợp đồng khác báo giá..."
                    />
                  </div>
                ) : null}
              </label>

              {/* "Trạng thái" + "Số hợp đồng" deu ngan (feedback 2026-09-26: "có
               * những dropdown không cần thiết phải dài như vậy... cho 1 hàng 2
               * dropdown cho đẹp") - ghep chung 1 hang. */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Trạng thái</span>
                  <select value={status} onChange={e => setStatus(e.target.value as ContractStatus)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
                    {STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{CONTRACT_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Số hợp đồng</span>
                  <input
                    value={contractNumber}
                    onChange={e => setContractNumber(e.target.value)}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="HD-2025-021"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Ngày ký</span>
                  <input type="date" value={signedAt} onChange={e => setSignedAt(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Hiệu lực đến</span>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                    File hợp đồng
                    <Pill>OCR kiểm tra</Pill>
                  </span>
                  <label className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-300 text-center text-xs text-slate-500 hover:bg-slate-50">
                    {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                    <span>{fileUrl ? "Đã tải file — chọn lại" : "Chọn file"}</span>
                    <input type="file" className="hidden" onChange={handleFileChange} disabled={uploading} />
                  </label>
                  {fileUrl ? (
                    <div className="mt-1 space-y-0.5">
                      <p className="truncate text-[11px] text-emerald-600" title={ocrFile?.name}>
                        Đã đính kèm file{ocrFile ? `: ${ocrFile.name}` : ""}
                      </p>
                      {/* "Đối chiếu tự động qua OCR" (2026-10-01) - trạng thái
                       * ngắn gọn ở đây, bảng so sánh đầy đủ hiện full-width
                       * bên dưới (đủ chỗ cho 3 dòng x 3 cột). Không bao giờ
                       * bịa số liệu: chưa chọn báo giá / đang tải / lỗi /
                       * không đọc được đều là các thông báo thật. */}
                      {!selectedVersionId ? (
                        <p className="text-[11px] text-slate-400">Đã tải file lên. Chọn báo giá ở trên để tự động đối chiếu.</p>
                      ) : ocrStatus === "loading" ? (
                        <p className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Loader2 className="size-3 animate-spin" /> Đang đối chiếu với báo giá...
                        </p>
                      ) : ocrStatus === "error" ? (
                        <p className="text-[11px] text-amber-600">{ocrError || "Không đối chiếu được hợp đồng — vui lòng kiểm tra thủ công."}</p>
                      ) : ocrStatus === "done" && ocrResult && !ocrResult.extractable ? (
                        <p className="text-[11px] text-amber-600">Không đọc được nội dung file để đối chiếu tự động — vui lòng kiểm tra thủ công.</p>
                      ) : ocrStatus === "done" && ocrResult ? (
                        <p className={`text-[11px] font-medium ${ocrResult.allMatched ? "text-emerald-600" : "text-amber-600"}`}>
                          {ocrResult.allMatched ? "Đã đối chiếu — số liệu khớp báo giá" : "Đã đối chiếu — có chênh lệch, xem bảng bên dưới"}
                        </p>
                      ) : (
                        <p className="text-[11px] text-slate-400">Đã tải file lên. Đối chiếu tự động qua OCR chưa khả dụng — vui lòng kiểm tra thủ công.</p>
                      )}
                    </div>
                  ) : null}
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Link hợp đồng</span>
                  <input
                    value={linkInput}
                    onChange={e => {
                      setLinkInput(e.target.value);
                      setFileUrl("");
                    }}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    placeholder="https://drive.google.com/..."
                  />
                </label>
              </div>

              {/* Bảng đối chiếu OCR đầy đủ (2026-10-01) - CHỈ hiện khi đã có
               * kết quả THẬT từ backend (ocrStatus === "done" && extractable).
               * Không đọc được / lỗi / chưa chọn báo giá đều đã có thông báo
               * honest ở trên, KHÔNG render bảng giả ở đây. */}
              {ocrStatus === "done" && ocrResult && ocrResult.extractable ? (
                <div className={`rounded-md border p-3 ${ocrResult.allMatched ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <div className={`mb-2 flex items-center gap-1.5 text-xs font-semibold ${ocrResult.allMatched ? "text-emerald-700" : "text-amber-700"}`}>
                    {ocrResult.allMatched ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                    {ocrResult.allMatched
                      ? "Số liệu trên file hợp đồng khớp với báo giá đã chọn"
                      : "Số liệu trên file hợp đồng có chênh lệch so với báo giá đã chọn"}
                    <span className="ml-auto font-normal text-slate-400">
                      {ocrResult.extracted.extractionMethod === "ai" ? "Trích xuất bằng AI" : "Trích xuất bằng quy tắc (heuristic) — có thể chưa chính xác 100%"}
                    </span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-slate-400">
                        <th className="py-1 font-medium">Chỉ tiêu</th>
                        <th className="py-1 font-medium">Hợp đồng (OCR)</th>
                        <th className="py-1 font-medium">Báo giá</th>
                        <th className="py-1 font-medium">Kết quả</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ocrResult.comparison.map(row => (
                        <tr key={row.label} className="border-t border-black/5">
                          <td className="py-1.5 text-slate-600">{row.label}</td>
                          <td className="py-1.5 font-medium text-slate-700">{formatVND(row.contractValue)}</td>
                          <td className="py-1.5 font-medium text-slate-700">{formatVND(row.quoteValue)}</td>
                          <td className={`py-1.5 font-semibold ${row.matched ? "text-emerald-600" : "text-red-500"}`}>
                            {row.matched ? "Khớp" : "Lệch"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {ocrResult.extracted.contractNumber || ocrResult.extracted.signedAt ? (
                    <p className="mt-2 text-[11px] text-slate-400">
                      Đọc được từ file: {ocrResult.extracted.contractNumber ? `Số HĐ ${ocrResult.extracted.contractNumber}` : null}
                      {ocrResult.extracted.contractNumber && ocrResult.extracted.signedAt ? " · " : null}
                      {ocrResult.extracted.signedAt ? `Ngày ký ${formatDateTime(ocrResult.extracted.signedAt)}` : null}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Ghi chú</span>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </label>
            </form>

            <footer className="shrink-0 border-t border-slate-200 px-5 py-3">
              <div className="w-full">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] text-emerald-600">
                  <Check className="size-3" /> Dữ liệu liên kết được kiểm tra trước khi lưu
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                    Hủy
                  </button>
                  <button type="submit" form="registerExternalContractForm" disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                    {saving ? "Đang lưu..." : "Lưu hợp đồng"}
                  </button>
                </div>
              </div>
            </footer>
          </div>
        </div>
      </aside>
    </>
  );
}
