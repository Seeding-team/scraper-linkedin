import { z } from "zod";

export const CrawlFb_Schemas = z
  .object({
    isDefaultAccount: z.boolean(),

    // Cứ khai báo là optional ở bước đầu
    userName: z.string().optional(),
    password: z.string().optional(),

    rows: z.array(
      z.object({
        name: z.string().min(1, "Vui lòng nhập tên GroupFb"),
        url: z.string().url("Đường dẫn không hợp lệ").or(z.literal("")),
        Intent: z.string().min(1, "Vui lòng chọn mục đích quét dữ liệu"),
      }),
    ),
  })
  .superRefine((data, ctx) => {
    // Nếu isDefaultAccount là false (nghĩa là KHÔNG dùng tài khoản mặc định)
    if (!data.isDefaultAccount) {
      // Kiểm tra userName
      if (!data.userName || data.userName.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Vui lòng nhập email hoặc SĐT Facebook",
          path: ["userName"],
        });
      }

      // Kiểm tra password
      if (!data.password || data.password.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Vui lòng nhập mật khẩu Facebook",
          path: ["password"],
        });
      }
    }
  });

export type CrawlFb_form = z.infer<typeof CrawlFb_Schemas>;
