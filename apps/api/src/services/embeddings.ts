import OpenAI from 'openai';

export interface EmbeddingResult {
  embedding: number[];
  tokenCount: number;
  model: string;
}

export interface EmbeddingError {
  code: string;
  message: string;
  originalError?: Error;
}

export class EmbeddingsService {
  private openai: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.openai = new OpenAI({ apiKey });
    this.model = 'text-embedding-3-small'; // 1536 dimensions
    this.maxTokens = 8191; // Max tokens for text-embedding-3-small
  }

  /**
   * Generate embeddings for text content
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      // Clean and prepare text
      const cleanedText = this.prepareText(text);
      
      if (!cleanedText || cleanedText.trim().length === 0) {
        throw new Error('Text content is empty or invalid');
      }

      // Check if text is too long and chunk if necessary
      const chunks = this.chunkText(cleanedText);
      
      if (chunks.length === 1) {
        // Single chunk - generate embedding directly
        return await this.generateSingleEmbedding(chunks[0]);
      } else {
        // Multiple chunks - generate embeddings and average them
        return await this.generateAveragedEmbedding(chunks);
      }
    } catch (error) {
      throw this.createEmbeddingError(error, text);
    }
  }

  /**
   * Generate embedding for a single text chunk
   */
  private async generateSingleEmbedding(text: string): Promise<EmbeddingResult> {
    const response = await this.openai.embeddings.create({
      model: this.model,
      input: text,
      encoding_format: 'float',
    });

    const embedding = response.data[0].embedding;
    const tokenCount = response.usage.total_tokens;

    return {
      embedding,
      tokenCount,
      model: this.model,
    };
  }

  /**
   * Generate embeddings for multiple chunks and average them
   */
  private async generateAveragedEmbedding(chunks: string[]): Promise<EmbeddingResult> {
    const embeddings: number[][] = [];
    let totalTokens = 0;

    // Generate embeddings for each chunk
    for (const chunk of chunks) {
      const result = await this.generateSingleEmbedding(chunk);
      embeddings.push(result.embedding);
      totalTokens += result.tokenCount;
    }

    // Average the embeddings
    const dimensions = embeddings[0].length;
    const averagedEmbedding = new Array(dimensions).fill(0);

    for (let i = 0; i < dimensions; i++) {
      let sum = 0;
      for (const embedding of embeddings) {
        sum += embedding[i];
      }
      averagedEmbedding[i] = sum / embeddings.length;
    }

    return {
      embedding: averagedEmbedding,
      tokenCount: totalTokens,
      model: this.model,
    };
  }

  /**
   * Prepare text for embedding generation
   */
  private prepareText(text: string): string {
    return text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove control characters
      .replace(/[\x00-\x1F\x7F]/g, '')
      // Limit length to prevent token overflow
      .substring(0, 32000) // Conservative limit
      .trim();
  }

  /**
   * Split text into chunks that fit within token limits
   */
  private chunkText(text: string): string[] {
    // Rough estimation: 1 token ≈ 4 characters for English text
    const estimatedTokens = text.length / 4;
    
    if (estimatedTokens <= this.maxTokens * 0.9) { // 90% of max to be safe
      return [text];
    }

    const chunks: string[] = [];
    const maxChunkSize = Math.floor(this.maxTokens * 0.9 * 4); // Convert back to characters
    
    // Split by sentences first to maintain context
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    let currentChunk = '';
    
    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      
      if (currentChunk.length + trimmedSentence.length + 1 <= maxChunkSize) {
        currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
      } else {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = trimmedSentence;
        } else {
          // Single sentence is too long, split by words
          const words = trimmedSentence.split(' ');
          let wordChunk = '';
          
          for (const word of words) {
            if (wordChunk.length + word.length + 1 <= maxChunkSize) {
              wordChunk += (wordChunk ? ' ' : '') + word;
            } else {
              if (wordChunk) {
                chunks.push(wordChunk);
                wordChunk = word;
              } else {
                // Single word is too long, truncate it
                chunks.push(word.substring(0, maxChunkSize));
              }
            }
          }
          
          if (wordChunk) {
            currentChunk = wordChunk;
          }
        }
      }
    }
    
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    return chunks.filter(chunk => chunk.trim().length > 0);
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  calculateSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimensions');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      norm1 += embedding1[i] * embedding1[i];
      norm2 += embedding2[i] * embedding2[i];
    }

    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    
    if (magnitude === 0) {
      return 0;
    }

    return dotProduct / magnitude;
  }

  /**
   * Validate embedding dimensions
   */
  validateEmbedding(embedding: number[]): boolean {
    return Array.isArray(embedding) && 
           embedding.length === 1536 && // text-embedding-3-small dimensions
           embedding.every(val => typeof val === 'number' && !isNaN(val));
  }

  /**
   * Get embedding model information
   */
  getModelInfo(): {
    model: string;
    dimensions: number;
    maxTokens: number;
  } {
    return {
      model: this.model,
      dimensions: 1536,
      maxTokens: this.maxTokens,
    };
  }

  /**
   * Estimate cost for embedding generation
   */
  estimateCost(text: string): {
    estimatedTokens: number;
    estimatedCostUSD: number;
  } {
    const estimatedTokens = Math.ceil(text.length / 4);
    // OpenAI pricing for text-embedding-3-small: $0.00002 per 1K tokens
    const estimatedCostUSD = (estimatedTokens / 1000) * 0.00002;

    return {
      estimatedTokens,
      estimatedCostUSD,
    };
  }

  /**
   * Create standardized embedding error
   */
  private createEmbeddingError(error: unknown, text: string): EmbeddingError {
    const message = error instanceof Error ? error.message : 'Unknown embedding error';
    
    return {
      code: 'EMBEDDING_GENERATION_FAILED',
      message: `Failed to generate embedding for text (${text.length} chars): ${message}`,
      originalError: error instanceof Error ? error : undefined,
    };
  }
}

// Create singleton instance
let embeddingsService: EmbeddingsService | null = null;

export function getEmbeddingsService(): EmbeddingsService | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    // Return null if API key is not configured (service is optional)
    return null;
  }
  
  if (!embeddingsService) {
    try {
      embeddingsService = new EmbeddingsService();
    } catch (error) {
      console.warn('⚠️  EmbeddingsService not available:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }
  }
  return embeddingsService;
}
