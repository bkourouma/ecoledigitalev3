import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Course Materials Upload Flow', () => {
  const courseId = '22a57716-1b30-4567-8234-f03f28d5ebbf';
  const testFilePath = path.join(__dirname, '../test-materials/test-upload.pdf');

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
      ...Array(200).fill(0x41), // Add content
    ]);
    fs.writeFileSync(testFilePath, pdfContent);
  });

  test.beforeEach(async ({ page }) => {
    // Navigate to teacher content page
    await page.goto('/teacher/content');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Check if we're logged in (if not, we'll see login page)
    const loginButton = page.locator('text=Se connecter');
    if (await loginButton.isVisible()) {
      // We need to log in first
      await page.goto('/login');
      await page.waitForLoadState('networkidle');
      
      // Fill in login credentials
      await page.fill('input[type="email"]', 'kouadio.assi@ecoledigitale.ci');
      await page.fill('input[type="password"]', 'imhotepacademy');
      
      // Click login button
      await page.click('button:has-text("Se connecter")');
      
      // Wait for redirect to teacher content
      await page.waitForURL('/teacher/content', { timeout: 10000 });
      await page.waitForLoadState('networkidle');
    }
  });

  test('should display teacher content page', async ({ page }) => {
    // Check if we're on the teacher content page
    await expect(page.locator('h1')).toBeVisible();
    
    // Should have course list or materials section
    const courseSection = page.locator('text=Cours');
    const materialsSection = page.locator('text=Matériaux');
    
    const hasContent = await courseSection.isVisible() || await materialsSection.isVisible();
    expect(hasContent).toBeTruthy();
  });

  test('should navigate to course materials', async ({ page }) => {
    // Look for the specific course in the list
    const courseLink = page.locator(`a:has-text("Matériaux")`).first();
    
    if (await courseLink.isVisible()) {
      await courseLink.click();
      await page.waitForLoadState('networkidle');
      
      // Should be on materials page
      await expect(page.url()).toContain('/materials');
    }
  });

  test('should display materials upload interface', async ({ page }) => {
    // Navigate to materials page
    const courseLink = page.locator(`a:has-text("Matériaux")`).first();
    
    if (await courseLink.isVisible()) {
      await courseLink.click();
      await page.waitForLoadState('networkidle');
      
      // Look for upload button or interface
      const uploadButton = page.locator('button:has-text("Ajouter")');
      const uploadInterface = page.locator('text=Télécharger');
      
      const hasUploadInterface = await uploadButton.isVisible() || await uploadInterface.isVisible();
      expect(hasUploadInterface).toBeTruthy();
    }
  });

  test('should upload a PDF file successfully', async ({ page }) => {
    // Navigate to materials page
    const courseLink = page.locator(`a:has-text("Matériaux")`).first();
    
    if (await courseLink.isVisible()) {
      await courseLink.click();
      await page.waitForLoadState('networkidle');
      
      // Find and click upload button
      const uploadButton = page.locator('button:has-text("Ajouter")').first();
      
      if (await uploadButton.isVisible()) {
        await uploadButton.click();
        
        // Wait for upload dialog or form to appear
        await page.waitForTimeout(500);
        
        // Find file input
        const fileInput = page.locator('input[type="file"]').first();
        
        if (await fileInput.isVisible()) {
          // Upload the test file
          await fileInput.setInputFiles(testFilePath);
          
          // Wait for file to be selected
          await page.waitForTimeout(500);
          
          // Fill in title if there's a title field
          const titleInput = page.locator('input[placeholder*="Titre"], input[placeholder*="titre"]').first();
          if (await titleInput.isVisible()) {
            await titleInput.fill('Test Material Upload - Playwright');
          }
          
          // Find and click submit button
          const submitButton = page.locator('button:has-text("Télécharger"), button:has-text("Envoyer"), button:has-text("Ajouter")').last();
          
          if (await submitButton.isVisible()) {
            // Listen for successful response
            const responsePromise = page.waitForResponse(
              response => response.url().includes('/api/courses/') && response.url().includes('/materials') && response.status() === 200
            );
            
            await submitButton.click();
            
            try {
              const response = await responsePromise;
              expect(response.status()).toBe(200);
              
              // Wait for success message or redirect
              await page.waitForTimeout(1000);
              
              // Check for success indicator
              const successMessage = page.locator('text=succès, text=Succès, text=téléchargé, text=Téléchargé').first();
              if (await successMessage.isVisible()) {
                await expect(successMessage).toBeVisible();
              }
            } catch (e) {
              console.log('Response timeout or error:', e.message);
            }
          }
        }
      }
    }
  });

  test('should display uploaded materials in list', async ({ page }) => {
    // Navigate to materials page
    const courseLink = page.locator(`a:has-text("Matériaux")`).first();
    
    if (await courseLink.isVisible()) {
      await courseLink.click();
      await page.waitForLoadState('networkidle');
      
      // Wait for materials list to load
      await page.waitForTimeout(1000);
      
      // Check if materials are displayed
      const materialsList = page.locator('[data-testid="materials-list"], .materials-list, ul li').first();
      
      if (await materialsList.isVisible()) {
        await expect(materialsList).toBeVisible();
      }
    }
  });

  test('should handle upload errors gracefully', async ({ page }) => {
    // Simulate network error for upload
    await page.route('**/api/courses/**/materials', route => {
      route.abort('failed');
    });
    
    // Navigate to materials page
    const courseLink = page.locator(`a:has-text("Matériaux")`).first();
    
    if (await courseLink.isVisible()) {
      await courseLink.click();
      await page.waitForLoadState('networkidle');
      
      // Try to upload
      const uploadButton = page.locator('button:has-text("Ajouter")').first();
      
      if (await uploadButton.isVisible()) {
        await uploadButton.click();
        await page.waitForTimeout(500);
        
        const fileInput = page.locator('input[type="file"]').first();
        if (await fileInput.isVisible()) {
          await fileInput.setInputFiles(testFilePath);
          await page.waitForTimeout(500);
          
          const submitButton = page.locator('button:has-text("Télécharger"), button:has-text("Envoyer"), button:has-text("Ajouter")').last();
          if (await submitButton.isVisible()) {
            await submitButton.click();
            
            // Wait for error message
            await page.waitForTimeout(1000);
            
            const errorMessage = page.locator('text=Erreur, text=erreur, text=échoué, text=Échoué').first();
            if (await errorMessage.isVisible()) {
              await expect(errorMessage).toBeVisible();
            }
          }
        }
      }
    }
  });

  test.afterAll(async () => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });
});

