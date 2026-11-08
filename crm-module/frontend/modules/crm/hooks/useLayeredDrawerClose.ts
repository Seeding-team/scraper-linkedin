import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hanh vi dong CHUAN cho moi drawer/sidebar/modal ben phai trong CRM (2026-10-27,
 * yeu cau sep "Chuan hoa hanh vi dong sidebar/drawer ben phai tren toan bo CRM").
 *
 * Rut ra tu pattern DA DUNG va proven trong ContractDetailDrawer (ContractDetailPage.tsx)
 * + fix lap-lai-nhieu-lan "dropdown portal bi hieu nham la click ra ngoai" da ghi trong
 * thao/CRM_KNOWN_BUGS_FIXED.md muc 1 — chi dong khi `event.target === event.currentTarget`
 * (backdrop THAT SU, khong phai bubble tu portal con/dropdown/date-picker/combobox).
 *
 * Them moi so voi pattern cu tung lam rieng le tung file:
 * - Stacking: nhieu lop drawer/modal mo cung luc, ESC/click-ngoai CHI dong lop TREN CUNG
 *   (module-level stack, dang ky luc mount, go luc unmount).
 * - Unsaved-changes guard dung CHUNG 1 dialog (khong con moi noi tu goi `window.confirm`
 *   voi text khac nhau) — xem <UnsavedChangesDialog/> cung thu muc.
 */

let layerSeq = 0;
const openLayers: number[] = [];

export type UseLayeredDrawerCloseOptions = {
  /** false/undefined = drawer dang dong, khong dang ky vao layer stack. */
  isOpen: boolean;
  onRequestClose: () => void;
  /** Tra ve true neu dang co du lieu chua luu — khi do requestClose() se hien dialog
   * xac nhan thay vi dong ngay. Bo qua (luon dong ngay) neu khong truyen. */
  isDirty?: () => boolean;
};

export function useLayeredDrawerClose({ isOpen, onRequestClose, isDirty }: UseLayeredDrawerCloseOptions) {
  const idRef = useRef<number | null>(null);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const onRequestCloseRef = useRef(onRequestClose);
  onRequestCloseRef.current = onRequestClose;
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    const id = ++layerSeq;
    idRef.current = id;
    openLayers.push(id);
    return () => {
      const i = openLayers.indexOf(id);
      if (i !== -1) openLayers.splice(i, 1);
      idRef.current = null;
    };
  }, [isOpen]);

  const isTopmost = useCallback(() => idRef.current !== null && openLayers[openLayers.length - 1] === idRef.current, []);

  const requestClose = useCallback(() => {
    if (isDirtyRef.current?.()) {
      setConfirmOpen(true);
      return;
    }
    onRequestCloseRef.current();
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopmost()) requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, isTopmost, requestClose]);

  /** Gan thang vao backdrop: <div {...backdropMouseDownProps}> — chi dong khi click
   * THAT SU vao chinh backdrop (khong phai bubble tu noi dung ben trong/portal), VA
   * drawer nay dang la lop tren cung. */
  const backdropMouseDownProps = {
    onMouseDown: (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && isTopmost()) requestClose();
    },
  };

  const confirmStay = useCallback(() => setConfirmOpen(false), []);
  const confirmDiscard = useCallback(() => {
    setConfirmOpen(false);
    onRequestCloseRef.current();
  }, []);

  return { backdropMouseDownProps, requestClose, confirmOpen, confirmStay, confirmDiscard };
}
