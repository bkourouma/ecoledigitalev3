import OpenAI from 'openai';
import { 
  AIConfig, 
  GeneratedQuestion, 
  AIQuestionType, 
  DifficultyLevel,
  AIQuestionGenerationResponse 
} from '@ecoledigitale/contracts';

interface QuestionGenerationOptions {
  content: string;
  config: AIConfig;
  courseContext?: string;
  aiInstructions?: string;
}

interface RateLimitInfo {
  requestsPerHour: number;
  tokensPerHour: number;
  currentRequests: number;
  currentTokens: number;
}

export class AIEvaluationService {
  private openai: OpenAI;
  private rateLimits: Map<string, RateLimitInfo> = new Map();

  constructor() {
    // Use environment variable for API key
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    console.log('🔑 Using API key ending with:', apiKey.slice(-10));

    this.openai = new OpenAI({
      apiKey: apiKey,
    });
  }

  /**
   * Generate questions from extracted content using OpenAI
   */
  async generateQuestions(options: QuestionGenerationOptions): Promise<AIQuestionGenerationResponse> {
    const { content, config, courseContext, aiInstructions } = options;
    
    // Validate content length
    if (content.length < 100) {
      throw new Error('Content too short for question generation (minimum 100 characters)');
    }

    // Handle large content by intelligently truncating
    let processedContent = content;
    if (content.length > 50000) {
      console.log(`Content is ${content.length} characters, truncating to 50,000 characters`);

      // Try to truncate at a sentence boundary to maintain context
      const truncatedContent = content.substring(0, 50000);
      const lastSentenceEnd = Math.max(
        truncatedContent.lastIndexOf('.'),
        truncatedContent.lastIndexOf('!'),
        truncatedContent.lastIndexOf('?')
      );

      if (lastSentenceEnd > 40000) {
        // If we found a good sentence boundary, use it
        processedContent = content.substring(0, lastSentenceEnd + 1);
      } else {
        // Otherwise, just truncate at word boundary
        const lastSpaceIndex = truncatedContent.lastIndexOf(' ');
        processedContent = content.substring(0, lastSpaceIndex > 40000 ? lastSpaceIndex : 50000);
      }

      console.log(`Content truncated from ${content.length} to ${processedContent.length} characters`);
    }

    const startTime = Date.now();
    const questions: GeneratedQuestion[] = [];

    try {
      // Generate different types of questions
      if (config.mcq > 0) {
        const mcqQuestions = await this.generateQuestionsByType(processedContent, 'mcq', config.mcq, config.difficulty, courseContext, aiInstructions);
        questions.push(...mcqQuestions);
      }

      if (config.short_answer > 0) {
        const shortAnswerQuestions = await this.generateQuestionsByType(processedContent, 'short_answer', config.short_answer, config.difficulty, courseContext, aiInstructions);
        questions.push(...shortAnswerQuestions);
      }

      if (config.long_answer > 0) {
        const longAnswerQuestions = await this.generateQuestionsByType(processedContent, 'long_answer', config.long_answer, config.difficulty, courseContext, aiInstructions);
        questions.push(...longAnswerQuestions);
      }

      if (config.true_false > 0) {
        const trueFalseQuestions = await this.generateQuestionsByType(processedContent, 'true_false', config.true_false, config.difficulty, courseContext, aiInstructions);
        questions.push(...trueFalseQuestions);
      }

      const processingTime = Date.now() - startTime;
      const totalTokens = this.estimateTokenUsage(processedContent, questions.length);

      return {
        questions,
        metadata: {
          totalGenerated: questions.length,
          tokensUsed: totalTokens,
          processingTime,
          model: 'gpt-4',
        },
      };
    } catch (error) {
      throw new Error(`Question generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate questions of a specific type
   */
  private async generateQuestionsByType(
    content: string,
    type: AIQuestionType,
    count: number,
    difficulty: DifficultyLevel,
    courseContext?: string,
    aiInstructions?: string
  ): Promise<GeneratedQuestion[]> {
    const prompt = this.buildPrompt(content, type, count, difficulty, courseContext, aiInstructions);

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: 'Vous êtes un concepteur pédagogique expert spécialisé dans la génération de questions d’évaluation de haute qualité. Répondez toujours en français et uniquement au format JSON valide.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      });

      const responseContent = response.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error('No response from OpenAI');
      }

      const parsedResponse = JSON.parse(responseContent);
      return this.validateAndFormatQuestions(parsedResponse.questions, type, difficulty);
    } catch (error) {
      throw new Error(`Failed to generate ${type} questions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Build prompt for specific question type
   */
  private buildPrompt(
    content: string,
    type: AIQuestionType,
    count: number,
    difficulty: DifficultyLevel,
    courseContext?: string,
    aiInstructions?: string
  ): string {
    const baseContext = courseContext ? `Contexte du cours: ${courseContext}\n\n` : '';

    const typeInstructions = {
      mcq: `Génère ${count} questions à choix multiple avec exactement 4 propositions chacune. Indique clairement la bonne réponse.`,
      short_answer: `Génère ${count} questions à réponse courte (1 à 2 phrases).`,
      long_answer: `Génère ${count} questions à réponse développée nécessitant des explications détaillées.`,
      true_false: `Génère ${count} questions Vrai/Faux avec des énoncés clairs.`
    };

    const difficultyInstructions = {
      easy: 'Met l’accent sur la compréhension de base et le rappel des faits clés.',
      medium: 'Inclut l’application et l’analyse des concepts.',
      hard: 'Exige synthèse, évaluation et esprit critique.'
    };

    const userExtra = aiInstructions ? `\n\nInstructions supplémentaires (prioritaires):\n${aiInstructions}\n` : '';

    return `${baseContext}En te basant sur le contenu pédagogique ci‑dessous, ${typeInstructions[type]}

Niveau de difficulté: ${difficulty} - ${difficultyInstructions[difficulty]}${userExtra}

Exigences générales:
1. Rédige TOUT en français (énoncés, options, explications). Conserve les noms de code/identifiants si nécessaires.
2. Chaque question doit être directement liée au contenu fourni et tester la compréhension (pas seulement la mémorisation).
3. Pour QCM: fournis exactement 4 propositions avec une seule bonne réponse.
4. Ajoute une brève explication justifiant la bonne réponse.
5. Ajoute un court extrait du contenu à l’origine de la question.

Contenu:
${content}

Réponds avec un objet JSON dans ce format exact:
{
  "questions": [
    {
      "question_text": "Votre question ici",
      "options": ["Proposition A", "Proposition B", "Proposition C", "Proposition D"], // Uniquement pour QCM
      "correct_answer": "La bonne réponse",
      "explanation": "Brève explication de pourquoi c’est correct",
      "source_content": "Extrait pertinent du contenu"
    }
  ]
}`;
  }

  /**
   * Validate and format generated questions
   */
  private validateAndFormatQuestions(
    questions: any[],
    type: AIQuestionType,
    difficulty: DifficultyLevel
  ): GeneratedQuestion[] {
    if (!Array.isArray(questions)) {
      throw new Error('Invalid response format: questions must be an array');
    }

    return questions.map((q, index) => {
      if (!q.question_text || !q.correct_answer || !q.source_content) {
        throw new Error(`Invalid question format at index ${index}: missing required fields`);
      }

      if (type === 'mcq' && (!q.options || !Array.isArray(q.options) || q.options.length !== 4)) {
        throw new Error(`Invalid MCQ format at index ${index}: must have exactly 4 options`);
      }

      return {
        type,
        question_text: q.question_text,
        options: type === 'mcq' ? q.options : undefined,
        correct_answer: q.correct_answer,
        points: 1,
        difficulty_level: difficulty,
        source_content: q.source_content,
        explanation: q.explanation || '',
      };
    });
  }

  /**
   * Check rate limits for a tenant
   */
  async checkRateLimit(tenantId: string): Promise<boolean> {
    const limit = this.rateLimits.get(tenantId);
    const maxRequestsPerHour = parseInt(process.env.AI_RATE_LIMIT_PER_HOUR || '50', 10);
    const maxTokensPerHour = parseInt(process.env.AI_TOKEN_LIMIT_PER_HOUR || '100000', 10);

    if (!limit) {
      this.rateLimits.set(tenantId, {
        requestsPerHour: maxRequestsPerHour,
        tokensPerHour: maxTokensPerHour,
        currentRequests: 0,
        currentTokens: 0,
      });
      return true;
    }

    return limit.currentRequests < limit.requestsPerHour && limit.currentTokens < limit.tokensPerHour;
  }

  /**
   * Update rate limit usage
   */
  updateRateLimit(tenantId: string, tokensUsed: number): void {
    const limit = this.rateLimits.get(tenantId);
    if (limit) {
      limit.currentRequests += 1;
      limit.currentTokens += tokensUsed;
    }
  }

  /**
   * Estimate token usage for content and questions
   */
  private estimateTokenUsage(content: string, questionCount: number): number {
    // Rough estimation: 1 token ≈ 4 characters for English text
    const contentTokens = Math.ceil(content.length / 4);
    const responseTokens = questionCount * 150; // Estimated tokens per question
    return contentTokens + responseTokens;
  }

  /**
   * Reset rate limits (called hourly by a cron job)
   */
  resetRateLimits(): void {
    this.rateLimits.clear();
  }
}

// Singleton instance
let aiEvaluationService: AIEvaluationService | null = null;

export function getAIEvaluationService(): AIEvaluationService {
  if (!aiEvaluationService) {
    aiEvaluationService = new AIEvaluationService();
  }
  return aiEvaluationService;
}
