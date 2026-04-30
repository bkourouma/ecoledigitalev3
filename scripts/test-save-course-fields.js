const { Client } = require("pg");

async function main() {
  const client = new Client({
    connectionString: "postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale",
  });

  await client.connect();
  await client.query("BEGIN");

  try {
    const tenantResult = await client.query(
      "SELECT id, slug FROM tenants WHERE slug = $1 LIMIT 1",
      ["imhotepacademy"]
    );

    if (tenantResult.rows.length === 0) {
      throw new Error("Tenant 'imhotepacademy' introuvable.");
    }

    const tenantId = tenantResult.rows[0].id;

    const programmeResult = await client.query(
      "SELECT id, name FROM programmes WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1",
      [tenantId]
    );

    if (programmeResult.rows.length === 0) {
      throw new Error(
        "Aucun programme trouvé pour ce tenant. Crée un programme avant de lancer ce test."
      );
    }

    const programmeId = programmeResult.rows[0].id;
    const timestamp = Date.now();
    const name = `TEST MATIERE ${timestamp}`;
    const code = `TEST-MAT-${String(timestamp).slice(-8)}`;

    const insertQuery = `
      INSERT INTO courses (
        tenant_id, programme_id, name, code, cm, td, tp, coef, vhh,
        description, objectives, hours_total, hours_theory, hours_practical,
        delivery_mode, prerequisites, evaluation_methods, resources, status
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19
      )
      RETURNING id, tenant_id, programme_id, name, code, cm, td, tp, coef, vhh, created_at
    `;

    const insertValues = [
      tenantId,
      programmeId,
      name,
      code,
      "20h",
      "10h",
      "8h",
      0,
      "38h",
      "Test insertion nouveaux champs",
      [],
      1,
      0,
      0,
      "presential",
      [],
      [],
      {},
      "active",
    ];

    const inserted = await client.query(insertQuery, insertValues);
    const row = inserted.rows[0];

    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          ok: true,
          insertedCourse: {
            id: row.id,
            name: row.name,
            code: row.code,
            cm: row.cm,
            td: row.td,
            tp: row.tp,
            coef: row.coef,
            vhh: row.vhh,
            createdAt: row.created_at,
          },
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
      },
      null,
      2
    )
  );
  process.exit(1);
});
