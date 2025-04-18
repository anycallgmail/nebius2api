import { ApiKey, KeyPoolConfig } from '../types/keyPool.ts';
import { Usage } from '../types/api.ts';
import { REDIS_CONFIG } from '../config/constants.ts';

import { Redis } from "https://esm.sh/@upstash/redis";

const redis = new Redis({
  url: REDIS_CONFIG.URL,
  token: REDIS_CONFIG.TOKEN,
});


// 导出 Redis 实例以供其他组件使用
export const redisClient = redis;

export class KeyPoolManager {
  private static instance: KeyPoolManager;
  private config: KeyPoolConfig | null = null;
  private _keyPrefix: string = 'keys';

  private constructor() {}
  
  // 获取当前键前缀
  public get keyPrefix(): string {
    return this._keyPrefix;
  }
  
  // 设置键前缀
  private setKeyPrefix(prefix: string): void {
    this._keyPrefix = prefix;
  }

  static getInstance(): KeyPoolManager {
    if (!KeyPoolManager.instance) {
      KeyPoolManager.instance = new KeyPoolManager();
    }
    return KeyPoolManager.instance;
  }

  /**
   * 初始化密钥池管理器
   * @param keyPrefix 可选的键前缀，用于区分不同项目的键
   */
  async initialize(keyPrefix?: string) {
    if (keyPrefix) {
      this.setKeyPrefix(keyPrefix);
    }
    const configRes = await redis.get<KeyPoolConfig>(`${this._keyPrefix}:config`);
    this.config = configRes || {
      currentAlgorithm: "round-robin",
      defaultRpm: 60
    };
    if (!configRes) {
      await redis.set(`${this._keyPrefix}:config`, this.config);
    }
    this.startRateLimitResetJob();
  }
  private startRateLimitResetJob() {
    setInterval(async () => {
      await this.resetRateLimits();
    }, 60000);
  }

  async resetRateLimits() {
    const keys = await this.listKeys();
    const now = Date.now();
    for (const key of keys) {
      if (now - key.rateLimit.lastReset >= 60000) {
        key.rateLimit.current = 0;
        key.rateLimit.lastReset = now;
        await redis.set(`${this._keyPrefix}:pool:${key.key}`, key);
      }
    }
  }

  async listKeys(): Promise<ApiKey[]> {
    const keys: ApiKey[] = [];
    // 使用 Redis 模式匹配获取所有键
    const keyPatterns = await redis.keys(`${this._keyPrefix}:pool:*`);
    
    // 如果有键，则获取它们的值
    if (keyPatterns.length > 0) {
      const keyValues = await Promise.all(
        keyPatterns.map((key: string) => redis.get<ApiKey>(key))
      );
      keys.push(...keyValues.filter(Boolean) as ApiKey[]);
    }
    
    return keys;
  }

  async addKey(key: string, rpm?: number): Promise<void> {
    const newKey: ApiKey = {
      key,
      rateLimit: {
        rpm: rpm || this.config?.defaultRpm || 60,
        current: 0,
        lastReset: Date.now()
      },
      usage: {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalRequests: 0,
        lastUsed: 0
      },
      algorithm: this.config?.currentAlgorithm || "round-robin",
      enabled: true
    };
    await redis.set(`${this._keyPrefix}:pool:${key}`, newKey);
  }

  async addKeys(keys: { key: string; rpm?: number }[]): Promise<{ success: string[]; failed: string[] }> {
    const results = {
      success: [] as string[],
      failed: [] as string[]
    };

    for (const { key, rpm } of keys) {
      try {
        await this.addKey(key, rpm);
        results.success.push(key);
      } catch (error) {
        console.error(`Failed to add key ${key}:`, error);
        results.failed.push(key);
      }
    }

    return results;
  }

  async getKey(userKey?: string): Promise<string> {
    if (userKey) {
      return userKey;
    }

    const keys = await this.listKeys();
    if (keys.length === 0) {
      throw new Error("No API keys available in the pool");
    }

    const enabledKeys = keys.filter(k => k.enabled);
    if (enabledKeys.length === 0) {
      throw new Error("No enabled API keys available in the pool");
    }

    const algorithm = this.config?.currentAlgorithm || "round-robin";
    let selectedKey: ApiKey | null = null;

    switch (algorithm) {
      case "round-robin": {
        selectedKey = enabledKeys.sort((a, b) => a.usage.lastUsed - b.usage.lastUsed)[0];
        break;
      }
      case "least-used": {
        selectedKey = enabledKeys.sort((a, b) => a.usage.totalRequests - b.usage.totalRequests)[0];
        break;
      }
      case "token-balanced": {
        selectedKey = enabledKeys.sort((a, b) => a.usage.totalTokens - b.usage.totalTokens)[0];
        break;
      }
      default: {
        selectedKey = enabledKeys[0];
      }
    }

    if (!selectedKey) {
      throw new Error("Failed to select an API key");
    }

    if (selectedKey.rateLimit.current >= selectedKey.rateLimit.rpm) {
      throw new Error("Rate limit exceeded for all available keys");
    }

    selectedKey.rateLimit.current++;
    selectedKey.usage.lastUsed = Date.now();
    selectedKey.usage.totalRequests++;
    await redis.set(`${this._keyPrefix}:pool:${selectedKey.key}`, selectedKey);

    return selectedKey.key;
  }

  async updateKeyStats(key: string, usage: Usage) {
    const keyData = await redis.get<ApiKey>(`${this._keyPrefix}:pool:${key}`);
    if (!keyData) {
      return;
    }

    const updatedKey = keyData;
    updatedKey.usage.totalTokens = (updatedKey.usage.totalTokens || 0) + usage.totalTokens;
    updatedKey.usage.promptTokens = (updatedKey.usage.promptTokens || 0) + usage.promptTokens;
    updatedKey.usage.completionTokens = (updatedKey.usage.completionTokens || 0) + usage.completionTokens;
    await redis.set(`${this._keyPrefix}:pool:${key}`, updatedKey);
  }

  /**
   * 禁用指定的 API key
   * @param key 要禁用的 API key
   * @param reason 禁用原因
   */
  async disableKey(key: string, reason: string): Promise<void> {
    const keyData = await redis.get<ApiKey>(`${this._keyPrefix}:pool:${key}`);
    if (!keyData) {
      return;
    }
    
    // 标记为禁用
    keyData.enabled = false;
    // 添加禁用原因和时间
    keyData.disabledReason = reason;
    keyData.disabledAt = Date.now();
    
    // 更新 Redis 中的数据
    await redis.set(`${this._keyPrefix}:pool:${key}`, keyData);
    
    // 记录日志
    console.log(`API Key ${key.substring(0, 8)}... 已被禁用，原因: ${reason}`);
  }

  /**
   * 尝试获取一个新的 API key，排除指定的 key
   * @param excludeKey 要排除的 API key
   * @returns 新的可用 API key
   */
  async retryWithFreshKey(excludeKey: string): Promise<string> {
    // 获取所有可用 key，排除已知失效的 key
    const keys = await this.listKeys();
    const enabledKeys = keys.filter(k => k.enabled && k.key !== excludeKey);
    
    if (enabledKeys.length === 0) {
      throw new Error("没有可用的 API keys");
    }
    
    // 使用当前算法选择一个 key
    const algorithm = this.config?.currentAlgorithm || "round-robin";
    let selectedKey: ApiKey | null = null;
    
    switch (algorithm) {
      case "round-robin": {
        selectedKey = enabledKeys.sort((a, b) => a.usage.lastUsed - b.usage.lastUsed)[0];
        break;
      }
      case "least-used": {
        selectedKey = enabledKeys.sort((a, b) => a.usage.totalRequests - b.usage.totalRequests)[0];
        break;
      }
      case "token-balanced": {
        selectedKey = enabledKeys.sort((a, b) => a.usage.totalTokens - b.usage.totalTokens)[0];
        break;
      }
      default: {
        selectedKey = enabledKeys[0];
      }
    }
    
    if (!selectedKey) {
      throw new Error("无法选择 API key");
    }
    
    if (selectedKey.rateLimit.current >= selectedKey.rateLimit.rpm) {
      throw new Error("所有可用 key 的速率限制已超出");
    }
    
    // 更新使用统计
    selectedKey.rateLimit.current++;
    selectedKey.usage.lastUsed = Date.now();
    selectedKey.usage.totalRequests++;
    await redis.set(`${this._keyPrefix}:pool:${selectedKey.key}`, selectedKey);
    
    return selectedKey.key;
  }
}
