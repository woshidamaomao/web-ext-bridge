// 定义消息类型常量
export const DEFAULT_MESSAGE_TYPE = "web-bridge";
export const HANDSHAKE_ACTION = "__handshake__";

// 基础消息接口
export interface BaseMessage {
  type: string;
  communicationId: string;
  id: string;
  timestamp: number;
}

// 请求消息接口
export interface RequestMessage extends BaseMessage {
  action: string;
  data?: any;
  needResponse?: boolean;
}

// 响应消息接口  
export interface ResponseMessage extends BaseMessage {
  requestId: string;
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * 简化的 Web 通信桥接器
 */
export class WebBridge {
  private readonly communicationId: string;
  private readonly messageType: string;
  private readonly allowedIds: Set<string>;
  private messageHandlers = new Map<string, (data: any) => Promise<any> | any>();
  private pendingRequests = new Map<string, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }>();
  private isReady = false;
  private readyPromise?: Promise<void>;
  private handshakeRetryInterval?: number;
  private handshakeAttempts = 0;

  // 配置选项
  private readonly options = {
    requestTimeout: 30000,         // 请求超时
    handshakeTimeout: 500,         // 握手超时（实时消费，设置为500ms）
    handshakeRetryInterval: 1000,  // 握手重试间隔
    maxHandshakeAttempts: 10,      // 最大握手尝试次数
  };

  /**
   * 创建通信桥接器
   * @param communicationId 通信标识符（昵称/ID）
   * @param options 配置选项
   */
  constructor(
    communicationId: string,
    options: {
      allowedIds?: string[];           // 允许通信的 ID 白名单
      messageType?: string;
      requestTimeout?: number;
      handshakeTimeout?: number;       // 单次握手超时
      handshakeRetryInterval?: number; // 握手重试间隔
      maxHandshakeAttempts?: number;   // 最大握手尝试次数
    } = {}
  ) {
    this.communicationId = communicationId;
    this.messageType = options.messageType || DEFAULT_MESSAGE_TYPE;
    this.allowedIds = new Set(options.allowedIds || []);

    // 合并配置选项
    Object.assign(this.options, options);
    
    this.setupMessageListener();
    this.setupHandshakeHandler();
  }

  /**
   * 添加允许通信的 ID
   */
  addAllowedId(communicationId: string): void {
    this.allowedIds.add(communicationId);
  }

  /**
   * 移除允许通信的 ID
   */
  removeAllowedId(communicationId: string): void {
    this.allowedIds.delete(communicationId);
  }

  /**
   * 检查是否允许与指定 ID 通信
   */
  isAllowedId(communicationId: string): boolean {
    return this.allowedIds.size === 0 || this.allowedIds.has(communicationId);
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 确保已建联 - 带重试机制
   */
  private async ensureReady(): Promise<void> {
    if (this.isReady) {
      return;
    }

    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = this.performHandshakeWithRetry();
    try {
      await this.readyPromise;
    } finally {
      this.readyPromise = undefined;
    }
  }

  /**
   * 执行握手（带重试机制）
   */
  private async performHandshakeWithRetry(): Promise<void> {
    return new Promise((resolve, reject) => {
      const attemptHandshake = async () => {
        try {
          // 发送握手请求
          await this.sendSingleHandshakeRequest();
          
          // 握手成功
          this.isReady = true;
          this.stopHandshakeRetry();
          resolve();
          
        } catch (error) {
          this.handshakeAttempts++;
          
          if (this.handshakeAttempts >= this.options.maxHandshakeAttempts) {
            this.stopHandshakeRetry();
            reject(new Error(`建联失败: ${error}`));
            return;
          }

          // 继续重试
          this.handshakeRetryInterval = setTimeout(attemptHandshake, this.options.handshakeRetryInterval) as unknown as number;
        }
      };

      // 立即开始第一次尝试
      attemptHandshake();
    });
  }

  /**
   * 发送单次握手请求
   */
  private async sendSingleHandshakeRequest(): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.generateId();
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('握手超时'));
      }, this.options.handshakeTimeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const message: RequestMessage = {
        type: this.messageType,
        communicationId: this.communicationId,
        id,
        action: HANDSHAKE_ACTION,
        data: { timestamp: Date.now() },
        needResponse: true,
        timestamp: Date.now(),
      };

      globalThis.postMessage(message, "*");
    });
  }

  /**
   * 停止握手重试
   */
  private stopHandshakeRetry(): void {
    if (this.handshakeRetryInterval) {
      clearTimeout(this.handshakeRetryInterval);
      this.handshakeRetryInterval = undefined;
    }
  }

  /**
   * 发送消息（仅发送，不等待回复）
   */
  send(action: string, data?: any): void {
    const message: RequestMessage = {
      type: this.messageType,
      communicationId: this.communicationId,
      id: this.generateId(),
      action,
      data,
      needResponse: false,
      timestamp: Date.now(),
    };

    globalThis.postMessage(message, "*");
  }

  /**
   * 调用远程方法并等待响应
   */
  async invoke<T = any>(action: string, data?: any): Promise<T> {
    await this.ensureReady();
    return this.invokeRequest<T>(action, data);
  }

  /**
   * 发送请求并等待响应（内部方法）
   */
  private async invokeRequest<T = any>(action: string, data?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.generateId();
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`请求超时: ${action}`));
      }, this.options.requestTimeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const message: RequestMessage = {
        type: this.messageType,
        communicationId: this.communicationId,
        id,
        action,
        data,
        needResponse: true,
        timestamp: Date.now(),
      };

      globalThis.postMessage(message, "*");
    });
  }

  /**
   * 注册消息处理器
   */
  handle(action: string, handler: (data: any) => Promise<any> | any): () => void {
    this.messageHandlers.set(action, handler);
    
    return () => {
      this.messageHandlers.delete(action);
    };
  }

  /**
   * 检查是否已准备就绪
   */
  getReady(): boolean {
    return this.isReady;
  }

  /**
   * 销毁实例
   */
  destroy(): void {
    this.stopHandshakeRetry();
    this.messageHandlers.clear();
    this.clearPendingRequests();
    globalThis.removeEventListener("message", this.handleMessage);
  }

  // ===== 私有方法 =====

  /**
   * 设置消息监听器
   */
  private setupMessageListener(): void {
    this.handleMessage = this.handleMessage.bind(this);
    globalThis.addEventListener("message", this.handleMessage);
  }

  /**
   * 消息处理器
   */
  private handleMessage = (event: MessageEvent): void => {
    const message = event.data;
    if (!message || typeof message !== "object" || message.type !== this.messageType) {
      return;
    }

    // 检查通信 ID 是否在白名单中
    if (!this.isAllowedId(message.communicationId)) {
      return;
    }

    // 处理请求消息
    if (message.action) {
      this.handleRequestMessage(message as RequestMessage);
    }
    
    // 处理响应消息
    if (message.requestId) {
      this.handleResponseMessage(message as ResponseMessage);
    }
  };

  /**
   * 处理请求消息
   */
  private async handleRequestMessage(message: RequestMessage): Promise<void> {
    const { action, data, needResponse, id } = message;

    try {
      const handler = this.messageHandlers.get(action);
      if (!handler) {
        if (needResponse) {
          this.sendResponse(id, false, undefined, `未找到处理器: ${action}`);
        }
        return;
      }

      let result = handler(data);
      if (result && typeof result.then === 'function') {
        result = await result;
      }

      if (needResponse) {
        this.sendResponse(id, true, result);
      }
    } catch (error) {
      console.error(`处理消息错误 [${action}]:`, error);
      if (needResponse) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.sendResponse(id, false, undefined, errorMessage);
      }
    }
  }

  /**
   * 处理响应消息
   */
  private handleResponseMessage(message: ResponseMessage): void {
    const { requestId, success, data, error } = message;
    const pending = this.pendingRequests.get(requestId);
    
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      
      if (success) {
        pending.resolve(data);
      } else {
        pending.reject(new Error(error || '未知错误'));
      }
    }
  }

  /**
   * 发送响应
   */
  private sendResponse(requestId: string, success: boolean, data?: any, error?: string): void {
    const response: ResponseMessage = {
      type: this.messageType,
      communicationId: this.communicationId,
      id: this.generateId(),
      requestId,
      success,
      data,
      error,
      timestamp: Date.now(),
    };

    globalThis.postMessage(response, "*");
  }

  /**
   * 设置握手处理器
   */
  private setupHandshakeHandler(): void {
    // 处理握手请求
    this.handle(HANDSHAKE_ACTION, (data) => {
      return { success: true, timestamp: Date.now() };
    });
  }

  /**
   * 清除待处理的请求
   */
  private clearPendingRequests(): void {
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('连接已断开'));
    });
    this.pendingRequests.clear();
  }
}

// ===== 工厂函数 =====

/**
 * 创建通信桥接器
 * @param communicationId 通信标识符（昵称/ID）
 * @param options 配置选项
 * @returns 桥接器实例
 */
export function createBridge(
  communicationId: string,
  options: {
    allowedIds?: string[];           // 允许通信的 ID 白名单
    messageType?: string;
    requestTimeout?: number;
    handshakeTimeout?: number;       // 单次握手超时
    handshakeRetryInterval?: number; // 握手重试间隔  
    maxHandshakeAttempts?: number;   // 最大握手尝试次数
  } = {}
): WebBridge {
  return new WebBridge(communicationId, options);
}