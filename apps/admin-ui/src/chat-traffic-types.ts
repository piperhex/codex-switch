export interface ChatTrafficOverview {
  totalBytes: number;
  daily: Array<{
    date: string;
    bytes: number;
    hourlyBytes: number[];
  }>;
}
