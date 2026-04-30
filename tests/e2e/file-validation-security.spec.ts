import { test, expect } from '@playwright/test';
import { 
  loginAsTeacher, 
  loginAsStudent, 
  logout, 
  ensureLoggedOut,
  waitForPageLoad 
} from '../utils/auth-helpers';
import path from 'path';
import fs from 'fs';

test.describe('File Validation and Security Tests', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
  });

  test('PDF File Validation Tests', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    // Find an assignment to test with
    const assignmentRow = page.locator('tr').first();
    if (await assignmentRow.isVisible()) {
      await assignmentRow.click();
      
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.isVisible()) {
        
        // Test 1: Valid PDF file
        const validPdfPath = path.join(__dirname, '../fixtures/valid-test.pdf');
        if (!fs.existsSync(validPdfPath)) {
          const pdfContent = `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj
2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj
3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
>>
endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer
<<
/Size 4
/Root 1 0 R
>>
startxref
200
%%EOF`;
          fs.writeFileSync(validPdfPath, pdfContent);
        }
        
        await fileInput.setInputFiles(validPdfPath);
        await page.waitForTimeout(1000);
        
        // Should not show error for valid PDF
        const errorMessage = page.locator('text=Type de fichier non autorisé');
        await expect(errorMessage).not.toBeVisible();
        
        // Test 2: Invalid file type (TXT)
        const invalidTxtPath = path.join(__dirname, '../fixtures/invalid.txt');
        if (!fs.existsSync(invalidTxtPath)) {
          fs.writeFileSync(invalidTxtPath, 'This is not a PDF file');
        }
        
        await fileInput.setInputFiles(invalidTxtPath);
        await page.waitForTimeout(1000);
        
        // Should show error for invalid file type
        await expect(page.locator('text=Type de fichier non autorisé')).toBeVisible();
        
        // Test 3: Invalid file type (DOC)
        const invalidDocPath = path.join(__dirname, '../fixtures/invalid.doc');
        if (!fs.existsSync(invalidDocPath)) {
          fs.writeFileSync(invalidDocPath, 'This is not a PDF file');
        }
        
        await fileInput.setInputFiles(invalidDocPath);
        await page.waitForTimeout(1000);
        
        // Should show error for invalid file type
        await expect(page.locator('text=Type de fichier non autorisé')).toBeVisible();
        
        // Test 4: File with PDF extension but wrong content
        const fakePdfPath = path.join(__dirname, '../fixtures/fake.pdf');
        if (!fs.existsSync(fakePdfPath)) {
          fs.writeFileSync(fakePdfPath, 'This is not a real PDF file');
        }
        
        await fileInput.setInputFiles(fakePdfPath);
        await page.waitForTimeout(1000);
        
        // Should show error for fake PDF
        await expect(page.locator('text=Seuls les fichiers PDF sont acceptés')).toBeVisible();
      }
    }
  });

  test('File Size Validation Tests', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    const assignmentRow = page.locator('tr').first();
    if (await assignmentRow.isVisible()) {
      await assignmentRow.click();
      
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.isVisible()) {
        
        // Test 1: File within size limit (1MB)
        const smallPdfPath = path.join(__dirname, '../fixtures/small.pdf');
        if (!fs.existsSync(smallPdfPath)) {
          const smallContent = 'A'.repeat(1024 * 1024); // 1MB
          fs.writeFileSync(smallPdfPath, smallContent);
        }
        
        await fileInput.setInputFiles(smallPdfPath);
        await page.waitForTimeout(1000);
        
        // Should not show size error
        const sizeErrorMessage = page.locator('text=trop volumineux');
        await expect(sizeErrorMessage).not.toBeVisible();
        
        // Test 2: File exceeding size limit (15MB)
        const largePdfPath = path.join(__dirname, '../fixtures/large.pdf');
        if (!fs.existsSync(largePdfPath)) {
          const largeContent = 'A'.repeat(15 * 1024 * 1024); // 15MB
          fs.writeFileSync(largePdfPath, largeContent);
        }
        
        await fileInput.setInputFiles(largePdfPath);
        await page.waitForTimeout(1000);
        
        // Should show size error
        await expect(page.locator('text=trop volumineux')).toBeVisible();
        
        // Test 3: File at exact size limit (10MB)
        const exactSizePdfPath = path.join(__dirname, '../fixtures/exact-size.pdf');
        if (!fs.existsSync(exactSizePdfPath)) {
          const exactContent = 'A'.repeat(10 * 1024 * 1024); // 10MB
          fs.writeFileSync(exactSizePdfPath, exactContent);
        }
        
        await fileInput.setInputFiles(exactSizePdfPath);
        await page.waitForTimeout(1000);
        
        // Should not show size error for exact limit
        await expect(page.locator('text=trop volumineux')).not.toBeVisible();
      }
    }
  });

  test('Security Access Control Tests', async ({ page }) => {
    
    // Test 1: Student cannot access teacher corrections
    await loginAsStudent(page);
    await page.goto('/teacher/corrections');
    await waitForPageLoad(page);
    
    // Should be redirected or show access denied
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('/teacher/corrections');
    
    // Test 2: Student cannot access teacher assignment creation
    await page.goto('/teacher/assignments/create');
    await waitForPageLoad(page);
    
    const currentUrl2 = page.url();
    expect(currentUrl2).not.toContain('/teacher/assignments/create');
    
    // Test 3: Student cannot access teacher assignment list
    await page.goto('/teacher/assignments/list');
    await waitForPageLoad(page);
    
    const currentUrl3 = page.url();
    expect(currentUrl3).not.toContain('/teacher/assignments/list');
    
    // Test 4: Teacher cannot access student grades
    await logout(page);
    await loginAsTeacher(page);
    
    await page.goto('/student/grades');
    await waitForPageLoad(page);
    
    const currentUrl4 = page.url();
    expect(currentUrl4).not.toContain('/student/grades');
    
    // Test 5: Teacher cannot access student assignments
    await page.goto('/student/assignments');
    await waitForPageLoad(page);
    
    const currentUrl5 = page.url();
    expect(currentUrl5).not.toContain('/student/assignments');
  });

  test('Authentication Required Tests', async ({ page }) => {
    
    // Test 1: Cannot access student assignments without login
    await page.goto('/student/assignments');
    await waitForPageLoad(page);
    
    // Should be redirected to login
    const currentUrl = page.url();
    expect(currentUrl).toContain('/login');
    
    // Test 2: Cannot access teacher corrections without login
    await page.goto('/teacher/corrections');
    await waitForPageLoad(page);
    
    const currentUrl2 = page.url();
    expect(currentUrl2).toContain('/login');
    
    // Test 3: Cannot access API endpoints without authentication
    const response = await page.request.get('/api/v1/student/assignments');
    expect(response.status()).toBe(401);
    
    const response2 = await page.request.get('/api/v1/teacher/corrections');
    expect(response2.status()).toBe(401);
  });

  test('File Upload Security Tests', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    const assignmentRow = page.locator('tr').first();
    if (await assignmentRow.isVisible()) {
      await assignmentRow.click();
      
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.isVisible()) {
        
        // Test 1: Malicious file with script content
        const maliciousPath = path.join(__dirname, '../fixtures/malicious.pdf');
        if (!fs.existsSync(maliciousPath)) {
          const maliciousContent = `<script>alert('XSS')</script>`;
          fs.writeFileSync(maliciousPath, maliciousContent);
        }
        
        await fileInput.setInputFiles(maliciousPath);
        await page.waitForTimeout(1000);
        
        // Should reject malicious content
        await expect(page.locator('text=Type de fichier non autorisé')).toBeVisible();
        
        // Test 2: File with executable extension
        const executablePath = path.join(__dirname, '../fixtures/executable.exe');
        if (!fs.existsSync(executablePath)) {
          fs.writeFileSync(executablePath, 'This is an executable file');
        }
        
        await fileInput.setInputFiles(executablePath);
        await page.waitForTimeout(1000);
        
        // Should reject executable files
        await expect(page.locator('text=Type de fichier non autorisé')).toBeVisible();
        
        // Test 3: File with very long filename
        const longNamePath = path.join(__dirname, '../fixtures/' + 'a'.repeat(300) + '.pdf');
        if (!fs.existsSync(longNamePath)) {
          fs.writeFileSync(longNamePath, 'Test content');
        }
        
        await fileInput.setInputFiles(longNamePath);
        await page.waitForTimeout(1000);
        
        // Should handle long filenames gracefully
        // Either accept or show appropriate error
        const hasError = await page.locator('text=Type de fichier non autorisé').isVisible();
        const hasSuccess = await page.locator('text=uploaded successfully').isVisible();
        expect(hasError || hasSuccess).toBe(true);
      }
    }
  });

  test('Download Security Tests', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    const assignmentRow = page.locator('tr').first();
    if (await assignmentRow.isVisible()) {
      await assignmentRow.click();
      
      const downloadButton = page.locator('button:has-text("Télécharger")');
      if (await downloadButton.isVisible()) {
        
        // Test 1: Download should require authentication
        const downloadPromise = page.waitForEvent('download');
        await downloadButton.click();
        const download = await downloadPromise;
        
        // Verify download URL contains authentication
        expect(download.url()).toContain('/api/v1/files/');
        
        // Test 2: Try to access download URL directly without authentication
        await logout(page);
        
        const directDownloadResponse = await page.request.get(download.url());
        expect(directDownloadResponse.status()).toBe(401);
      }
    }
  });

  test.afterAll(async () => {
    // Clean up test files
    const testFiles = [
      path.join(__dirname, '../fixtures/valid-test.pdf'),
      path.join(__dirname, '../fixtures/invalid.txt'),
      path.join(__dirname, '../fixtures/invalid.doc'),
      path.join(__dirname, '../fixtures/fake.pdf'),
      path.join(__dirname, '../fixtures/small.pdf'),
      path.join(__dirname, '../fixtures/large.pdf'),
      path.join(__dirname, '../fixtures/exact-size.pdf'),
      path.join(__dirname, '../fixtures/malicious.pdf'),
      path.join(__dirname, '../fixtures/executable.exe')
    ];
    
    testFiles.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });
});
