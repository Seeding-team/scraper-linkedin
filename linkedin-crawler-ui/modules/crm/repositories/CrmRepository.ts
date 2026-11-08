import type {
  AnalyticsFilters,
  CreateDealInput,
  CrmAnalytics,
  CrmUserOption,
  Deal,
  DealFilters,
  DealStage,
  StageTransitionInput,
  UpdateDealInput,
} from '../types';

export interface CrmRepository {
  getDeals(filters?: DealFilters): Promise<Deal[]>;
  getDeal(id: string): Promise<Deal>;
  createDeal(input: CreateDealInput): Promise<Deal>;
  updateDeal(id: string, input: UpdateDealInput): Promise<Deal>;
  deleteDeal(id: string, confirmCascade?: boolean): Promise<void>;
  getAiParseDealStatus(): Promise<boolean>;
  parseDealText(text: string): Promise<Partial<Record<
    'customerName' | 'companyName' | 'phone' | 'email' | 'servicePackage' | 'estimatedBudget' | 'nextStep' | 'note',
    string | number | null
  >>>;
  moveDeal(
    id: string,
    stage: DealStage,
    payload?: StageTransitionInput
  ): Promise<Deal>;
  getAnalytics(filters?: AnalyticsFilters): Promise<CrmAnalytics>;
  getAgents(): Promise<CrmUserOption[]>;
}
