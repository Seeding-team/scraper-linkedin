-- Migration 212: Add SIM location, owner name, and domain/group scope to zalo_accounts
-- Created at: 2026-11-01

ALTER TABLE public.zalo_accounts
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS sim_location TEXT DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS sim_location_detail TEXT,
  ADD COLUMN IF NOT EXISTS assigned_domains JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assigned_groups JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.zalo_accounts.owner_name IS 'Tên nhân sự phụ trách tài khoản Zalo';
COMMENT ON COLUMN public.zalo_accounts.sim_location IS 'Vị trí SIM/thiết bị: owner (Điện thoại người phụ trách), staff (Điện thoại nhân sự khác), farm (Phone Farm)';
COMMENT ON COLUMN public.zalo_accounts.sim_location_detail IS 'Chi tiết vị trí SIM thực tế hoặc mã Phone Farm / thiết bị';
COMMENT ON COLUMN public.zalo_accounts.assigned_domains IS 'Mảng ID lĩnh vực phụ trách (JSONB array)';
COMMENT ON COLUMN public.zalo_accounts.assigned_groups IS 'Mảng ID nhóm Facebook/Zalo phụ trách (JSONB array)';

