"use client";

import { MaterialIcon } from "@/components/ui";

// Mock data for high scoring posts that need assignment
const unassignedPosts = [
  {
    id: 1,
    title: "Tuyển dụng Marketing Manager lương 2000$",
    group: "Tuyển dụng Marketing & Communications",
    score: 95,
    time: "2 giờ trước",
  },
  {
    id: 2,
    title: "Cần tìm Agency thiết kế Website Bất động sản",
    group: "Cộng đồng thiết kế website giá rẻ",
    score: 92,
    time: "3 giờ trước",
  },
  {
    id: 3,
    title: "Share bộ tài liệu SEO 2026 mới nhất",
    group: "Hội thiết kế website và SEO web",
    score: 88,
    time: "5 giờ trước",
  },
  {
    id: 4,
    title: "Tìm người chạy Ads ngân sách 100M/tháng",
    group: "Cộng đồng Digital Marketing VN",
    score: 85,
    time: "1 ngày trước",
  },
];

export function AdminUnassignedPosts() {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-on-surface">
          <MaterialIcon
            name="assignment"
            className="text-primary text-[18px]"
          />
          Bài post điểm cao chưa Assign
        </h3>
        <span className="rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {unassignedPosts.length} bài viết
        </span>
      </div>

      <div className="flex flex-col divide-y divide-outline-variant px-5">
        {unassignedPosts.map((post) => (
          <div
            key={post.id}
            className="flex items-center justify-between gap-4 py-4"
          >
            <div className="flex flex-col min-w-0 flex-1">
              <a
                href="#"
                className="fmb-1 truncate text-sm font-semibold text-on-surface transition-colors hover:text-primary"
              >
                {post.title}
              </a>
              <div className="flex items-center gap-3 text-[11px] text-on-surface-variant font-medium">
                <span className="flex items-center gap-1 truncate">
                  <MaterialIcon name="groups" className="text-[12px]" />
                  <span className="truncate">{post.group}</span>
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <MaterialIcon name="history" className="text-[12px]" />
                  {post.time}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1.5 shrink-0">
              <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                Điểm: {post.score}
              </span>
              <button className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-95">
                <MaterialIcon name="person_add" className="text-[12px]" />
                Assign
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
