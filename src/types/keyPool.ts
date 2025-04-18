export interface ApiKey {
  key: string;
  rateLimit: {
    rpm: number;
    current: number;
    lastReset: number;
  };
  usage: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    totalRequests: number;
    lastUsed: number;
  };
  algorithm: string;
  enabled: boolean;
  disabledReason?: string; // 禁用原因
  disabledAt?: number; // 禁用时间戳
}

export interface KeyPoolConfig {
  currentAlgorithm: string;
  defaultRpm: number;
}
