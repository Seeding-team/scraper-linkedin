import React, { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/modules/crm/components/SearchableSelect';
import { VendorRepository, CrmVendor } from '@/modules/crm/repositories/VendorRepository';

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function CrmVendorSelect({ value, onChange, placeholder = '-- Chọn Vendor --' }: Props) {
  const [vendors, setVendors] = useState<CrmVendor[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [manageSearch, setManageSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ code: '', name: '', status: 'active' });

  const fetchVendors = async () => {
    const data = await VendorRepository.listVendors();
    setVendors(data);
  };

  useEffect(() => {
    fetchVendors().catch(console.error);
  }, []);

  const activeOptions = useMemo(
    () => vendors.filter(v => v.status === 'active').map(v => ({ value: v.id, label: v.name || v.code || v.id })),
    [vendors],
  );

  const filteredVendors = useMemo(() => {
    const keyword = manageSearch.trim().toLowerCase();
    if (!keyword) return vendors;
    return vendors.filter(v => `${v.code || ''} ${v.name || ''} ${v.short_name || ''}`.toLowerCase().includes(keyword));
  }, [manageSearch, vendors]);

  const handleQuickAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const created = await VendorRepository.createVendor({ name: newName.trim(), code: newCode.trim() || null, status: 'active' });
      setVendors(prev => [...prev, created].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      onChange(created.id);
      setShowAdd(false);
      setNewName('');
      setNewCode('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Không tạo được Vendor.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (vendor: CrmVendor) => {
    setEditingId(vendor.id);
    setEditDraft({ code: vendor.code || '', name: vendor.name || '', status: vendor.status || 'active' });
  };

  const saveEdit = async (vendorId: string) => {
    if (!editDraft.name.trim()) return;
    setSaving(true);
    try {
      const updated = await VendorRepository.updateVendor(vendorId, {
        code: editDraft.code.trim() || null,
        name: editDraft.name.trim(),
        status: editDraft.status,
      });
      setVendors(prev => prev.map(v => (v.id === vendorId ? updated : v)));
      setEditingId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Không cập nhật được Vendor.');
    } finally {
      setSaving(false);
    }
  };

  const deactivateVendor = async (vendorId: string) => {
    setSaving(true);
    try {
      const updated = await VendorRepository.deactivateVendor(vendorId);
      setVendors(prev => prev.map(v => (v.id === vendorId ? updated : v)));
      if (value === vendorId) onChange('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Không ngừng sử dụng được Vendor.');
    } finally {
      setSaving(false);
    }
  };

  // Backend chi co /deactivate, khong co /activate rieng - kich hoat lai
  // dung LAI dung 1 duong updateVendor() (PATCH) da co san, chi doi status,
  // khong can endpoint moi.
  const reactivateVendor = async (vendorId: string) => {
    setSaving(true);
    try {
      const updated = await VendorRepository.updateVendor(vendorId, { status: 'active' });
      setVendors(prev => prev.map(v => (v.id === vendorId ? updated : v)));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Không kích hoạt lại được Vendor.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={activeOptions}
        placeholder={placeholder}
        actions={[
          { key: 'add', label: '+ Thêm Vendor', type: 'add', onSelect: () => setShowAdd(true) },
          { key: 'manage', label: 'Quản lý Vendor', type: 'manage', onSelect: () => setShowManage(true) },
        ]}
      />

      {showAdd && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          {/* max-w-md KHONG dung duoc trong repo nay: app/globals.css dinh
              nghia --spacing-md rieng, Tailwind v4 lay nham gia tri do cho
              utility max-w-md thay vi --container-md that (28rem) - CUNG 1
              loai bug voi max-w-lg da tim va fix truoc do (VendorImportFlow
              Step 4). Dung gia tri arbitrary [28rem] (dung gia tri Tailwind
              default that) de tranh dung ten bi trung, khong phai vá cứng
              mot con so tuy y. */}
          <div className="flex w-full max-w-[28rem] flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="m-0 font-semibold text-slate-800">Thêm Vendor nhanh</h3>
              <button type="button" onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600">×</button>
            </div>
            <form onSubmit={handleQuickAdd} className="flex flex-col gap-4 p-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Mã Vendor</label>
                <input className="h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={newCode} onChange={e => setNewCode(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Tên Vendor *</label>
                <input required autoFocus className="h-9 w-full rounded-md border border-slate-300 px-3 text-sm" value={newName} onChange={e => setNewName(e.target.value)} />
              </div>
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowAdd(false)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Hủy</button>
                <button type="submit" disabled={saving || !newName.trim()} className="rounded-md bg-[#c2185b] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#a91549] disabled:opacity-50">
                  {saving ? 'Đang lưu...' : 'Thêm mới'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showManage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="m-0 font-semibold text-slate-800">Quản lý Vendor</h3>
              <button type="button" onClick={() => setShowManage(false)} className="text-slate-400 hover:text-slate-600">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-4 flex items-center gap-3">
                <input
                  className="h-9 flex-1 rounded-md border border-slate-300 px-3 text-sm"
                  value={manageSearch}
                  onChange={e => setManageSearch(e.target.value)}
                  placeholder="Tìm Vendor theo tên hoặc mã"
                />
                <button type="button" className="rounded-md bg-[#c2185b] px-3 py-2 text-sm font-medium text-white hover:bg-[#a91549]" onClick={() => setShowAdd(true)}>
                  + Thêm Vendor
                </button>
              </div>
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 font-medium text-slate-600">Code</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Name</th>
                    <th className="px-3 py-2 font-medium text-slate-600">Status</th>
                    <th className="px-3 py-2 text-right font-medium text-slate-600">Thao tac</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVendors.map(vendor => (
                    <tr key={vendor.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-600">
                        {editingId === vendor.id ? (
                          <input className="h-8 w-full rounded border border-slate-300 px-2" value={editDraft.code} onChange={e => setEditDraft(prev => ({ ...prev, code: e.target.value }))} />
                        ) : vendor.code || '-'}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">
                        {editingId === vendor.id ? (
                          <input className="h-8 w-full rounded border border-slate-300 px-2" value={editDraft.name} onChange={e => setEditDraft(prev => ({ ...prev, name: e.target.value }))} />
                        ) : vendor.name}
                      </td>
                      <td className="px-3 py-2">
                        {editingId === vendor.id ? (
                          <select className="h-8 rounded border border-slate-300 px-2" value={editDraft.status} onChange={e => setEditDraft(prev => ({ ...prev, status: e.target.value }))}>
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                          </select>
                        ) : (
                          <span className={`rounded px-2 py-0.5 text-[10px] font-medium ${vendor.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{vendor.status}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {editingId === vendor.id ? (
                          <div className="flex justify-end gap-2">
                            <button type="button" disabled={saving} className="rounded bg-[#c2185b] px-2 py-1 text-xs font-medium text-white" onClick={() => saveEdit(vendor.id)}>Lưu</button>
                            <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => setEditingId(null)}>Hủy</button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => startEdit(vendor)}>Sửa</button>
                            {vendor.status === 'active' ? (
                              <button type="button" disabled={saving} className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-600" onClick={() => deactivateVendor(vendor.id)}>Ngừng</button>
                            ) : (
                              <button type="button" disabled={saving} className="rounded border border-emerald-200 px-2 py-1 text-xs text-emerald-700" onClick={() => reactivateVendor(vendor.id)}>Kích hoạt lại</button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filteredVendors.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-sm text-slate-500">Không tìm thấy Vendor phù hợp.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
