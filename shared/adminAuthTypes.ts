export interface AdminAccount {
  username: string;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  recoveryCodesRemaining: number;
}

export interface AdminLogin {
  token: string;
  expiresAt: number;
  account: AdminAccount;
  usedRecoveryCode?: boolean;
}

export interface AdminChallenge {
  requiresTotp: true;
  challenge: string;
  expiresAt: number;
}

export interface AdminTotpSetup {
  secret: string;
  qrDataUrl: string;
  expiresAt: number;
}
