import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Course Materials Upload - Direct API Test', () => {
  const courseId = '22a57716-1b30-4567-8234-f03f28d5ebbf';
  const testFilePath = path.join(__dirname, '../test-materials/test-upload-direct.pdf');

  test.beforeAll(async () => {
    // Create test materials directory if it doesn't exist
    const testMaterialsDir = path.join(__dirname, '../test-materials');
    if (!fs.existsSync(testMaterialsDir)) {
      fs.mkdirSync(testMaterialsDir, { recursive: true });
    }

    // Create a test PDF file
    const pdfContent = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, // %PDF-1.4
      0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A, // header
      ...Array(300).fill(0x41), // Add content
    ]);
    fs.writeFileSync(testFilePath, pdfContent);
  });

  test('should upload PDF file via API with valid JWT token', async ({ page }) => {
    // Navigate to login page
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Check if already logged in
    let token = await page.evaluate(() => {
      return localStorage.getItem('ecoledigitale_jwt_token');
    });

    // If not logged in, perform login
    if (!token) {
      // Fill in login credentials
      const emailInput = page.locator('input[type="email"]').first();
      const passwordInput = page.locator('input[type="password"]').first();

      if (await emailInput.isVisible()) {
        await emailInput.fill('kouadio.assi@ecoledigitale.ci');
        await passwordInput.fill('imhotepacademy');

        // Click login button
        const loginButton = page.locator('button:has-text("Se connecter"), button:has-text("Login")').first();
        if (await loginButton.isVisible()) {
          await loginButton.click();

          // Wait for redirect and token to be set
          await page.waitForTimeout(2000);
        }
      }

      // Extract token again after login
      token = await page.evaluate(() => {
        return localStorage.getItem('ecoledigitale_jwt_token');
      });
    }

    expect(token).toBeTruthy();

    // Create FormData with file
    const fileBuffer = fs.readFileSync(testFilePath);
    const blob = new Blob([fileBuffer], { type: 'application/pdf' });
    
    // Use page.evaluate to perform the upload from browser context
    const uploadResult = await page.evaluate(async (token, courseId) => {
      const fd = new FormData();
      
      // Create a blob from the test file
      const pdfContent = new Uint8Array([
        0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, // %PDF-1.4
        0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A, // header
        ...Array(300).fill(0x41), // Add content
      ]);
      
      const blob = new Blob([pdfContent], { type: 'application/pdf' });
      fd.append('file', blob, 'playwright-test-upload.pdf');
      fd.append('title', 'Playwright Test Upload - ' + new Date().toISOString());
      
      try {
        const response = await fetch(`/api/courses/${courseId}/materials`, {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${token}`
          },
          body: fd
        });
        
        const data = await response.json();
        return {
          status: response.status,
          ok: response.ok,
          data,
          error: null
        };
      } catch (error) {
        return {
          status: null,
          ok: false,
          data: null,
          error: String(error)
        };
      }
    }, token, courseId);

    // Verify upload was successful
    expect(uploadResult.ok).toBe(true);
    expect(uploadResult.status).toBe(200);
    expect(uploadResult.data).toBeTruthy();
    expect(uploadResult.data.id).toBeTruthy();
    expect(uploadResult.data.title).toContain('Playwright Test Upload');
    expect(uploadResult.data.fileName).toBe('playwright-test-upload.pdf');
    expect(uploadResult.data.fileType).toBe('application/pdf');
    expect(uploadResult.data.processingStatus).toBe('pending');
    expect(uploadResult.error).toBeNull();
  });

  test('should upload multiple files sequentially', async ({ page }) => {
    // Navigate to login page
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Check if already logged in
    let token = await page.evaluate(() => {
      return localStorage.getItem('ecoledigitale_jwt_token');
    });

    // If not logged in, perform login
    if (!token) {
      // Fill in login credentials
      const emailInput = page.locator('input[type="email"]').first();
      const passwordInput = page.locator('input[type="password"]').first();

      if (await emailInput.isVisible()) {
        await emailInput.fill('kouadio.assi@ecoledigitale.ci');
        await passwordInput.fill('imhotepacademy');

        // Click login button
        const loginButton = page.locator('button:has-text("Se connecter"), button:has-text("Login")').first();
        if (await loginButton.isVisible()) {
          await loginButton.click();

          // Wait for redirect and token to be set
          await page.waitForTimeout(2000);
        }
      }

      // Extract token again after login
      token = await page.evaluate(() => {
        return localStorage.getItem('ecoledigitale_jwt_token');
      });
    }

    expect(token).toBeTruthy();

    // Upload 3 files
    const uploadResults = await page.evaluate(async (token, courseId) => {
      const results = [];
      
      for (let i = 1; i <= 3; i++) {
        const fd = new FormData();
        
        const pdfContent = new Uint8Array([
          0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34,
          0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A,
          ...Array(200 + i * 50).fill(0x41),
        ]);
        
        const blob = new Blob([pdfContent], { type: 'application/pdf' });
        fd.append('file', blob, `test-file-${i}.pdf`);
        fd.append('title', `Test File ${i} - ${new Date().toISOString()}`);
        
        try {
          const response = await fetch(`/api/courses/${courseId}/materials`, {
            method: 'POST',
            headers: {
              'authorization': `Bearer ${token}`
            },
            body: fd
          });
          
          const data = await response.json();
          results.push({
            fileNumber: i,
            status: response.status,
            ok: response.ok,
            id: data.id,
            fileName: data.fileName
          });
        } catch (error) {
          results.push({
            fileNumber: i,
            status: null,
            ok: false,
            error: String(error)
          });
        }
      }
      
      return results;
    }, token, courseId);

    // Verify all uploads were successful
    expect(uploadResults).toHaveLength(3);
    
    uploadResults.forEach((result, index) => {
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(result.id).toBeTruthy();
      expect(result.fileName).toBe(`test-file-${index + 1}.pdf`);
    });
  });

  test('should reject upload without authentication', async ({ page }) => {
    // Navigate to a page but don't authenticate
    await page.goto('/');
    
    // Try to upload without token
    const uploadResult = await page.evaluate(async (courseId) => {
      const fd = new FormData();
      
      const pdfContent = new Uint8Array([
        0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34,
        0x0A, 0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A,
        ...Array(100).fill(0x41),
      ]);
      
      const blob = new Blob([pdfContent], { type: 'application/pdf' });
      fd.append('file', blob, 'unauthorized-test.pdf');
      fd.append('title', 'Unauthorized Test');
      
      try {
        const response = await fetch(`/api/courses/${courseId}/materials`, {
          method: 'POST',
          body: fd
        });
        
        return {
          status: response.status,
          ok: response.ok
        };
      } catch (error) {
        return {
          status: null,
          ok: false,
          error: String(error)
        };
      }
    }, courseId);

    // Should be rejected with 401
    expect(uploadResult.ok).toBe(false);
    expect(uploadResult.status).toBe(401);
  });

  test.afterAll(async () => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });
});

