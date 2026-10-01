import { Client } from "pg";
import bcrypt from "bcryptjs";

const connectionString = process.env.DATABASE_URL ||
  (() => { throw new Error("DATABASE_URL est requis (voir .env.example)"); })();

async function resetDemoPasswords() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log("🔗 Connected to database");

    const password = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());
    const passwordHash = await bcrypt.hash(password, 12);
    
    // Special password for teacher account
    const teacherPassword = (process.env.SEED_PASSWORD || (() => { throw new Error("SEED_PASSWORD est requis (mot de passe des comptes de démonstration)"); })());
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
    console.log("   - Tous les comptes : valeur de SEED_PASSWORD");
  } catch (err) {
    console.error("❌ Error resetting passwords:", err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

resetDemoPasswords();

