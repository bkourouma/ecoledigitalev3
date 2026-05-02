import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: paymentId } = await params;
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Non autorisé - Veuillez vous connecter' },
        { status: 401 }
      );
    }

    const userId = (session as any).user?.id as string;
    const tenantSlug = (session as any).tenantSlug || 'imhotepacademy';
    const jwtToken = (session as any).jwtToken;

    if (!jwtToken) {
      return NextResponse.json(
        { error: "Token d'authentification manquant" },
        { status: 401 }
      );
    }

    // Récupérer les détails du paiement depuis l'API Fastify
    let payment = null;
    try {
      const specificResponse = await fetch(`${API_BASE_URL}/api/v1/teacher-payments/${paymentId}`, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${jwtToken}`,
          "X-Tenant": tenantSlug,
          "X-User-Id": userId
        },
      });

      if (specificResponse.ok) {
        const data = await specificResponse.json();
        payment = data.data || data;
      } else {
        // Si l'endpoint spécifique ne fonctionne pas, récupérons depuis la liste
        const listResponse = await fetch(`${API_BASE_URL}/api/v1/teacher-payments?limit=100`, {
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${jwtToken}`,
            "X-Tenant": tenantSlug,
            "X-User-Id": userId
          },
        });

        if (!listResponse.ok) {
          return NextResponse.json(
            { error: 'Impossible de récupérer les paiements' },
            { status: listResponse.status }
          );
        }

        const listData = await listResponse.json();
        payment = listData.data?.find((p: any) => p.id === paymentId);

        if (!payment) {
          return NextResponse.json(
            { error: 'Paiement non trouvé' },
            { status: 404 }
          );
        }
      }
    } catch (error) {
      console.error('Erreur lors de la récupération du paiement:', error);
      return NextResponse.json(
        { error: 'Erreur lors de la récupération du paiement' },
        { status: 500 }
      );
    }

    // Générer le contenu HTML du relevé
    const htmlContent = generateStatementHTML(payment);

    // Retourner le HTML avec les bons headers
    return new NextResponse(htmlContent, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error) {
    console.error('Erreur lors de la génération du relevé:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la génération du relevé' },
      { status: 500 }
    );
  }
}

function generateStatementHTML(payment: any): string {
  const formatAmount = (amount: number) => {
    return amount.toLocaleString('fr-FR') + ' FCFA';
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Non défini';
    const date = new Date(dateString);
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  return `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Relevé de Paiement</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          line-height: 1.6;
        }
        .header {
          text-align: center;
          border-bottom: 2px solid #8B5CF6;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        .logo {
          font-size: 24px;
          font-weight: bold;
          color: #8B5CF6;
          margin-bottom: 10px;
        }
        .title {
          font-size: 20px;
          font-weight: bold;
          margin-bottom: 20px;
        }
        .info-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 30px;
        }
        .info-section {
          background: #F9FAFB;
          padding: 15px;
          border-radius: 8px;
        }
        .info-section h3 {
          margin: 0 0 10px 0;
          color: #374151;
          font-size: 16px;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .info-label {
          font-weight: 500;
          color: #6B7280;
        }
        .info-value {
          color: #111827;
        }
        .amount-breakdown {
          background: #F3F4F6;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        .amount-row {
          display: flex;
          justify-content: space-between;
          margin-bottom: 10px;
          padding: 8px 0;
        }
        .amount-row.total {
          border-top: 2px solid #8B5CF6;
          font-weight: bold;
          font-size: 18px;
          color: #8B5CF6;
          margin-top: 15px;
          padding-top: 15px;
        }
        .deduction {
          color: #DC2626;
        }
        .footer {
          text-align: center;
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #E5E7EB;
          color: #6B7280;
          font-size: 14px;
        }
        @media print {
          body { margin: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">IMHOTEP ACADEMY</div>
        <div>École Supérieure de Technologie</div>
        <div style="font-size: 14px; color: #6B7280;">Abidjan, Côte d'Ivoire</div>
      </div>

      <div class="title">RELEVÉ DE PAIEMENT</div>

      <div class="info-grid">
        <div class="info-section">
          <h3>Informations Enseignant</h3>
          <div class="info-row">
            <span class="info-label">Nom:</span>
            <span class="info-value">${payment.teacherName || 'Yvonne Checkah'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Email:</span>
            <span class="info-value">${payment.teacherEmail || 'yvonne.checkah@imhotepacademy.com'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">ID Paiement:</span>
            <span class="info-value">${payment.id}</span>
          </div>
        </div>

        <div class="info-section">
          <h3>Détails du Paiement</h3>
          <div class="info-row">
            <span class="info-label">Période:</span>
            <span class="info-value">${payment.periodName || `Période ${payment.periodId}`}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Date de calcul:</span>
            <span class="info-value">${formatDate(payment.calculatedAt || payment.calculated_at)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Date de paiement:</span>
            <span class="info-value">${formatDate(payment.paymentDate || payment.paid_at)}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Statut:</span>
            <span class="info-value">${payment.status === 'paid' ? 'Payé' : payment.status === 'approved' ? 'Approuvé' : 'En attente'}</span>
          </div>
        </div>
      </div>

      <div class="amount-breakdown">
        <h3 style="margin: 0 0 15px 0;">Détail des Montants</h3>
        
        <div class="amount-row">
          <span>Montant de base:</span>
          <span>${formatAmount(payment.baseAmount || payment.base_amount || 0)}</span>
        </div>
        
        <div class="amount-row">
          <span>Heures supplémentaires:</span>
          <span>${formatAmount(payment.overtimeAmount || payment.overtime_amount || 0)}</span>
        </div>
        
        <div class="amount-row">
          <span>Bonus:</span>
          <span>${formatAmount(payment.bonusAmount || payment.bonus_amount || 0)}</span>
        </div>
        
        <div class="amount-row deduction">
          <span>Déductions:</span>
          <span>-${formatAmount(payment.deductions || 0)}</span>
        </div>
        
        <div class="amount-row total">
          <span>MONTANT NET À PAYER:</span>
          <span>${formatAmount(payment.netAmount || payment.totalAmount || payment.total_amount || 0)}</span>
        </div>
      </div>

      ${payment.notes ? `
        <div class="info-section">
          <h3>Notes</h3>
          <p>${payment.notes}</p>
        </div>
      ` : ''}

      <div class="footer">
        <p>Document généré le ${formatDate(new Date().toISOString())}</p>
        <p>IMHOTEP ACADEMY - École Supérieure de Technologie</p>
        <p class="no-print">
          <button onclick="window.print()" style="background: #8B5CF6; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer;">
            Imprimer ce relevé
          </button>
        </p>
      </div>
    </body>
    </html>
  `;
}
