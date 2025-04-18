import { RequestLog, ResponseLog, ErrorLog } from '../types/logging.ts';

export function generateRequestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

export function logRequest(log: RequestLog): void {
  console.log("[Request]", JSON.stringify(log, null, 2));
}

export function logResponse(log: ResponseLog): void {
  console.log("[Response]", JSON.stringify(log, null, 2));
}

export function logError(log: ErrorLog): void {
  console.error("[Error]", JSON.stringify(log, null, 2));
}
