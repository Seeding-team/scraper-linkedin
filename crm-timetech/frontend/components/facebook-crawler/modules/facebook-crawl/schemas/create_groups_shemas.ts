import { z } from "zod";

export const CreateGroupSchema = z.object({
  platform: z.enum(["facebook", "linkedin"]).default("facebook"),
  group_name: z.string().min(1, "Vui lòng nhập tên hiển thị Group"),
  link_group: z
    .string()
    .min(1, "Vui lòng nhập Link URL")
    .url("Đường dẫn URL không hợp lệ"),
  intent: z.string().min(1, "Vui lòng chọn hoặc nhập mục đích (Intent)"),
  members: z.coerce.number().int().optional(),
  posts_per_week: z.coerce.number().optional(),
  health_score: z.coerce.number().optional(),
  chay_24h: z.boolean().default(false),
  industry: z.string().optional(),
  tier: z.coerce.number().int().optional(),
  team: z.string().optional(),
  icp: z.string().optional(),
  icp_desc: z.string().optional(),
});

// Xuất type tự động từ Zod Schema để dùng cho các file khác
export type CreateGroupPayload = z.infer<typeof CreateGroupSchema>;

export const initialCreateGroupData: CreateGroupPayload = {
  platform: "facebook",
  group_name: "",
  link_group: "",
  intent: "",
  members: 0,
  chay_24h: false,
  industry: "",
  tier: 1,
  team: "",
  icp: "",
  icp_desc: "",
};
