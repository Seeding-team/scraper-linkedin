'use client';

/** Placeholder chung cho cac muc "Danh mục & cấu hình" (prototype
 * markee_crm_v26_compact_opportunity_name.html) CHUA co cau hinh that trong
 * app - xac nhan voi user (2026-09-27): "từ giai đoạn cơ hội trở xuống, là
 * chưa có gì". KHONG bia du lieu/form gia - chi bao ro dang phat trien. */
export function CrmConfigComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ padding: '1.25rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0 }}>{title}</h1>
      {description ? <p style={{ fontSize: '0.8rem', color: '#64748b', margin: '0.35rem 0 0' }}>{description}</p> : null}
      <div
        style={{
          marginTop: '1rem',
          border: '1px dashed #dbe5f2',
          background: '#f8fafc',
          borderRadius: '0.75rem',
          padding: '1.5rem',
          textAlign: 'center',
          color: '#94a3b8',
          fontSize: '0.85rem',
          fontWeight: 700,
        }}
      >
        Đang phát triển
      </div>
    </div>
  );
}
