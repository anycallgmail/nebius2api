import { Context } from "jsr:@hono/hono";
import { API_KEY } from '../config/constants.ts';

export const apiKeyMiddleware = async (c: Context, next: () => Promise<void>) => {
  const authHeader = c.req.header("Authorization");
  const providedKey = authHeader?.replace("Bearer ", "");
  
  if (providedKey !== API_KEY) {
    return c.text("无效的密钥，访问被拒绝", 403);
  }
  
  await next();
};
