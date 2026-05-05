// End-to-end smoke test for the teacher live-session flow.
// Drives Chromium via Playwright. Logs every step + writes screenshots to ./e2e-screenshots/.
//
// Usage: node scripts/test-live-session-e2e.mjs
//   WEB=http://localhost:3010 (default)

import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const WEB = process.env.WEB || "http://localhost:3010";
const TEACHER = { email: "koffi.nguessan.ci@example.com", password: "Password@2025" };
const STUDENT = { email: "fabrice.kouadio.lprigla01@example.com", password: "?DbFJ3EkSmA9" };
const SHOTS = "./e2e-screenshots";
mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log("·", ...a);

async function shot(page, name) {
  const path = join(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  log(`📸 ${path}`);
}

async function loginAs(page, who, label) {
  log(`Login as ${label} (${who.email})`);
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await shot(page, `${label}-01-login-page`);

  // The login form uses email + password inputs. Try multiple selectors to be resilient.
  await page.fill('input[type="email"], input[name="email"], input[placeholder*="mail" i]', who.email);
  await page.fill('input[type="password"], input[name="password"]', who.password);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"], button:has-text("Connexion"), button:has-text("Se connecter")'),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
  log(`Landed on ${page.url()}`);
  await shot(page, `${label}-02-after-login`);
}

async function safeGoto(page, url, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      return;
    } catch (err) {
      log(`goto ${url} attempt ${i} failed: ${err.message} — retrying`);
      await page.waitForTimeout(2000);
    }
  }
  throw new Error(`could not navigate to ${url}`);
}

async function teacherCreatesLiveSession(page) {
  log("Teacher: waiting for JWT to land in localStorage");
  for (let i = 0; i < 30; i++) {
    const tok = await page.evaluate(() => localStorage.getItem("ecoledigitale_jwt_token")).catch(() => null);
    if (tok) {
      log(`JWT in localStorage after ${i * 500}ms (length=${tok.length}, first 20 chars: ${tok.slice(0, 20)})`);
      // Sanity check the token works against the proxy from inside the browser
      const verify = await page.evaluate(async (t) => {
        const r = await fetch("/api/v1/notifications-inbox/unread-count", {
          headers: { Authorization: `Bearer ${t}`, "X-Tenant": "ecoledigitale" },
        });
        return { status: r.status, body: await r.text() };
      }, tok);
      log(`Browser-side proxy probe: ${verify.status} ${verify.body.slice(0, 100)}`);
      break;
    }
    await page.waitForTimeout(500);
  }
  log("Teacher: navigating to /teacher/schedule");
  await safeGoto(page, `${WEB}/teacher/schedule`);
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(7000); // schedule fetch + first-compile slack
  await shot(page, "teacher-03-schedule");

  // FullCalendar renders events as elements with class .fc-event. Click the first one.
  const events = page.locator(".fc-event").first();
  const count = await page.locator(".fc-event").count();
  log(`Visible calendar events: ${count}`);
  if (count === 0) {
    log("⚠️  No events visible — schedule may not have any sessions in the current view");
    return null;
  }
  await events.click({ force: true });
  await page.waitForTimeout(800);
  await shot(page, "teacher-04-event-clicked");

  // The SessionDetails dialog should be visible. Look for the "Démarrer la séance en direct" button.
  const startBtn = page.getByRole("button", { name: /démarrer la séance en direct/i });
  const startBtnCount = await startBtn.count();
  log(`"Démarrer la séance en direct" buttons visible: ${startBtnCount}`);
  if (startBtnCount === 0) {
    log("⚠️  Add-live-session button not rendered in the dialog");
    await shot(page, "teacher-04b-dialog-no-button");
    return null;
  }

  await Promise.all([
    page.waitForURL(/\/live\//, { timeout: 30000 }).catch(() => {}),
    startBtn.first().click(),
  ]);
  await page.waitForTimeout(2500);
  log(`After click: ${page.url()}`);
  await shot(page, "teacher-05-live-room");

  const m = page.url().match(/\/live\/([0-9a-f-]+)/);
  return m ? m[1] : null;
}

async function studentChecksBell(page, expectedTitleSubstring) {
  log("Student: waiting for JWT in localStorage");
  for (let i = 0; i < 30; i++) {
    const tok = await page.evaluate(() => localStorage.getItem("ecoledigitale_jwt_token")).catch(() => null);
    if (tok) break;
    await page.waitForTimeout(500);
  }
  // Stay on whatever the student landed on after login (typically /student/courses)
  await page.waitForTimeout(3000);
  await shot(page, "student-06-after-login-home");

  // Probe the unread-count endpoint directly via the proxy
  const tok = await page.evaluate(() => localStorage.getItem("ecoledigitale_jwt_token"));
  const probe = await page.evaluate(async (t) => {
    const r = await fetch("/api/v1/notifications-inbox/unread-count", {
      headers: { Authorization: `Bearer ${t}`, "X-Tenant": "ecoledigitale" },
    });
    return { status: r.status, body: await r.text() };
  }, tok);
  log(`Student unread-count via proxy: ${probe.status} ${probe.body}`);

  // List the inbox payload too
  const list = await page.evaluate(async (t) => {
    const r = await fetch("/api/v1/notifications-inbox?limit=5", {
      headers: { Authorization: `Bearer ${t}`, "X-Tenant": "ecoledigitale" },
    });
    return { status: r.status, body: await r.text() };
  }, tok);
  log(`Student inbox: ${list.status} ${list.body.slice(0, 400)}`);

  // Look for the bell icon (lucide Bell renders as an svg). Click whatever has aria-label notifications.
  const bellSelectors = [
    'button[aria-label*="otification" i]',
    'button[aria-label*="non lue" i]',
  ];
  let clicked = false;
  for (const sel of bellSelectors) {
    const c = await page.locator(sel).count();
    if (c > 0) {
      await page.locator(sel).first().click();
      clicked = true;
      break;
    }
  }
  log(`Bell clicked: ${clicked}`);
  await page.waitForTimeout(500);
  await shot(page, "student-07-bell-open");

  // Read the visible notification text to verify the dispatch reached the student
  const visible = await page.locator("body").innerText();
  const found = visible.toLowerCase().includes(expectedTitleSubstring.toLowerCase());
  log(`Notification text "${expectedTitleSubstring}" present on page: ${found}`);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });

  const teacherCtx = await browser.newContext({
    permissions: ["camera", "microphone"],
    viewport: { width: 1400, height: 900 },
  });
  const teacher = await teacherCtx.newPage();
  teacher.on("pageerror", (err) => log("[teacher pageerror]", err.message));
  teacher.on("console", (msg) => {
    if (msg.type() === "error") log("[teacher console.error]", msg.text());
  });
  teacher.on("response", (resp) => {
    const url = resp.url();
    if (url.includes("/api/v1/")) {
      log(`[teacher net] ${resp.status()} ${resp.request().method()} ${url}`);
    }
  });
  teacher.on("requestfailed", (req) => {
    log(`[teacher net FAIL] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });

  const studentCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const student = await studentCtx.newPage();
  student.on("pageerror", (err) => log("[student pageerror]", err.message));

  let ok = true;
  try {
    await loginAs(teacher, TEACHER, "teacher");
    const liveId = await teacherCreatesLiveSession(teacher);
    if (!liveId) {
      ok = false;
    } else {
      log(`✅ Live session created: ${liveId}`);
      await loginAs(student, STUDENT, "student");
      await studentChecksBell(student, "Cours en direct");
    }
  } catch (err) {
    log("❌ Test threw:", err.message);
    ok = false;
  } finally {
    await browser.close();
  }

  process.exit(ok ? 0 : 1);
}

main();
