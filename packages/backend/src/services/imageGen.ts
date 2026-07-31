import { createChildLogger } from '../utils/logger.js';
import { getErrorMessage } from '@ai-rpg/shared/utils/error';
import type { Knex } from 'knex';
import { config } from '../utils/config.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * ⚠️ 死代码警告：ImageGenService 当前无任何模块 import 调用。
 *
 * 历史遗留：原注释撒谎 "in production would call image generation API"，但 production 路径从未实现。
 * 已清理撒谎注释，但 mock 实现仍未替换。等真正需要图像生成时，走 design-first 流程从零设计。
 *
 * 已知问题：
 * - createPlaceholderImage 通过 fs.copyFileSync 把 SVG 内容复制到 .png 路径，产出扩展名为 .png 但内容是 SVG 的非法文件
 * - 构造函数 _db: Knex 参数从未使用（保留前缀 _ 标注）
 */

export interface ImageGenOptions {
  width?: number;
  height?: number;
  style?: string;
  quality?: string;
}

export interface ImageResult {
  url: string;
  localPath: string;
}

export class ImageGenService {
  private logger: ReturnType<typeof createChildLogger>;
  private imagesDir: string;

  constructor(_db: Knex) {
    this.logger = createChildLogger('image-gen');
    this.imagesDir = config.gameData.images;

    // Ensure images directory exists
    if (!fs.existsSync(this.imagesDir)) {
      fs.mkdirSync(this.imagesDir, { recursive: true });
    }
  }

  async generateImage(
    prompt: string,
    options: ImageGenOptions = {}
  ): Promise<ImageResult> {
    try {
      const imageId = randomUUID();
      const filename = `${imageId}.png`;
      const localPath = path.join(this.imagesDir, filename);
      const url = `/images/${filename}`;

      this.logger.info('Generating image', {
        prompt: prompt.substring(0, 100),
        options,
        imageId,
      });

      // mock 占位实现——写入 SVG 占位符，未接入真实图像生成 API
      // 本服务目前无任何消费方调用（死代码），等真正需要时走 design-first 流程
      await this.createPlaceholderImage(localPath, prompt);

      this.logger.info('Image generated successfully', {
        imageId,
        localPath,
        url,
      });

      return { url, localPath };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to generate image', {
        prompt: prompt.substring(0, 100),
        error: errorMessage,
      });
      throw error;
    }
  }

  async generatePortrait(characterData: unknown, templateConfig?: { default_race?: string; default_class?: string }): Promise<string> {
    try {
      const data = characterData as Record<string, unknown>;
      const characterName = data.name || 'Unknown Character';
      const characterClass = data.class || templateConfig?.default_class || 'Adventurer';
      const characterRace = data.race || templateConfig?.default_race || 'Human';

      const prompt = `Portrait of ${characterRace} ${characterClass} named ${characterName}, fantasy RPG style, detailed face, high quality`;

      this.logger.info('Generating character portrait', {
        characterName,
        characterClass,
        characterRace,
      });

      const result = await this.generateImage(prompt, {
        width: 512,
        height: 512,
        style: 'portrait',
        quality: 'high',
      });

      return result.url;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to generate portrait', {
        characterData,
        error: errorMessage,
      });
      throw error;
    }
  }

  async generateScene(sceneDescription: string): Promise<string> {
    try {
      const prompt = `RPG game scene: ${sceneDescription}, detailed environment, atmospheric lighting, fantasy art style, wide angle view`;

      this.logger.info('Generating scene image', {
        sceneDescription: sceneDescription.substring(0, 100),
      });

      const result = await this.generateImage(prompt, {
        width: 1024,
        height: 576,
        style: 'landscape',
        quality: 'high',
      });

      return result.url;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      this.logger.error('Failed to generate scene', {
        sceneDescription: sceneDescription.substring(0, 100),
        error: errorMessage,
      });
      throw error;
    }
  }

  private async createPlaceholderImage(
    filePath: string,
    _prompt: string
  ): Promise<void> {
    // Create a simple placeholder SVG file
    const svgContent = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1a1a2e"/>
  <rect x="10" y="10" width="492" height="492" fill="#16213e" rx="20"/>
  <text x="256" y="240" font-family="Arial, sans-serif" font-size="24" fill="#e94560" text-anchor="middle">
    AI-generated Games
  </text>
  <text x="256" y="280" font-family="Arial, sans-serif" font-size="16" fill="#0f3460" text-anchor="middle">
    Image Generation Placeholder
  </text>
</svg>`;

    // 写入 SVG 文件作为占位符（未接入真实 PNG/JPEG 生成）
    fs.writeFileSync(filePath.replace('.png', '.svg'), svgContent.trim());

    // 把 SVG 内容复制到 .png 路径——产出扩展名为 .png 但内容是 SVG 的非法文件（已知问题，待真实实现时修复）
    if (!fs.existsSync(filePath)) {
      fs.copyFileSync(filePath.replace('.png', '.svg'), filePath);
    }
  }
}
