/**
 * Mẫu câu inbox dùng chung cho nút "Inbox ngay" (post-card + post-detail-modal).
 *
 * Mỗi mẫu có 2 phiên bản:
 * - `content`: bản gốc chung chung — dùng làm preview trong dropdown và fallback
 *   khi bài viết của khách không có nội dung chữ (bài thuần ảnh/video).
 * - `contentWithPost`: bản có chỗ trống `{post}` — khi khách có đăng nội dung,
 *   hệ thống tự chèn nguyên văn bài khách vào để seeder khỏi phải copy tay.
 */

export const POST_PLACEHOLDER = "{post}";

/** Bài khách dài quá thì cắt bớt cho tin nhắn không bị "tường chữ". */
const MAX_QUOTE_LENGTH = 300;

export interface InboxTemplate {
  title: string;
  content: string;
  contentWithPost: string;
}

export interface InboxTemplateGroup {
  category: string;
  templates: InboxTemplate[];
}

export const INBOX_TEMPLATES: InboxTemplateGroup[] = [
  {
    category: "Dịch vụ Website",
    templates: [
      {
        title: "Thiết kế Web Doanh Nghiệp",
        content:
          "Chào bạn, mình thấy bạn đang có nhu cầu phát triển kinh doanh. Bên mình chuyên thiết kế Website chuyên nghiệp, chuẩn SEO và tối ưu chuyển đổi. Một Website xịn sẽ là 'nhân viên sale' làm việc 24/7 cho bạn. Bạn có muốn mình gửi thêm một số mẫu Web bên mình đã làm để tham khảo không?",
        contentWithPost:
          `Chào bạn, mình bên Markee. Mình thấy bạn có đăng: "${POST_PLACEHOLDER}". Bên mình chuyên thiết kế Website chuyên nghiệp, chuẩn SEO và tối ưu chuyển đổi. Một Website xịn sẽ là 'nhân viên sale' làm việc 24/7 cho bạn. Bạn có muốn mình gửi thêm một số mẫu Web bên mình đã làm để tham khảo không?`,
      },
      {
        title: "Tối ưu/Nâng cấp Web hiện tại",
        content:
          "Dạ chào anh/chị, em thấy lĩnh vực của mình rất tiềm năng. Không biết hiện tại anh/chị đã có Website riêng để đẩy mạnh thương hiệu chưa ạ? Bên em nhận thiết kế mới và nâng cấp Website với chi phí cực kì hợp lý. Anh/chị check tin nhắn để em tư vấn chi tiết hơn nhé!",
        contentWithPost:
          `Dạ chào anh/chị, em bên Markee. Em thấy anh/chị có đăng: "${POST_PLACEHOLDER}". Lĩnh vực của mình rất tiềm năng — không biết anh/chị đã có Website riêng để đẩy mạnh thương hiệu chưa ạ? Bên em nhận thiết kế mới và nâng cấp Website với chi phí cực kì hợp lý. Anh/chị check tin nhắn để em tư vấn chi tiết hơn nhé!`,
      },
    ],
  },
  {
    category: "Chatbot AI & CSKH",
    templates: [
      {
        title: "Chatbot AI Chăm sóc khách hàng",
        content:
          "Chào bạn, mình thấy mảng dịch vụ của bạn thường xuyên phải trả lời nhiều câu hỏi từ khách hàng. Bên mình đang cung cấp giải pháp Chatbot AI thông minh có khả năng tự động trả lời, tư vấn và chốt đơn 24/7 như người thật. Mình gửi bạn xem thử bản demo Chatbot AI bên mình nhé?",
        contentWithPost:
          `Chào bạn, mình bên Markee. Mình thấy bạn có đăng: "${POST_PLACEHOLDER}". Với mảng này chắc bạn thường xuyên phải trả lời nhiều câu hỏi từ khách hàng — bên mình đang cung cấp giải pháp Chatbot AI thông minh có khả năng tự động trả lời, tư vấn và chốt đơn 24/7 như người thật. Mình gửi bạn xem thử bản demo Chatbot AI bên mình nhé?`,
      },
      {
        title: "Tích hợp AI tư vấn chuyên sâu",
        content:
          "Dạ chào anh/chị, em chuyên triển khai các hệ thống Chatbot AI (Tích hợp ChatGPT/Claude) vào quy trình chăm sóc khách hàng. Chatbot bên em có thể học theo data riêng của doanh nghiệp để tư vấn cá nhân hóa. Anh/chị có hứng thú nâng cấp hệ thống CSKH của mình không ạ?",
        contentWithPost:
          `Dạ chào anh/chị, em bên Markee. Em thấy anh/chị có đăng: "${POST_PLACEHOLDER}". Em chuyên triển khai các hệ thống Chatbot AI (tích hợp ChatGPT/Claude) vào quy trình chăm sóc khách hàng — Chatbot bên em có thể học theo data riêng của doanh nghiệp để tư vấn cá nhân hóa. Anh/chị có hứng thú nâng cấp hệ thống CSKH của mình không ạ?`,
      },
    ],
  },
  {
    category: "n8n & Tự động hoá",
    templates: [
      {
        title: "Giải pháp Automation (n8n)",
        content:
          "Xin chào! Mình thấy quy trình vận hành của bạn đang phải xử lý thủ công khá nhiều bước. Bên mình chuyên thiết kế các luồng tự động hoá bằng n8n, giúp đồng bộ dữ liệu giữa các nền tảng hoàn toàn tự động. Việc này sẽ giúp bạn giảm thiểu sai sót và tối ưu hiệu suất x10 lần. Mình trao đổi thêm nhé?",
        contentWithPost:
          `Xin chào, mình bên Markee! Mình thấy bạn có đăng: "${POST_PLACEHOLDER}". Bên mình chuyên thiết kế các luồng tự động hoá bằng n8n, giúp đồng bộ dữ liệu giữa các nền tảng hoàn toàn tự động — giảm thiểu sai sót và tối ưu hiệu suất x10 lần. Mình trao đổi thêm nhé?`,
      },
      {
        title: "Tối ưu quy trình đa nền tảng",
        content:
          "Chào anh/chị, việc lặp đi lặp lại các tác vụ thủ công thường tốn rất nhiều nguồn lực. Bên em cung cấp giải pháp Tự động hoá doanh nghiệp với n8n, giúp tự động kết nối các phần mềm (Lead FB -> Zalo -> CRM). Chi phí triển khai 1 lần, dùng trọn đời. Anh/chị check inbox em gửi demo nhé!",
        contentWithPost:
          `Chào anh/chị, em bên Markee. Em thấy anh/chị có đăng: "${POST_PLACEHOLDER}". Việc lặp đi lặp lại các tác vụ thủ công như vậy thường tốn rất nhiều nguồn lực — bên em cung cấp giải pháp Tự động hoá doanh nghiệp với n8n, giúp tự động kết nối các phần mềm (Lead FB -> Zalo -> CRM). Chi phí triển khai 1 lần, dùng trọn đời. Anh/chị check inbox em gửi demo nhé!`,
      },
    ],
  },
];

/**
 * Ghép mẫu câu với nội dung bài khách đăng.
 * - Bài có chữ → dùng `contentWithPost`, chèn nguyên văn (cắt ở 300 ký tự nếu quá dài).
 * - Bài rỗng (thuần ảnh/video) → trả về bản gốc `content`.
 */
export function composeInboxMessage(
  template: InboxTemplate,
  postContent?: string | null,
): string {
  const quote = (postContent || "").replace(/\s+/g, " ").trim();
  if (!quote) return template.content;
  const short =
    quote.length > MAX_QUOTE_LENGTH
      ? quote.slice(0, MAX_QUOTE_LENGTH).trimEnd() + "…"
      : quote;
  return template.contentWithPost.replace(POST_PLACEHOLDER, short);
}
