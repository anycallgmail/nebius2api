export interface ErrorTransformRule {
  statusCode: number | number[] | '*';
  message?: string;
  transformedStatusCode?: number;
  transform?: (error: any) => any;
}

export interface MessageTransformConfig {
  enabled: boolean;
  rules: ErrorTransformRule[];
}

export interface TransformationConfig {
  error: MessageTransformConfig;
  response?: MessageTransformConfig;
}
