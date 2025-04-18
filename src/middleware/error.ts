import { TransformationConfig } from '../types/error.ts';

export function transformError(error: any, status: number, config: TransformationConfig): { body: any; status: number } {
  if (!config.error?.enabled) {
    return { body: error, status };
  }

  for (const rule of config.error.rules) {
    const matches = 
      rule.statusCode === '*' ||
      rule.statusCode === status ||
      (Array.isArray(rule.statusCode) && rule.statusCode.includes(status));

    if (matches) {
      const transformedError = rule.transform ? rule.transform(error) : error;
      const transformedStatus = rule.transformedStatusCode ?? status;
      
      if (rule.message && typeof transformedError === 'object') {
        transformedError.message = rule.message;
      }

      return {
        body: transformedError,
        status: transformedStatus
      };
    }
  }

  return { body: error, status };
}
