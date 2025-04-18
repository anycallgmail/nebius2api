// API key for authentication
// Get from environment variable with fallback for development
export const API_KEY = Deno.env.get('RELAY_API_KEY') ?? 'your_fixed_api_key_here';

// Server configuration
export const SERVER_PORT = 8000;

// API endpoints
export const API_ENDPOINTS = {
  CHAT_COMPLETIONS: '/chat/completions',
  ADMIN: {
    KEYS: '/admin/keys',
    CONFIG: '/admin/config'
  }
};

// External API configuration
export const EXTERNAL_API = {
  CENTML: {
    BASE_URL: 'https://api.studio.nebius.ai/v1',
    ENDPOINTS: {
      CHAT_COMPLETIONS: '/chat/completions'
    }
  }
};

// Redis 配置
export const REDIS_CONFIG = {
  URL: 'https://.upstash.io',
  TOKEN: '',
};
