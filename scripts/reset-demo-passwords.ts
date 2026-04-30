import { Client } from "pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ||
  "postgresql://postgres:mysecretpassword@localhost:5432/dbecoledigitale";

async function resetDemoPasswords() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log("🔗 Connected to database");

    const password = "Passw0rd!admin";
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Special password for teacher account
    const teacherPassword = "Passw0rd!teacher";
    const teacherPasswordHash = await bcrypt.hash(teacherPassword, 12);

    // Demo tenants and emails to update
    const tenants = ["imhotepacademy", "imhotepdata", "aspci"];
    const teacherEmails: string[] = [
      "kouadio.assi@ecoledigitale.ci" // teacher demo - uses different password
    ];

    // Update admin/student/parent for each tenant
    for (const slug of tenants) {
      const emails = [
        `admin@${slug}.fr`,
        `student@${slug}.fr`,
        `parent@${slug}.fr`,
      ];
      for (const email of emails) {
        const res = await client.query(
          `UPDATE users SET password_hash = $1, updated_at = NOW()
           WHERE email = $2
           RETURNING email`,
          [passwordHash, email]
        );
        if (res.rowCount) console.log(`✅ Updated ${email}`);
        else console.log(`ℹ️  Skipped (not found): ${email}`);
      }
    }

    // Update teacher accounts with special password
    for (const email of teacherEmails) {
      const res = await client.query(
        `UPDATE users SET password_hash = $1, updated_at = NOW()
         WHERE email = $2
         RETURNING email`,
        [teacherPasswordHash, email]
      );
      if (res.rowCount) console.log(`✅ Updated ${email} (teacher password)`);
      else console.log(`ℹ️  Skipped (not found): ${email}`);
    }

    console.log("\n🎉 All demo passwords reset:");
    console.log("   - Admin/Student/Parent: Passw0rd!admin");
    console.log("   - Teacher accounts: Passw0rd!teacher");
  } catch (err) {
    console.error("❌ Error resetting passwords:", err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

resetDemoPasswords();

