export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  prefix?: boolean;
  reasoning_content?: string;
  tool_call_id?: string;
}

export interface ResponseFormat {
  type: "text" | "json_object";
}

export interface StreamOptions {
  include_usage?: boolean;
}

export interface Function {
  description?: string;
  name: string;
  parameters?: Record<string, unknown>;
}

export interface Tool {
  type: "function";
  function: Function;
}

export interface ChatCompletionRequest {
  messages: Message[];
  model: string;
  frequency_penalty?: number;
  max_tokens?: number;
  presence_penalty?: number;
  response_format?: ResponseFormat;
  stop?: string | string[];
  stream?: boolean;
  stream_options?: StreamOptions;
  temperature?: number;
  top_p?: number;
  tools?: Tool[];
  tool_choice?: object | string;
  logprobs?: boolean;
  top_logprobs?: number;
}

export interface Usage {
  completionTokens: number;
  promptTokens: number;
  totalTokens: number;

  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: Message;
  finish_reason: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  usage: Usage;
  choices: ChatCompletionChoice[];
}

export interface DeltaContent {
  content?: string;
  reasoning_content?: string;
  role?: string;
}

export interface StreamChoice {
  delta: DeltaContent;
  index: number;
  finish_reason?: string;
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: StreamChoice[];
  usage?: Usage;
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
};
