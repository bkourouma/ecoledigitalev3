"use client";

import React, { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AntSelect } from "@/platform/ui/FormField";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
} from "@ecoledigitale/ui";
import { 
  HelpCircle,
  Mail,
  MessageSquare,
  BookOpen,
  FileText,
  Search,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Phone,
  Clock,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";

interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: 'general' | 'technical' | 'academic' | 'account';
}

export default function StudentSupportPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFAQ, setExpandedFAQ] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [contactForm, setContactForm] = useState({
    subject: '',
    message: '',
    category: 'general',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // FAQ Data
  const faqItems: FAQItem[] = [
    {
      id: '1',
      question: 'Comment puis-je accéder à mes devoirs ?',
      answer: 'Vous pouvez accéder à vos devoirs en allant dans la section "Devoirs" du menu. Tous vos devoirs actifs seront affichés avec leurs dates d\'échéance. Cliquez sur "Voir détails" pour ouvrir un devoir spécifique.',
      category: 'academic',
    },
    {
      id: '2',
      question: 'Comment soumettre un devoir ?',
      answer: 'Ouvrez le devoir que vous souhaitez compléter, puis cliquez sur l\'onglet "Ma soumission". Vous pouvez soit télécharger un fichier, soit saisir votre réponse directement dans le champ de texte. N\'oubliez pas de cliquer sur "Soumettre" une fois terminé.',
      category: 'academic',
    },
    {
      id: '3',
      question: 'Mon fichier ne s\'upload pas, que faire ?',
      answer: 'Vérifiez que votre fichier ne dépasse pas 10 Mo et qu\'il est dans un format accepté (.pdf, .doc, .docx, etc.). Essayez également de rafraîchir la page ou d\'utiliser un autre navigateur. Si le problème persiste, contactez le support technique.',
      category: 'technical',
    },
    {
      id: '4',
      question: 'Comment voir mes notes ?',
      answer: 'Accédez à la section "Mes Notes" dans le menu principal. Vous y trouverez toutes vos notes organisées par cours et par période académique.',
      category: 'academic',
    },
    {
      id: '5',
      question: 'J\'ai oublié mon mot de passe, comment le réinitialiser ?',
      answer: 'Sur la page de connexion, cliquez sur "Mot de passe oublié". Vous recevrez un email avec les instructions pour réinitialiser votre mot de passe.',
      category: 'account',
    },
    {
      id: '6',
      question: 'Comment contacter mon professeur ?',
      answer: 'Vous pouvez contacter vos professeurs via la section "Messages" dans le menu. Sélectionnez le cours concerné et envoyez un message à votre professeur.',
      category: 'academic',
    },
    {
      id: '7',
      question: 'Où puis-je trouver les supports de cours ?',
      answer: 'Tous les supports de cours sont disponibles dans la section "Contenu Récent". Vous pouvez filtrer par cours et télécharger les fichiers dont vous avez besoin.',
      category: 'academic',
    },
    {
      id: '8',
      question: 'Comment fonctionne le Tuteur IA ?',
      answer: 'Le Tuteur IA est disponible dans la section "Aide & Support". Vous pouvez lui poser des questions sur vos cours, devoirs ou tout autre sujet académique. Il vous fournira des réponses personnalisées basées sur votre contexte d\'apprentissage.',
      category: 'general',
    },
    {
      id: '9',
      question: 'Mon texte ne se sauvegarde pas automatiquement',
      answer: 'Assurez-vous d\'être connecté à Internet. La sauvegarde automatique se fait toutes les 2 secondes. Si le problème persiste, essayez de rafraîchir la page ou de vous reconnecter.',
      category: 'technical',
    },
    {
      id: '10',
      question: 'Comment modifier mes informations personnelles ?',
      answer: 'Allez dans "Mon Profil" dans le menu, puis cliquez sur "Modifier". Vous pourrez mettre à jour vos informations personnelles et académiques.',
      category: 'account',
    },
  ];

  // Rediriger si non authentifié ou non étudiant
  React.useEffect(() => {
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

  const toggleFAQ = (id: string) => {
    setExpandedFAQ(expandedFAQ === id ? null : id);
  };

  const filteredFAQs = faqItems.filter(item => {
    const matchesSearch = searchQuery === '' || 
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    
    return matchesSearch && matchesCategory;
  });

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitSuccess(false);

    // Simuler l'envoi du formulaire - remplacer par un appel API réel
    setTimeout(() => {
      setIsSubmitting(false);
      setSubmitSuccess(true);
      setContactForm({ subject: '', message: '', category: 'general' });
      
      // Réinitialiser le message de succès après 5 secondes
      setTimeout(() => setSubmitSuccess(false), 5000);
    }, 1500);
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
                <HelpCircle className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="font-bold bg-gradient-to-r from-emerald-600 to-blue-600 bg-clip-text text-transparent whitespace-nowrap text-2xl leading-tight md:text-3xl">
                  Support & Aide
                </h1>
                <p className="text-gray-600 whitespace-nowrap text-sm md:text-base">
                  Trouvez des réponses à vos questions ou contactez notre équipe
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Search & Filter */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="Rechercher dans la FAQ..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                      />
                    </div>
                  </div>
                  <div className="md:w-48">
                    <AntSelect
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="all">Toutes les catégories</option>
                      <option value="general">Général</option>
                      <option value="technical">Technique</option>
                      <option value="academic">Académique</option>
                      <option value="account">Compte</option>
                    </AntSelect>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* FAQ Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  Questions Fréquemment Posées
                </CardTitle>
                <CardDescription>
                  {filteredFAQs.length} question(s) trouvée(s)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {filteredFAQs.length > 0 ? (
                    filteredFAQs.map((item) => (
                      <div
                        key={item.id}
                        className="border border-gray-200 rounded-lg overflow-hidden"
                      >
                        <button
                          onClick={() => toggleFAQ(item.id)}
                          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
                        >
                          <span className="font-medium text-gray-900 flex-1">
                            {item.question}
                          </span>
                          {expandedFAQ === item.id ? (
                            <ChevronUp className="w-5 h-5 text-gray-500 flex-shrink-0 ml-4" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0 ml-4" />
                          )}
                        </button>
                        {expandedFAQ === item.id && (
                          <div className="px-4 pb-4 text-gray-600">
                            {item.answer}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8">
                      <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600">
                        Aucune question trouvée. Essayez de modifier vos critères de recherche.
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Quick Links */}
            <Card>
              <CardHeader>
                <CardTitle>Ressources Utiles</CardTitle>
                <CardDescription>
                  Accès rapide aux sections importantes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Button
                    variant="outline"
                    className="justify-start h-auto py-4"
                    onClick={() => router.push('/student/ai-tutor')}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <MessageSquare className="w-5 h-5 text-blue-600" />
                      </div>
                      <div className="text-left">
                        <div className="font-medium">Tuteur IA</div>
                        <div className="text-xs text-gray-500">Obtenez de l'aide instantanée</div>
                      </div>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start h-auto py-4"
                    onClick={() => router.push('/student/assignments')}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-100 rounded-lg">
                        <FileText className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div className="text-left">
                        <div className="font-medium">Mes Devoirs</div>
                        <div className="text-xs text-gray-500">Voir tous vos devoirs</div>
                      </div>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start h-auto py-4"
                    onClick={() => router.push('/student/messages')}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-100 rounded-lg">
                        <MessageSquare className="w-5 h-5 text-purple-600" />
                      </div>
                      <div className="text-left">
                        <div className="font-medium">Messages</div>
                        <div className="text-xs text-gray-500">Contacter vos professeurs</div>
                      </div>
                    </div>
                  </Button>
                  <Button
                    variant="outline"
                    className="justify-start h-auto py-4"
                    onClick={() => router.push('/student/profile')}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-orange-100 rounded-lg">
                        <FileText className="w-5 h-5 text-orange-600" />
                      </div>
                      <div className="text-left">
                        <div className="font-medium">Mon Profil</div>
                        <div className="text-xs text-gray-500">Gérer vos informations</div>
                      </div>
                    </div>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Contact Form */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Nous Contacter</CardTitle>
                <CardDescription>
                  Envoyez-nous un message si vous ne trouvez pas de réponse
                </CardDescription>
              </CardHeader>
              <CardContent>
                {submitSuccess ? (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle className="w-5 h-5" />
                      <span className="font-medium">Message envoyé avec succès !</span>
                    </div>
                    <p className="text-sm text-green-700 mt-2">
                      Nous vous répondrons dans les plus brefs délais.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleContactSubmit} className="space-y-4">
                    <div>
                      <Label htmlFor="category">Catégorie</Label>
                      <AntSelect
                        id="category"
                        value={contactForm.category}
                        onChange={(e) => setContactForm({ ...contactForm, category: e.target.value })}
                        className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        required
                      >
                        <option value="general">Général</option>
                        <option value="technical">Problème technique</option>
                        <option value="academic">Question académique</option>
                        <option value="account">Problème de compte</option>
                      </AntSelect>
                    </div>
                    <div>
                      <Label htmlFor="subject">Sujet</Label>
                      <Input
                        id="subject"
                        value={contactForm.subject}
                        onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                        placeholder="Résumé de votre question"
                        required
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="message">Message</Label>
                      <textarea
                        id="message"
                        value={contactForm.message}
                        onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                        placeholder="Décrivez votre problème ou votre question en détail..."
                        required
                        rows={5}
                        className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Envoi en cours...
                        </>
                      ) : (
                        <>
                          <Mail className="w-4 h-4 mr-2" />
                          Envoyer le message
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>

            {/* Contact Information */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Informations de Contact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-emerald-600 mt-0.5" />
                  <div>
                    <div className="font-medium text-gray-900">Email</div>
                    <a
                      href="mailto:support@ecoledigitale.com"
                      className="text-sm text-emerald-600 hover:underline"
                    >
                      support@ecoledigitale.com
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Phone className="w-5 h-5 text-emerald-600 mt-0.5" />
                  <div>
                    <div className="font-medium text-gray-900">Téléphone</div>
                    <a
                      href="tel:+33123456789"
                      className="text-sm text-emerald-600 hover:underline"
                    >
                      +33 1 23 45 67 89
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-emerald-600 mt-0.5" />
                  <div>
                    <div className="font-medium text-gray-900">Heures d'ouverture</div>
                    <div className="text-sm text-gray-600">
                      Lundi - Vendredi: 9h00 - 18h00
                      <br />
                      Samedi: 9h00 - 13h00
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Help Tips */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Conseils</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm text-gray-600">
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                    <span>Vérifiez d'abord la FAQ avant de contacter le support</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                    <span>Utilisez le Tuteur IA pour des questions rapides</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                    <span>Contactez vos professeurs via Messages pour les questions de cours</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}












