const { Client } = require("pg");
require("dotenv").config({ path: ".env" });
(async () => {
  const c = new Client({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "5432", 10),
    database: process.env.DB_NAME || "dbecoledigitale",
    user: process.env.DB_USER || "postgres",
    password:
      process.env.DB_PASSWORD ||
      process.env.POSTGRES_PASSWORD ||
      "mysecretpassword",
  });
  await c.connect();
  const content = `Énoncé du test :

Question 1 — Calculer le coût de revient d'un produit en utilisant la méthode des coûts complets.
Question 2 — Différence entre charges variables et fixes.
Question 3 — Analyser la rentabilité de deux centres de profit.

Rendre la copie au format PDF, 5 pages maximum.`;
  const url =
    "/api/v1/professional/assignments/3a61f2df-f3dc-45f9-b583-a68540e14094/subject-document/00000000-0000-0000-0000-000000000001_sujet_test.txt";
  const r = await c.query(
    `UPDATE professional_assignments
     SET subject_content = $1, subject_document_url = $2, updated_at = now()
     WHERE id = $3
     RETURNING id, titre, subject_content, subject_document_url`,
    [content, url, "3a61f2df-f3dc-45f9-b583-a68540e14094"]
  );
  console.log("UPDATE OK:");
  console.log(JSON.stringify(r.rows[0], null, 2));
  await c.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
