"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTenantSlug } from "@/lib/api-utils";

interface ChildForm {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  gender: string;
  placeOfBirth: string;
  nationality: string;
}

interface ParentForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  relationship: string;
  profession: string;
  address: string;
}

const emptyChild = (): ChildForm => ({
  firstName: "",
  lastName: "",
  email: "",
  dateOfBirth: "",
  gender: "",
  placeOfBirth: "",
  nationality: "",
});

const emptyParent = (): ParentForm => ({
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  relationship: "",
  profession: "",
  address: "",
});

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background text-foreground px-3 py-2 text-sm";

function RegisterForm() {
  const searchParams = useSearchParams();
  const [children, setChildren] = useState<ChildForm[]>([emptyChild()]);
  const [parent, setParent] = useState<ParentForm>(emptyParent());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const tenant = useMemo(() => {
    const fromQuery = searchParams.get("tenant");
    if (fromQuery) return fromQuery;
    try {
      return getTenantSlug();
    } catch {
      return "";
    }
  }, [searchParams]);

  useEffect(() => {
    const originalHtmlOverflow = document.documentElement.style.overflow;
    const originalBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "auto";
    document.documentElement.style.height = "auto";
    document.body.style.overflow = "auto";
    document.body.style.height = "auto";
    return () => {
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.overflow = originalBodyOverflow;
    };
  }, []);

  const updateChild = (index: number, field: keyof ChildForm, value: string) => {
    setChildren((prev) =>
      prev.map((child, i) => (i === index ? { ...child, [field]: value } : child))
    );
  };

  const updateParent = (field: keyof ParentForm, value: string) => {
    setParent((prev) => ({ ...prev, [field]: value }));
  };

  const addChild = () => setChildren((prev) => [...prev, emptyChild()]);

  const removeChild = (index: number) =>
    setChildren((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // Validation
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child.firstName.trim() || !child.lastName.trim() || !child.email.trim()) {
        setError(`Veuillez renseigner le prénom, le nom et l'email de l'enfant ${i + 1}.`);
        return;
      }
    }
    if (!parent.firstName.trim() || !parent.lastName.trim() || !parent.email.trim()) {
      setError("Veuillez renseigner le prénom, le nom et l'email du parent.");
      return;
    }

    setIsLoading(true);
    try {
      const payload = {
        accountType: "parent",
        firstName: parent.firstName.trim(),
        lastName: parent.lastName.trim(),
        email: parent.email.trim().toLowerCase(),
        phone: parent.phone.trim() || undefined,
        address: parent.address.trim() || undefined,
        relationship: parent.relationship.trim() || undefined,
        profession: parent.profession.trim() || undefined,
        children: children.map((child) => ({
          firstName: child.firstName.trim(),
          lastName: child.lastName.trim(),
          email: child.email.trim().toLowerCase(),
          dateOfBirth: child.dateOfBirth || undefined,
          gender: child.gender || undefined,
          placeOfBirth: child.placeOfBirth.trim() || undefined,
          nationality: child.nationality.trim() || undefined,
        })),
      };

      const response = await fetch("/api/v1/auth/register-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tenant ? { "X-Tenant": tenant } : {}),
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(result.message || result.error || "Échec de l'enregistrement de la demande.");
        return;
      }

      setSuccess(
        result.message ||
          "Votre demande d'inscription a été enregistrée. Après validation, vous recevrez par email vos identifiants ainsi que ceux de vos enfants."
      );
      setChildren([emptyChild()]);
      setParent(emptyParent());
    } catch {
      setError("Erreur de connexion au serveur. Veuillez réessayer.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-start justify-center bg-background pt-12 pb-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-emerald-600 rounded-2xl flex items-center justify-center shadow-xl">
              <span className="text-white font-bold text-2xl">ED</span>
            </div>
          </div>
          <h1 className="text-4xl font-bold gradient-text">Inscription en ligne</h1>
          <p className="text-muted-foreground whitespace-nowrap text-sm md:text-base">
            Inscrivez votre/vos enfant(s) puis votre compte parent. Un administrateur
            validera la demande et vous recevrez tous les identifiants par email.
          </p>
        </div>

        <Card variant="glass" className="hover-lift">
          <CardHeader>
            <CardTitle gradient>Demande d&apos;inscription familiale</CardTitle>
            <CardDescription>
              Les champs marqués d&apos;un astérisque (*) sont obligatoires.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {success ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">
                  {success}
                </div>
                <Link href="/login">
                  <Button className="w-full">Retour à la connexion</Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-8">
                {/* ---- Children ---- */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground">
                      Enfant(s) à inscrire
                    </h3>
                    <span className="text-sm text-muted-foreground">
                      {children.length} enfant{children.length > 1 ? "s" : ""}
                    </span>
                  </div>

                  {children.map((child, index) => (
                    <div
                      key={index}
                      className="space-y-4 rounded-lg border border-border bg-muted/40 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-foreground">
                          Enfant {index + 1}
                        </p>
                        {children.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeChild(index)}
                            className="text-sm text-red-400 hover:text-red-300"
                          >
                            Retirer
                          </button>
                        )}
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <Label>Prénom *</Label>
                          <Input
                            value={child.firstName}
                            onChange={(e) => updateChild(index, "firstName", e.target.value)}
                            required
                          />
                        </div>
                        <div>
                          <Label>Nom *</Label>
                          <Input
                            value={child.lastName}
                            onChange={(e) => updateChild(index, "lastName", e.target.value)}
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <Label>Email de l&apos;enfant *</Label>
                        <Input
                          type="email"
                          value={child.email}
                          onChange={(e) => updateChild(index, "email", e.target.value)}
                          required
                        />
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <Label>Date de naissance</Label>
                          <Input
                            type="date"
                            value={child.dateOfBirth}
                            onChange={(e) =>
                              updateChild(index, "dateOfBirth", e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <Label>Genre</Label>
                          <select
                            value={child.gender}
                            onChange={(e) => updateChild(index, "gender", e.target.value)}
                            className={SELECT_CLASS}
                          >
                            <option value="">— Sélectionner —</option>
                            <option value="masculin">Masculin</option>
                            <option value="feminin">Féminin</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <Label>Nationalité</Label>
                          <Input
                            value={child.nationality}
                            onChange={(e) =>
                              updateChild(index, "nationality", e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <Label>Lieu de naissance</Label>
                          <Input
                            value={child.placeOfBirth}
                            onChange={(e) =>
                              updateChild(index, "placeOfBirth", e.target.value)
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    onClick={addChild}
                    className="w-full"
                  >
                    + Ajouter un enfant
                  </Button>
                </div>

                {/* ---- Parent ---- */}
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">Parent / Tuteur</h3>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <Label>Prénom *</Label>
                      <Input
                        value={parent.firstName}
                        onChange={(e) => updateParent("firstName", e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <Label>Nom *</Label>
                      <Input
                        value={parent.lastName}
                        onChange={(e) => updateParent("lastName", e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <Label>Email *</Label>
                      <Input
                        type="email"
                        value={parent.email}
                        onChange={(e) => updateParent("email", e.target.value)}
                        required
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Tous les identifiants (parent et enfants) seront envoyés à cette adresse.
                      </p>
                    </div>
                    <div>
                      <Label>Téléphone</Label>
                      <Input
                        value={parent.phone}
                        onChange={(e) => updateParent("phone", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <Label>Lien de parenté</Label>
                      <Input
                        placeholder="Père, mère, tuteur..."
                        value={parent.relationship}
                        onChange={(e) => updateParent("relationship", e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Profession</Label>
                      <Input
                        value={parent.profession}
                        onChange={(e) => updateParent("profession", e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Adresse</Label>
                    <Input
                      value={parent.address}
                      onChange={(e) => updateParent("address", e.target.value)}
                    />
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Envoi en cours..." : "Envoyer la demande d'inscription"}
                </Button>

                <p className="text-center text-sm text-muted-foreground">
                  Vous avez déjà un compte ?{" "}
                  <Link href="/login" className="text-blue-400 hover:underline">
                    Se connecter
                  </Link>
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
