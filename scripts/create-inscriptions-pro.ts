import { Client } from "pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

interface ApprenantData {
  prenom: string;
  nom: string;
  email: string;
  telephone?: string;
}

const apprenants: ApprenantData[] = [
  {
    prenom: "Amadou",
    nom: "Diallo",
    email: "amadou.diallo@example.ci",
    telephone: "+225 07 12 34 56 78"
  },
  {
    prenom: "Fatou",
    nom: "Traoré",
    email: "fatou.traore@example.ci",
    telephone: "+225 07 23 45 67 89"
  },
  {
    prenom: "Ibrahim",
    nom: "Koné",
    email: "ibrahim.kone@example.ci",
    telephone: "+225 07 34 56 78 90"
  },
  {
    prenom: "Aissatou",
    nom: "Sangaré",
    email: "aissatou.sangare@example.ci",
    telephone: "+225 07 45 67 89 01"
  },
  {
    prenom: "Moussa",
    nom: "Cissé",
    email: "moussa.cisse@example.ci",
    telephone: "+225 07 56 78 90 12"
  },
  {
    prenom: "Kadiatou",
    nom: "Diabaté",
    email: "kadiatou.diabate@example.ci",
    telephone: "+225 07 67 89 01 23"
  },
  {
    prenom: "Bakary",
    nom: "Ouattara",
    email: "bakary.ouattara@example.ci",
    telephone: "+225 07 78 90 12 34"
  },
  {
    prenom: "Mariam",
    nom: "Coulibaly",
    email: "mariam.coulibaly@example.ci",
    telephone: "+225 07 89 01 23 45"
  },
  {
    prenom: "Sékou",
    nom: "Touré",
    email: "sekou.toure@example.ci",
    telephone: "+225 07 90 12 34 56"
  },
  {
    prenom: "Aminata",
    nom: "Kouamé",
    email: "aminata.kouame@example.ci",
    telephone: "+225 07 01 23 45 67"
  }
];

async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 12);
}

async function createInscriptions() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("🔗 Connected to database");

    await client.query("BEGIN");

    // Get tenant ID for imhotepdata
    const tenantResult = await client.query(
      "SELECT id FROM tenants WHERE slug = 'imhotepdata'"
    );

    if (tenantResult.rows.length === 0) {
      throw new Error("Tenant 'imhotepdata' not found.");
    }

    const tenantId = tenantResult.rows[0].id;
    console.log(`📋 Using tenant: imhotepdata (${tenantId})`);

    // Get open sessions (statut = 'ouverte')
    console.log("\n📅 Fetching open sessions...");
    const sessionsResult = await client.query(
      `SELECT 
        s.id, 
        s.code_session, 
        s.date_debut, 
        s.date_fin,
        s.places_totales,
        s.places_reservees,
        s.places_disponibles,
        s.prix_ht,
        s.prix_ttc,
        f.titre as formation_titre
       FROM sessions_professionnelles s
       JOIN formations_professionnelles f ON s.formation_pro_id = f.id
       WHERE s.tenant_id = $1 
         AND s.statut = 'ouverte'
         AND s.places_disponibles > 0
       ORDER BY s.date_debut ASC
       LIMIT 10`,
      [tenantId]
    );

    if (sessionsResult.rows.length === 0) {
      throw new Error("No open sessions found. Please create sessions first.");
    }

    console.log(`  ✅ Found ${sessionsResult.rows.length} open sessions`);

    // Create or get apprenants
    console.log("\n👥 Creating/checking apprenants...");
    const apprenantIds: string[] = [];

    for (const apprenant of apprenants) {
      // Check if user exists
      const existingUser = await client.query(
        "SELECT id FROM users WHERE tenant_id = $1 AND email = $2",
        [tenantId, apprenant.email]
      );

      let userId: string;
      if (existingUser.rows.length > 0) {
        userId = existingUser.rows[0].id;
        console.log(`  ✅ Found existing user: ${apprenant.prenom} ${apprenant.nom}`);
      } else {
        // Create user
        const fullName = `${apprenant.prenom} ${apprenant.nom}`;
        const passwordHash = await hashPassword(process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis"); })());
        
        const createUser = await client.query(
          `INSERT INTO users (
            tenant_id, email, name, first_name, last_name, password_hash
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id`,
          [
            tenantId,
            apprenant.email,
            fullName,
            apprenant.prenom,
            apprenant.nom,
            passwordHash
          ]
        );
        userId = createUser.rows[0].id;
        console.log(`  ✅ Created user: ${apprenant.prenom} ${apprenant.nom}`);
      }
      apprenantIds.push(userId);
    }

    // Create inscriptions
    console.log("\n📝 Creating inscriptions...");
    let inscriptionCount = 0;

    const sessions = sessionsResult.rows;
    let apprenantIndex = 0;

    for (const session of sessions) {
      // Create 2-3 inscriptions per session (depending on available places)
      const maxInscriptions = Math.min(
        Math.floor(session.places_disponibles / 2), // Use at most half of available places
        3 // Maximum 3 per session
      );

      for (let i = 0; i < maxInscriptions && apprenantIndex < apprenantIds.length; i++) {
        const apprenantId = apprenantIds[apprenantIndex % apprenantIds.length];
        apprenantIndex++;

        // Generate enrollment number
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const prefix = `INS-DATA-${year}${month}${day}-`;
        
        // Get the highest number for today
        const countQuery = `
          SELECT COALESCE(MAX(CAST(SUBSTRING(numero_inscription FROM LENGTH($1) + 1) AS INTEGER)), 0) + 1 as next_num
          FROM inscriptions_professionnelles
          WHERE tenant_id = $2
            AND numero_inscription LIKE $1 || '%'
        `;
        const countResult = await client.query(countQuery, [prefix, tenantId]);
        const nextNum = countResult.rows[0].next_num;
        const numeroInscription = `${prefix}${String(nextNum).padStart(3, '0')}`;

        // Get pricing from session
        const montantHT = parseFloat(session.prix_ht) || 0;
        const montantTTC = parseFloat(session.prix_ttc) || 0;

        // Determine statut (mix of en_attente and confirmee)
        const statuts: Array<"en_attente" | "confirmee"> = ["en_attente", "confirmee"];
        const statut = statuts[inscriptionCount % 2]; // Alternate between statuses

        // Insert inscription
        const insertInscription = await client.query(
          `INSERT INTO inscriptions_professionnelles (
            tenant_id,
            numero_inscription,
            session_id,
            apprenant_id,
            entreprise_id,
            type_inscription,
            statut,
            montant_ht,
            montant_ttc,
            code_promo_utilise,
            reduction_appliquee,
            date_inscription
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
          RETURNING id, numero_inscription, statut`,
          [
            tenantId,
            numeroInscription,
            session.id,
            apprenantId,
            null, // entreprise_id (null for individual)
            "individuelle",
            statut,
            montantHT,
            montantTTC,
            null, // code_promo_utilise
            0, // reduction_appliquee
          ]
        );

        // Update session places (places_disponibles is a generated column, so we only update places_reservees)
        await client.query(
          `UPDATE sessions_professionnelles
           SET places_reservees = places_reservees + 1,
               updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2`,
          [session.id, tenantId]
        );

        const inscription = insertInscription.rows[0];
        console.log(`  ✅ Created inscription: ${inscription.numero_inscription}`);
        console.log(`     Session: ${session.code_session} (${session.formation_titre})`);
        console.log(`     Statut: ${inscription.statut}`);
        console.log(`     Montant TTC: ${montantTTC}€`);

        inscriptionCount++;
      }
    }

    await client.query("COMMIT");

    console.log("\n🎉 All inscriptions created successfully!");
    console.log(`\n📝 Created ${inscriptionCount} inscriptions for ${sessions.length} sessions`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating inscriptions:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the script
createInscriptions()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });

