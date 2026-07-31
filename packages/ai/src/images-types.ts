/**
 * 图像生成类型契约（M2-5，接口先行 §15-D2）
 *
 * 独立类型族，与文本 LLM 类型（LLMClient/Model）解耦：图像 API 的调用签名
 * （generateImages(model, context, options): Promise<AssistantImages>）与文本
 * （chat/stream/countTokens）完全不同。
 *
 * 消费者现状：无现实消费者（ImageGenService 死代码自标等 design-first 重设计），
 * 本类型族为该未来设计预留的 H 层接缝。图像二进制落盘是 E 层职责，H 层仅返回 data/url。
 *
 * 设计文档: docs/design/solution-design-20260726-pi-reference-upgrade/模块M2 §6.6
 */

/** 图像模型（独立类型族，与文本 Model 解耦） */
export interface ImagesModel {
  id: string;
  provider: string;
  /** 图像 API 标识（注册中心查找键），如 'openrouter-images' */
  api: string;
  name?: string;
  /** 支持的输出尺寸（可选声明） */
  sizes?: string[];
}

/** 图像生成上下文 */
export interface ImagesContext {
  prompt: string;
  /** 负向提示词（可选） */
  negativePrompt?: string;
}

/** 图像生成选项 */
export interface ImagesOptions {
  /** 输出尺寸，如 '1024x1024' */
  size?: string;
  /** 张数，默认 1（由 Provider 解释） */
  n?: number;
  quality?: string;
  style?: string;
  signal?: AbortSignal;
}

/** 单张生成结果：data/url 二必有其一（两者皆无视为 Provider 契约违反） */
export interface GeneratedImage {
  /** base64 数据（无 url 时必有 data） */
  data?: string;
  /** 远程 url（无 data 时必有 url） */
  url?: string;
  mimeType?: string;
}

/** 生成结果聚合 */
export interface AssistantImages {
  images: GeneratedImage[];
  usage?: { totalImages: number };
}

/** 图像 Provider 接口 */
export interface ImagesApiProvider {
  readonly api: string;
  generateImages(
    model: ImagesModel,
    context: ImagesContext,
    options?: ImagesOptions,
  ): Promise<AssistantImages>;
}
