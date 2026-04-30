import { Client } from "pg";

const connectionString = process.env.DATABASE_URL ||
  "postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale";

interface FormationData {
  titre: string;
  description_courte: string;
  objectifs: string[];
  prerequis?: string;
  public_cible?: string;
  duree_jours?: number;
  duree_heures?: number;
  prix_ht?: number;
  prix_ttc: number;
  type_certification?: string;
  nom_certification?: string;
  themes: string[];
  niveau?: "Débutant" | "Intermédiaire" | "Avancé";
  carriere: string;
  dispositifs_pedagogiques?: string;
}

const formations: FormationData[] = [
  {
    titre: "Diplôme supérieur d'Ingénierie IA et big data",
    description_courte: "Maîtriser les technologies avancées et résoudre des problèmes complexes en IA et big data.",
    objectifs: [
      "Maîtriser les technologies avancées en IA et big data",
      "Résoudre des problèmes complexes en IA et big data",
      "Développer des compétences d'ingénierie en intelligence artificielle",
      "Maîtriser les outils et frameworks du big data"
    ],
    prerequis: "Bac Scientifique, Bac+2 minimum, en informatique, Télécom, Mathématiques, Économie",
    public_cible: "Informaticiens, Travailleurs, Étudiants",
    duree_jours: 730, // 2 ans = environ 730 jours (365 jours/an * 2)
    prix_ht: 2000000,
    prix_ttc: 2000000,
    type_certification: "Diplôme",
    nom_certification: "Diplôme supérieur d'Ingénierie IA et big data",
    themes: ["Intelligence Artificielle", "Big Data", "Ingénierie", "Data Science"],
    niveau: "Avancé",
    carriere: "LES FORMATIONS DIPLÔMANTES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Test de sélection. Disposer d'un ordinateur portable puissant* (Minimum: Core i5/8e Génération minimum/16 Go Ram/500 Go // Ryzen 5/16 Go/500Go // Apple M1/16Go/500 Go)"
  },
  {
    titre: "Licence en Intelligence Artificielle Appliquée",
    description_courte: "Maîtriser les dernières technologies en IA.",
    objectifs: [
      "Maîtriser les dernières technologies en IA",
      "Appliquer l'intelligence artificielle dans des contextes réels",
      "Développer des compétences pratiques en IA",
      "Comprendre les enjeux et applications de l'IA"
    ],
    prerequis: "Bac Scientifique",
    public_cible: "Informaticiens, Travailleurs, Étudiants",
    duree_jours: 365, // 1 an = environ 365 jours
    prix_ht: 950000,
    prix_ttc: 950000,
    type_certification: "Diplôme",
    nom_certification: "Licence en Intelligence Artificielle Appliquée",
    themes: ["Intelligence Artificielle", "IA Appliquée", "Machine Learning"],
    niveau: "Avancé",
    carriere: "LES FORMATIONS DIPLÔMANTES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Test de sélection. Disposer d'un ordinateur portable puissant* (Minimum: Core i5/8e Génération minimum/16 Go Ram/500 Go // Ryzen 5/16 Go/500Go // Apple M1/16Go/500 Go)"
  },
  {
    titre: "Licence professionnelle en Big Data",
    description_courte: "Maîtriser les dernières technologies en big data.",
    objectifs: [
      "Maîtriser les dernières technologies en big data",
      "Gérer et analyser de grands volumes de données",
      "Utiliser les outils et frameworks du big data",
      "Développer des compétences professionnelles en big data"
    ],
    prerequis: "Bac Scientifique",
    public_cible: "Informaticiens, Travailleurs, Étudiants",
    duree_jours: 365, // 1 an = environ 365 jours
    prix_ht: 950000,
    prix_ttc: 950000,
    type_certification: "Diplôme",
    nom_certification: "Licence professionnelle en Big Data",
    themes: ["Big Data", "Data Engineering", "Data Analytics", "Hadoop", "Spark"],
    niveau: "Avancé",
    carriere: "LES FORMATIONS DIPLÔMANTES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Test de sélection. Disposer d'un ordinateur portable puissant* (Minimum: Core i5/8e Génération minimum/16 Go Ram/500 Go // Ryzen 5/16 Go/500Go // Apple M1/16Go/500 Go)"
  },
  {
    titre: "Certificat Technico-fonctionnel",
    description_courte: "Gérer les projets, le prototypage d'application et avoir les bases en intelligence artificielle.",
    objectifs: [
      "Gérer les projets technico-fonctionnels",
      "Maîtriser le prototypage d'application",
      "Acquérir les bases en intelligence artificielle",
      "Développer des compétences techniques et fonctionnelles"
    ],
    prerequis: "Bac",
    public_cible: "Informaticiens, Travailleurs, Étudiants",
    duree_jours: 120, // 4 mois = environ 120 jours (30 jours/mois * 4)
    prix_ht: 1000000,
    prix_ttc: 1000000,
    type_certification: "Certificat",
    nom_certification: "Certificat Technico-fonctionnel",
    themes: ["Gestion de Projets", "Prototypage", "Intelligence Artificielle", "Développement"],
    niveau: "Intermédiaire",
    carriere: "LES FORMATIONS DIPLÔMANTES d'IMHOTEP DATA",
    dispositifs_pedagogiques: "Test de sélection. Disposer d'un ordinateur portable."
  }
];

function generateSlug(titre: string): string {
  return titre
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, ""); // Remove leading/trailing hyphens
}

async function createFormations() {
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
      throw new Error("Tenant 'imhotepdata' not found");
    }

    const tenantId = tenantResult.rows[0].id;
    console.log(`📋 Using tenant: imhotepdata (${tenantId})`);
    console.log("");

    let createdCount = 0;
    let skippedCount = 0;

    for (const formation of formations) {
      const slug = generateSlug(formation.titre);

      // Check if formation already exists
      const existingCheck = await client.query(
        "SELECT id FROM formations_professionnelles WHERE tenant_id = $1 AND slug = $2",
        [tenantId, slug]
      );

      if (existingCheck.rows.length > 0) {
        console.log(`⏭️  Skipping: ${formation.titre} (already exists)`);
        skippedCount++;
        continue;
      }

      // Build description_complete from dispositifs_pedagogiques if available
      let description_complete = formation.description_courte;
      if (formation.dispositifs_pedagogiques) {
        description_complete += "\n\nDispositifs pédagogiques particuliers :\n" + formation.dispositifs_pedagogiques;
      }

      const insertQuery = `
        INSERT INTO formations_professionnelles (
          tenant_id,
          titre,
          slug,
          description_courte,
          objectifs,
          prerequis,
          public_cible,
          duree_jours,
          duree_heures,
          prix_ht,
          prix_ttc,
          type_certification,
          nom_certification,
          themes,
          niveau,
          carriere,
          actif,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, true, $17)
        RETURNING id, slug, titre
      `;

      const result = await client.query(insertQuery, [
        tenantId,
        formation.titre,
        slug,
        formation.description_courte,
        JSON.stringify(formation.objectifs),
        formation.prerequis || null,
        formation.public_cible || null,
        formation.duree_jours || null,
        formation.duree_heures || null,
        formation.prix_ht || null,
        formation.prix_ttc,
        formation.type_certification || null,
        formation.nom_certification || null,
        JSON.stringify(formation.themes),
        formation.niveau || null,
        formation.carriere,
        null, // created_by
      ]);

      createdCount++;
      console.log(`✅ Created: ${formation.titre}`);
    }

    await client.query("COMMIT");

    console.log("");
    console.log("📊 Summary:");
    console.log(`   ✅ Created: ${createdCount} formations`);
    console.log(`   ⏭️  Skipped: ${skippedCount} formations (already exist)`);
    console.log("");
    console.log("✅ All formations created successfully!");

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error creating formations:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the script
createFormations()
  .then(() => {
    console.log("🎉 Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Script failed:", error);
    process.exit(1);
  });

