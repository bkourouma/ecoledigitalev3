"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import { useFormationDetail } from "@/lib/hooks/use-formations-pro";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@ecoledigitale/ui";
import { createApiHeaders } from "@/lib/api-utils";
import { Lock, Loader2, PlayCircle } from "lucide-react";

type PublicSupport = {
  id: string;
  titre: string;
  description?: string;
  type_fichier: string;
  is_video: boolean;
  thumbnail_url?: string | null;
};

type UnlockedSupport = PublicSupport & {
  playback_url?: string | null;
  download_url?: string | null;
  video_provider?: "local" | "vimeo" | null;
};

export default function FormationPublicDetailPage() {
  const params = useParams();
  const slug = decodeURIComponent((params.slug as string) || "");
  const { data: session } = useSession();
  const { data: formationResponse, isLoading } = useFormationDetail(slug || null);

  const [publicSupports, setPublicSupports] = useState<PublicSupport[]>([]);
  const [unlockedSupports, setUnlockedSupports] = useState<UnlockedSupport[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [registerData, setRegisterData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerMessage, setRegisterMessage] = useState<string | null>(null);

  const formation = formationResponse?.data as any;

  useEffect(() => {
    if (!slug) return;

    const loadPublicSupports = async () => {
      setMaterialsLoading(true);
      try {
        const response = await fetch(`/api/v1/formations-pro/${encodeURIComponent(slug)}/materials/public`, {
          headers: createApiHeaders(),
        });
        const data = await response.json();
        setPublicSupports(data?.data?.supports || []);
      } catch {
        setPublicSupports([]);
      } finally {
        setMaterialsLoading(false);
      }
    };

    loadPublicSupports();
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    if (!(session as any)?.jwtToken) {
      setUnlockedSupports([]);
      setUnlockError(null);
      return;
    }

    const loadUnlockedSupports = async () => {
      try {
        setUnlockError(null);
        const response = await fetch(`/api/v1/formations-pro/${encodeURIComponent(slug)}/materials/unlocked`, {
          headers: {
            ...createApiHeaders(),
            Authorization: `Bearer ${(session as any).jwtToken}`,
          },
        });

        const data = await response.json();
        if (!response.ok) {
          setUnlockError(data?.message || "Contenu non debloque");
          setUnlockedSupports([]);
          return;
        }

        setUnlockedSupports(data?.data?.supports || []);
      } catch {
        setUnlockError("Contenu non debloque");
        setUnlockedSupports([]);
      }
    };

    loadUnlockedSupports();
  }, [slug, (session as any)?.jwtToken]);

  const onRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterLoading(true);
    setRegisterMessage(null);

    try {
      const response = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: createApiHeaders(),
        body: JSON.stringify(registerData),
      });

      const data = await response.json();
      if (!response.ok) {
        setRegisterMessage(data?.message || "Echec de creation du compte");
        return;
      }

      await signIn("credentials", {
        email: registerData.email,
        password: registerData.password,
        redirect: false,
      });
      setRegisterMessage("Compte cree et connecte. Vous pouvez maintenant payer la formation.");
    } catch {
      setRegisterMessage("Erreur lors de la creation du compte");
    } finally {
      setRegisterLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-10 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement...
      </div>
    );
  }

  if (!formation) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-10">
        <Card><CardContent className="p-6">Formation introuvable.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-10 space-y-6">
      <div className="space-y-2">
        <Link href="/formations-professionnelles/public" className="text-sm text-muted-foreground hover:underline">
          Retour au catalogue public
        </Link>
        <h1 className="text-3xl font-bold">{formation.titre}</h1>
        <p className="text-muted-foreground">{formation.description_courte || ""}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Apercu des supports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {materialsLoading && <p className="text-sm text-muted-foreground">Chargement des supports...</p>}
            {!materialsLoading && publicSupports.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun support visible pour le moment.</p>
            )}
            {publicSupports.map((support) => (
              <div key={support.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{support.titre}</p>
                    <p className="text-xs text-muted-foreground">{support.type_fichier}</p>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-amber-600">
                    <Lock className="h-3 w-3" />
                    Verrouille
                  </div>
                </div>
                {support.thumbnail_url && (
                  <img
                    src={support.thumbnail_url}
                    alt={support.titre}
                    className="mt-2 h-32 w-full rounded object-cover"
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inscription et paiement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!session && (
              <>
                <Button className="w-full" onClick={() => signIn("google", { callbackUrl: window.location.href })}>
                  Continuer avec Gmail
                </Button>
                <form onSubmit={onRegister} className="space-y-2">
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    placeholder="Prenom"
                    value={registerData.firstName}
                    onChange={(e) => setRegisterData((s) => ({ ...s, firstName: e.target.value }))}
                    required
                  />
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    placeholder="Nom"
                    value={registerData.lastName}
                    onChange={(e) => setRegisterData((s) => ({ ...s, lastName: e.target.value }))}
                    required
                  />
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    placeholder="Email"
                    type="email"
                    value={registerData.email}
                    onChange={(e) => setRegisterData((s) => ({ ...s, email: e.target.value }))}
                    required
                  />
                  <input
                    className="w-full rounded border px-3 py-2 text-sm"
                    placeholder="Mot de passe"
                    type="password"
                    minLength={8}
                    value={registerData.password}
                    onChange={(e) => setRegisterData((s) => ({ ...s, password: e.target.value }))}
                    required
                  />
                  <Button type="submit" className="w-full" disabled={registerLoading}>
                    {registerLoading ? "Creation..." : "Creer un compte"}
                  </Button>
                </form>
              </>
            )}

            {session && (
              <p className="text-sm text-green-700">Connecte en tant que {(session.user as any)?.email}</p>
            )}

            {registerMessage && <p className="text-xs text-muted-foreground">{registerMessage}</p>}

            <Link href={`/formations-professionnelles/inscription/catalogue/${encodeURIComponent(slug)}`}>
              <Button className="w-full">Acheter la formation (CinetPay)</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Videos debloquees apres paiement</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!session && <p className="text-sm text-muted-foreground">Connectez-vous puis effectuez le paiement pour voir les videos.</p>}
          {session && unlockError && <p className="text-sm text-amber-700">{unlockError}</p>}
          {unlockedSupports.map((support) => (
            <div key={support.id} className="rounded-md border p-3 space-y-2">
              <p className="font-medium">{support.titre}</p>
              {support.is_video && (
                <div className="space-y-2">
                  {support.video_provider === "vimeo" ? (
                    <iframe
                      src={support.playback_url || ""}
                      title={support.titre}
                      className="h-64 w-full rounded"
                      allow="autoplay; fullscreen; picture-in-picture"
                    />
                  ) : (
                    <video
                      controls
                      className="h-64 w-full rounded bg-black"
                      src={`/api/v1/formations-pro/videos/${support.id}/playback?slug=${encodeURIComponent(slug)}`}
                    />
                  )}
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <PlayCircle className="h-3 w-3" />
                    Acces debloque
                  </p>
                </div>
              )}
              {!support.is_video && support.download_url && (
                <Link href={support.download_url} className="text-sm underline">
                  Ouvrir le document
                </Link>
              )}
            </div>
          ))}
          {session && !unlockError && unlockedSupports.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun contenu debloque pour le moment.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
