import { createHash } from 'crypto';

export interface StablePrefixComposeInput {
  tools?: unknown;
  system?: string;
  stableRules?: unknown;
  stableMemorySummary?: unknown;
  dynamicPayload?: unknown;
}

export interface StablePrefixComposeResult {
  stablePrefix: string;
  fullPrompt: string;
  prefixHash: string;
  stablePrefixLength: number;
  cacheStrategy: 'stable-prefix-v1';
}

type StableSectionKey =
  | 'tools'
  | 'system'
  | 'stableRules'
  | 'stableMemorySummary'
  | 'dynamicPayload';

const SECTION_LABELS: Record<StableSectionKey, string> = {
  tools: 'TOOLS',
  system: 'SYSTEM',
  stableRules: 'STABLE_RULES',
  stableMemorySummary: 'STABLE_MEMORY_SUMMARY',
  dynamicPayload: 'DYNAMIC_PAYLOAD',
};

export class StablePrefixComposer {
  compose(input: StablePrefixComposeInput): StablePrefixComposeResult {
    const stableSections = this.buildStableSections(input);
    const dynamicSection = this.buildSection('dynamicPayload', input.dynamicPayload);

    const stablePrefix = stableSections.join('\n\n').trim();
    const fullPrompt = [stablePrefix, dynamicSection].filter(Boolean).join('\n\n').trim();

    return {
      stablePrefix,
      fullPrompt,
      prefixHash: createHash('sha256').update(stablePrefix).digest('hex'),
      stablePrefixLength: stablePrefix.length,
      cacheStrategy: 'stable-prefix-v1',
    };
  }

  private buildStableSections(input: StablePrefixComposeInput): string[] {
    const orderedKeys: StableSectionKey[] = [
      'tools',
      'system',
      'stableRules',
      'stableMemorySummary',
    ];

    return orderedKeys
      .map((key) => this.buildSection(key, input[key]))
      .filter((section): section is string => Boolean(section));
  }

  private buildSection(key: StableSectionKey, value: unknown): string | null {
    if (value === undefined || value === null) {
      return null;
    }

    const normalizedContent = this.stringifySectionValue(key, value);
    if (!normalizedContent.trim()) {
      return null;
    }

    return `## ${SECTION_LABELS[key]}\n${normalizedContent}`;
  }

  private stringifySectionValue(key: StableSectionKey, value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }

    const normalized = this.normalizeValue(key, value);
    return JSON.stringify(normalized, null, 2);
  }

  private normalizeValue(key: StableSectionKey, value: unknown): unknown {
    if (Array.isArray(value)) {
      const normalizedItems = value.map((item) => this.normalizeValue(key, item));

      if (key === 'tools') {
        return normalizedItems.sort((left, right) => {
          const leftName = this.extractSortableName(left);
          const rightName = this.extractSortableName(right);
          return leftName.localeCompare(rightName);
        });
      }

      return normalizedItems;
    }

    if (value && typeof value === 'object') {
      const objectValue = value as Record<string, unknown>;
      return Object.keys(objectValue)
        .sort((left, right) => left.localeCompare(right))
        .reduce<Record<string, unknown>>((acc, currentKey) => {
          acc[currentKey] = this.normalizeValue(key, objectValue[currentKey]);
          return acc;
        }, {});
    }

    return value;
  }

  private extractSortableName(value: unknown): string {
    if (!value || typeof value !== 'object') {
      return '';
    }

    const name = (value as Record<string, unknown>).name;
    return typeof name === 'string' ? name : '';
  }
}
