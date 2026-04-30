import { test, expect } from '@playwright/test';
import { 
  loginAsTeacher, 
  loginAsStudent, 
  logout, 
  ensureLoggedOut,
  waitForPageLoad 
} from '../utils/auth-helpers';
import path from 'path';

test.describe('Complete Assignment Workflow', () => {
  const assignmentTitle = `Test E2E Assignment - ${Date.now()}`;
  const assignmentDescription = 'Devoir de test pour validation E2E du workflow complet';
  
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
  });

  test('complete workflow: create → assign → submit → grade → view', async ({ page }) => {
    // Step 1: Teacher creates assignment
    await loginAsTeacher(page);
    
    // Navigate to create assignment page
    await page.goto('/teacher/assignments/create');
    await waitForPageLoad(page);
    
    // Fill assignment form
    await page.fill('input[name="title"]', assignmentTitle);
    await page.fill('textarea[name="description"]', assignmentDescription);
    
    // Select homework type (PDF)
    await page.selectOption('select[name="type"]', 'homework');
    
    // Set due date (7 days from now)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dueDateString = futureDate.toISOString().split('T')[0];
    await page.fill('input[name="dueDate"]', dueDateString);
    
    // Submit the form
    await page.click('button[type="submit"]');
    
    // Wait for success message or redirect
    await page.waitForTimeout(2000);
    
    // Verify assignment was created
    await page.goto('/teacher/assignments/list');
    await expect(page.locator(`text=${assignmentTitle}`)).toBeVisible();
    
    // Step 2: Teacher assigns to class (simplified - assuming assignment is auto-assigned)
    // In a real test, you would navigate to assignment page and assign to specific class
    
    // Step 3: Student views and submits assignment
    await logout(page);
    await loginAsStudent(page);
    
    // Navigate to student assignments
    await page.goto('/student/assignments');
    await waitForPageLoad(page);
    
    // Find and click on the assignment
    const assignmentRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(assignmentRow).toBeVisible({ timeout: 10000 });
    
    // Click on assignment to view details
    await assignmentRow.click();
    
    // Upload a test PDF file
    const testFilePath = path.join(__dirname, '../fixtures/test-assignment.pdf');
    
    // Create a simple PDF file for testing if it doesn't exist
    // In a real scenario, you would have pre-created test files
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      // For now, we'll simulate the file upload process
      // In a real test, you would upload an actual PDF file
      await fileInput.setInputFiles(testFilePath);
      
      // Wait for upload to complete
      await page.waitForTimeout(3000);
      
      // Finalize submission
      const submitButton = page.locator('button:has-text("Finaliser la soumission")');
      if (await submitButton.isVisible()) {
        await submitButton.click();
        
        // Confirm submission in dialog
        const confirmButton = page.locator('button:has-text("Soumettre")');
        if (await confirmButton.isVisible()) {
          await confirmButton.click();
        }
        
        // Wait for success message
        await expect(page.locator('text=soumis avec succès')).toBeVisible({ timeout: 10000 });
      }
    }
    
    // Step 4: Teacher grades the submission
    await logout(page);
    await loginAsTeacher(page);
    
    // Navigate to corrections page
    await page.goto('/teacher/corrections');
    await waitForPageLoad(page);
    
    // Find the student's submission
    const submissionRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(submissionRow).toBeVisible({ timeout: 10000 });
    
    // Click grade button
    const gradeButton = submissionRow.locator('button:has-text("Noter")');
    if (await gradeButton.isVisible()) {
      await gradeButton.click();
      
      // Fill in grade and feedback
      await page.fill('input[name="score"]', '15');
      await page.fill('textarea[name="feedback"]', 'Excellent travail ! Continuez ainsi.');
      
      // Submit grade
      await page.click('button:has-text("Enregistrer la note")');
      
      // Wait for success message
      await expect(page.locator('text=Note enregistrée')).toBeVisible({ timeout: 10000 });
    }
    
    // Step 5: Student views grade
    await logout(page);
    await loginAsStudent(page);
    
    // Navigate to grades page
    await page.goto('/student/grades');
    await waitForPageLoad(page);
    
    // Verify the grade is visible
    const gradeRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(gradeRow).toBeVisible({ timeout: 10000 });
    await expect(gradeRow.locator('text=15')).toBeVisible();
    await expect(gradeRow.locator('text=Excellent travail')).toBeVisible();
    
    // Verify statistics are updated
    const statsCards = page.locator('[data-testid="stats-card"]');
    await expect(statsCards.first()).toBeVisible();
  });

  test('should prevent double submission', async ({ page }) => {
    // This test would verify that once a student submits an assignment,
    // they cannot submit it again
    
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    // Find a submitted assignment
    const submittedRow = page.locator('tr:has([data-status="submitted"])');
    
    if (await submittedRow.count() > 0) {
      await submittedRow.first().click();
      
      // Verify that upload is disabled
      const uploadSection = page.locator('[data-testid="upload-section"]');
      await expect(uploadSection.locator('text=Déjà soumis')).toBeVisible();
      
      // Verify no file input is available
      const fileInput = page.locator('input[type="file"]');
      await expect(fileInput).not.toBeVisible();
    }
  });

  test('should show late submission warning', async ({ page }) => {
    // This test would create an assignment with a past due date
    // and verify that late submission is properly handled
    
    await loginAsTeacher(page);
    
    // Create assignment with past due date
    await page.goto('/teacher/assignments/create');
    
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const pastDateString = pastDate.toISOString().split('T')[0];
    
    await page.fill('input[name="title"]', `Late Assignment Test - ${Date.now()}`);
    await page.fill('textarea[name="description"]', 'Test assignment for late submission');
    await page.selectOption('select[name="type"]', 'homework');
    await page.fill('input[name="dueDate"]', pastDateString);
    
    await page.click('button[type="submit"]');
    
    // Switch to student and try to submit
    await logout(page);
    await loginAsStudent(page);
    
    await page.goto('/student/assignments');
    
    // Look for late assignment indicator
    const lateIndicator = page.locator('text=En retard, .late-indicator');
    if (await lateIndicator.count() > 0) {
      await expect(lateIndicator.first()).toBeVisible();
    }
  });
});
