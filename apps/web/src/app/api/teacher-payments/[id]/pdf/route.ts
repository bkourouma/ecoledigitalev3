import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]/route';

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

    // Générer le contenu HTML détaillé
    const htmlContent = generateDetailedHTML(payment);

    // Retourner le HTML avec les bons headers
    return new NextResponse(htmlContent, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error) {
    console.error('Erreur lors de la génération du PDF:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la génération du PDF' },
      { status: 500 }
    );
  }
}

function generateDetailedHTML(payment: any): string {
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
      <title>Fiche de Paiement Détaillée</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 900px;
          margin: 0 auto;
          padding: 20px;
          line-height: 1.6;
          color: #333;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 3px solid #8B5CF6;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        .logo-section {
          flex: 1;
        }
        .logo {
          font-size: 28px;
          font-weight: bold;
          color: #8B5CF6;
          margin-bottom: 5px;
        }
        .subtitle {
          color: #6B7280;
          font-size: 14px;
        }
        .document-info {
          text-align: right;
          flex: 1;
        }
        .doc-title {
          font-size: 20px;
          font-weight: bold;
          color: #374151;
          margin-bottom: 5px;
        }
        .doc-number {
          color: #6B7280;
          font-size: 14px;
        }
        .main-content {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 30px;
          margin-bottom: 30px;
        }
        .section {
          background: #F9FAFB;
          padding: 20px;
          border-radius: 10px;
          border-left: 4px solid #8B5CF6;
        }
        .section h3 {
          margin: 0 0 15px 0;
          color: #374151;
          font-size: 18px;
          font-weight: 600;
        }
        .field {
          margin-bottom: 12px;
        }
        .field-label {
          font-weight: 500;
          color: #6B7280;
          font-size: 14px;
          display: block;
          margin-bottom: 2px;
        }
        .field-value {
          color: #111827;
          font-size: 16px;
        }
        .status-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
          text-transform: uppercase;
        }
        .status-paid {
          background: #D1FAE5;
          color: #065F46;
        }
        .status-approved {
          background: #FEF3C7;
          color: #92400E;
        }
        .status-pending {
          background: #FEE2E2;
          color: #991B1B;
        }
        .financial-section {
          grid-column: 1 / -1;
          background: linear-gradient(135deg, #F3F4F6 0%, #E5E7EB 100%);
          padding: 25px;
          border-radius: 10px;
          margin: 20px 0;
        }
        .financial-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 20px;
        }
        .amount-card {
          background: white;
          padding: 15px;
          border-radius: 8px;
          text-align: center;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .amount-label {
          font-size: 12px;
          color: #6B7280;
          text-transform: uppercase;
          font-weight: 500;
          margin-bottom: 5px;
        }
        .amount-value {
          font-size: 18px;
          font-weight: bold;
          color: #374151;
        }
        .amount-value.negative {
          color: #DC2626;
        }
        .total-card {
          grid-column: 1 / -1;
          background: #8B5CF6;
          color: white;
          padding: 20px;
          border-radius: 10px;
          text-align: center;
        }
        .total-label {
          font-size: 14px;
          opacity: 0.9;
          margin-bottom: 5px;
        }
        .total-amount {
          font-size: 32px;
          font-weight: bold;
        }
        .notes-section {
          background: #FFFBEB;
          border: 1px solid #FCD34D;
          border-radius: 8px;
          padding: 20px;
          margin: 20px 0;
        }
        .notes-title {
          color: #92400E;
          font-weight: 600;
          margin-bottom: 10px;
        }
        .notes-content {
          color: #78350F;
          line-height: 1.6;
        }
        .footer {
          text-align: center;
          margin-top: 40px;
          padding-top: 20px;
          border-top: 2px solid #E5E7EB;
          color: #6B7280;
        }
        .signature-section {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          margin: 40px 0;
        }
        .signature-box {
          text-align: center;
          padding: 20px;
          border: 2px dashed #D1D5DB;
          border-radius: 8px;
        }
        .signature-label {
          font-weight: 500;
          color: #374151;
          margin-bottom: 40px;
        }
        .signature-line {
          border-bottom: 1px solid #9CA3AF;
          margin: 0 20px;
          height: 40px;
        }
        @media print {
          body { margin: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo-section">
          <div class="logo">IMHOTEP ACADEMY</div>
          <div class="subtitle">École Supérieure de Technologie</div>
          <div class="subtitle">Abidjan, Côte d'Ivoire</div>
        </div>
        <div class="document-info">
          <div class="doc-title">FICHE DE PAIEMENT</div>
          <div class="doc-number">N° ${payment.id.substring(0, 8).toUpperCase()}</div>
          <div class="doc-number">Généré le ${formatDate(new Date().toISOString())}</div>
        </div>
      </div>

      <div class="main-content">
        <div class="section">
          <h3>👨‍🏫 Informations Enseignant</h3>
          <div class="field">
            <span class="field-label">Nom complet</span>
            <div class="field-value">${payment.teacherName || 'Yvonne Checkah'}</div>
          </div>
          <div class="field">
            <span class="field-label">Adresse email</span>
            <div class="field-value">${payment.teacherEmail || 'yvonne.checkah@imhotepacademy.com'}</div>
          </div>
          <div class="field">
            <span class="field-label">Numéro employé</span>
            <div class="field-value">EMP-YC001</div>
          </div>
          <div class="field">
            <span class="field-label">Type de contrat</span>
            <div class="field-value">Permanent</div>
          </div>
        </div>

        <div class="section">
          <h3>📅 Détails du Paiement</h3>
          <div class="field">
            <span class="field-label">Période de paiement</span>
            <div class="field-value">${payment.periodName || `Période ${payment.periodId}`}</div>
          </div>
          <div class="field">
            <span class="field-label">Type de paiement</span>
            <div class="field-value">
              ${payment.paymentType === 'mixed' ? 'Paiement mixte' :
                payment.paymentType === 'base' ? 'Salaire de base' :
                payment.paymentType === 'overtime' ? 'Heures supplémentaires' : 'Paiement standard'}
            </div>
          </div>
          <div class="field">
            <span class="field-label">Date de calcul</span>
            <div class="field-value">${formatDate(payment.calculatedAt || payment.calculated_at)}</div>
          </div>
          <div class="field">
            <span class="field-label">Date de paiement</span>
            <div class="field-value">${formatDate(payment.paymentDate || payment.paid_at)}</div>
          </div>
          <div class="field">
            <span class="field-label">Statut</span>
            <div class="field-value">
              <span class="status-badge ${
                payment.status === 'paid' ? 'status-paid' :
                payment.status === 'approved' ? 'status-approved' : 'status-pending'
              }">
                ${payment.status === 'paid' ? 'Payé' : 
                  payment.status === 'approved' ? 'Approuvé' : 'En attente'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="financial-section">
        <h3 style="text-align: center; margin-bottom: 25px; color: #374151;">💰 Détail Financier</h3>
        
        <div class="financial-grid">
          <div class="amount-card">
            <div class="amount-label">Montant de Base</div>
            <div class="amount-value">${formatAmount(payment.baseAmount || payment.base_amount || 0)}</div>
          </div>
          
          <div class="amount-card">
            <div class="amount-label">Heures Supplémentaires</div>
            <div class="amount-value">${formatAmount(payment.overtimeAmount || payment.overtime_amount || 0)}</div>
          </div>
          
          <div class="amount-card">
            <div class="amount-label">Bonus & Primes</div>
            <div class="amount-value">${formatAmount(payment.bonusAmount || payment.bonus_amount || 0)}</div>
          </div>
          
          <div class="amount-card">
            <div class="amount-label">Déductions</div>
            <div class="amount-value negative">-${formatAmount(payment.deductions || 0)}</div>
          </div>
          
          <div class="total-card">
            <div class="total-label">MONTANT NET À PAYER</div>
            <div class="total-amount">${formatAmount(payment.netAmount || payment.totalAmount || payment.total_amount || 0)}</div>
          </div>
        </div>
      </div>

      ${payment.notes ? `
        <div class="notes-section">
          <div class="notes-title">📝 Notes et Observations</div>
          <div class="notes-content">${payment.notes}</div>
        </div>
      ` : ''}

      <div class="signature-section">
        <div class="signature-box">
          <div class="signature-label">Signature de l'Enseignant</div>
          <div class="signature-line"></div>
          <div style="margin-top: 10px; font-size: 12px; color: #6B7280;">Date: ___________</div>
        </div>
        <div class="signature-box">
          <div class="signature-label">Signature de l'Administration</div>
          <div class="signature-line"></div>
          <div style="margin-top: 10px; font-size: 12px; color: #6B7280;">Date: ___________</div>
        </div>
      </div>

      <div class="footer">
        <p><strong>IMHOTEP ACADEMY</strong> - École Supérieure de Technologie</p>
        <p>Abidjan, Côte d'Ivoire | Tél: +225 XX XX XX XX XX | Email: contact@imhotepacademy.com</p>
        <p style="font-size: 12px; margin-top: 15px;">
          Ce document est confidentiel et destiné uniquement à l'usage de l'enseignant concerné.
        </p>
        <p class="no-print" style="margin-top: 20px;">
          <button onclick="window.print()" style="background: #8B5CF6; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 14px;">
            🖨️ Imprimer ce document
          </button>
        </p>
      </div>
    </body>
    </html>
  `;
}
