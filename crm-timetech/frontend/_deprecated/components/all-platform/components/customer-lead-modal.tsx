"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { customerLeadService } from "@/services/customer-lead.service";
import type { Customer as CustomerLead } from "@/services/customer-lead.service";
import { toast } from "sonner";

interface CustomerLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  lead?: CustomerLead | null;
  defaultConvId?: string;
  defaultCustomerName?: string;
  onSuccess?: () => void;
  currentUserRole?: string;
}

export function CustomerLeadModal({
  isOpen,
  onClose,
  lead,
  defaultConvId,
  defaultCustomerName,
  onSuccess,
  currentUserRole,
}: CustomerLeadModalProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sdrs, setSdrs] = useState<any[]>([]);

  const [formData, setFormData] = useState<Partial<CustomerLead>>({
    customer_name: "",
    company_name: "",
    conv_id: "",
    status: "pending",
    note: "",
    reject_reason: "",
    is_assigned: false,
    sdr_id: "",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (lead) {
        setFormData({ ...lead });
      } else {
        setFormData({
          customer_name: defaultCustomerName || "",
          company_name: "",
          conv_id: defaultConvId || "",
          status: "pending",
          note: "",
          reject_reason: "",
          is_assigned: false,
          sdr_id: "",
        });
      }

      // Fetch SDRs if Admin/Leader
      if (currentUserRole === "admin" || currentUserRole === "leader") {
        customerLeadService.getSdrs().then((sdrs) => {
          setSdrs(sdrs);
        }).catch(() => {});
      }
    }
  }, [isOpen, lead, defaultConvId, defaultCustomerName, currentUserRole]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const dataToSave = { ...formData };
      if (dataToSave.sdr_id) {
        dataToSave.is_assigned = true;
      } else {
        dataToSave.is_assigned = false;
        dataToSave.sdr_id = undefined;
      }

      let res;
      if (lead?.id) {
        res = await customerLeadService.update(lead.id, dataToSave);
      } else {
        res = await customerLeadService.create(dataToSave);
      }

      toast.success(lead?.id ? "Cập nhật Lead thành công!" : "Tạo Lead thành công!");
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Có lỗi xảy ra");
    } finally {
      setLoading(false);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      <div className="bg-surface rounded-xl shadow-xl w-[95vw] md:w-[500px] min-w-[300px] sm:min-w-[500px] max-w-[100vw] overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
          <h2 className="text-lg font-bold text-on-surface">
            {lead ? "Chỉnh sửa Lead" : "Lưu Khách Hàng (Lead)"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface-variant transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          <form id="leadForm" onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">Tên khách hàng</label>
              <input
                type="text"
                required
                value={formData.customer_name || ""}
                onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })}
                className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Nguyễn Văn A"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">Tên công ty / Dự án</label>
              <input
                type="text"
                value={formData.company_name || ""}
                onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Công ty TNHH ABC..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Trạng thái</label>
                <select
                  value={formData.status || "pending"}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-surface"
                >
                  <option value="pending">Đang chờ</option>
                  <option value="closed">Đã chốt (Win)</option>
                  <option value="rejected">Từ chối (Loss)</option>
                </select>
              </div>

              {(currentUserRole === "admin" || currentUserRole === "leader") && (
                <div>
                  <label className="block text-sm font-medium text-on-surface mb-1">Giao cho (SDR)</label>
                  <select
                    value={formData.sdr_id || ""}
                    onChange={(e) => setFormData({ ...formData, sdr_id: e.target.value })}
                    className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-surface"
                  >
                    <option value="">-- Không giao --</option>
                    {sdrs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name || s.email}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {formData.status === "rejected" && (
              <div>
                <label className="block text-sm font-medium text-on-surface mb-1">Lý do từ chối</label>
                <input
                  type="text"
                  value={formData.reject_reason || ""}
                  onChange={(e) => setFormData({ ...formData, reject_reason: e.target.value })}
                  className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Khách chê đắt..."
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-on-surface mb-1">Ghi chú</label>
              <textarea
                value={formData.note || ""}
                onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                className="w-full px-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                placeholder="Yêu cầu cụ thể..."
              />
            </div>
          </form>
        </div>

        <div className="p-4 border-t border-outline-variant flex justify-end gap-3 bg-surface-container-low">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-on-surface-variant bg-surface border border-outline-variant rounded-lg hover:bg-surface-container-low font-medium transition-colors"
          >
            Hủy
          </button>
          <button
            type="submit"
            form="leadForm"
            disabled={loading}
            className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:opacity-50"
          >
            {loading ? "Đang lưu..." : "Lưu lại"}
          </button>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;

  return createPortal(modalContent, document.body);
}
