"use client";

import React, { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
} from "@ecoledigitale/ui";
import { 
  Bot,
  Send,
  Lightbulb,
  BookOpen,
  TrendingUp,
  Loader2,
  MessageCircle,
  Sparkles,
} from "lucide-react";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Recommendation {
  id: string;
  type: 'study_tip' | 'resource' | 'reminder';
  title: string;
  description: string;
  actionable: boolean;
  actionLabel?: string;
}

export default function AITutorPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Recommandations simulées - à remplacer par des données de l'API
  const [recommendations] = useState<Recommendation[]>([
    {
      id: '1',
      type: 'study_tip',
      title: 'Conseil d\'étude',
      description: 'Réviser les formules de trigonométrie avant le prochain cours de mathématiques.',
      actionable: true,
      actionLabel: 'Voir les formules'
    },
    {
      id: '2',
      type: 'resource',
      title: 'Ressource recommandée',
      description: 'Vidéo explicative sur la mécanique quantique disponible.',
      actionable: true,
      actionLabel: 'Regarder la vidéo'
    },
    {
      id: '3',
      type: 'reminder',
      title: 'Rappel important',
      description: 'Devoir de physique à rendre dans 3 jours.',
      actionable: true,
      actionLabel: 'Voir le devoir'
    }
  ]);

  // Rediriger si non authentifié ou non étudiant
  useEffect(() => {
    if (status === 'loading') {
      return;
    }

    if (!session) {
      router.push('/login');
      return;
    }

    const roles = (session as any)?.roles ?? [];
    const isStudent = Array.isArray(roles) && roles.some((r: string) => ['student', 'Étudiant'].includes(r));

    if (!isStudent) {
      router.push('/');
    }
  }, [session, status, router]);

  // Faire défiler vers le bas lorsque les messages changent
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Simuler une réponse de l'IA - remplacer par un appel API réel
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Je comprends votre question sur "${userMessage.content}". Voici une réponse détaillée qui devrait vous aider dans votre apprentissage. N'hésitez pas à me poser d'autres questions si vous avez besoin de clarifications supplémentaires.`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMessage]);
      setIsLoading(false);
    }, 1500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const getRecommendationIcon = (type: string) => {
    switch (type) {
      case 'study_tip': return <Lightbulb className="w-5 h-5 text-yellow-500" />;
      case 'resource': return <BookOpen className="w-5 h-5 text-blue-500" />;
      case 'reminder': return <TrendingUp className="w-5 h-5 text-green-500" />;
      default: return <Bot className="w-5 h-5 text-gray-500" />;
    }
  };

  const getRecommendationColor = (type: string) => {
    switch (type) {
      case 'study_tip': return 'border-yellow-500 bg-yellow-50';
      case 'resource': return 'border-blue-500 bg-blue-50';
      case 'reminder': return 'border-green-500 bg-green-50';
      default: return 'border-gray-500 bg-gray-50';
    }
  };

  const handleRecommendationAction = (recommendation: Recommendation) => {
    // Naviguer vers la page pertinente selon le type de recommandation
    console.log('Action de recommandation:', recommendation);
    // TODO: Implémenter la logique de navigation
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-emerald-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-4">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-bold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
                  Tuteur IA
                </h1>
                <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
                  Assistant intelligent pour votre apprentissage
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Sparkles className="w-4 h-4" />
              <span>Contexte: Basé sur vos cours actuels</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chat Section */}
          <div className="lg:col-span-2">
            <Card className="h-[calc(100vh-280px)] flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="w-5 h-5" />
                  Conversation
                </CardTitle>
                <CardDescription>
                  Posez vos questions et obtenez des réponses personnalisées
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col overflow-hidden">
                {/* Messages */}
                <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
                  {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                      <Bot className="w-16 h-16 text-gray-300 mb-4" />
                      <h3 className="text-lg font-medium text-gray-900 mb-2">
                        Commencez une conversation
                      </h3>
                      <p className="text-gray-600 max-w-md">
                        Posez une question sur vos cours, devoirs ou tout autre sujet académique.
                        Je suis là pour vous aider !
                      </p>
                    </div>
                  ) : (
                    messages.map((message) => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-lg p-4 ${
                            message.role === 'user'
                              ? 'bg-emerald-500 text-white'
                              : 'bg-gray-100 text-gray-900'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {message.role === 'assistant' && (
                              <Bot className="w-5 h-5 mt-0.5 flex-shrink-0" />
                            )}
                            <div className="flex-1">
                              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                              <p className={`text-xs mt-2 ${
                                message.role === 'user' ? 'text-emerald-100' : 'text-gray-500'
                              }`}>
                                {message.timestamp.toLocaleTimeString('fr-FR', {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-100 rounded-lg p-4">
                        <div className="flex items-center gap-2">
                          <Bot className="w-5 h-5" />
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-sm text-gray-600">Réflexion en cours...</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="flex gap-2">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Posez une question..."
                    disabled={isLoading}
                    className="flex-1"
                  />
                  <Button
                    onClick={handleSendMessage}
                    disabled={isLoading || !input.trim()}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recommendations Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recommandations</CardTitle>
                <CardDescription>
                  Suggestions personnalisées pour votre apprentissage
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recommendations.map((recommendation) => (
                    <div
                      key={recommendation.id}
                      className={`p-3 rounded-lg border-l-4 ${getRecommendationColor(recommendation.type)}`}
                    >
                      <div className="flex items-start space-x-3">
                        {getRecommendationIcon(recommendation.type)}
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 text-sm mb-1">
                            {recommendation.title}
                          </div>
                          <div className="text-xs text-gray-600 mb-2">
                            {recommendation.description}
                          </div>
                          {recommendation.actionable && recommendation.actionLabel && (
                            <button
                              onClick={() => handleRecommendationAction(recommendation)}
                              className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                            >
                              {recommendation.actionLabel} →
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Quick Questions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Questions Rapides</CardTitle>
                <CardDescription>
                  Cliquez pour poser une question courante
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    'Comment résoudre une équation du second degré ?',
                    'Quelle est la différence entre vitesse et accélération ?',
                    'Expliquez-moi le théorème de Pythagore',
                  ].map((question, index) => (
                    <button
                      key={index}
                      onClick={() => setInput(question)}
                      className="w-full text-left p-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

