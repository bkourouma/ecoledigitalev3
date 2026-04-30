"use client";

import { useEffect } from 'react';
import { useRouter } from "next/navigation";
import { useSession } from 'next-auth/react';
import { motion } from 'framer-motion';
import {
  BookOpen,
  Users,
  GraduationCap,
  TrendingUp,
  Calendar,
  Star,
  Clock,
  Award,
  Play,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  MoreHorizontal
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Featured Community Hero Section (Discord-like)
const FeaturedHeroSection = ({ userRole, userName }: { userRole: string; userName: string }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="featured-card mb-12 h-56"
    >
      <div className="relative z-10 h-full flex items-center">
        <div className="flex-1">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="text-3xl font-bold mb-2"
          >
            Trouvez votre communauté
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="text-lg opacity-90 mb-4"
          >
            sur EcoleDigitale
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
          >
            <Button variant="secondary" size="lg" className="bg-white/20 hover:bg-white/30 text-white border-white/30">
              Découvrir
            </Button>
          </motion.div>
        </div>

        {/* Decorative illustration area */}
        <div className="hidden md:block w-64 h-full relative">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent rounded-2xl" />
          <div className="absolute top-4 right-4 w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
            <GraduationCap className="h-8 w-8 text-white" />
          </div>
          <div className="absolute bottom-4 right-8 w-12 h-12 bg-white/15 rounded-full flex items-center justify-center">
            <BookOpen className="h-6 w-6 text-white" />
          </div>
        </div>
      </div>

      {/* Background decorative elements */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24" />
    </motion.div>
  );
};

// Featured Community Cards Section
const FeaturedCommunitySection = () => {
  const featuredCommunities = [
    {
      title: "Réalité Virtuelle",
      description: "Explorez l'avenir de l'éducation avec la VR",
      members: "1,234",
      image: "🥽",
      gradient: "from-purple-600 via-blue-600 to-cyan-500"
    },
    {
      title: "Game Play",
      description: "Apprenez en jouant avec nos jeux éducatifs",
      members: "856",
      image: "🎮",
      gradient: "from-pink-500 via-purple-500 to-indigo-600"
    }
  ];

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-white">Communauté en vedette</h2>
        <Button variant="ghost" className="text-purple-400 hover:text-purple-300">
          Voir tout
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {featuredCommunities.map((community, index) => (
          <motion.div
            key={community.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.6 }}
            className={`community-card bg-gradient-to-br ${community.gradient} h-40`}
          >
            <div className="flex items-center h-full">
              <div className="flex-1">
                <h3 className="text-lg font-bold mb-1">{community.title}</h3>
                <p className="text-sm opacity-90 mb-2">{community.description}</p>
                <div className="flex items-center space-x-4 text-xs opacity-75">
                  <span className="flex items-center">
                    <Users className="h-3 w-3 mr-1" />
                    {community.members} membres
                  </span>
                </div>
              </div>
              <div className="text-4xl ml-4">
                {community.image}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// Popular Right Now Section
const PopularRightNowSection = () => {
  const popularItems = [
    {
      title: "3D Art",
      description: "Créez des œuvres d'art en 3D",
      icon: "🎨",
      members: "2.4k",
      gradient: "from-blue-600 to-purple-600"
    },
    {
      title: "NFT",
      description: "Découvrez l'art numérique",
      icon: "💎",
      members: "1.8k",
      gradient: "from-purple-600 to-pink-600"
    }
  ];

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-white">Populaire en ce moment</h2>
        <Button variant="ghost" className="text-purple-400 hover:text-purple-300">
          Voir tout
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {popularItems.map((item, index) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.6 }}
            className={`discord-card bg-gradient-to-br ${item.gradient} p-4 h-24`}
          >
            <div className="flex items-center h-full">
              <div className="text-2xl mr-4">{item.icon}</div>
              <div className="flex-1">
                <h3 className="font-bold text-white mb-1">{item.title}</h3>
                <p className="text-xs text-white/80">{item.description}</p>
              </div>
              <div className="text-xs text-white/60">
                {item.members} membres
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// Recent Add Section
const RecentAddSection = () => {
  const recentItems = [
    {
      title: "Cours de Mathématiques",
      description: "Algèbre et géométrie avancées",
      author: "Prof. Martin",
      time: "Il y a 2h",
      image: "📐",
      gradient: "from-emerald-500 to-teal-600"
    },
    {
      title: "Atelier Créatif",
      description: "Design et arts numériques",
      author: "Sophie L.",
      time: "Il y a 4h",
      image: "🎨",
      gradient: "from-pink-500 to-rose-600"
    }
  ];

  return (
    <div className="mb-12">
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl font-bold text-white">Récent Ajout</h2>
        <Button variant="ghost" className="text-purple-400 hover:text-purple-300">
          Voir tout
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {recentItems.map((item, index) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.6 }}
            className="discord-card p-4"
          >
            <div className="flex items-start space-x-4">
              <div className={`w-12 h-12 bg-gradient-to-br ${item.gradient} rounded-xl flex items-center justify-center text-xl`}>
                {item.image}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white mb-1">{item.title}</h3>
                <p className="text-sm text-gray-300 mb-2">{item.description}</p>
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>Par {item.author}</span>
                  <span>{item.time}</span>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-purple-400 hover:text-purple-300">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/login");
    }
  }, [session, status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-role-primary" />
      </div>
    );
  }

  if (!session) {
    return null; // Redirect is happening via useEffect
  }

  const userRole = (session as any).roles?.[0] || 'student';
  const userName = session.user?.name || 'Utilisateur';
  const tenantSlug = (session as any).tenantSlug || 'imhotepacademy';

  return (
    <div className="bg-background">
      <div className="max-w-4xl mx-auto p-8 xl:p-12">
        <FeaturedHeroSection userRole={userRole} userName={userName} />
        <FeaturedCommunitySection />
        <PopularRightNowSection />
        <RecentAddSection />
      </div>
    </div>
  );
}

