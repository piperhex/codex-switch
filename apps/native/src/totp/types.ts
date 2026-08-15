export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpEntry {
  id: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
  createdAt: string;
}

export type TotpDraft = Omit<TotpEntry, 'id' | 'createdAt'>;

export interface TotpVault {
  entries: TotpEntry[];
  modifiedAt: string;
}

export interface TotpManagerState {
  addEntry: (draft: TotpDraft) => void;
  cloudSyncEnabled: boolean;
  deleteEntry: (id: string) => void;
  entries: TotpEntry[];
  initialized: boolean;
  setCloudSyncEnabled: (enabled: boolean) => Promise<void>;
  syncing: boolean;
  updateEntry: (id: string, draft: TotpDraft) => void;
}
