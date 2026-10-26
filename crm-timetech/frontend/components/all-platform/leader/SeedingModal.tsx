"use client";

import { MaterialIcon } from "@/components/ui";

interface SeedingModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: any;
}

export function SeedingModal({ isOpen, onClose, member }: SeedingModalProps) {
  if (!isOpen) return null;

  const seedingItems = member?.seedingItems || [];

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          cursor: 'pointer'
        }}
      />

      {/* Modal Content */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: '640px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          overflow: 'hidden'
        }}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant bg-surface-container-low">
          <div>
            <h2 className="text-lg font-bold text-on-surface flex items-center gap-2">
              <MaterialIcon name="visibility" className="text-blue-600" />
              Chi tiết Seeding
            </h2>
            <p className="text-xs text-on-surface-variant font-medium mt-0.5">{member?.name || member?.email}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface-variant hover:bg-surface-container-highest/50 transition">
            <MaterialIcon name="close" className="text-[20px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-surface-container-low">
          {seedingItems.length === 0 ? (
            <div className="text-center py-12 flex flex-col items-center justify-center border-2 border-dashed border-outline-variant rounded-xl bg-surface">
              <MaterialIcon name="inbox" className="text-outline text-5xl mb-2" />
              <p className="text-sm font-medium text-on-surface-variant">Chưa có bài seeding nào trong khoảng thời gian này.</p>
            </div>
          ) : (
            seedingItems.map((item: any, idx: number) => {
              const accountObj = item.social_accounts;
              const accountName = Array.isArray(accountObj)
                ? (accountObj[0]?.account_name || "Tài khoản ẩn danh")
                : (accountObj?.account_name || "Tài khoản ẩn danh");
              return (
                <div key={idx} className="bg-surface border border-outline-variant rounded-xl p-4 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-100 w-fit">
                      <MaterialIcon name="account_circle" className="text-[14px]" />
                      {accountName}
                    </div>
                    <div className="text-[11px] font-semibold text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-md">
                      {item.current_day}
                    </div>
                  </div>

                  {item.content && (
                    <div className="text-sm text-on-surface whitespace-pre-wrap bg-surface-container-low p-3 rounded-lg border border-outline-variant">
                      {item.content}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    {item.link_comment && (
                      <a
                        href={item.link_comment}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 font-bold text-xs hover:bg-emerald-100 transition border border-emerald-100"
                      >
                        <MaterialIcon name="forum" className="text-[14px]" />
                        Xem bình luận
                      </a>
                    )}
                    {item.link_post && !item.link_comment && (
                      <a
                        href={item.link_post}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-low text-on-surface font-bold text-xs hover:bg-surface-container-highest transition border border-outline-variant"
                      >
                        <MaterialIcon name="article" className="text-[14px]" />
                        Xem bài viết
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end p-4 border-t border-outline-variant bg-surface">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-sm font-bold text-on-surface-variant bg-surface-container-low hover:bg-surface-container-highest transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
