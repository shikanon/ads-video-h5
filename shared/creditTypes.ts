export interface CreditWallet {
  balance: number;
  dailyGrant: number;
  pointValueRmb: number;
  special: boolean;
  lastGrantDate: string;
  nextGrantAt: string;
  totalSpent: number;
}

export interface TokenPrice {
  modelId: string;
  input: number;
  cachedInput: number;
  output: number;
  audioInput?: number;
  cachedAudioInput?: number;
  source: string;
  updatedAt: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cachedInput: number;
  audioInput: number;
  cachedAudioInput: number;
}

export interface CreditEntry {
  id: string;
  userId: string;
  kind: 'daily_grant' | 'special_grant' | 'model_usage' | 'usage_pending';
  at: string;
  points: number;
  balance: number;
  taskId?: string;
  modelId?: string;
  requestId?: string;
  usage?: TokenUsage;
  price?: TokenPrice;
  detail?: string;
}

export interface CreditAccount {
  id: string;
  email: string;
  displayName: string;
  wallet: CreditWallet;
}

export interface CreditAdminState {
  accounts: CreditAccount[];
  prices: TokenPrice[];
  dailyGrant: number;
  pointValueRmb: number;
  specialInitial: number;
}
