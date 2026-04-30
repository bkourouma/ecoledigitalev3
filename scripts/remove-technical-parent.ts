import { Client } from "pg";

type Args = {
  email: string;
  tenantSlug?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    email: "parent@imhotep.local",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--email" && argv[index + 1]) {
      args.email = argv[index + 1].trim().toLowerCase();
      index += 1;
      continue;
    }

    if (value === "--tenant" && argv[index + 1]) {
      args.tenantSlug = argv[index + 1].trim().toLowerCase();
      index += 1;
    }
  }

  return args;
}

function resolveConnectionString(): string {
  return process.env.DATABASE_URL || "postgresql://postgres:DevMick@2003@localhost:5432/dbecoledigitale";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new Client({
    connectionString: resolveConnectionString(),
  });

  await client.connect();

  try {
    await client.query("BEGIN");

    const found = await client.query<{
      id: string;
      tenant_id: string;
      tenant_slug: string;
      email: string;
      is_technical_account: boolean;
    }>(
      `
        SELECT
          u.id,
          u.tenant_id,
          t.slug AS tenant_slug,
          u.email,
          COALESCE(u.is_technical_account, false) AS is_technical_account
        FROM users u
        INNER JOIN tenants t ON t.id = u.tenant_id
        WHERE LOWER(u.email) = LOWER($1)
          AND ($2::text IS NULL OR LOWER(t.slug) = LOWER($2))
        ORDER BY u.created_at DESC
      `,
      [args.email, args.tenantSlug ?? null]
    );

    if (found.rows.length === 0) {
      await client.query("ROLLBACK");
      console.log(
        JSON.stringify(
          {
            deleted: 0,
            message: "Aucun parent correspondant n'a ete trouve.",
            email: args.email,
            tenant: args.tenantSlug ?? null,
          },
          null,
          2
        )
      );
      return;
    }

    const deleted: Array<{ id: string; tenantSlug: string; email: string; isTechnicalAccount: boolean }> = [];

    for (const row of found.rows) {
      await client.query("DELETE FROM users WHERE id = $1 AND tenant_id = $2", [row.id, row.tenant_id]);
      deleted.push({
        id: row.id,
        tenantSlug: row.tenant_slug,
        email: row.email,
        isTechnicalAccount: row.is_technical_account,
      });
    }

    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          deleted: deleted.length,
          rows: deleted,
          warning:
            "Les comptes techniques peuvent etre recrees automatiquement par le provisionnement du tenant. L'interface doit donc aussi les filtrer cote API.",
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
  console.error(error);
  process.exit(1);
});
