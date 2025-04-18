import { Context, Hono } from "jsr:@hono/hono";
import { encodeChat } from "https://esm.sh/gpt-tokenizer@2.8.1/model/gpt-4o";

import { KeyPoolManager } from '../services/keyPool.ts';
import { 
  ChatCompletionRequest, 
  ChatCompletionResponse, 
  ChatCompletionChoice,
  ChatCompletionChunk,
  ChatMessage
} from '../types/api.ts';
import { RequestLog } from '../types/logging.ts';
import { logRequest, logResponse, logError, generateRequestId } from '../services/logging.ts';
import { transformError } from '../middleware/error.ts';
import { defaultTransformConfig } from '../config/error.ts';
import { API_ENDPOINTS, EXTERNAL_API } from '../config/constants.ts';

const router = new Hono();

router.post(API_ENDPOINTS.CHAT_COMPLETIONS, async (c: Context) => {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const requestLog: RequestLog = {
    timestamp: new Date().toISOString(),
    requestId,
    method: c.req.method,
    path: c.req.path,
    userAgent: c.req.header("User-Agent"),
    isStream: false,
    messageCount: 0,
    model: "",
  };

  try {
    const body = await c.req.json() as ChatCompletionRequest;
    
    // Update request log with body info
    requestLog.isStream = body.stream ?? false;
    requestLog.messageCount = body.messages?.length ?? 0;
    requestLog.model = body.model ?? "";
    logRequest(requestLog);

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      logError({
        requestId,
        timestamp: new Date().toISOString(),
        type: "ValidationError",
        message: "Messages array is required and cannot be empty",
      });
      return c.text("Messages array is required and cannot be empty", 400);
    }
    if (!body.model) {
      logError({
        requestId,
        timestamp: new Date().toISOString(),
        type: "ValidationError",
        message: "Model field is required",
      });
      return c.text("Model field is required", 400);
    }

    // Validate token count
    const chatMessages: ChatMessage[] = body.messages.map(msg => {
      // 处理 content 可能是数组的情况
      let content = msg.content;
      if (Array.isArray(content)) {
        content = content.map(item => item.text || '').join('');
      }
      
      return {
        role: msg.role === 'tool' ? 'assistant' : msg.role, // Map 'tool' role to 'assistant' for tokenizer
        content: content,
        name: msg.name
      };
    });
    const chatTokens = encodeChat(chatMessages, "gpt-4o");
    if (chatTokens.length > 128000) {
      logError({
        requestId,
        timestamp: new Date().toISOString(),
        type: "ValidationError",
        message: "Input exceeds maximum token limit of 128000",
      });
      return c.text("Input exceeds maximum token limit of 128000", 400);
    }

    // Get API key from pool or use provided key
    let apiKey: string;
    try {
      apiKey = await KeyPoolManager.getInstance().getKey();
    } catch (error) {
      logError({
        requestId,
        timestamp: new Date().toISOString(),
        type: "KeyPoolError",
        message: error instanceof Error ? error.message : "Failed to get API key",
      });
      return c.text(error instanceof Error ? error.message : "Failed to get API key", 429);
    }

    const isStream = body.stream ?? false;
    if (isStream) {
      body.stream_options = { include_usage: true };
    }
    
    // 发送请求函数，允许在 key 余额耗尽时重试
    const sendRequest = async (key: string, retryAttempt = 0): Promise<Response> => {
      // 最大重试次数限制（防止无限递归）
      const MAX_RETRY_ATTEMPTS = 3;
      if (retryAttempt > MAX_RETRY_ATTEMPTS) {
        throw new Error(`超过最大重试次数 ${MAX_RETRY_ATTEMPTS}`);
      }
      
      // 更新授权头使用当前 key
      const headers = new Headers();
      headers.set("Content-Type", "application/json");
      headers.set("Authorization", `Bearer ${key}`);
      
      // 添加用户代理头
      const userAgent = c.req.header("User-Agent");
      if (userAgent) headers.set("User-Agent", userAgent);
      
      // 发送请求
      const resp = await fetch(
        `${EXTERNAL_API.CENTML.BASE_URL}${EXTERNAL_API.CENTML.ENDPOINTS.CHAT_COMPLETIONS}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }
      );
      
      // 如果请求成功，直接返回响应
      if (resp.ok) {
        return resp;
      }
      
      // 处理错误响应
      const errorData = await resp.clone().json();
      
      // 检测是否是 API key 余额耗尽错误（402 Payment Required）
      const isKeyExhausted = resp.status === 402 &&
                            errorData?.details?.detail?.includes("exhausted your budget");
      
      if (isKeyExhausted) {
        // 记录 key 余额耗尽错误
        logError({
          requestId,
          timestamp: new Date().toISOString(),
          type: "KeyExhaustedError",
          message: `API Key 余额耗尽: ${key.substring(0, 8)}...`,
          details: errorData,
          status: resp.status,
        });
        
        // 禁用当前 key
        await KeyPoolManager.getInstance().disableKey(
          key,
          "余额耗尽: " + (errorData.details?.detail || "Payment Required")
        );
        
        try {
          // 尝试使用新 key 重试请求
          console.log(`API Key ${key.substring(0, 8)}... 余额耗尽，尝试使用新 key 重试请求...`);
          const newApiKey = await KeyPoolManager.getInstance().retryWithFreshKey(key);
          
          // 递归调用，使用新 key 重试
          apiKey = newApiKey; // 更新全局 apiKey 变量
          return sendRequest(newApiKey, retryAttempt + 1);
          
        } catch (retryError) {
          // 如果无法获取新 key，抛出错误
          throw new Error(retryError instanceof Error ?
            retryError.message :
            "所有可用 API key 都无法完成请求，请稍后再试");
        }
      }
      
      // 其他类型的错误，返回原始错误响应
      return resp;
    };
    
    // 发送请求并处理可能的重试
    let response: Response;
    try {
      response = await sendRequest(apiKey);
    } catch (sendError) {
      // 处理所有重试失败的情况
      logError({
        requestId,
        timestamp: new Date().toISOString(),
        type: "AllRetriesFailedError",
        message: sendError instanceof Error ? sendError.message : "所有重试请求均失败",
        details: sendError,
      });
      
      return c.json({
        error: sendError instanceof Error ? sendError.message : "所有可用 API key 都无法完成请求，请稍后再试"
      }, 503);
    }

    // 处理非 key 余额耗尽但仍然失败的错误
    if (!response.ok) {
      const error = await response.json();
      logError({
        requestId,
        timestamp: new Date().toISOString(),
        type: "UpstreamError",
        message: "Upstream API error",
        details: error,
        status: response.status,
      });

      // Transform error based on configuration
      const { body: transformedError, status: transformedStatus } =
        transformError(error, response.status, defaultTransformConfig);

      return new Response(JSON.stringify(transformedError), {
        status: transformedStatus,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (isStream) {
      // Handle streaming response
      const readable = response.body;
      if (!readable) {
        logError({
          requestId,
          timestamp: new Date().toISOString(),
          type: "StreamError",
          message: "No response stream available",
        });
        return c.text("No response stream available", 500);
      }

      // Create a TransformStream to count chunks and track timing
      let chunkCount = 0;
      let firstChunkTime: number | null = null;
      let totalTokens = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      // 检查是否为特殊思考模式的模型（从开始就是思考内容直到</think>）
      const isSpecialThinkingModel = (modelName: string): boolean => {
        return modelName.includes("Qwen/QwQ-32B") || modelName.includes("Qwen/QwQ-32B-fast");
      };
      
      // 根据模型类型设置初始状态
      const isSpecialModel = isSpecialThinkingModel(body.model);
      let isProcessingReasoning = isSpecialModel; // 特殊模型从一开始就是思考过程
      let buffer = '';

      const transformStream = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
          chunkCount++;
          if (firstChunkTime === null) {
            firstChunkTime = Date.now();
          }

          // Add new chunk to buffer
          const text = new TextDecoder().decode(chunk);
          buffer += text;

          // Process complete messages
          const messages = buffer.split('\n\n');
          // Keep the last (potentially incomplete) chunk in buffer
          buffer = messages.pop() || '';

          for (const message of messages) {
            const trimmedMessage = message.trim();
            if (!trimmedMessage) continue;

            if (trimmedMessage === 'data: [DONE]') {
              controller.enqueue(new TextEncoder().encode(message + '\n\n'));
              continue;
            }

            if (trimmedMessage.startsWith('data: ')) {
              try {
                const data = JSON.parse(trimmedMessage.slice(6)) as ChatCompletionChunk;
                
                // Track usage if available
                if (data.usage) {
                  totalTokens = data.usage.total_tokens ?? 0;
                  promptTokens = data.usage.prompt_tokens ?? 0;
                  completionTokens = data.usage.completion_tokens ?? 0;
                }

                // Transform the chunk if it contains choices
                if (data.choices && data.choices.length > 0) {
                  const choice = data.choices[0];
                  
                  /**
                   * 检查是否为使用特殊思考模式的模型（从开始就是思考内容直到</think>）
                   * @param modelName 模型名称
                   * @returns 是否为特殊处理模型
                   */
                  const isSpecialThinkingModel = (modelName: string): boolean => {
                    return modelName.includes("Qwen/QwQ-32B") || modelName.includes("Qwen/QwQ-32B-fast");
                  };
                  
                  // 检查当前模型是否是特殊处理模型
                  const isSpecialModel = isSpecialThinkingModel(data.model || body.model);
                  
                  // 处理<think>标签，将内容移至reasoning_content
                  if (choice.delta.content !== undefined) {
                    const content = choice.delta.content;
                    
                    // 检测</think>结束标签 (对所有模型通用)
                    if (content.includes('</think>')) {
                      isProcessingReasoning = false;
                      // 分离</think>标签和实际内容
                      const parts = content.split('</think>');
                      const thinkContent = parts[0] || '';
                      const afterThink = parts[1] || '';
                      
                      // 将</think>前的内容放入reasoning_content
                      if (thinkContent.trim()) {
                        choice.delta.reasoning_content = thinkContent;
                      }
                      
                      // 保留标签后的内容
                      if (afterThink.trim()) {
                        choice.delta.content = afterThink;
                      } else {
                        delete choice.delta.content;
                      }
                    }
                    // 检测<think>开始标签 (只对非特殊模型有效)
                    else if (!isSpecialModel && content.includes('<think>')) {
                      isProcessingReasoning = true;
                      // 分离<think>标签和实际内容
                      const parts = content.split('<think>');
                      const beforeThink = parts[0] || '';
                      const thinkContent = parts[1] || '';
                      
                      // 保留标签外的内容
                      if (beforeThink.trim()) {
                        choice.delta.content = beforeThink;
                      } else {
                        delete choice.delta.content;
                      }
                      
                      // 将<think>内的内容放入reasoning_content
                      if (thinkContent.trim()) {
                        choice.delta.reasoning_content = thinkContent;
                      }
                    }
                    // 在<think>和</think>标签之间的内容或特殊模型的初始内容
                    else if (isProcessingReasoning) {
                      choice.delta.reasoning_content = content;
                      delete choice.delta.content;
                    }
                  }
                }

                // Encode and send the transformed chunk
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
              } catch (e) {
                console.error('Error processing message:', e);
                // If we can't parse the JSON, forward the original message
                controller.enqueue(new TextEncoder().encode(message + '\n\n'));
              }
            } else {
              // Forward non-data messages as-is
              controller.enqueue(new TextEncoder().encode(message + '\n\n'));
            }
          }
        },
        flush(controller: TransformStreamDefaultController<Uint8Array>) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            controller.enqueue(new TextEncoder().encode(buffer));
          }

          // Update key usage statistics
          void KeyPoolManager.getInstance().updateKeyStats(apiKey, {
            totalTokens,
            promptTokens,
            completionTokens
          });

          // Log final streaming stats
          void logResponse({
            requestId,
            timestamp: new Date().toISOString(),
            status: response.status,
            duration: Date.now() - startTime,
            isStream: true,
            chunkCount,
            ttfb: firstChunkTime ? firstChunkTime - startTime : undefined,
            totalStreamDuration: Date.now() - startTime,
            usage: totalTokens > 0 ? {
              completionTokens,
              promptTokens,
              totalTokens
            } : undefined
          });
        }
      });

      // Log initial streaming response
      logResponse({
        requestId,
        timestamp: new Date().toISOString(),
        status: response.status,
        duration: Date.now() - startTime,
        isStream: true,
      });

      // Forward all response headers for streaming
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Content-Type", "text/event-stream");
      responseHeaders.set("Cache-Control", "no-cache");
      responseHeaders.set("Connection", "keep-alive");

      // Pipe through transform stream to track chunks
      const transformedStream = readable.pipeThrough(transformStream);
      return new Response(transformedStream, {
        headers: responseHeaders
      });
    } else {
      // Handle regular response
      const data = await response.json() as ChatCompletionResponse;
      
      // Transform response to handle reasoning_content
      if (data.choices && Array.isArray(data.choices)) {
        // 检查是否为特殊思考模式的模型
        const isSpecialThinkingModel = (modelName: string): boolean => {
          return modelName.includes("Qwen/QwQ-32B") || modelName.includes("Qwen/QwQ-32B-fast");
        };
        
        // 检查当前模型是否是特殊处理模型
        const isSpecialModel = isSpecialThinkingModel(body.model);
        
        data.choices = data.choices.map((choice: ChatCompletionChoice) => {
          // 处理消息内容
          if (choice.message && choice.message.content) {
            const content = choice.message.content;
            
            // 对特殊模型（Qwen/QwQ-32B系列）的处理
            if (isSpecialModel) {
              const endThinkMatch = content.match(/<\/think>/);
              
              if (endThinkMatch) {
                // 有</think>结束标签的情况
                const parts = content.split('</think>');
                const thinkContent = parts[0].trim(); // </think>前的内容作为思考
                const afterThink = parts[1] || ''; // </think>后的内容作为正常输出
                
                choice.message = {
                  ...choice.message,
                  content: afterThink.trim(),
                  reasoning_content: thinkContent
                };
              } else {
                // 没有</think>标签时，全部视为思考内容
                choice.message = {
                  ...choice.message,
                  content: '',
                  reasoning_content: content.trim()
                };
              }
            } else {
              // 常规模型的处理（deepseek等）- 使用完整<think></think>标签对
              const thinkRegex = /<think>([\s\S]*?)<\/think>/;
              const match = content.match(thinkRegex);
              
              if (match) {
                // 提取<think>标签内的内容到reasoning_content
                const thinkContent = match[1].trim();
                // 移除<think>标签和其内容，保留其余部分
                const newContent = content.replace(thinkRegex, '').trim();
                
                choice.message = {
                  ...choice.message,
                  content: newContent,
                  reasoning_content: thinkContent
                };
              }
            }
          }
          return choice;
        });
      }

      const responseSize = JSON.stringify(data).length;

      // Update key usage statistics
      if (data.usage) {
        data.usage.totalTokens = data.usage.total_tokens ?? 0;
        data.usage.promptTokens = data.usage.prompt_tokens ?? 0;
        data.usage.completionTokens = data.usage.completion_tokens ?? 0;
        await KeyPoolManager.getInstance().updateKeyStats(apiKey, data.usage);
      }

      // Log regular response with usage information
      logResponse({
        requestId,
        timestamp: new Date().toISOString(),
        status: response.status,
        duration: Date.now() - startTime,
        isStream: false,
        dataSize: responseSize,
        usage: data.usage
      });

      return Response.json(data);
    }
  } catch (error) {
    // Log detailed error information
    logError({
      requestId,
      timestamp: new Date().toISOString(),
      type: error instanceof Error ? error.constructor.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown error occurred",
      stack: error instanceof Error ? error.stack : undefined,
      details: error,
    });

    console.error("Error:", error);
    if (error instanceof Error) {
      return c.text(`Internal server error: ${error.message}`, 500);
    }
    return c.text("Internal server error", 500);
  }
});

export default router;
