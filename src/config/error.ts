import { TransformationConfig } from '../types/error.ts';

export const defaultTransformConfig: TransformationConfig = {
  error: {
    enabled: true,
    rules: [
      {
        statusCode: 401,
        message: "认证失败，请检查您的访问凭证",
        transform: () => ({
          code: 'AUTH_ERROR',
          message: "认证失败，请检查您的访问凭证",
        })
      },
      {
        statusCode: 400,
        message: "请求无效，请检查您的输入",
        transform: () => ({
          code: 'BAD_REQUEST',
          message: "请求无效，请检查您的输入",
        })
      },
      {
        statusCode: 403,
        message: "禁止访问，您没有权限",
        transform: () => ({
          code: 'FORBIDDEN',
          message: "禁止访问，您没有权限",
        })
      },
      {
        statusCode: 404,
        message: "请求的资源未找到",
        transform: () => ({
          code: 'NOT_FOUND',
          message: "请求的资源未找到",
        })
      },
      {
        statusCode: 429,
        message: "请求过于频繁，请稍后再试",
        transform: () => ({
          code: 'TOO_MANY_REQUESTS',
          message: "请求过于频繁，请稍后再试",
        })
      },
      {
        statusCode: [500, 501, 502, 503, 504],
        message: "服务暂时不可用，请稍后重试",
        transform: (error) => ({
          code: 'SERVICE_ERROR',
          message: "服务暂时不可用，请稍后重试",
          requestId: error.requestId
        })
      },
      {
        statusCode: '*',
        transform: () => ({
          message: `发生未知错误`
        })
      }
    ]
  }
};
