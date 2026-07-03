/**
 * Test automatique de bout en bout des routes questions.
 * Lance ce script après le redémarrage de l'API.
 *   node scripts/test-questions-routes.js
 */
const http = require("http");

const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJlY29sZWRpZ2l0YWxlIiwiYXVkIjoiZWNvbGVkaWdpdGFsZSIsInN1YiI6IjM1ZDY2N2I0LWFiZGYtNDBmMS05YjdmLTY1MjM3Nzc2NGVmYSIsInVzZXJJZCI6IjM1ZDY2N2I0LWFiZGYtNDBmMS05YjdmLTY1MjM3Nzc2NGVmYSIsInNjb3BlIjoidGVuYW50X3VzZXIiLCJ0ZW5hbnRJZCI6ImY3M2Y1MjlmLTViMWItNDAyNy04NzdkLWQ0ZGMzNDRkMDgxYiIsInRlbmFudFNsdWciOiJlY29sZWRpZ2l0YWxlIiwicm9sZXMiOlsiYWRtaW4iXSwiYWN0aXZlUm9sZSI6ImFkbWluIiwianRpIjoiNGNiOGU0ZTMtZjVlZC00MTk5LTg1YTYtODQ5Zjk5NDU2ZjBkIiwiaWF0IjoxNzc5ODAxMDM5LCJleHAiOjE3Nzk4ODc0Mzl9.QftHKguLCY_XQcAbtJWzoZCbUZK7NU594AkBlZGUSmg";

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: "localhost",
        port: 4000,
        path,
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const ASSIGNMENT_N1 = "216b5fb6-6c28-4823-83ef-92e668c6c1c9";
  const ASSIGNMENT_IA = "9edfaf7a-7aee-4e7a-96b5-23662fc63a5a";

  console.log("=== 1. GET questions de l'évaluation N1 (4 attendues) ===");
  let r = await req("GET", `/api/v1/professional/assignments/${ASSIGNMENT_N1}/questions`);
  console.log("Status:", r.status);
  if (Array.isArray(r.body?.data)) {
    console.log(`OK : ${r.body.data.length} questions retournées`);
    r.body.data.forEach((q, i) =>
      console.log(`  Q${i + 1} [${q.type}] ${q.points}pt : ${q.question_text.slice(0, 60)}…`)
    );
  } else {
    console.log("ÉCHEC :", JSON.stringify(r.body).slice(0, 300));
  }

  console.log("\n=== 2. POST nouvelle question sur l'évaluation IA brouillon ===");
  r = await req("POST", `/api/v1/professional/assignments/${ASSIGNMENT_IA}/questions`, {
    type: "true_false",
    question_text: "Question test ajoutée via API : la MCV est toujours positive.",
    points: 2,
    options: [
      { id: "true", text: "Vrai" },
      { id: "false", text: "Faux" },
    ],
    correct_answer: "false",
    explanation: "La MCV peut être négative si CV > CA (cas rare mais possible).",
  });
  console.log("Status:", r.status);
  console.log("Body:", JSON.stringify(r.body).slice(0, 300));
  const createdQId = r.body?.data?.id;

  if (createdQId) {
    console.log("\n=== 3. PATCH cette question (modif des points) ===");
    r = await req("PATCH", `/api/v1/professional/questions/${createdQId}`, { points: 5 });
    console.log("Status:", r.status, "| points devenu:", r.body?.data?.points);

    console.log("\n=== 4. DELETE cette question ===");
    r = await req("DELETE", `/api/v1/professional/questions/${createdQId}`);
    console.log("Status:", r.status, "| body:", JSON.stringify(r.body).slice(0, 150));
  }

  console.log("\n=== 5. GET questions de l'éval N2 (6 attendues, incl. mcq_multi) ===");
  r = await req(
    "GET",
    `/api/v1/professional/assignments/55fbe15d-7e5a-4f5c-acd0-49b519c57f50/questions`
  );
  console.log("Status:", r.status);
  if (Array.isArray(r.body?.data)) {
    console.log(`OK : ${r.body.data.length} questions retournées`);
    const types = r.body.data.map((q) => q.type);
    console.log("  Types :", types.join(", "));
  }

  console.log("\n=== ✅ Test terminé ===");
})().catch((e) => {
  console.error("ERREUR :", e.message);
  process.exit(1);
});
