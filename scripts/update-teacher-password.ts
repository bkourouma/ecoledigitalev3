import { Client } from "pg";
import bcrypt from "bcryptjs";

const connectionString = "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale";

async function updateTeacherPassword() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log("🔗 Connected to database");

    const email = "kouadio.assi@ecoledigitale.ci";
    const password = "Passw0rd!teacher";
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await client.query(
      `UPDATE users 
       SET password_hash = $1, updated_at = NOW()
       WHERE email = $2 AND tenant_id = '6eb9c106-b650-4398-b6fa-091b6828c4ba'
       RETURNING id, email, first_name, last_name`,
      [passwordHash, email]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      console.log(`✅ Password updated for: ${user.first_name} ${user.last_name} (${user.email})`);
      console.log(`\n📝 Teacher Login Credentials:`);
      console.log(`Email: ${email}`);
      console.log(`Password: ${password}`);
    } else {
      console.log(`❌ User not found: ${email}`);
    }

  } catch (error) {
    console.error("❌ Error updating password:", error);
  } finally {
    await client.end();
  }
}

updateTeacherPassword();

