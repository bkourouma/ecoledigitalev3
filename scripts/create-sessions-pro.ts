import { Client } from "pg";

const connectionString = process.env.DATABASE_URL ||
  "postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale";

interface SessionData {
  formation_id: string;
  formation_titre: string;
  date_debut: string; // YYYY-MM-DD
  date_fin: string; // YYYY-MM-DD
  horaires: string;
  mode_formation: "presentiel" | "distanciel" | "hybride";
  lieu?: string;
  lien_visio?: string;
  places_totales: number;
  statut: "planifiee" | "ouverte";
}

function getFutureDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
}

function getEndDate(startDate: string, days: number): string {
  const date = new Date(startDate);
  date.setDate(date.getDate() + days - 1);
  return date.toISOString().split('T')[0];
}

async function createSessions() {
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

    // Get all formations we created
    console.log("\n📚 Fetching formations...");
    const formationsResult = await client.query(
      `SELECT id, titre, duree_jours, duree_heures, prix_ht, prix_ttc
       FROM formations_professionnelles
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [tenantId]
    );

    if (formationsResult.rows.length === 0) {
      throw new Error("No formations found. Please create formations first.");
    }

    console.log(`  ✅ Found ${formationsResult.rows.length} formations`);

    // Check if formateurs exist, create some if needed
    console.log("\n👨‍🏫 Checking formateurs...");
    const formateursResult = await client.query(
      `SELECT id, nom, prenom, email
       FROM formateurs
       WHERE tenant_id = $1 AND actif = true
       LIMIT 5`,
      [tenantId]
    );

    let formateurIds: string[] = formateursResult.rows.map((row: any) => row.id);

    if (formateurIds.length === 0) {
      console.log("  ⚠️  No formateurs found. Creating formateurs...");
      
      const formateursToCreate = [
        {
          nom: "Martin",
          prenom: "Jean",
          email: "jean.martin@imhotepdata.fr",
          specialites: ["Développement Web", "Full Stack"],
          bio: "Expert en développement web avec 10 ans d'expérience"
        },
        {
          nom: "Dubois",
          prenom: "Sophie",
          email: "sophie.dubois@imhotepdata.fr",
          specialites: ["Data Science", "Machine Learning"],
          bio: "Data scientist spécialisée en machine learning et IA"
        },
        {
          nom: "Bernard",
          prenom: "Pierre",
          email: "pierre.bernard@imhotepdata.fr",
          specialites: ["Marketing Digital", "E-commerce"],
          bio: "Consultant en marketing digital et stratégie e-commerce"
        },
        {
          nom: "Petit",
          prenom: "Marie",
          email: "marie.petit@imhotepdata.fr",
          specialites: ["Cloud Computing", "AWS"],
          bio: "Architecte cloud certifiée AWS avec expertise en DevOps"
        },
        {
          nom: "Moreau",
          prenom: "Thomas",
          email: "thomas.moreau@imhotepdata.fr",
          specialites: ["Cybersécurité", "Ethical Hacking"],
          bio: "Expert en cybersécurité et tests d'intrusion"
        }
      ];

      for (const formateur of formateursToCreate) {
        const insertFormateur = await client.query(
          `INSERT INTO formateurs (
            tenant_id, nom, prenom, email, specialites, bio, actif
          )
          VALUES ($1, $2, $3, $4, $5, $6, true)
          ON CONFLICT (tenant_id, email) DO UPDATE SET
            nom = EXCLUDED.nom,
            prenom = EXCLUDED.prenom,
            specialites = EXCLUDED.specialites,
            bio = EXCLUDED.bio,
            updated_at = NOW()
          RETURNING id`,
          [
            tenantId,
            formateur.nom,
            formateur.prenom,
            formateur.email,
            JSON.stringify(formateur.specialites),
            formateur.bio
          ]
        );
        formateurIds.push(insertFormateur.rows[0].id);
        console.log(`  ✅ Created formateur: ${formateur.prenom} ${formateur.nom}`);
      }
    } else {
      console.log(`  ✅ Found ${formateurIds.length} existing formateurs`);
    }

    // Create sessions for each formation
    console.log("\n📅 Creating sessions...");

    const formations = formationsResult.rows;
    let sessionCount = 0;

    for (let i = 0; i < formations.length; i++) {
      const formation = formations[i];
      const dureeJours = formation.duree_jours || Math.ceil((formation.duree_heures || 35) / 7);

      // Create 2 sessions per formation (one in 30 days, one in 60 days)
      for (let sessionNum = 0; sessionNum < 2; sessionNum++) {
        const daysFromNow = 30 + (sessionNum * 30) + (i * 10); // Stagger dates
        const dateDebut = getFutureDate(daysFromNow);
        const dateFin = getEndDate(dateDebut, dureeJours);

        // Assign formateur based on formation theme
        const formateurIndex = i % formateurIds.length;
        const formateurId = formateurIds[formateurIndex];

        // Determine mode and location based on formation
        // Database enum uses English values: presential, remote, hybrid
        const modes: Array<"presential" | "remote" | "hybrid"> = ["presential", "hybrid", "remote"];
        const modeFormation = modes[i % modes.length];
        
        const lieu = modeFormation === "presential" || modeFormation === "hybrid"
          ? "Centre de formation Imhotep Data, Abidjan"
          : null;
        
        const lienVisio = modeFormation === "remote" || modeFormation === "hybrid"
          ? "https://meet.imhotepdata.ci/session-" + (sessionCount + 1)
          : null;

        // Generate session code (will be auto-generated by trigger, but we can set it)
        const year = new Date(dateDebut).getFullYear();
        const formationCode = formation.titre
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .substring(0, 4);
        const codeSession = `${formationCode}-${year}-${String(sessionCount + 1).padStart(3, '0')}`;

        // Insert session
        const insertSession = await client.query(
          `INSERT INTO sessions_professionnelles (
            tenant_id,
            formation_pro_id,
            code_session,
            date_debut,
            date_fin,
            horaires,
            mode_formation,
            lieu,
            lien_visio,
            places_totales,
            places_reservees,
            prix_ht,
            prix_ttc,
            statut,
            notes_internes
          )
          VALUES ($1, $2, $3, $4, $5, $6, CAST($7 AS delivery_mode), $8, $9, $10, 0, $11, $12, $13, $14)
          RETURNING id, code_session`,
          [
            tenantId,
            formation.id,
            codeSession,
            dateDebut,
            dateFin,
            "9h00 - 17h00",
            modeFormation, // presential, remote, or hybrid
            lieu,
            lienVisio,
            20, // places_totales
            formation.prix_ht || null,
            formation.prix_ttc || null,
            sessionNum === 0 ? "ouverte" : "planifiee", // First session is "ouverte", second is "planifiee"
            `Session de formation ${formation.titre}`
          ]
        );

        const sessionId = insertSession.rows[0].id;

        // Assign formateur to session
        await client.query(
          `INSERT INTO session_formateurs (
            tenant_id,
            session_id,
            formateur_id,
            role
          )
          VALUES ($1, $2, $3, 'principal')
          ON CONFLICT (tenant_id, session_id, formateur_id) DO NOTHING`,
          [tenantId, sessionId, formateurId]
        );

        console.log(`  ✅ Created session: ${codeSession}`);
        console.log(`     Formation: ${formation.titre}`);
        console.log(`     Dates: ${dateDebut} au ${dateFin}`);
        console.log(`     Mode: ${modeFormation}`);
        console.log(`     Places: 20`);
        console.log(`     Statut: ${sessionNum === 0 ? "ouverte" : "planifiee"}`);

        sessionCount++;
      }
    }

    await client.query("COMMIT");

    console.log("\n🎉 All sessions created successfully!");
    console.log(`\n📝 Created ${sessionCount} sessions for ${formations.length} formations`);

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating sessions:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the script
createSessions()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });

