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
}

const formations: FormationData[] = [
  {
    titre: "Formation Développement Web Full Stack",
    description_courte: "Maîtrisez les technologies modernes du développement web frontend et backend",
    objectifs: [
      "Maîtriser les technologies frontend (React, TypeScript)",
      "Développer des APIs REST avec Node.js",
      "Gérer les bases de données (PostgreSQL, MongoDB)",
      "Déployer des applications en production"
    ],
    prerequis: "Connaissances de base en programmation",
    public_cible: "Développeurs débutants et intermédiaires",
    duree_jours: 5,
    duree_heures: 35,
    prix_ht: 2000,
    prix_ttc: 2400,
    type_certification: "Certificat",
    nom_certification: "Certificat Développement Web Full Stack",
    themes: ["Développement", "Web", "Full Stack"],
    niveau: "Intermédiaire"
  },
  {
    titre: "Formation Data Science et Machine Learning",
    description_courte: "Apprenez à analyser des données et créer des modèles de machine learning",
    description_complete: "Formation complète en data science et machine learning. Vous découvrirez comment collecter, nettoyer et analyser des données, puis créer des modèles prédictifs. La formation inclut des projets pratiques avec Python, pandas, scikit-learn et TensorFlow.",
    objectifs: [
      "Maîtriser Python pour la data science",
      "Analyser et visualiser des données",
      "Créer des modèles de machine learning",
      "Déployer des modèles en production"
    ],
    prerequis: "Bases en mathématiques et programmation",
    public_cible: "Data analysts, développeurs, statisticiens",
    duree_jours: 7,
    duree_heures: 49,
    prix_ht: 3000,
    prix_ttc: 3600,
    type_certification: "Diplôme",
    nom_certification: "Diplôme Data Science",
    themes: ["Data Science", "Machine Learning", "Python"],
    niveau: "Avancé"
  },
  {
    titre: "Formation Marketing Digital et E-commerce",
    description_courte: "Développez vos compétences en marketing digital et e-commerce",
    description_complete: "Formation complète sur les stratégies de marketing digital et la gestion d'un e-commerce. Vous apprendrez à créer des campagnes publicitaires efficaces, optimiser le référencement (SEO), utiliser les réseaux sociaux pour le business, et gérer une boutique en ligne.",
    objectifs: [
      "Maîtriser les outils de marketing digital",
      "Créer et gérer des campagnes publicitaires",
      "Optimiser le référencement (SEO/SEA)",
      "Gérer une boutique e-commerce"
    ],
    prerequis: "Aucun prérequis technique",
    public_cible: "Entrepreneurs, marketeurs, responsables communication",
    duree_jours: 4,
    duree_heures: 28,
    prix_ht: 1500,
    prix_ttc: 1800,
    type_certification: "Attestation",
    nom_certification: "Attestation Marketing Digital",
    themes: ["Marketing", "E-commerce", "Digital"],
    niveau: "Débutant"
  },
  {
    titre: "Formation Cloud Computing AWS",
    description_courte: "Maîtrisez les services cloud Amazon Web Services",
    description_complete: "Formation approfondie sur Amazon Web Services (AWS). Vous apprendrez à déployer, gérer et sécuriser des infrastructures cloud. La formation couvre les services essentiels d'AWS : EC2, S3, RDS, Lambda, et bien d'autres. Préparation à la certification AWS.",
    objectifs: [
      "Comprendre l'architecture cloud AWS",
      "Déployer des applications sur AWS",
      "Gérer et sécuriser des infrastructures cloud",
      "Préparer la certification AWS"
    ],
    prerequis: "Connaissances de base en administration système",
    public_cible: "Développeurs, administrateurs système, DevOps",
    duree_jours: 6,
    duree_heures: 42,
    prix_ht: 2500,
    prix_ttc: 3000,
    type_certification: "Certificat",
    nom_certification: "Certificat AWS Cloud Practitioner",
    themes: ["Cloud", "AWS", "DevOps"],
    niveau: "Intermédiaire"
  },
  {
    titre: "Formation Cybersécurité et Ethical Hacking",
    description_courte: "Apprenez à sécuriser les systèmes et détecter les vulnérabilités",
    description_complete: "Formation complète en cybersécurité et ethical hacking. Vous découvrirez les techniques de sécurisation des systèmes, la détection de vulnérabilités, les tests d'intrusion, et la gestion des incidents de sécurité. Formation pratique avec des laboratoires de hacking éthique.",
    objectifs: [
      "Comprendre les menaces de cybersécurité",
      "Sécuriser les systèmes et réseaux",
      "Effectuer des tests d'intrusion",
      "Gérer les incidents de sécurité"
    ],
    prerequis: "Connaissances en réseaux et systèmes",
    public_cible: "Administrateurs système, développeurs, auditeurs sécurité",
    duree_jours: 8,
    duree_heures: 56,
    prix_ht: 3500,
    prix_ttc: 4200,
    type_certification: "Diplôme",
    nom_certification: "Diplôme Cybersécurité",
    themes: ["Cybersécurité", "Ethical Hacking", "Sécurité"],
    niveau: "Avancé"
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

    // Get tenant ID for imhotepdata (tenant that has formations data)
    const tenantResult = await client.query(
      "SELECT id FROM tenants WHERE slug = 'imhotepdata'"
    );

    if (tenantResult.rows.length === 0) {
      throw new Error("Tenant 'imhotepdata' not found. Please run the basic seed script first.");
    }

    const tenantId = tenantResult.rows[0].id;
    console.log(`📋 Using tenant: imhotepdata (${tenantId})`);

    // Get a user ID to use as created_by (use admin user)
    const userResult = await client.query(
      "SELECT id FROM users WHERE tenant_id = $1 AND email LIKE '%admin%' LIMIT 1",
      [tenantId]
    );

    const createdBy = userResult.rows.length > 0 ? userResult.rows[0].id : null;
    console.log(`👤 Using created_by: ${createdBy || 'NULL'}`);

    console.log("\n📝 Creating formations...");

    for (const formation of formations) {
      // Generate unique slug
      let slug = generateSlug(formation.titre);
      let slugSuffix = 1;
      
      // Check if slug exists and make it unique
      while (true) {
        const existingSlug = await client.query(
          "SELECT id FROM formations_professionnelles WHERE tenant_id = $1 AND slug = $2",
          [tenantId, slug]
        );
        
        if (existingSlug.rows.length === 0) {
          break; // Slug is unique
        }
        
        slug = `${generateSlug(formation.titre)}-${slugSuffix}`;
        slugSuffix++;
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
          actif,
          created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, $16)
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
        createdBy,
      ]);

      console.log(`  ✅ Created: ${formation.titre}`);
      console.log(`     ID: ${result.rows[0].id}`);
      console.log(`     Slug: ${result.rows[0].slug}`);
      console.log(`     Prix TTC: ${formation.prix_ttc}€`);
    }

    await client.query("COMMIT");

    console.log("\n🎉 All formations created successfully!");
    console.log(`\n📝 Created ${formations.length} formations:`);
    formations.forEach((formation, index) => {
      console.log(`  ${index + 1}. ${formation.titre} - ${formation.prix_ttc}€ TTC`);
    });

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
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });

