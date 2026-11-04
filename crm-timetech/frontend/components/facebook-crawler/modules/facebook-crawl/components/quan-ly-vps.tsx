"use client";

import React, { useState } from "react";
import axios from "axios";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PlatformStatCard, PlatformStatsRow } from "@/components/features/shared/PlatformStatCard";
import { MaterialIcon } from "@/components/ui";

const API_BASE = process.env.NEXT_PUBLIC_API_FACEBOOK_BASE_URL || "http://127.0.0.1:8000";

interface VpsCookie {
  id: string;
  status: string;
  email?: string;
}

interface VpsFb {
  id: number;
  created_at: string;
  name: string;
  http: string;
  active_session: number;
  active: boolean;
  cookie_count: number;
  error_cookie_count: number;
  Vps_cookies?: VpsCookie[];
}

export function QuanLyVps() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [formData, setFormData] = useState<Partial<VpsFb>>({});

  const [cookieModalVpsId, setCookieModalVpsId] = useState<number | null>(null);
  
  // State form thêm cookie
  const [newCookieEmail, setNewCookieEmail] = useState("");
  const [newCookieJson, setNewCookieJson] = useState("");

  // Fetch dữ liệu từ router FastAPI
  const { data: vpsList = [], isLoading, error } = useQuery<VpsFb[]>({
    queryKey: ["vps_fb_list"],
    queryFn: async () => {
      const res = await axios.get(`${API_BASE}/api/all-platform/vps_fb`);
      return res.data.data || [];
    },
    staleTime: 5000,
  });

  const createMutation = useMutation({
    mutationFn: async (newData: any) => {
      await axios.post(`${API_BASE}/api/all-platform/vps_fb`, newData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vps_fb_list"] });
      closeModal();
    },
    onError: (err: any) => {
      alert("Lỗi khi thêm: " + (err?.response?.data?.detail || err.message));
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await axios.put(`${API_BASE}/api/all-platform/vps_fb/${id}`, data);
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vps_fb_list"] });
      closeModal();
    },
    onError: (err: any) => {
      alert("Lỗi khi cập nhật: " + (err?.response?.data?.detail || err.message));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await axios.delete(`${API_BASE}/api/all-platform/vps_fb/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vps_fb_list"] });
    },
    onError: (err: any) => {
      alert("Lỗi khi xóa: " + (err?.response?.data?.detail || err.message));
    }
  });

  // Mutation thêm cookie
  const createCookieMutation = useMutation({
    mutationFn: async (newData: any) => {
      await axios.post(`${API_BASE}/api/all-platform/vps_fb/cookies`, newData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vps_fb_list"] });
      setNewCookieEmail("");
      setNewCookieJson("");
    },
    onError: (err: any) => {
      alert("Lỗi khi thêm cookie: " + (err?.response?.data?.detail || err.message));
    }
  });
  // Mutation xóa cookie
  const deleteCookieMutation = useMutation({
    mutationFn: async (cookieId: string) => {
      await axios.delete(`${API_BASE}/api/all-platform/vps_fb/cookies/${cookieId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vps_fb_list"] });
    },
    onError: (err: any) => {
      alert("Lỗi khi xóa cookie: " + (err?.response?.data?.detail || err.message));
    }
  });

  const openModalForCreate = () => {
    setIsEditMode(false);
    setFormData({ name: "", http: "", active_session: 0, active: true });
    setIsModalOpen(true);
  };

  const openModalForEdit = (vps: VpsFb) => {
    setIsEditMode(true);
    setFormData({
      id: vps.id,
      name: vps.name,
      http: vps.http,
      active_session: vps.active_session,
      active: vps.active,
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setFormData({});
  };

  const handleSave = () => {
    if (!formData.name || !formData.http) {
      alert("Vui lòng điền tên và http proxy.");
      return;
    }
    const payload: any = {
      name: formData.name,
      http: formData.http,
    };

    if (isEditMode && formData.id) {
      updateMutation.mutate({ id: formData.id, data: payload });
    } else {
      payload.active_session = 0;
      payload.active = false;
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (id: number) => {
    if (window.confirm("Bạn có chắc chắn muốn xóa VPS này? Mọi dữ liệu liên quan có thể bị ảnh hưởng.")) {
      deleteMutation.mutate(id);
    }
  };

  const handleAddCookie = () => {
    if (!newCookieEmail.trim()) {
      alert("Vui lòng nhập Email. (Bắt buộc)");
      return;
    }

    let parsedCookie = {};
    if (newCookieJson.trim()) {
      try {
        parsedCookie = JSON.parse(newCookieJson);
      } catch(e) {
        alert("Cookie JSON không hợp lệ. Vui lòng kiểm tra lại định dạng.");
        return;
      }
    }

    createCookieMutation.mutate({
      vps_fb_id: cookieModalVpsId,
      cookie: parsedCookie,
      email: newCookieEmail.trim(),
      status: newCookieJson.trim() ? "idle" : null
    });
  };

  const handleDeleteCookie = (cookieId: string) => {
    if (window.confirm("Bạn có chắc chắn muốn xóa cookie này khỏi VPS?")) {
      deleteCookieMutation.mutate(cookieId);
    }
  };

  // Tính toán số liệu thống kê hiển thị
  const totalVps = vpsList.length;
  const activeVps = vpsList.filter(v => v.active).length;
  const inactiveVps = totalVps - activeVps;
  const totalCookies = vpsList.reduce((sum, v) => sum + (v.cookie_count || 0), 0);
  const totalErrorCookies = vpsList.reduce((sum, v) => sum + (v.error_cookie_count || 0), 0);

  // Lọc tìm kiếm và trạng thái
  const filteredList = vpsList.filter(v => {
    const searchStr = searchTerm.toLowerCase();
    const matchSearch = (v.name || "").toLowerCase().includes(searchStr) ||
                        (v.http || "").toLowerCase().includes(searchStr) ||
                        v.id.toString() === searchStr.trim();
    const matchStatus = statusFilter === "all" || 
                        (statusFilter === "active" && v.active) || 
                        (statusFilter === "inactive" && !v.active);
    return matchSearch && matchStatus;
  });

  const getCookieStatusBadge = (status: string | null) => {
    if (!status || status === "null") {
      return <span className="inline-flex px-2.5 py-1 bg-slate-100 text-slate-500 rounded-md text-xs font-bold border border-slate-200">Chưa có cookie</span>;
    }
    switch(status) {
      case "idle":
        return <span className="inline-flex px-2.5 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-bold border border-slate-200">Chưa sử dụng</span>;
      case "in_use":
      case "in_idle":
        return <span className="inline-flex px-2.5 py-1 bg-blue-50 text-blue-600 rounded-md text-xs font-bold border border-blue-100">Đang sử dụng</span>;
      case "cooldown":
        return <span className="inline-flex px-2.5 py-1 bg-orange-50 text-orange-600 rounded-md text-xs font-bold border border-orange-100">Đang làm lạnh</span>;
      case "error":
        return <span className="inline-flex px-2.5 py-1 bg-red-50 text-red-600 rounded-md text-xs font-bold border border-red-100">Lỗi</span>;
      default:
        return <span className="inline-flex px-2.5 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-bold border border-slate-200">{status}</span>;
    }
  };

  // Vps đang được chọn xem cookies
  const currentCookieVps = vpsList.find(v => v.id === cookieModalVpsId) || null;

  return (
    <div className="flex w-full flex-col gap-6 font-sans">
      <PlatformStatsRow>
        <PlatformStatCard
          label="Tổng số VPS"
          value={totalVps}
          accent="primary"
          hint="Đang lưu trữ"
        />
        <PlatformStatCard
          label="Đang hoạt động"
          value={activeVps}
          accent="success"
          hintTone="up"
          hint="Hoạt động"
        />
        <PlatformStatCard
          label="Chưa hoạt động"
          value={inactiveVps}
          accent="warning"
          hintTone="down"
        />
        <PlatformStatCard
          label="Tổng Cookies"
          value={totalCookies}
          accent="primary"
          hint="Tất cả VPS"
        />
        <PlatformStatCard
          label="Cookies lỗi"
          value={totalErrorCookies}
          accent="error"
          hintTone="down"
          hint="Status = error"
        />
      </PlatformStatsRow>

      <div className="flex items-center justify-between mt-4">
        <h2 className="text-xl font-bold text-slate-800">Quản lý VPS & Cấu hình</h2>
        <button
          onClick={openModalForCreate}
          className="bg-primary text-white hover:bg-primary/90 flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition cursor-pointer"
        >
          <MaterialIcon name="add" className="text-[18px]" />
          Thêm VPS Mới
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-200">
          Không thể tải danh sách VPS. Vui lòng kiểm tra lại API backend.
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="relative w-full sm:w-[400px] md:w-[500px] shrink-0">
            <MaterialIcon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]" />
            <input
              type="text"
              placeholder="Tìm kiếm theo ID, tên VPS, Proxy..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors text-slate-800"
            />
          </div>
          <div className="w-full sm:w-48">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors cursor-pointer text-slate-800"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Tạm ngưng</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto min-h-[300px]">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50/75 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="py-3 px-5">ID</th>
                <th className="py-3 px-5">Tên VPS</th>
                <th className="py-3 px-5">HTTP Proxy</th>
                <th className="py-3 px-5 text-center">Active Session</th>
                <th className="py-3 px-5 text-center">Cookies (Tổng / Lỗi)</th>
                <th className="py-3 px-5 text-center">Trạng thái</th>
                <th className="py-3 px-5 text-center">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      <span>Đang tải dữ liệu VPS...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 italic">
                    {searchTerm || statusFilter !== 'all' ? "Không tìm thấy kết quả nào phù hợp." : "Chưa có dữ liệu VPS nào."}
                  </td>
                </tr>
              ) : (
                filteredList.map((vps) => (
                  <tr key={vps.id} className="hover:bg-slate-50/50 transition duration-150">
                    <td className="py-4 px-5 font-medium text-slate-500">#{vps.id}</td>
                    <td className="py-4 px-5 font-bold text-slate-900">{vps.name}</td>
                    <td className="py-4 px-5 text-slate-500 text-xs font-mono">{vps.http}</td>
                    <td className="py-4 px-5 text-center font-medium">{vps.active_session}</td>
                    <td className="py-4 px-5 text-center">
                      <div className="flex flex-col items-center justify-center gap-1">
                        <span className="bg-blue-50 text-blue-700 border border-blue-200 font-bold px-2.5 py-0.5 rounded-full text-xs">
                          Tổng: {vps.cookie_count}
                        </span>
                        {vps.error_cookie_count > 0 && (
                          <span className="bg-red-50 text-red-700 border border-red-200 font-bold px-2.5 py-0.5 rounded-full text-xs" title="Số cookie đang bị lỗi">
                            Lỗi: {vps.error_cookie_count}
                          </span>
                        )}
                        <button 
                          onClick={() => setCookieModalVpsId(vps.id)}
                          className="text-[10px] text-blue-500 hover:text-blue-700 hover:underline mt-1 font-bold cursor-pointer"
                        >
                          Xem chi tiết
                        </button>
                      </div>
                    </td>
                    <td className="py-4 px-5 text-center">
                      {vps.active ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-100 w-max mx-auto">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Hoạt động
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200 w-max mx-auto">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                          Tạm ngưng
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-5 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => openModalForEdit(vps)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition cursor-pointer"
                          title="Chỉnh sửa VPS"
                        >
                          <MaterialIcon name="edit" className="text-[16px]" />
                        </button>
                        <button
                          onClick={() => handleDelete(vps.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition cursor-pointer"
                          title="Xóa VPS"
                        >
                          <MaterialIcon name="delete" className="text-[16px]" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL CHI TIẾT COOKIES */}
      {currentCookieVps && (
        <div 
          className="fixed inset-0 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          style={{ zIndex: 9999 }}
          onClick={() => setCookieModalVpsId(null)}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            style={{ width: "100%", maxWidth: "650px", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 flex-shrink-0">
              <h3 className="font-bold text-lg text-slate-800">
                Quản lý Cookies - VPS #{currentCookieVps.id}
              </h3>
              <button 
                onClick={() => setCookieModalVpsId(null)} 
                className="text-slate-400 hover:text-slate-700 bg-white hover:bg-slate-100 rounded-md p-1 transition cursor-pointer"
              >
                <MaterialIcon name="close" />
              </button>
            </div>
            
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Form thêm cookie */}
              <div className="p-4 bg-white border-b border-slate-100 flex-shrink-0 space-y-3">
                <h4 className="text-sm font-bold text-slate-800">Thêm Cookie mới</h4>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Email (Bắt buộc)" 
                    className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary outline-none transition"
                    value={newCookieEmail}
                    onChange={e => setNewCookieEmail(e.target.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="Dán mã JSON cookie vào đây (Tùy chọn)..." 
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary outline-none transition"
                    value={newCookieJson}
                    onChange={e => setNewCookieJson(e.target.value)}
                  />
                  <button 
                    onClick={handleAddCookie}
                    disabled={createCookieMutation.isPending}
                    className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap hover:bg-primary/90 transition disabled:opacity-60 cursor-pointer flex items-center gap-1.5"
                  >
                    {createCookieMutation.isPending ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <MaterialIcon name="add" className="text-[16px]" />
                    )}
                    Thêm
                  </button>
                </div>
              </div>

              {/* Danh sách cookie */}
              <div className="flex-1 overflow-y-auto bg-slate-50">
                {(!currentCookieVps.Vps_cookies || currentCookieVps.Vps_cookies.length === 0) ? (
                  <div className="p-10 flex flex-col items-center justify-center text-slate-400">
                    <MaterialIcon name="key" className="text-[48px] mb-3 text-slate-300" />
                    <p className="font-medium text-sm">Chưa có cookie nào trong VPS này.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse bg-white">
                    <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-5 text-xs font-bold text-slate-500 uppercase">STT</th>
                        <th className="py-3 px-5 text-xs font-bold text-slate-500 uppercase">Email</th>
                        <th className="py-3 px-5 text-xs font-bold text-slate-500 uppercase text-center">Trạng thái</th>
                        <th className="py-3 px-5 text-xs font-bold text-slate-500 uppercase text-center w-20">Xóa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {currentCookieVps.Vps_cookies.map((c, index) => (
                        <tr key={c.id || index} className="hover:bg-slate-50 transition">
                          <td className="py-3 px-5 text-sm font-bold text-slate-400 w-12 text-center">{index + 1}</td>
                          <td className="py-3 px-5 text-sm font-medium text-slate-700">{c.email || <span className="text-slate-300 italic">Không có email</span>}</td>
                          <td className="py-3 px-5 text-center">
                            {getCookieStatusBadge(c.status)}
                          </td>
                          <td className="py-3 px-5 text-center">
                            <button
                              onClick={() => handleDeleteCookie(c.id.toString())}
                              className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition cursor-pointer"
                              title="Xóa Cookie"
                            >
                              <MaterialIcon name="delete" className="text-[16px]" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL THÊM / CẬP NHẬT VPS */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          style={{ zIndex: 9999 }}
          onClick={closeModal}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            style={{ width: "100%", maxWidth: "450px", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 flex-shrink-0">
              <h3 className="font-bold text-lg text-slate-800">
                {isEditMode ? "Cập nhật VPS" : "Thêm VPS mới"}
              </h3>
              <button 
                onClick={closeModal} 
                className="text-slate-400 hover:text-slate-700 bg-white hover:bg-slate-100 rounded-md p-1 transition cursor-pointer"
              >
                <MaterialIcon name="close" />
              </button>
            </div>
            
            <div className="p-6 flex flex-col gap-5 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Tên VPS <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name || ""}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none transition"
                  placeholder="Ví dụ: VPS USA 01"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  HTTP Proxy <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.http || ""}
                  onChange={(e) => setFormData({ ...formData, http: e.target.value })}
                  className="w-full border border-slate-300 rounded-lg px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-primary focus:border-primary outline-none transition font-mono"
                  placeholder="Ví dụ: http://10.30.195.41:8888"
                />
              </div>
            </div>
            
            <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 flex-shrink-0">
              <button
                onClick={closeModal}
                className="px-4 py-2 text-sm font-bold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleSave}
                disabled={createMutation.isPending || updateMutation.isPending}
                className="flex items-center justify-center min-w-[100px] px-4 py-2 text-sm font-bold text-white bg-primary rounded-lg hover:bg-primary/90 transition disabled:opacity-60 cursor-pointer"
              >
                {createMutation.isPending || updateMutation.isPending ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  isEditMode ? "Lưu thay đổi" : "Tạo mới"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
