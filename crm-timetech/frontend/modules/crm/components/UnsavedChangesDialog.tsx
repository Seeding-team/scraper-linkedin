/** Dialog xac nhan dung CHUNG khi dong drawer/modal con du lieu chua luu (2026-10-27).
 * Dung voi hook useLayeredDrawerClose — xem file do de biet khi nao dialog nay hien. */
export function UnsavedChangesDialog({ onStay, onDiscard }: { onStay: () => void; onDiscard: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Xác nhận đóng"
      style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(15, 23, 42, 0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ background: '#fff', borderRadius: 10, padding: '20px 22px', maxWidth: 380, boxShadow: '0 20px 50px rgba(15,23,42,0.25)' }}>
        <p style={{ margin: '0 0 16px', fontSize: '0.92rem', color: '#1e293b', fontWeight: 600 }}>
          Bạn có thay đổi chưa lưu. Bạn có chắc muốn đóng?
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="crm-secondary-button" onClick={onStay}>Tiếp tục chỉnh sửa</button>
          <button type="button" className="crm-primary-button" style={{ background: '#b91c1c', borderColor: '#b91c1c' }} onClick={onDiscard}>
            Đóng và bỏ thay đổi
          </button>
        </div>
      </div>
    </div>
  );
}
