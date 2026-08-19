import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

/**
 * Bulletin de paie au format PDF — feature 031.
 *
 * Cette route CONSTRUISAIT auparavant le document elle-même : ~500 lignes de
 * HTML assemblées à la main, renvoyées avec un bouton « Imprimer ». Ce n'était
 * pas un PDF — l'utilisateur devait passer par la boîte d'impression du
 * navigateur, et le rendu dépendait de sa configuration (marges, en-têtes,
 * fonds de couleur désactivés par défaut).
 *
 * Le document est désormais produit par l'API
 * (`teacher-payslip-template.service.ts`), rendu par Puppeteer, à la charte des
 * attestations. Cette route n'est plus qu'un relais : elle porte la session
 * NextAuth vers l'API, qui ne connaît que les jetons Bearer.
 *
 * Le relais est nécessaire — le navigateur ne peut pas appeler l'API
 * directement, il n'a ni le jeton ni l'en-tête de tenant.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: paymentId } = await params;
  // Le type de session NextAuth n'est pas augmenté dans ce projet : `user.id`,
  // `jwtToken` et `tenantSlug` y sont ajoutés par les callbacks sans que le
  // type le reflète. Le cast reste local plutôt que d'introduire une
  // déclaration globale au détour d'une route.
  const session = (await getServerSession(authOptions)) as any;

  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Non autorisé - Veuillez vous connecter" },
      { status: 401 }
    );
  }

  const jwtToken = session.jwtToken;
  if (!jwtToken) {
    return NextResponse.json(
      { error: "Token d'authentification manquant" },
      { status: 401 }
    );
  }

  try {
    const upstream = await fetch(
      `${API_BASE_URL}/api/v1/teacher-payments/${paymentId}/payslip.pdf`,
      {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          "X-Tenant": session.tenantSlug || "imhotepacademy",
          "X-User-Id": session.user.id as string,
        },
      }
    );

    if (!upstream.ok) {
      // Le corps d'erreur de l'API est du JSON : le transmettre tel quel plutôt
      // que de le maquiller en PDF vide, qui s'ouvrirait sur une page blanche.
      const detail = await upstream.text();
      return NextResponse.json(
        {
          error: "Génération du bulletin impossible",
          statut: upstream.status,
          detail: detail.slice(0, 500),
        },
        { status: upstream.status }
      );
    }

    const pdf = Buffer.from(await upstream.arrayBuffer());

    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // `inline` : le bulletin se consulte le plus souvent d'un coup d'œil,
        // le téléchargement reste à un clic depuis la visionneuse.
        "Content-Disposition": `inline; filename="bulletin-paie-${paymentId.slice(0, 8)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Génération du bulletin impossible",
        detail: (error as Error).message,
      },
      { status: 502 }
    );
  }
}
