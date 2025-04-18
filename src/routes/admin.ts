import { Context, Hono } from "jsr:@hono/hono";
import { KeyPoolManager, redisClient } from '../services/keyPool.ts';
import { ApiKey, KeyPoolConfig } from '../types/keyPool.ts';
import { API_ENDPOINTS } from '../config/constants.ts';

const router = new Hono();

// List all keys
router.get(API_ENDPOINTS.ADMIN.KEYS, async (c: Context) => {
  try {
    const keys = await KeyPoolManager.getInstance().listKeys();
    return c.json(keys);
  } catch (error) {
    console.error("Error listing keys:", error);
    return c.json({ error: "Failed to list keys" }, 500);
  }
});

// Add a new key
router.post(API_ENDPOINTS.ADMIN.KEYS, async (c: Context) => {
  try {
    const body = await c.req.json();
    
    // Handle single key addition
    if ('key' in body) {
      const { key, rpm } = body;
      if (!key) {
        return c.json({ error: "Key is required" }, 400);
      }
      await KeyPoolManager.getInstance().addKey(key, rpm);
      return c.json({ message: "Key added successfully" });
    }
    
    // Handle batch key addition
    if ('keys' in body && Array.isArray(body.keys)) {
      if (body.keys.length === 0) {
        return c.json({ error: "Keys array cannot be empty" }, 400);
      }

      // Validate keys format
      const invalidKeys = body.keys.filter((k: { key?: string; rpm?: number }) => !k.key || typeof k.key !== 'string');
      if (invalidKeys.length > 0) {
        return c.json({ error: "Invalid key format in batch request" }, 400);
      }

      const results = await KeyPoolManager.getInstance().addKeys(body.keys);
      return c.json({
        message: "Batch key addition completed",
        results: {
          total: body.keys.length,
          successful: results.success.length,
          failed: results.failed.length,
          failedKeys: results.failed
        }
      });
    }

    return c.json({ error: "Invalid request format" }, 400);
  } catch (error) {
    console.error("Error adding key(s):", error);
    return c.json({ error: "Failed to add key(s)" }, 500);
  }
});

// Update a key
router.put(`${API_ENDPOINTS.ADMIN.KEYS}/:key`, async (c: Context) => {
  try {
    const keyId = c.req.param("key");
    const { rpm, enabled } = await c.req.json();
    const keyPool = KeyPoolManager.getInstance();
    const keyData = await redisClient.get<ApiKey>(`${keyPool.keyPrefix}:pool:${keyId}`);
    
    if (!keyData) {
      return c.json({ error: "Key not found" }, 404);
    }

    const updatedKey = keyData;
    if (typeof rpm === 'number') {
      updatedKey.rateLimit.rpm = rpm;
    }
    if (typeof enabled === 'boolean') {
      updatedKey.enabled = enabled;
    }

    await redisClient.set(`${keyPool.keyPrefix}:pool:${keyId}`, updatedKey);
    return c.json({ message: "Key updated successfully" });
  } catch (error) {
    console.error("Error updating key:", error);
    return c.json({ error: "Failed to update key" }, 500);
  }
});

// Delete a key
router.delete(`${API_ENDPOINTS.ADMIN.KEYS}/:key`, async (c: Context) => {
  try {
    const keyId = c.req.param("key");
    const keyPool = KeyPoolManager.getInstance();
    const keyData = await redisClient.get<ApiKey>(`${keyPool.keyPrefix}:pool:${keyId}`);
    
    if (!keyData) {
      return c.json({ error: "Key not found" }, 404);
    }

    await redisClient.del(`${keyPool.keyPrefix}:pool:${keyId}`);
    return c.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.error("Error deleting key:", error);
    return c.json({ error: "Failed to delete key" }, 500);
  }
});

// Get configuration
router.get(API_ENDPOINTS.ADMIN.CONFIG, async (c: Context) => {
  try {
    const keyPool = KeyPoolManager.getInstance();
    const configRes = await redisClient.get<KeyPoolConfig>(`${keyPool.keyPrefix}:config`);
    if (!configRes) {
      return c.json({ error: "Configuration not found" }, 404);
    }
    return c.json(configRes);
  } catch (error) {
    console.error("Error getting config:", error);
    return c.json({ error: "Failed to get configuration" }, 500);
  }
});

// Update configuration
router.put(API_ENDPOINTS.ADMIN.CONFIG, async (c: Context) => {
  try {
    const { currentAlgorithm, defaultRpm } = await c.req.json();
    const keyPool = KeyPoolManager.getInstance();
    const configRes = await redisClient.get<KeyPoolConfig>(`${keyPool.keyPrefix}:config`);
    
    if (!configRes) {
      return c.json({ error: "Configuration not found" }, 404);
    }

    const updatedConfig = configRes;
    if (currentAlgorithm) {
      if (!["round-robin", "least-used", "token-balanced"].includes(currentAlgorithm)) {
        return c.json({ error: "Invalid algorithm" }, 400);
      }
      updatedConfig.currentAlgorithm = currentAlgorithm;
    }
    if (typeof defaultRpm === 'number' && defaultRpm > 0) {
      updatedConfig.defaultRpm = defaultRpm;
    }

    await redisClient.set(`${keyPool.keyPrefix}:config`, updatedConfig);
    return c.json({ message: "Configuration updated successfully" });
  } catch (error) {
    console.error("Error updating config:", error);
    return c.json({ error: "Failed to update configuration" }, 500);
  }
});

export default router;
