"""Seed the two real quote form templates (idempotent) for Seeding's CRM.

Requires migration 028_quote_forms_and_quotes.sql to already be applied
(quote_forms/quotes/quote_items tables + customer_leads.quote_id column).

Idempotent: upserts by unique `code`, safe to run multiple times.

Content ported from chatwoot/overrides/app/services/quote_forms/{standard_seed,
villa_automation_seed}.rb — same two templates already used in production Chatwoot,
adapted to the plain JSON shape consumed by modules/quotes on the frontend.
"""
import sys
from pathlib import Path

import copy

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.supabase_client import get_supabase_client  # noqa: E402


def field(key, label, type_, required=False, editable=True, visible=True,
          default_value=None, placeholder=None, help_text=None, options=None,
          config=None, formula=None):
    data = {"key": key, "label": label, "type": type_, "required": required,
            "editable": editable, "visible": visible}
    if default_value is not None:
        data["defaultValue"] = default_value
    if placeholder is not None:
        data["placeholder"] = placeholder
    if help_text is not None:
        data["helpText"] = help_text
    if options is not None:
        data["options"] = options
    if config is not None:
        data["config"] = config
    if formula is not None:
        data["formula"] = formula
    return data


def section(key, title, fields):
    return {"key": key, "title": title, "fields": fields}


def standard_schema():
    return {
        "version": 1,
        "layoutType": "cloudgate_standard_quote",
        "sections": [
            section("seller", "THÔNG TIN ĐƠN VỊ BÁO GIÁ", [
                field("sellerCompanyName", "Tên công ty", "text", required=True, default_value="CÔNG TY TNHH CLOUDGATE"),
                field("sellerAddress", "Địa chỉ công ty", "textarea", default_value=""),
                field("sellerContactName", "Người liên hệ", "text", required=True, default_value="Dương Thị Mai"),
                field("sellerPhone", "SĐT", "phone", required=True, default_value="+84 906750554"),
                field("sellerEmail", "Email", "email", required=True, default_value="sales@getcloudgate.com"),
                field("sellerWebsite", "Website", "text", default_value="Getcloudgate.com"),
            ]),
            section("customer", "THÔNG TIN KHÁCH HÀNG", [
                field("customerRecipient", "Kính gửi", "text", required=True,
                      placeholder="Ví dụ: Anh Nguyễn Văn An",
                      help_text="Nhập tên người nhận báo giá hoặc đại diện khách hàng."),
                field("customerCompanyName", "Khách hàng", "text", required=True,
                      placeholder="Ví dụ: Công ty TNHH Markee",
                      help_text="Nhập đúng tên công ty hoặc dự án của khách hàng."),
                field("customerContactName", "Người liên hệ khách hàng", "text",
                      placeholder="Ví dụ: Nguyễn Văn An",
                      help_text="Nhập người đang trao đổi trực tiếp với bộ phận kinh doanh."),
                field("customerAddress", "Địa chỉ", "textarea",
                      placeholder="Ví dụ: 12 Nguyễn Huệ, Quận 1, TP.HCM",
                      help_text="Nhập địa chỉ xuất hóa đơn hoặc địa chỉ dự án nếu có."),
                field("customerPhone", "Số điện thoại khách hàng", "phone",
                      placeholder="Ví dụ: 0906 750 554",
                      help_text="Dùng số điện thoại khách đang sử dụng để liên hệ trực tiếp."),
                field("customerEmail", "Email khách hàng", "email",
                      placeholder="Ví dụ: khachhang@congty.com",
                      help_text="Nhập email nhận báo giá hoặc email người phụ trách."),
                field("customerTaxCode", "Mã số thuế", "text",
                      placeholder="Ví dụ: 0312345678",
                      help_text="Nhập mã số thuế nếu khách cần xuất hóa đơn."),
            ]),
            section("quoteInfo", "THÔNG TIN CHUNG CỦA BÁO GIÁ", [
                field("quoteTitle", "Tiêu đề báo giá", "text", required=True, default_value="BẢNG BÁO GIÁ",
                      placeholder="Ví dụ: Báo giá triển khai CRM",
                      help_text="Nhập tiêu đề ngắn gọn để khách hiểu nội dung báo giá."),
                field("quoteNumber", "Số báo giá", "text", required=True,
                      config={"generatedWhenCreatingQuote": True}),
                field("quoteDate", "Ngày báo giá", "date", required=True,
                      help_text="Chọn ngày phát hành báo giá."),
                field("validityDays", "Thời hạn hiệu lực", "number", required=True, default_value=30,
                      placeholder="Ví dụ: 30", help_text="Nhập số ngày báo giá còn hiệu lực."),
                field("currency", "Đơn vị tiền tệ", "select", required=True, default_value="VND", options=["VND"]),
                field("defaultVatRate", "Thuế VAT mặc định", "number", required=True, default_value=10),
            ]),
            section("quoteItems", "BẢNG DỊCH VỤ/SẢN PHẨM", [
                field("quoteItems", "Dịch vụ", "repeater-table", required=True, config={
                    "allowAddRows": True, "allowDeleteRows": True, "allowReorderRows": True,
                    "initialRows": 0,
                    "columns": [
                        field("order", "STT", "auto-number", editable=False),
                        field("serviceDescription", "Tên dịch vụ", "textarea", required=True,
                              placeholder="Ví dụ: Thiết kế website doanh nghiệp",
                              help_text="Nhập tên sản phẩm hoặc dịch vụ khách cần."),
                        field("description", "Mô tả", "textarea", required=False,
                              placeholder="Ví dụ: Thiết kế UI, lập trình, bàn giao source",
                              help_text="Mô tả phạm vi công việc và nội dung bàn giao."),
                        field("unit", "ĐVT", "text", required=True,
                              placeholder="Ví dụ: Gói, Tháng, Người dùng",
                              help_text="Nhập đơn vị tính phù hợp với dịch vụ."),
                        field("quantity", "Số lượng", "number", required=True,
                              placeholder="Ví dụ: 1", help_text="Nhập số lượng khách đăng ký."),
                        field("unitPrice", "Đơn giá (VND)", "currency", required=True,
                              placeholder="Ví dụ: 15000000", help_text="Nhập giá cho một đơn vị, chưa gồm VAT."),
                        field("subtotal", "Thành tiền trước VAT", "calculated", editable=False,
                              formula="quantity * unitPrice"),
                        field("discountPercent", "Giảm giá (%)", "number", required=True, default_value=0,
                              placeholder="Ví dụ: 10", help_text="Nhập phần trăm giảm giá riêng cho dòng này, từ 0 đến 100."),
                        field("amountAfterDiscount", "Sau giảm giá", "calculated", editable=False, visible=False,
                              formula="subtotal - (subtotal * discountPercent / 100)"),
                        field("vatRate", "Thuế VAT", "number", required=True, default_value=10,
                              placeholder="Ví dụ: 10", help_text="Nhập phần trăm thuế, ví dụ 10."),
                        field("vatAmount", "Tiền VAT", "calculated", editable=False, visible=False,
                              formula="amountAfterDiscount * vatRate / 100"),
                        field("total", "Thành tiền thanh toán (VND)", "calculated", editable=False,
                              formula="amountAfterDiscount + vatAmount"),
                    ],
                }),
            ]),
            section("totals", "TỔNG TIỀN", [
                field("subtotalAmount", "TỔNG CỘNG CHƯA BAO GỒM THUẾ GTGT", "calculated", editable=False,
                      formula="sum(quoteItems.subtotal)"),
                field("totalVatAmount", "THUẾ GTGT", "calculated", editable=False,
                      formula="sum(quoteItems.vatAmount)"),
                field("totalAmount", "TỔNG THANH TOÁN", "calculated", editable=False,
                      formula="subtotalAmount + totalVatAmount"),
            ]),
            section("notes", "GHI CHÚ", [
                field("notes", "GHI CHÚ", "repeatable-textarea", default_value=[
                    "Giá trên được tính theo đơn vị VND, đã bao gồm thuế GTGT.",
                    "Báo giá có hiệu lực trong vòng 30 ngày kể từ ngày phát hành.",
                    "Phương thức thanh toán sẽ được nhập theo từng báo giá.",
                    "Giảm giá được áp dụng theo từng trường hợp.",
                    "Các hạng mục ngoài phạm vi sẽ được báo giá riêng.",
                ]),
            ]),
            section("representatives", "ĐẠI DIỆN HAI BÊN", [
                field("companyRepresentative", "ĐẠI DIỆN CÔNG TY", "text", default_value="DƯƠNG THỊ MAI"),
                field("customerRepresentative", "KHÁCH HÀNG", "text", default_value=""),
            ]),
        ],
    }


def default_standard_schema():
    """Mẫu báo giá chuẩn, tối giản — dùng làm fallback khi công ty phát hành chưa
    gán defaultQuoteFormId (xem quote_issuer_companies, migration 069). Tái dùng
    đúng cấu trúc section của standard_schema() (Cloudgate), chỉ đổi khối "seller"
    thành trống (giờ được autofill từ công ty phát hành chọn ở Bước 1 wizard, không
    còn hardcode "CLOUDGATE"/"Dương Thị Mai" nữa) và thêm 2 field mới sellerTaxCode/
    sellerLogo mà bản Cloudgate cũ chưa có."""
    schema = copy.deepcopy(standard_schema())
    schema["enableDynamicPaymentPlan"] = True
    for section_data in schema["sections"]:
        if section_data["key"] == "seller":
            section_data["fields"] = [
                field("sellerCompanyName", "Tên pháp lý", "text", required=True),
                field("sellerTaxCode", "Mã số thuế", "text"),
                field("sellerAddress", "Địa chỉ công ty", "textarea"),
                field("sellerContactName", "Người liên hệ", "text"),
                field("sellerPhone", "SĐT", "phone"),
                field("sellerEmail", "Email", "email"),
                field("sellerWebsite", "Website", "text"),
                field("sellerLogo", "Logo", "text", visible=False,
                      help_text="URL logo, tự điền từ công ty phát hành, không hiện dạng field nhập tay."),
            ]
        elif section_data["key"] == "representatives":
            # standard_schema() hardcode san "DUONG THI MAI" (dai dien Cloudgate)
            # lam default - mau chuan phai de trong, khong gan san ten 1 nguoi cu the.
            for f in section_data["fields"]:
                if f["key"] == "companyRepresentative":
                    f.pop("defaultValue", None)
    return schema


def chatbot_douyin_quote_items():
    return [
        {
            "serviceDescription": "Tải video nguồn",
            "description": "Nhóm dịch vụ xử lý video đầu vào cho hệ thống chatbot_auto_inbox và lồng tiếng Douyin.",
            "unit": "Gói",
            "quantity": 1,
            "unitPrice": 5000000,
            "discountPercent": 10,
            "vatRate": 10,
            "children": [
                {
                    "serviceDescription": "Tải qua relay bot Telegram công khai",
                    "description": "Nhận link Douyin/TikTok từ relay bot Telegram và đưa vào hàng đợi xử lý.",
                    "unit": "Tác vụ",
                    "quantity": 1,
                    "unitPrice": 1000000,
                    "discountPercent": 0,
                    "vatRate": 10,
                },
                {
                    "serviceDescription": "Tải trực tiếp bằng cookie Douyin",
                    "description": "Dùng cookie hợp lệ để tải trực tiếp video nguồn khi relay không đủ dữ liệu.",
                    "unit": "Tác vụ",
                    "quantity": 1,
                    "unitPrice": 1500000,
                    "discountPercent": 50,
                    "vatRate": 10,
                },
                {
                    "serviceDescription": "Tự động làm mới cookie Douyin theo lịch",
                    "description": "Theo dõi hạn cookie và nhắc/làm mới theo lịch vận hành đã thống nhất.",
                    "unit": "Tháng",
                    "quantity": 1,
                    "unitPrice": 1200000,
                    "discountPercent": 0,
                    "vatRate": 10,
                },
                {
                    "serviceDescription": "Giới hạn thời lượng video nguồn",
                    "description": "Áp rule giới hạn thời lượng trước khi đưa video vào pipeline lồng tiếng.",
                    "unit": "Rule",
                    "quantity": 1,
                    "unitPrice": 800000,
                    "discountPercent": 100,
                    "vatRate": 10,
                },
            ],
        },
        {
            "serviceDescription": "Lồng tiếng Douyin và đồng bộ chatbot_auto_inbox",
            "description": "Nhóm xử lý âm thanh, transcript và đồng bộ nội dung đã hoàn thiện về hệ thống inbox tự động.",
            "unit": "Gói",
            "quantity": 1,
            "unitPrice": 8000000,
            "discountPercent": 0,
            "vatRate": 10,
            "children": [
                {
                    "serviceDescription": "Tách transcript và chuẩn hóa nội dung",
                    "description": "Tạo transcript tiếng gốc, chuẩn hóa câu thoại và loại bỏ đoạn không cần xử lý.",
                    "unit": "Gói",
                    "quantity": 1,
                    "unitPrice": 2000000,
                    "discountPercent": 0,
                    "vatRate": 10,
                },
                {
                    "serviceDescription": "Lồng tiếng Việt theo giọng thương hiệu",
                    "description": "Sinh voice tiếng Việt theo cấu hình giọng và tốc độ đọc đã thống nhất.",
                    "unit": "Video",
                    "quantity": 10,
                    "unitPrice": 350000,
                    "discountPercent": 0,
                    "vatRate": 10,
                },
                {
                    "serviceDescription": "Đồng bộ kết quả vào chatbot_auto_inbox",
                    "description": "Gắn file hoàn thiện, metadata và trạng thái xử lý vào luồng trả lời tự động.",
                    "unit": "Gói",
                    "quantity": 1,
                    "unitPrice": 2500000,
                    "discountPercent": 0,
                    "vatRate": 10,
                },
            ],
        },
    ]


def chatbot_douyin_schema():
    schema = standard_schema()
    fields = [field for section_data in schema["sections"] for field in section_data["fields"]]
    defaults = {
        "sellerCompanyName": "MARKEE AI",
        "sellerAddress": "TP. Hồ Chí Minh",
        "sellerContactName": "Markee Sales",
        "sellerPhone": "076 5055 708",
        "sellerEmail": "sales@markeeai.com",
        "sellerWebsite": "markeeai.com",
        "quoteTitle": "Hệ thống chatbot_auto_inbox và lồng tiếng Douyin",
        "defaultVatRate": 10,
        "notes": [
            "Cấu trúc dịch vụ cha/con có thể chỉnh sửa trực tiếp trong form báo giá.",
            "Giảm giá áp dụng riêng cho từng dòng, không áp dụng chồng từ dịch vụ cha xuống dịch vụ con.",
            "Chi phí chưa bao gồm các hạng mục phát sinh ngoài phạm vi đã mô tả.",
        ],
        "companyRepresentative": "MARKEE AI",
    }
    for item in fields:
        if item["key"] in defaults:
            item["defaultValue"] = defaults[item["key"]]
        if item["key"] == "quoteItems":
            item["defaultValue"] = chatbot_douyin_quote_items()
    return schema


def villa_schema():
    return {
        "version": 1,
        "layoutType": "villa_solution_package",
        "sections": [
            section("quoteInfo", "THÔNG TIN BÁO GIÁ", [
                field("sellerBrandName", "Thương hiệu", "text", required=True, default_value="MARKEE"),
                field("customerRecipient", "Kính gửi", "text", required=True, default_value="",
                      placeholder="Ví dụ: Anh Nguyễn Văn An",
                      help_text="Nhập tên người nhận báo giá hoặc đại diện khách hàng."),
                field("quoteNumber", "Số báo giá", "text", required=True,
                      config={"generatedWhenCreatingQuote": True}),
                field("quoteDate", "Ngày báo giá", "date", required=True,
                      help_text="Chọn ngày phát hành báo giá."),
                field("quoteTitle", "Tiêu đề báo giá", "text", required=True,
                      default_value="GIẢI PHÁP TƯ VẤN ONLINE & GIỮ KHÁCH HÀNG TỰ ĐỘNG",
                      placeholder="Ví dụ: Giải pháp giữ khách tự động",
                      help_text="Nhập tiêu đề ngắn gọn thể hiện gói giải pháp đang báo giá."),
                field("quoteSubtitle", "Nội dung giới thiệu", "textarea", required=False,
                      default_value="Khách nhắn ngoài giờ mà không ai trả lời? → Markee phản hồi tức thì 24/7.",
                      help_text="Nhập đoạn mô tả ngắn về vấn đề của khách và giá trị giải pháp."),
                field("quoteBenefitLine", "Dòng lợi ích", "textarea", required=False,
                      default_value="Kế toán, tư vấn, giáo dục, sửa chữa, dịch vụ chuyên môn",
                      help_text="Nhập một dòng nêu nhóm ngành hoặc lợi ích chính của gói."),
            ]),
            section("solutions", "DANH SÁCH GIẢI PHÁP", [
                field("solutionItems", "Danh sách giải pháp", "repeater-table", required=True, default_value=[],
                      config={
                          "allowAddRows": True, "allowDeleteRows": True, "allowReorderRows": True,
                          "initialRows": 0,
                          "columns": [
                              field("order", "STT", "auto-number", editable=False),
                              field("solutionName", "Giải pháp", "textarea", required=True,
                                    placeholder="Ví dụ: Website tư vấn tự động",
                                    help_text="Nhập tên gói giải pháp hoặc hạng mục khách cần."),
                              field("customerBenefit", "Bạn nhận được", "textarea", required=True,
                                    placeholder="Ví dụ: Tự động phản hồi khách 24/7",
                                    help_text="Mô tả lợi ích trực tiếp khách nhận được từ hạng mục này."),
                              field("includedFeatures", "Bao gồm", "textarea", required=True,
                                    placeholder="Ví dụ: Landing page, chatbot, hướng dẫn vận hành",
                                    help_text="Liệt kê phạm vi công việc và nội dung bàn giao."),
                              field("offerPrice", "Giá ưu đãi", "currency", required=True,
                                    placeholder="Ví dụ: 15000000",
                                    help_text="Nhập giá bán áp dụng cho khách trong báo giá này."),
                              field("originalPrice", "Giá gốc", "currency", required=False,
                                    placeholder="Ví dụ: 25000000",
                                    help_text="Nhập giá gốc trước ưu đãi nếu cần hiển thị so sánh."),
                              field("pricingNote", "Ghi chú giá", "text", required=False,
                                    default_value="Trọn gói", placeholder="Ví dụ: Trọn gói",
                                    help_text="Ghi chú cách tính giá như trọn gói, theo tháng hoặc theo người dùng."),
                          ],
                      }),
            ]),
            section("commitments", "CAM KẾT", [
                field("commitments", "Cam kết", "repeatable-textarea", default_value=[
                    "Setup hoàn chỉnh",
                    "Hướng dẫn tận tay",
                    "Đồng hành 90 ngày đầu",
                    "Hoàn tiền nếu không triển khai được",
                ]),
            ]),
            section("totals", "CHI PHÍ VÀ THANH TOÁN", [
                field("setupTotalAmount", "Chi phí setup một lần", "calculated", editable=False,
                      formula="sum(solutionItems.offerPrice)"),
                field("monthlyAmount", "Chi phí hàng tháng", "currency", editable=True, default_value=0),
                field("paymentPhaseOnePercent", "Tỷ lệ thanh toán đợt 1", "number", default_value=30),
                field("paymentPhaseTwoPercent", "Tỷ lệ thanh toán đợt 2", "number", default_value=70),
                field("paymentPhaseOneAmount", "Thanh toán đợt 1", "calculated",
                      formula="setupTotalAmount * paymentPhaseOnePercent / 100"),
                field("paymentPhaseTwoAmount", "Thanh toán đợt 2", "calculated",
                      formula="setupTotalAmount * paymentPhaseTwoPercent / 100"),
            ]),
            section("implementation", "TRIỂN KHAI VÀ LIÊN HỆ", [
                field("implementationStepOne", "Bước 1", "text", default_value="Đặt lịch tư vấn 15 phút miễn phí"),
                field("implementationStepTwo", "Bước 2", "text", default_value="Triển khai trong 7 ngày làm việc"),
                field("sellerEmail", "Email liên hệ", "email", default_value="admin@markee.vn"),
                field("sellerZalo", "Zalo", "text", default_value="076 5055 708"),
                field("offerExpiryText", "Thời hạn ưu đãi", "text", default_value="Ưu đãi hết ngày"),
                field("offerExpiryDate", "Ngày hết hạn ưu đãi", "date", required=False),
            ]),
        ],
    }


TEMPLATES = [
    {
        "code": "STANDARD_DEFAULT_QUOTE_FORM",
        "name": "Mẫu báo giá chuẩn",
        "description": "Mẫu mặc định dùng khi công ty phát hành báo giá chưa gán mẫu riêng (xem quote_issuer_companies).",
        "status": "active",
        "schema_version": 1,
        "layout_type": "cloudgate_standard_quote",
        "schema_json": default_standard_schema(),
        "is_default_template": True,
        "force_update": True,
    },
    {
        "code": "STANDARD_QUOTE_FORM",
        "name": "Mẫu báo giá Cloudgate",
        "description": "Mẫu báo giá dùng để nhập thông tin khách hàng, dịch vụ, số lượng, đơn giá, thuế và điều khoản khi tạo deal trong CRM.",
        "status": "active",
        "schema_version": 1,
        "layout_type": "cloudgate_standard_quote",
        "schema_json": standard_schema(),
    },
    {
        "code": "MARKEE_VILLA_AUTOMATION_QUOTE",
        "name": "Giải pháp tư vấn online & giữ khách hàng tự động",
        "description": "Mẫu báo giá giải pháp website, quản lý villa, đồng bộ OTA, dịch vụ du lịch, đa ngôn ngữ, landing page, triển khai production và hạ tầng.",
        "status": "active",
        "schema_version": 1,
        "layout_type": "villa_solution_package",
        "schema_json": villa_schema(),
    },
    {
        "code": "HE_THONG_CHATBOT_AUTO_INBOX_VA_LONG_TIENG_DOUYIN",
        "name": "Hệ thống chatbot_auto_inbox và lồng tiếng Douyin",
        "description": "Mẫu báo giá dùng cấu trúc dịch vụ cha/con chung cho hệ thống chatbot_auto_inbox, tải video nguồn và lồng tiếng Douyin.",
        "status": "active",
        "schema_version": 1,
        "layout_type": "cloudgate_standard_quote",
        "schema_json": chatbot_douyin_schema(),
        "force_update": True,
    },
]


def main() -> int:
    client = get_supabase_client()
    for template in TEMPLATES:
        existing = (
            client.table("quote_forms")
            .select("id, name")
            .eq("code", template["code"])
            .execute()
        )
        if existing.data:
            if template.get("force_update"):
                update_payload = {key: value for key, value in template.items() if key != "force_update"}
                client.table("quote_forms").update(update_payload).eq("id", existing.data[0]["id"]).execute()
                print(f"UPDATED: {template['code']} -> {existing.data[0]['id']} ({template['name']})")
            else:
                print(f"SKIP (already exists): {template['code']} -> {existing.data[0]['id']}")
            continue
        insert_payload = {key: value for key, value in template.items() if key != "force_update"}
        result = client.table("quote_forms").insert(insert_payload).execute()
        row = result.data[0] if result.data else {}
        print(f"CREATED: {template['code']} -> {row.get('id')} ({template['name']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
