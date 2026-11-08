/**
 * Loại team — migration 049 (teams.team_type). Dùng chung cho dropdown
 * "Loại team" (AdminTeamModal, CategoryManagementContent's TeamModal) và
 * dropdown lọc team trên Pipeline. Value phải khớp CHECK constraint
 * teams_team_type_check ở backend.
 */
export type TeamType =
  | "dev"
  | "marketing"
  | "sale"
  | "presales"
  | "technical"
  | "back_office"
  | "intern"
  | "freelancer"
  | "khac";

export const TEAM_TYPE_OPTIONS: Array<{ value: TeamType; label: string }> = [
  { value: "dev", label: "Dev" },
  { value: "marketing", label: "Marketing" },
  { value: "sale", label: "Sale" },
  { value: "presales", label: "Presales" },
  { value: "technical", label: "Technical" },
  { value: "back_office", label: "Back Office" },
  { value: "intern", label: "Intern" },
  { value: "freelancer", label: "Freelancer" },
  { value: "khac", label: "Khác" },
];

export function getTeamTypeLabel(value?: string | null): string {
  return TEAM_TYPE_OPTIONS.find(o => o.value === value)?.label || "Khác";
}
