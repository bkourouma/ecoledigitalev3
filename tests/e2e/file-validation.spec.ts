import { test, expect } from '@playwright/test';
import { loginAsStudent, ensureLoggedOut, waitForPageLoad } from '../utils/auth-helpers';
import path from 'path';
import fs from 'fs';

test.describe('File Upload Validation', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
    await loginAsStudent(page);
    
    // Navigate to assignments page
    await page.goto('/student/assignments');
    await waitForPageLoad(page);
    
    // Find an assignment that allows submission
    const assignmentRow = page.locator('tr').first();
    if (await assignmentRow.isVisible()) {
      await assignmentRow.click();
      await waitForPageLoad(page);
    }
  });

  test('should accept valid PDF files', async ({ page }) => {
    // Create a small valid PDF for testing
    const testPdfPath = path.join(__dirname, '../fixtures/valid-test.pdf');
    
    // Create a minimal PDF file if it doesn't exist
    if (!fs.existsSync(testPdfPath)) {
      // Create directory if it doesn't exist
      const fixturesDir = path.dirname(testPdfPath);
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }
      
      // Create a minimal PDF content
      const pdfContent = Buffer.from([
        0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34, // %PDF-1.4
        0x0A, 0x25, 0xC4, 0xE5, 0xF2, 0xE5, 0xEB, 0xA7, 0xF3, 0xA0, 0xD0, 0xC4, 0xC6, 0x0A,
        // Minimal PDF structure
        0x31, 0x20, 0x30, 0x20, 0x6F, 0x62, 0x6A, 0x0A, // 1 0 obj
        0x3C, 0x3C, 0x2F, 0x54, 0x79, 0x70, 0x65, 0x2F, 0x43, 0x61, 0x74, 0x61, 0x6C, 0x6F, 0x67, 0x2F, 0x50, 0x61, 0x67, 0x65, 0x73, 0x20, 0x32, 0x20, 0x30, 0x20, 0x52, 0x3E, 0x3E, 0x0A,
        0x65, 0x6E, 0x64, 0x6F, 0x62, 0x6A, 0x0A, // endobj
        // Add more minimal PDF structure...
        0x78, 0x72, 0x65, 0x66, 0x0A, // xref
        0x30, 0x20, 0x32, 0x0A, // 0 2
        0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x20, 0x36, 0x35, 0x35, 0x33, 0x35, 0x20, 0x66, 0x20, 0x0A,
        0x74, 0x72, 0x61, 0x69, 0x6C, 0x65, 0x72, 0x0A, // trailer
        0x3C, 0x3C, 0x2F, 0x53, 0x69, 0x7A, 0x65, 0x20, 0x32, 0x2F, 0x52, 0x6F, 0x6F, 0x74, 0x20, 0x31, 0x20, 0x30, 0x20, 0x52, 0x3E, 0x3E, 0x0A,
        0x73, 0x74, 0x61, 0x72, 0x74, 0x78, 0x72, 0x65, 0x66, 0x0A, // startxref
        0x31, 0x30, 0x39, 0x0A, // 109
        0x25, 0x25, 0x45, 0x4F, 0x46 // %%EOF
      ]);
      
      fs.writeFileSync(testPdfPath, pdfContent);
    }
    
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(testPdfPath);
      
      // Wait for upload to process
      await page.waitForTimeout(2000);
      
      // Should not show error message
      const errorMessage = page.locator('text=Erreur, text=Invalid, text=Seuls les fichiers PDF');
      await expect(errorMessage).not.toBeVisible();
      
      // Should show success indicator
      const successIndicator = page.locator('text=Fichier téléchargé, text=Upload réussi');
      await expect(successIndicator).toBeVisible({ timeout: 10000 });
    }
  });

  test('should reject non-PDF files', async ({ page }) => {
    // Create a text file for testing
    const testTxtPath = path.join(__dirname, '../fixtures/invalid-file.txt');
    
    if (!fs.existsSync(testTxtPath)) {
      const fixturesDir = path.dirname(testTxtPath);
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }
      fs.writeFileSync(testTxtPath, 'This is not a PDF file');
    }
    
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(testTxtPath);
      
      // Wait for validation
      await page.waitForTimeout(2000);
      
      // Should show error message
      const errorMessage = page.locator('text=Seuls les fichiers PDF sont autorisés');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    }
  });

  test('should reject files that are too large', async ({ page }) => {
    // Create a large file (simulate > 10MB)
    const largePdfPath = path.join(__dirname, '../fixtures/large-file.pdf');
    
    if (!fs.existsSync(largePdfPath)) {
      const fixturesDir = path.dirname(largePdfPath);
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }
      
      // Create a file larger than 10MB (10 * 1024 * 1024 bytes)
      const largeContent = Buffer.alloc(11 * 1024 * 1024, 0); // 11MB of zeros
      // Add PDF header to make it look like a PDF
      largeContent.write('%PDF-1.4', 0);
      fs.writeFileSync(largePdfPath, largeContent);
    }
    
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(largePdfPath);
      
      // Wait for validation
      await page.waitForTimeout(3000);
      
      // Should show error message about file size
      const errorMessage = page.locator('text=Fichier trop volumineux, text=10MB maximum');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    }
  });

  test('should reject corrupted PDF files', async ({ page }) => {
    // Create a file with PDF extension but invalid content
    const corruptPdfPath = path.join(__dirname, '../fixtures/corrupt-file.pdf');
    
    if (!fs.existsSync(corruptPdfPath)) {
      const fixturesDir = path.dirname(corruptPdfPath);
      if (!fs.existsSync(fixturesDir)) {
        fs.mkdirSync(fixturesDir, { recursive: true });
      }
      
      // Create a file that looks like PDF but has invalid content
      fs.writeFileSync(corruptPdfPath, 'This is not a valid PDF file content');
    }
    
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(corruptPdfPath);
      
      // Wait for validation
      await page.waitForTimeout(2000);
      
      // Should show error message about invalid PDF
      const errorMessage = page.locator('text=Format PDF invalide, text=Fichier corrompu');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
    }
  });

  test('should handle network errors gracefully', async ({ page }) => {
    // Simulate network failure during upload
    await page.route('**/api/v1/assignments/*/submissions/upload', route => {
      route.abort('failed');
    });
    
    const testPdfPath = path.join(__dirname, '../fixtures/valid-test.pdf');
    const fileInput = page.locator('input[type="file"]');
    
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(testPdfPath);
      
      // Wait for error handling
      await page.waitForTimeout(3000);
      
      // Should show network error message
      const errorMessage = page.locator('text=Erreur réseau, text=Échec du téléchargement');
      await expect(errorMessage).toBeVisible({ timeout: 5000 });
      
      // Should allow retry
      const retryButton = page.locator('button:has-text("Réessayer")');
      await expect(retryButton).toBeVisible();
    }
  });

  test('should show upload progress', async ({ page }) => {
    const testPdfPath = path.join(__dirname, '../fixtures/valid-test.pdf');
    const fileInput = page.locator('input[type="file"]');
    
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(testPdfPath);
      
      // Should show progress indicator during upload
      const progressIndicator = page.locator('.progress-bar, [role="progressbar"], text=Téléchargement');
      
      // Progress should be visible briefly
      if (await progressIndicator.count() > 0) {
        await expect(progressIndicator.first()).toBeVisible();
      }
    }
  });
});
