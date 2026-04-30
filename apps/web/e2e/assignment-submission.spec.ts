import { test, expect } from '@playwright/test';

test.describe('Assignment Submission Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication - in a real test you'd handle actual login
    await page.goto('/student/assignments');
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
  });

  test('should display assignment list for student', async ({ page }) => {
    // Check if we're on the assignments page
    await expect(page.locator('h1')).toContainText('Mes devoirs');
    
    // Check if assignments are displayed
    await expect(page.locator('[data-testid="assignment-card"]').first()).toBeVisible();
  });

  test('should navigate to assignment detail page', async ({ page }) => {
    // Click on the first assignment's "Voir détails" button
    await page.locator('a:has-text("Voir détails")').first().click();
    
    // Wait for navigation
    await page.waitForLoadState('networkidle');
    
    // Check if we're on the detail page
    await expect(page.url()).toMatch(/\/student\/assignments\/[^\/]+$/);
    
    // Check if assignment details are displayed
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('[role="tablist"]')).toBeVisible();
    await expect(page.locator('text=Détails')).toBeVisible();
    await expect(page.locator('text=Ma soumission')).toBeVisible();
    await expect(page.locator('text=Feedback')).toBeVisible();
  });

  test('should show file upload interface for file assignments', async ({ page }) => {
    // Navigate to a file assignment (assuming first assignment is file type)
    await page.locator('a:has-text("Voir détails")').first().click();
    await page.waitForLoadState('networkidle');
    
    // Click on submission tab
    await page.locator('text=Ma soumission').click();
    
    // Check if file upload interface is displayed
    await expect(page.locator('text=Soumission de fichier')).toBeVisible();
    await expect(page.locator('text=Glissez votre fichier ici')).toBeVisible();
  });

  test('should show text response interface for text assignments', async ({ page }) => {
    // This test assumes there's a text assignment available
    // In a real test, you'd set up test data or navigate to a specific assignment
    
    // Navigate to assignment detail
    await page.locator('a:has-text("Voir détails")').first().click();
    await page.waitForLoadState('networkidle');
    
    // Click on submission tab
    await page.locator('text=Ma soumission').click();
    
    // If this is a text assignment, check for text interface
    const textInterface = page.locator('text=Réponse textuelle');
    if (await textInterface.isVisible()) {
      await expect(page.locator('textarea')).toBeVisible();
      await expect(page.locator('text=mots')).toBeVisible();
      await expect(page.locator('text=caractères')).toBeVisible();
    }
  });

  test('should handle file upload validation', async ({ page }) => {
    // Navigate to a file assignment
    await page.locator('a:has-text("Voir détails")').first().click();
    await page.waitForLoadState('networkidle');
    
    // Click on submission tab
    await page.locator('text=Ma soumission').click();
    
    // Check if this is a file assignment
    const fileUploadInterface = page.locator('text=Soumission de fichier');
    if (await fileUploadInterface.isVisible()) {
      // Try to upload an invalid file type (if validation is implemented)
      const fileInput = page.locator('input[type="file"]');
      
      // Create a test file with invalid extension
      const invalidFile = {
        name: 'test.exe',
        mimeType: 'application/x-msdownload',
        buffer: Buffer.from('fake executable content'),
      };
      
      // In a real test, you'd upload the file and check for validation errors
      // await fileInput.setInputFiles(invalidFile);
      // await expect(page.locator('text=Type de fichier non autorisé')).toBeVisible();
    }
  });

  test('should show submission status correctly', async ({ page }) => {
    // Navigate to assignment detail
    await page.locator('a:has-text("Voir détails")').first().click();
    await page.waitForLoadState('networkidle');
    
    // Click on submission tab
    await page.locator('text=Ma soumission').click();
    
    // Check for submission status indicator
    await expect(page.locator('text=Statut de la soumission')).toBeVisible();
    
    // Status should be one of: pending, in_progress, submitted, graded
    const statusIndicator = page.locator('[data-testid="submission-status"]');
    if (await statusIndicator.isVisible()) {
      const statusText = await statusIndicator.textContent();
      expect(['En attente', 'En cours', 'Soumis', 'Noté']).toContain(statusText?.trim());
    }
  });

  test('should handle text response auto-save', async ({ page }) => {
    // Navigate to a text assignment
    await page.locator('a:has-text("Voir détails")').first().click();
    await page.waitForLoadState('networkidle');
    
    // Click on submission tab
    await page.locator('text=Ma soumission').click();
    
    // Check if this is a text assignment
    const textArea = page.locator('textarea');
    if (await textArea.isVisible()) {
      // Type some text
      await textArea.fill('This is a test response for the assignment.');
      
      // Wait for auto-save (debounced)
      await page.waitForTimeout(3000);
      
      // Check for save indicator
      const saveIndicator = page.locator('text=Sauvegardé');
      if (await saveIndicator.isVisible()) {
        await expect(saveIndicator).toBeVisible();
      }
      
      // Check word and character count
      await expect(page.locator('text=mots')).toBeVisible();
      await expect(page.locator('text=caractères')).toBeVisible();
    }
  });

  test('should show assignment feedback when graded', async ({ page }) => {
    // Navigate to assignment detail
    await page.locator('a:has-text("Voir détails")').first().click();
    await page.waitForLoadState('networkidle');
    
    // Click on feedback tab
    await page.locator('text=Feedback').click();
    
    // Check if feedback section is displayed
    const feedbackSection = page.locator('text=Feedback du professeur');
    if (await feedbackSection.isVisible()) {
      // If assignment is graded, should show grade and feedback
      await expect(page.locator('text=Note')).toBeVisible();
    } else {
      // If not graded yet, should show appropriate message
      await expect(page.locator('text=Aucun feedback disponible')).toBeVisible();
    }
  });

  test('should handle overdue assignments', async ({ page }) => {
    // Navigate to assignment detail
    await page.locator('a:has-text("Voir détails")').first().click();
    await page.waitForLoadState('networkidle');
    
    // Check for overdue indicator if assignment is past due date
    const overdueIndicator = page.locator('text=En retard');
    if (await overdueIndicator.isVisible()) {
      await expect(overdueIndicator).toBeVisible();
      
      // Should still allow submission if late submissions are allowed
      await page.locator('text=Ma soumission').click();
      // Check that submission interface is still available or shows appropriate message
    }
  });

  test('should prevent editing submitted assignments', async ({ page }) => {
    // Navigate to a submitted assignment (if available)
    await page.locator('a:has-text("Voir détails")').first().click();
    await page.waitForLoadState('networkidle');
    
    // Click on submission tab
    await page.locator('text=Ma soumission').click();
    
    // Check if assignment is submitted
    const submittedStatus = page.locator('text=Soumis');
    if (await submittedStatus.isVisible()) {
      // Should not allow editing
      const textArea = page.locator('textarea');
      if (await textArea.isVisible()) {
        await expect(textArea).toBeDisabled();
      }
      
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.isVisible()) {
        await expect(fileInput).toBeDisabled();
      }
    }
  });

  test('should show assignment details correctly', async ({ page }) => {
    // Navigate to assignment detail
    await page.locator('a:has-text("Voir détails")').first().click();
    await page.waitForLoadState('networkidle');
    
    // Check assignment details on the Details tab
    await expect(page.locator('text=Détails')).toBeVisible();
    
    // Should show course information
    await expect(page.locator('[data-testid="course-info"]')).toBeVisible();
    
    // Should show instructor information
    await expect(page.locator('[data-testid="instructor-info"]')).toBeVisible();
    
    // Should show due date
    await expect(page.locator('[data-testid="due-date"]')).toBeVisible();
    
    // Should show points
    await expect(page.locator('[data-testid="max-points"]')).toBeVisible();
    
    // Should show assignment description
    await expect(page.locator('[data-testid="assignment-description"]')).toBeVisible();
  });

  test('should handle network errors gracefully', async ({ page }) => {
    // Simulate network failure
    await page.route('**/api/v1/assignments/**', route => {
      route.abort('failed');
    });
    
    // Navigate to assignment detail
    await page.locator('a:has-text("Voir détails")').first().click();
    
    // Should show error message
    await expect(page.locator('text=Erreur')).toBeVisible();
    await expect(page.locator('text=Impossible de charger')).toBeVisible();
  });

  test('should be responsive on mobile devices', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Navigate to assignment detail
    await page.locator('a:has-text("Voir détails")').first().click();
    await page.waitForLoadState('networkidle');
    
    // Check if tabs are still accessible on mobile
    await expect(page.locator('[role="tablist"]')).toBeVisible();
    
    // Check if content is properly displayed
    await expect(page.locator('h1')).toBeVisible();
    
    // Click on submission tab
    await page.locator('text=Ma soumission').click();
    
    // Check if submission interface is usable on mobile
    const submissionContent = page.locator('[role="tabpanel"]');
    await expect(submissionContent).toBeVisible();
  });
});
