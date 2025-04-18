import { Hono } from "jsr:@hono/hono";
import { KeyPoolManager } from './services/keyPool.ts';
import { apiKeyMiddleware } from './middleware/auth.ts';
import adminRoutes from './routes/admin.ts';
import chatRoutes from './routes/chat.ts';
import { SERVER_PORT } from './config/constants.ts';

// Initialize app
const app = new Hono();

// Initialize KeyPoolManager
const keyPoolManager = KeyPoolManager.getInstance();
await keyPoolManager.initialize();

// Apply middleware
app.use(apiKeyMiddleware);

// Mount routes
app.route('/', adminRoutes);
app.route('/', chatRoutes);

// Start server
console.log(`Server is running on port ${SERVER_PORT}`);
Deno.serve({ port: SERVER_PORT }, app.fetch);
