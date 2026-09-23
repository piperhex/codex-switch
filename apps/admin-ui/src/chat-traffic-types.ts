export interface ChatTrafficOverview {
  totalBytes: number;
  daily: Array<{
    date: string;
    bytes: number;
    hourlyBytes: number[];
  }>;
}
export type TrafficApi = <T>(path: string, options?: RequestInit) => Promise<T>;

export interface UserChatTraffic {
  id: string;
  email: string;
  totalBytes: number;
  monthBytes: number;
  monthUsedBytes: number;
  monthlyLimitBytes: number;
  resetAt: string;
}

export interface UserChatTrafficDetail extends ChatTrafficOverview { user: UserChatTraffic }
