export interface CreditWallet {
  balance: number;
  reserved?: number;
  dailyGrant: number;
  registrationGrant: number;
  pointValueRmb: number;
  special: boolean;
  lastGrantDate: string;
  nextGrantAt: string;
  checkInDate: string;
  canCheckIn: boolean;
  lastCheckInDate: string | null;
  nextCheckInAt: string;
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

export interface ImagePrice {
  modelId: string;
  rmbPerImage: number;
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
  kind: 'signup_grant' | 'daily_checkin' | 'daily_grant' | 'special_grant' | 'model_usage' | 'usage_pending' | 'service_refund';
  at: string;
  points: number;
  balance: number;
  taskId?: string;
  modelId?: string;
  requestId?: string;
  usage?: TokenUsage;
  price?: TokenPrice;
  imagePrice?: ImagePrice;
  imageCount?: number;
  detail?: string;
}

export interface CreditAccount {
  id: string;
  email: string;
  displayName: string;
  authProvider?: 'email' | 'wechat';
  wallet: CreditWallet;
}

export interface CreditAdminState {
  accounts: CreditAccount[];
  prices: TokenPrice[];
  imagePrices: ImagePrice[];
  dailyGrant: number;
  registrationGrant: number;
  pointValueRmb: number;
  specialInitial: number;
}

export interface CreditCheckInResult {
  wallet: CreditWallet;
  claimed: boolean;
  points: number;
  date: string;
}
