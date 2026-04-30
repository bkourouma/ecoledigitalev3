import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { getFileCategory, SUPPORTED_FILE_TYPES } from '@ecoledigitale/contracts';

export interface TextExtractionResult {
  text: string;
  metadata?: {
    pageCount?: number;
    wordCount?: number;
    characterCount?: number;
    language?: string;
  };
}

export interface TextExtractionError {
  code: string;
  message: string;
  originalError?: Error;
}

export class TextExtractionService {
  /**
   * Extract text from a file buffer based on its MIME type
   */
  async extractText(
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string
  ): Promise<TextExtractionResult> {
    try {
      switch (mimeType) {
        case SUPPORTED_FILE_TYPES.PDF:
          return await this.extractFromPDF(fileBuffer);
        
        case SUPPORTED_FILE_TYPES.POWERPOINT:
        case SUPPORTED_FILE_TYPES.POWERPOINT_LEGACY:
          return await this.extractFromPowerPoint(fileBuffer);
        
        default:
          throw new Error(`Unsupported file type for text extraction: ${mimeType}`);
      }
    } catch (error) {
      throw this.createExtractionError(error, mimeType, fileName);
    }
  }

  /**
   * Extract text from PDF files
   */
  private async extractFromPDF(fileBuffer: Buffer): Promise<TextExtractionResult> {
    try {
      const data = await pdfParse(fileBuffer);

      const text = data.text.trim();
      
      if (!text) {
        throw new Error('No text content found in PDF');
      }

      return {
        text,
        metadata: {
          pageCount: data.numpages,
          wordCount: this.countWords(text),
          characterCount: text.length,
        },
      };
    } catch (error) {
      throw new Error(`PDF text extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract text from PowerPoint files (.pptx)
   */
  private async extractFromPowerPoint(fileBuffer: Buffer): Promise<TextExtractionResult> {
    try {
      // For .pptx files, we can use mammoth (though it's primarily for Word docs)
      // For better PowerPoint support, we might need a different library
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      
      let text = result.value.trim();
      
      // If mammoth doesn't work well with PowerPoint, try alternative approach
      if (!text || text.length < 10) {
        // Fallback: try to extract as zip and parse XML
        text = await this.extractFromPowerPointZip(fileBuffer);
      }

      if (!text) {
        throw new Error('No text content found in PowerPoint file');
      }

      return {
        text,
        metadata: {
          wordCount: this.countWords(text),
          characterCount: text.length,
        },
      };
    } catch (error) {
      throw new Error(`PowerPoint text extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Alternative PowerPoint extraction using ZIP parsing
   * PowerPoint files are essentially ZIP archives with XML content
   */
  private async extractFromPowerPointZip(fileBuffer: Buffer): Promise<string> {
    try {
      // This is a simplified approach - in production, you might want to use
      // a dedicated PowerPoint parsing library like 'officegen' or 'node-pptx'
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(fileBuffer);
      
      let extractedText = '';
      
      // Look for slide content in the ZIP structure
      const slideFiles = Object.keys(zip.files).filter(name => 
        name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
      );
      
      for (const slideFile of slideFiles) {
        const content = await zip.files[slideFile].async('text');
        // Extract text from XML (basic regex approach)
        const textMatches = content.match(/<a:t[^>]*>([^<]+)<\/a:t>/g);
        if (textMatches) {
          const slideText = textMatches
            .map((match: string) => match.replace(/<[^>]+>/g, ''))
            .join(' ');
          extractedText += slideText + '\n';
        }
      }
      
      return extractedText.trim();
    } catch (error) {
      // If ZIP parsing fails, return empty string to trigger error in parent function
      return '';
    }
  }

  /**
   * Check if a file type supports text extraction
   */
  canExtractText(mimeType: string): boolean {
    return [
      SUPPORTED_FILE_TYPES.PDF,
      SUPPORTED_FILE_TYPES.POWERPOINT,
      SUPPORTED_FILE_TYPES.POWERPOINT_LEGACY,
    ].includes(mimeType as any);
  }

  /**
   * Get estimated processing time for a file
   */
  getEstimatedProcessingTime(fileSize: number, mimeType: string): number {
    // Base time in seconds
    let baseTime = 5;
    
    // Adjust based on file type
    switch (mimeType) {
      case SUPPORTED_FILE_TYPES.PDF:
        baseTime = 3;
        break;
      case SUPPORTED_FILE_TYPES.POWERPOINT:
      case SUPPORTED_FILE_TYPES.POWERPOINT_LEGACY:
        baseTime = 8;
        break;
    }
    
    // Add time based on file size (rough estimate: 1 second per MB)
    const sizeInMB = fileSize / (1024 * 1024);
    const sizeTime = Math.ceil(sizeInMB * 1);
    
    return baseTime + sizeTime;
  }

  /**
   * Validate extracted text quality
   */
  validateExtractedText(text: string): {
    isValid: boolean;
    issues: string[];
    confidence: number;
  } {
    const issues: string[] = [];
    let confidence = 1.0;

    // Check minimum length
    if (text.length < 10) {
      issues.push('Text too short');
      confidence -= 0.5;
    }

    // Check for reasonable word count
    const wordCount = this.countWords(text);
    if (wordCount < 5) {
      issues.push('Too few words extracted');
      confidence -= 0.3;
    }

    // Check for excessive special characters (might indicate extraction errors)
    const specialCharRatio = (text.match(/[^\w\s]/g) || []).length / text.length;
    if (specialCharRatio > 0.3) {
      issues.push('High ratio of special characters');
      confidence -= 0.2;
    }

    // Check for repeated patterns (might indicate extraction errors)
    const repeatedPatterns = text.match(/(.{10,})\1{2,}/g);
    if (repeatedPatterns && repeatedPatterns.length > 0) {
      issues.push('Repeated text patterns detected');
      confidence -= 0.2;
    }

    return {
      isValid: issues.length === 0 || confidence > 0.5,
      issues,
      confidence: Math.max(0, confidence),
    };
  }

  /**
   * Clean and normalize extracted text
   */
  cleanText(text: string): string {
    return text
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove excessive line breaks
      .replace(/\n{3,}/g, '\n\n')
      // Remove control characters
      .replace(/[\x00-\x1F\x7F]/g, '')
      // Trim
      .trim();
  }

  /**
   * Count words in text
   */
  private countWords(text: string): number {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Create standardized extraction error
   */
  private createExtractionError(
    error: unknown,
    mimeType: string,
    fileName: string
  ): TextExtractionError {
    const message = error instanceof Error ? error.message : 'Unknown extraction error';
    
    return {
      code: 'TEXT_EXTRACTION_FAILED',
      message: `Failed to extract text from ${fileName} (${mimeType}): ${message}`,
      originalError: error instanceof Error ? error : undefined,
    };
  }
}

// Create singleton instance
let textExtractionService: TextExtractionService | null = null;

export function getTextExtractionService(): TextExtractionService {
  if (!textExtractionService) {
    textExtractionService = new TextExtractionService();
  }
  return textExtractionService;
}
