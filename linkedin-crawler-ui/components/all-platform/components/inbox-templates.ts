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
    category: "Inbox Facebook - Chào hỏi & Tư vấn",
    templates: [
      {
        title: "Chào hỏi tự nhiên theo bài viết",
        content:
          "Chào bạn, mình thấy bài viết của bạn trên nhóm. Mình cũng đang hoạt động trong lĩnh vực này và rất vui được kết nối cùng bạn để trao đổi thêm nhé!",
        contentWithPost:
          `Chào bạn, mình thấy bài đăng của bạn trên nhóm: "${POST_PLACEHOLDER}". Mình bên Markee AI, bên mình có giải pháp chuyên xử lý mảng này rất hiệu quả. Bạn check inbox để mình gửi giải pháp cụ thể cho bạn tham khảo nhé!`,
      },
      {
        title: "Tư vấn nhu cầu chi tiết & Demo",
        content:
          "Dạ chào anh/chị, em thấy mình đang quan tâm đến giải pháp phát triển kinh doanh. Bên em có sẵn các bộ giải pháp và demo thực tế, em xin phép gửi anh/chị xem qua nhé!",
        contentWithPost:
          `Dạ chào bạn, mình thấy bạn đang cần hỗ trợ về: "${POST_PLACEHOLDER}". Bên mình có sẵn giải pháp trọn gói và demo mẫu trực quan. Không biết bạn đã tìm được đơn vị triển khai phù hợp chưa ạ? Mình gửi bạn thông tin chi tiết qua đây nhé!`,
      },
      {
        title: "Gửi báo giá & Ưu đãi Messenger",
        content:
          "Chào bạn, bên mình đang có chương trình tư vấn 1-1 và gửi báo giá ưu đãi trọn gói cho thành viên nhóm. Mình xin phép nhắn tin để trao đổi nhanh cùng bạn nhé!",
        contentWithPost:
          `Chào bạn, mình thấy bạn đăng bài: "${POST_PLACEHOLDER}". Bên mình đang có bảng báo giá ưu đãi và demo phù hợp với đúng nhu cầu này của bạn. Bạn check tin nhắn chờ/tin nhắn Messenger để mình gửi chi tiết nhé!`,
      },
    ],
  },
  {
    category: "Inbox Facebook - Kết nối & Hợp tác",
    templates: [
      {
        title: "Kết nối đối tác chuyên môn",
        content:
          "Chào bạn, mình rất ấn tượng với chia sẻ của bạn trên nhóm. Bên mình cũng đang triển khai các dự án tương tự và rất muốn kết nối hợp tác lâu dài cùng bạn!",
        contentWithPost:
          `Chào bạn, mình đọc được bài chia sẻ của bạn: "${POST_PLACEHOLDER}". Bên mình cũng đang triển khai các dự án tương tự và rất muốn kết nối hợp tác, trao đổi chuyên môn cùng bạn!`,
      },
      {
        title: "Hỗ trợ kỹ thuật / Triển khai nhanh",
        content:
          "Chào bạn, nếu bạn đang cần hỗ trợ kỹ thuật hoặc cần người triển khai nhanh giải pháp cho dự án thì cứ nhắn mình nhé. Bên mình có đội ngũ hỗ trợ 24/7.",
        contentWithPost:
          `Chào bạn, thấy bạn có nhu cầu: "${POST_PLACEHOLDER}". Nếu bạn cần hỗ trợ triển khai nhanh hoặc tư vấn kỹ thuật chuyên sâu thì nhắn mình nhé, bên mình luôn sẵn sàng đồng hành cùng bạn!`,
      },
    ],
  },
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
