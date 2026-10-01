import { Client } from "pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 12);
}

interface DemoAccount {
  tenant: string;
  email: string;
  password: string;
  role: string;
  firstName: string;
  lastName: string;
}

const demoAccounts: DemoAccount[] = [
  {
    tenant: "imhotepdata",
    email: "admin@imhotepdata.fr",
    password: (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })()),
    role: "admin",
    firstName: "Admin",
    lastName: "Imhotep Data"
  }
];

async function createDemoAccounts() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("ðŸ”— Connected to database");

    await client.query("BEGIN");

    for (const account of demoAccounts) {
      console.log(`\nðŸ“ Processing account: ${account.email} (${account.tenant})`);

      // Get tenant ID
      const tenantResult = await client.query(
        "SELECT id FROM tenants WHERE slug = $1",
        [account.tenant]
      );

      if (tenantResult.rows.length === 0) {
        console.error(`  âŒ Tenant '${account.tenant}' not found. Skipping...`);
        continue;
      }

      const tenantId = tenantResult.rows[0].id;
      console.log(`  ðŸ“‹ Using tenant: ${account.tenant} (${tenantId})`);

      // Get or create role
      let roleId: string;
      const roleResult = await client.query(
        `SELECT id FROM roles WHERE tenant_id = $1 AND key = $2`,
        [tenantId, account.role]
      );

      if (roleResult.rows.length === 0) {
        // Create role if it doesn't exist
        const roleName = account.role === "admin" ? "Administrateur" :
                        account.role === "student" ? "Ã‰tudiant" :
                        account.role === "teacher" ? "Enseignant" :
                        account.role === "parent" ? "Parent" : account.role;
        
        const createRoleResult = await client.query(
          `INSERT INTO roles (tenant_id, key, name)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [tenantId, account.role, roleName]
        );
        roleId = createRoleResult.rows[0].id;
        console.log(`  âœ… Role '${account.role}' created`);
      } else {
        roleId = roleResult.rows[0].id;
        console.log(`  âœ… Role '${account.role}' found`);
      }

      // Create or update user
      const name = account.lastName ? `${account.firstName} ${account.lastName}` : account.firstName;
      const passwordHash = await hashPassword(account.password);
      // Use empty string instead of null for last_name if not provided
      const lastName = account.lastName || "";

      const userResult = await client.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, first_name, last_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, email) DO UPDATE SET
           name = EXCLUDED.name,
           password_hash = EXCLUDED.password_hash,
           first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           updated_at = NOW()
         RETURNING id`,
        [tenantId, account.email, name, passwordHash, account.firstName, lastName]
      );

      const userId = userResult.rows[0].id;
      console.log(`  âœ… User created/updated: ${account.email} (${userId})`);

      // Assign role to user
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, roleId]
      );
      console.log(`  âœ… Role '${account.role}' assigned to user`);

      // If teacher, create teacher record
      if (account.role === "teacher") {
        const teacherCheck = await client.query(
          `SELECT id FROM teachers WHERE user_id = $1 AND tenant_id = $2`,
          [userId, tenantId]
        );

        if (teacherCheck.rows.length === 0) {
          await client.query(
            `INSERT INTO teachers (tenant_id, user_id, first_name, last_name, email, contract_type, status)
             VALUES ($1, $2, $3, $4, $5, 'permanent', 'active')
             ON CONFLICT (tenant_id, email) DO UPDATE SET
               first_name = EXCLUDED.first_name,
               last_name = EXCLUDED.last_name,
               user_id = EXCLUDED.user_id,
               updated_at = NOW()`,
            [tenantId, userId, account.firstName, lastName, account.email]
          );
          console.log(`  âœ… Teacher record created`);
        }
      }
    }

    await client.query("COMMIT");

    console.log("\nðŸŽ‰ All demo accounts created/updated successfully!");
    console.log("\nðŸ“ Demo accounts:");
    demoAccounts.forEach(account => {
      console.log(`  - ${account.email} / ${account.password} (${account.role}, ${account.tenant})`);
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("âŒ Error creating demo accounts:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the script
createDemoAccounts()
  .then(() => {
    console.log("\nâœ… Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nâŒ Script failed:", error);
    process.exit(1);
  });


