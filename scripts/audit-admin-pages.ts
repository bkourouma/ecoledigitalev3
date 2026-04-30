import { chromium, Browser, Page, BrowserContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

interface DbControl {
  control: string;
  whatItDoes: string;
  tablesAndColumns: string;
  endpoint: string;
}

interface PageAudit {
  url: string;
  controls: DbControl[];
  errors: string[];
}

const ADMIN_CREDENTIALS = {
  email: 'admin@imhotepacademy.fr',
  password: 'Passw0rd!admin',
};

const BASE_URL = 'http://localhost:3000';
const API_BASE_URL = 'http://localhost:4000';

class AdminAuditor {
  private browser!: Browser;
  private context!: BrowserContext;
  private page!: Page;
  private networkCalls: Map<string, any[]> = new Map();
  private auditResults: PageAudit[] = [];

  async initialize() {
    console.log('🚀 Initializing browser...');
    this.browser = await chromium.launch({ headless: false });
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    this.page = await this.context.newPage();

    // Setup network monitoring
    this.page.on('request', request => {
      const url = request.url();
      if (url.includes('/api/') || url.includes(API_BASE_URL)) {
        if (!this.networkCalls.has(url)) {
          this.networkCalls.set(url, []);
        }
        this.networkCalls.get(url)!.push({
          method: request.method(),
          url: url,
          headers: request.headers(),
          postData: request.postData(),
          timestamp: new Date().toISOString(),
        });
      }
    });

    this.page.on('response', async response => {
      const url = response.url();
      if (url.includes('/api/') || url.includes(API_BASE_URL)) {
        const calls = this.networkCalls.get(url) || [];
        const lastCall = calls[calls.length - 1];
        if (lastCall) {
          lastCall.status = response.status();
          lastCall.statusText = response.statusText();
          try {
            lastCall.responseBody = await response.json();
          } catch {
            // Not JSON, skip
          }
        }
      }
    });

    this.page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('❌ Console Error:', msg.text());
      }
    });
  }

  async login() {
    console.log('🔐 Logging in as admin...');
    await this.page.goto(`${BASE_URL}/login`);
    await this.page.waitForLoadState('networkidle');

    await this.page.fill('input[name="email"], input[type="email"]', ADMIN_CREDENTIALS.email);
    await this.page.fill('input[name="password"], input[type="password"]', ADMIN_CREDENTIALS.password);
    await this.page.click('button[type="submit"]');

    await this.page.waitForURL(/dashboard|academic|\/(?!login)/, { timeout: 10000 });
    console.log('✅ Logged in successfully');
  }

  async auditPage(url: string, pageTitle: string): Promise<PageAudit> {
    console.log(`\n📄 Auditing: ${pageTitle} (${url})`);
    
    const audit: PageAudit = {
      url,
      controls: [],
      errors: [],
    };

    this.networkCalls.clear();

    try {
      await this.page.goto(`${BASE_URL}${url}`);
      await this.page.waitForLoadState('networkidle', { timeout: 15000 });
      await this.page.waitForTimeout(2000); // Extra wait for dynamic content

      // Check for console errors
      const logs: string[] = [];
      this.page.on('console', msg => {
        if (msg.type() === 'error') {
          logs.push(msg.text());
        }
      });

      // Detect data tables/grids
      const tables = await this.page.locator('table, [role="table"], .ant-table').count();
      console.log(`  Found ${tables} table(s)`);

      // Detect buttons
      const buttons = await this.page.locator('button').count();
      console.log(`  Found ${buttons} button(s)`);

      // Detect forms
      const forms = await this.page.locator('form').count();
      console.log(`  Found ${forms} form(s)`);

      // Analyze network calls
      console.log(`  Network calls: ${this.networkCalls.size}`);
      for (const [url, calls] of this.networkCalls.entries()) {
        for (const call of calls) {
          const pathMatch = url.match(/\/api\/(.*)/);
          const endpoint = pathMatch ? pathMatch[0] : url;
          
          audit.controls.push({
            control: `${call.method} request`,
            whatItDoes: `Network call to ${endpoint}`,
            tablesAndColumns: 'TO_BE_ANALYZED',
            endpoint: `${call.method} ${endpoint}`,
          });
        }
      }

      if (logs.length > 0) {
        audit.errors = logs;
      }

    } catch (error: any) {
      console.error(`  ❌ Error auditing page: ${error.message}`);
      audit.errors.push(error.message);
    }

    this.auditResults.push(audit);
    return audit;
  }

  async auditAllAdminPages() {
    const adminPages = [
      // Academic Management
      { url: '/academic', title: 'Academic Home' },
      { url: '/academic/cycles', title: 'Cycles Management' },
      { url: '/academic/programmes', title: 'Programmes Management' },
      { url: '/academic/courses', title: 'Courses Management' },
      { url: '/academic/students', title: 'Students Management' },
      { url: '/academic/teachers', title: 'Teachers Management' },
      { url: '/academic/classrooms', title: 'Classrooms Management' },
      
      // Assignments & Evaluations
      { url: '/academic/assignments', title: 'Assignments Overview' },
      { url: '/academic/assignments/assign', title: 'Assign Assignments' },
      { url: '/academic/assignments/instances', title: 'Assignment Instances' },
      { url: '/academic/evaluations', title: 'Evaluations List' },
      { url: '/academic/evaluations/create', title: 'Create Evaluation' },
      
      // Academic Year Management
      { url: '/annee-academique/demarrer', title: 'Start Academic Year' },
      { url: '/annee-academique/ajouter-classe', title: 'Add Class' },
      { url: '/annee-academique/classes', title: 'Classes List' },
      { url: '/annee-academique/inscription', title: 'Student Enrollment' },
      
      // Attendance
      { url: '/attendance', title: 'Attendance Overview' },
      { url: '/attendance/admin', title: 'Attendance Admin' },
      
      // Schedule Generation
      { url: '/schedule-generation', title: 'Schedule Generation' },
      { url: '/schedule-generation/calendar', title: 'Schedule Calendar' },
      { url: '/schedule-generation/stats', title: 'Schedule Stats' },
      
      // Finances
      { url: '/(dashboard)/admin/finances', title: 'Finances Dashboard' },
      { url: '/(dashboard)/admin/finances/scolarite', title: 'Tuition Management' },
      { url: '/(dashboard)/admin/finances/student-payments', title: 'Student Payments' },
      { url: '/(dashboard)/admin/finances/payment-validation', title: 'Payment Validation' },
      { url: '/(dashboard)/admin/finances/tuition-schedules', title: 'Tuition Schedules' },
      { url: '/(dashboard)/admin/finances/reports', title: 'Financial Reports' },
      { url: '/(dashboard)/admin/finances/analytics', title: 'Financial Analytics' },
      
      // Payments Management
      { url: '/payments/periods', title: 'Payment Periods' },
      { url: '/payments/teacher-configs', title: 'Teacher Payment Configs' },
      { url: '/payments/teaching-hours', title: 'Teaching Hours' },
      { url: '/payments/manage', title: 'Manage Payments' },
      { url: '/payments/calculate', title: 'Calculate Payments' },
    ];

    for (const pageInfo of adminPages) {
      await this.auditPage(pageInfo.url, pageInfo.title);
      await this.page.waitForTimeout(1000); // Pause between pages
    }
  }

  generateReport() {
    console.log('\n📊 Generating audit report...');
    
    let reportContent = '';
    
    for (const audit of this.auditResults) {
      reportContent += `\nPageUrl: ${audit.url}\n`;
      
      if (audit.errors.length > 0) {
        reportContent += `  ⚠️ ERRORS FOUND:\n`;
        for (const error of audit.errors) {
          reportContent += `    - ${error}\n`;
        }
      }
      
      if (audit.controls.length === 0) {
        reportContent += `  - No database controls detected\n`;
      } else {
        for (const control of audit.controls) {
          reportContent += `  - Action or Control: "${control.control}"\n`;
          reportContent += `      - What it does: ${control.whatItDoes}\n`;
          reportContent += `      - Table and colonnes used or affected: ${control.tablesAndColumns}\n`;
          reportContent += `      - Endpoint: ${control.endpoint}\n\n`;
        }
      }
    }
    
    return reportContent;
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up...');
    await this.browser.close();
  }
}

async function main() {
  const auditor = new AdminAuditor();
  
  try {
    await auditor.initialize();
    await auditor.login();
    await auditor.auditAllAdminPages();
    
    const report = auditor.generateReport();
    
    // Save report to file
    const reportPath = path.join(process.cwd(), 'audit-admin-report.txt');
    fs.writeFileSync(reportPath, report, 'utf-8');
    console.log(`\n✅ Report saved to: ${reportPath}`);
    
  } catch (error) {
    console.error('💥 Fatal error:', error);
  } finally {
    await auditor.cleanup();
  }
}

main();



