import { Usage } from './api.ts';

export interface RequestLog {
  timestamp: string;
  requestId: string;
  method: string;
  path: string;
  userAgent?: string;
  isStream: boolean;
  messageCount: number;
  model: string;
  duration?: number;
}

export interface ResponseLog {
  requestId: string;
  timestamp: string;
  status: number;
  duration: number;
  isStream: boolean;
  dataSize?: number;
  chunkCount?: number;
  ttfb?: number;
  totalStreamDuration?: number;
  usage?: Usage;
}

export interface ErrorLog {
  requestId: string;
  timestamp: string;
  type: string;
  message: string;
  stack?: string;
  details?: unknown;
  status?: number;
}
