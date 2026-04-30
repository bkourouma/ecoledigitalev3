/**
 * Enregistre des enseignants avec des noms plausibles en Côte d'Ivoire (Baoulé, nord, etc.).
 * Tenant : celui du programme LP RIGL si présent, sinon imhotepacademy.
 *
 * Depuis apps/api : npx tsx scripts/seed-teachers-cote-divoire.ts
 */
import "dotenv/config";
import { Client } from "pg";

const TENANT_SLUG_FALLBACK = "imhotepacademy";

type Row = {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  specialties: string[];
  bio: string;
  qualifications: string[];
};

const TEACHERS: Row[] = [
  {
    employeeNumber: "CI-ENS-001",
    firstName: "Koffi",
    lastName: "N'Guessan",
    email: "koffi.nguessan.ci@example.com",
    phone: "+2250701120304",
    specialties: ["Réseaux", "Systèmes"],
    bio: "Enseignant en infrastructures réseau et administration système.",
    qualifications: ["Master Réseaux et télécoms"],
  },
  {
    employeeNumber: "CI-ENS-002",
    firstName: "Aminata",
    lastName: "Koné",
    email: "aminata.kone.ci@example.com",
    phone: "+2250502233445",
    specialties: ["Bases de données", "SQL"],
    bio: "Spécialiste modélisation Merise et développement sous SGBDR.",
    qualifications: ["Master informatique", "Ingénieur logiciel"],
  },
  {
    employeeNumber: "CI-ENS-003",
    firstName: "Akissi",
    lastName: "Kouadio",
    email: "akissi.kouadio.ci@example.com",
    phone: "+2250703344556",
    specialties: ["Algorithmique", "Python"],
    bio: "Cours d'algorithmique et structures de données.",
    qualifications: ["Doctorat informatique"],
  },
  {
    employeeNumber: "CI-ENS-004",
    firstName: "Issouf",
    lastName: "Traoré",
    email: "issouf.traore.ci@example.com",
    phone: "+2250704455667",
    specialties: ["Mathématiques appliquées", "Excel"],
    bio: "Algèbre linéaire et outils numériques pour la gestion.",
    qualifications: ["Master mathématiques"],
  },
  {
    employeeNumber: "CI-ENS-005",
    firstName: "Adama",
    lastName: "Ouattara",
    email: "adama.ouattara.ci@example.com",
    phone: "+2250705566778",
    specialties: ["Développement web", "PHP"],
    bio: "Développement d'applications web et bases MySQL.",
    qualifications: ["Master GL", "Certification web"],
  },
  {
    employeeNumber: "CI-ENS-006",
    firstName: "Bakary",
    lastName: "Diabaté",
    email: "bakary.diabate.ci@example.com",
    phone: "+2250706677889",
    specialties: ["C#", ".NET"],
    bio: "Programmation orientée objet et frameworks Microsoft.",
    qualifications: ["Ingénieur en informatique"],
  },
  {
    employeeNumber: "CI-ENS-007",
    firstName: "Kouassi",
    lastName: "Yao",
    email: "kouassi.yao.ci@example.com",
    phone: "+2250707788990",
    specialties: ["Linux", "Windows Server"],
    bio: "Administration système et virtualisation.",
    qualifications: ["Master systèmes et réseaux"],
  },
  {
    employeeNumber: "CI-ENS-008",
    firstName: "Mensah",
    lastName: "Adjobi",
    email: "mensah.adjobi.ci@example.com",
    phone: "+2250708899001",
    specialties: ["Anglais technique", "Communication"],
    bio: "Anglais de spécialité informatique et professionnel.",
    qualifications: ["CAPES", "Master LLCE anglais"],
  },
  {
    employeeNumber: "CI-ENS-009",
    firstName: "Aïcha",
    lastName: "Touré",
    email: "aicha.toure.ci@example.com",
    phone: "+2250709900112",
    specialties: ["Théorie des graphes", "RO"],
    bio: "Recherche opérationnelle et optimisation.",
    qualifications: ["Master mathématiques appliquées"],
  },
  {
    employeeNumber: "CI-ENS-010",
    firstName: "Salifou",
    lastName: "Bamba",
    email: "salifou.bamba.ci@example.com",
    phone: "+2250710011223",
    specialties: ["Droit des TIC", "Cybersécurité"],
    bio: "Cadre juridique du numérique et protection des données.",
    qualifications: ["Master droit du numérique"],
  },
  {
    employeeNumber: "CI-ENS-011",
    firstName: "Geneviève",
    lastName: "Assi",
    email: "genevieve.assi.ci@example.com",
    phone: "+2250711122334",
    specialties: ["Marchés financiers", "Bourse"],
    bio: "Pratique de la bourse et finance pour informaticiens.",
    qualifications: ["Master finance", "Certification AMF"],
  },
  {
    employeeNumber: "CI-ENS-012",
    firstName: "Inès",
    lastName: "Gondo",
    email: "ines.gondo.ci@example.com",
    phone: "+2250712233445",
    specialties: ["Réseaux avancés", "Sécurité réseau"],
    bio: "Fondements et sécurisation des réseaux d'entreprise.",
    qualifications: ["Master réseaux informatiques"],
  },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL est absent. Définissez-le dans apps/api/.env");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const prog = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM programmes
       WHERE name ILIKE '%Réseaux Informatiques%' AND name ILIKE '%Génie Logiciel%'
       LIMIT 1`
    );

    let tenantId: string | undefined = prog.rows[0]?.tenant_id;
    if (!tenantId) {
      const t = await client.query<{ id: string }>(
        `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
        [TENANT_SLUG_FALLBACK]
      );
      tenantId = t.rows[0]?.id;
    }

    if (!tenantId) {
      throw new Error(
        "Aucun tenant trouvé (programme LP RIGL ou slug imhotepacademy)."
      );
    }

    const slugRes = await client.query<{ slug: string }>(
      `SELECT slug FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const slug = slugRes.rows[0]?.slug ?? "(inconnu)";
    console.log(`Tenant: ${slug} (${tenantId})\n`);

    let inserted = 0;
    let skipped = 0;

    for (const row of TEACHERS) {
      const r = await client.query(
        `INSERT INTO teachers (
           tenant_id, user_id, employee_number, first_name, last_name,
           email, phone, specialties, bio, qualifications,
           hire_date, contract_type, hourly_rate, status
         )
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
         ON CONFLICT (tenant_id, email) DO NOTHING
         RETURNING id`,
        [
          tenantId,
          row.employeeNumber,
          row.firstName,
          row.lastName,
          row.email,
          row.phone,
          row.specialties,
          row.bio,
          row.qualifications,
          "2024-09-01",
          "permanent",
          45.0,
        ]
      );
      if (r.rowCount && r.rows.length > 0) {
        inserted++;
        console.log(`  + ${row.firstName} ${row.lastName} (${row.email})`);
      } else {
        skipped++;
        console.log(`  = déjà présent : ${row.firstName} ${row.lastName} (${row.email})`);
      }
    }

    console.log(`\nTerminé : ${inserted} créé(s), ${skipped} ignoré(s) (doublon e-mail).`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
