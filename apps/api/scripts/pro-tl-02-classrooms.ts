/**
 * ÉTAPE 2 — Salles de classe (page /academic/classrooms).
 *
 * Crée les salles dédiées au parcours Transport-Logistique, avec le même jeu de
 * colonnes que POST /api/v1/classrooms. Idempotent : l'unicité (tenant_id, code)
 * est respectée via ON CONFLICT DO NOTHING.
 *
 * Depuis apps/api : npx tsx scripts/pro-tl-02-classrooms.ts
 */
import { getTenantId, log, makePool } from "./pro-tl-common";

interface Salle {
  code: string;
  name: string;
  type: string;
  capacity: number;
  floor: number;
  building: string;
  description: string;
  equipment: string[];
}

const SALLES: Salle[] = [
  {
    code: "TL-AMPHI-A",
    name: "Amphithéâtre Transport-Logistique A",
    type: "amphitheatre",
    capacity: 120,
    floor: 0,
    building: "Bâtiment Logistique",
    description: "Amphi des cours magistraux Supply Chain et Transport multimodal.",
    equipment: ["Vidéoprojecteur", "Sonorisation", "Tableau blanc", "Climatisation"],
  },
  {
    code: "TL-101",
    name: "Salle TL 101",
    type: "salle_cours",
    capacity: 40,
    floor: 1,
    building: "Bâtiment Logistique",
    description: "Salle de cours et travaux dirigés.",
    equipment: ["Vidéoprojecteur", "Tableau blanc"],
  },
  {
    code: "TL-102",
    name: "Salle TL 102",
    type: "salle_cours",
    capacity: 40,
    floor: 1,
    building: "Bâtiment Logistique",
    description: "Salle de cours et travaux dirigés.",
    equipment: ["Vidéoprojecteur", "Tableau blanc"],
  },
  {
    code: "TL-INFO-1",
    name: "Salle informatique Logistique 1",
    type: "salle_informatique",
    capacity: 30,
    floor: 2,
    building: "Bâtiment Logistique",
    description: "Postes équipés pour la data logistique, l'IA appliquée et les ERP/WMS.",
    equipment: ["30 postes", "Vidéoprojecteur", "Climatisation", "Réseau haut débit"],
  },
  {
    code: "TL-INFO-2",
    name: "Salle informatique Logistique 2",
    type: "salle_informatique",
    capacity: 25,
    floor: 2,
    building: "Bâtiment Logistique",
    description: "Salle de simulation et optimisation (recherche opérationnelle).",
    equipment: ["25 postes", "Vidéoprojecteur", "Climatisation"],
  },
  {
    code: "TL-ATELIER",
    name: "Atelier Entrepôt pédagogique",
    type: "atelier",
    capacity: 24,
    floor: 0,
    building: "Hangar pédagogique",
    description: "Entrepôt école : réception, stockage, préparation de commandes.",
    equipment: ["Rayonnages", "Transpalette", "Douchettes code-barres", "Postes de picking"],
  },
  {
    code: "TL-SEM-1",
    name: "Salle de séminaire Logistique",
    type: "salle_reunion",
    capacity: 20,
    floor: 3,
    building: "Bâtiment Logistique",
    description: "Soutenances de mémoire, séminaires et jurys.",
    equipment: ["Écran", "Visioconférence", "Table de réunion"],
  },
];

async function main() {
  const pool = makePool();
  const tenantId = await getTenantId(pool);

  try {
    let created = 0;
    let skipped = 0;
    for (const s of SALLES) {
      const r = await pool.query(
        `INSERT INTO classrooms
           (tenant_id, name, code, type, capacity, floor, building,
            description, equipment, status, is_active)
         VALUES ($1,$2,$3,$4::classroom_type,$5,$6,$7,$8,$9,'disponible'::classroom_status,true)
         ON CONFLICT (tenant_id, code) DO NOTHING
         RETURNING id`,
        [
          tenantId,
          s.name,
          s.code,
          s.type,
          s.capacity,
          s.floor,
          s.building,
          s.description,
          s.equipment,
        ]
      );
      if (r.rowCount) {
        created++;
        log(`  + ${s.code} — ${s.name} (${s.type}, ${s.capacity} places)`);
      } else {
        skipped++;
        log(`  = ${s.code} déjà présente`);
      }
    }
    log(`\n${created} salle(s) créée(s), ${skipped} ignorée(s).`);

    const total = await pool.query(
      `SELECT count(*)::int AS n FROM classrooms WHERE tenant_id = $1 AND is_active`,
      [tenantId]
    );
    log(`Total salles actives du tenant : ${total.rows[0].n}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
