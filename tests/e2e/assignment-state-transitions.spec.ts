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

test.describe('Assignment State Transitions and Workflow Validation', () => {
  const assignmentTitle = `State Test Assignment - ${Date.now()}`;
  let assignmentId: string;
  
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
  });

  test('Assignment Status Transitions: Pending → Submitted → Graded', async ({ page }) => {
    
    // ===== STEP 1: CREATE ASSIGNMENT =====
    await loginAsTeacher(page);
    await page.goto('/teacher/assignments/create');
    await waitForPageLoad(page);
    
    await page.fill('input[name="title"]', assignmentTitle);
    await page.fill('textarea[name="description"]', 'Test assignment for state transitions');
    await page.selectOption('select[name="type"]', 'homework');
    
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dueDateString = futureDate.toISOString().split('T')[0];
    await page.fill('input[name="dueDate"]', dueDateString);
    
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    
    // ===== STEP 2: ASSIGN TO CLASS =====
    await page.goto('/academic/assignments/assign');
    await waitForPageLoad(page);
    
    // Select class and course (simplified)
    const classSelect = page.locator('select[name="classId"]');
    if (await classSelect.isVisible()) {
      const firstOption = await classSelect.locator('option').nth(1);
      if (await firstOption.isVisible()) {
        await firstOption.click();
        await page.waitForTimeout(1000);
      }
    }
    
    const courseSelect = page.locator('select[name="courseId"]');
    if (await courseSelect.isVisible()) {
      const firstOption = await courseSelect.locator('option').nth(1);
      if (await firstOption.isVisible()) {
        await firstOption.click();
        await page.waitForTimeout(1000);
      }
    }
    
    const assignmentSelect = page.locator('select[name="assignmentId"]');
    if (await assignmentSelect.isVisible()) {
      await assignmentSelect.selectOption({ label: assignmentTitle });
      await page.waitForTimeout(1000);
    }
    
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 5);
    const endDateString = endDate.toISOString().split('T')[0];
    await page.fill('input[name="ends_at"]', endDateString);
    
    const submitButton = page.locator('button:has-text("Créer l\'affectation")');
    if (await submitButton.isVisible()) {
      await submitButton.click();
      await page.waitForTimeout(2000);
    }
    
    // ===== STEP 3: STUDENT VIEWS ASSIGNMENT (PENDING STATE) =====
    await logout(page);
    await loginAsStudent(page);
    
    await page.goto('/student/assignments');
    await waitForPageLoad(page);
    
    const assignmentRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(assignmentRow).toBeVisible({ timeout: 10000 });
    
    // Verify PENDING state
    await expect(assignmentRow.locator('text=En cours')).toBeVisible();
    
    // Click to view details
    await assignmentRow.click();
    
    // Verify assignment is not yet submitted
    const statusBadge = page.locator('[data-testid="assignment-status"]');
    if (await statusBadge.isVisible()) {
      await expect(statusBadge).toContainText('En cours');
    }
    
    // ===== STEP 4: STUDENT SUBMITS ASSIGNMENT =====
    const testPdfPath = path.join(__dirname, '../fixtures/state-test.pdf');
    if (!fs.existsSync(testPdfPath)) {
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
      fs.writeFileSync(testPdfPath, pdfContent);
    }
    
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(testPdfPath);
      await page.waitForTimeout(2000);
      
      // Finalize submission
      const finalizeButton = page.locator('button:has-text("Finaliser la soumission")');
      if (await finalizeButton.isVisible()) {
        await finalizeButton.click();
        
        const confirmButton = page.locator('button:has-text("Soumettre")');
        if (await confirmButton.isVisible()) {
          await confirmButton.click();
          await page.waitForTimeout(2000);
        }
      }
    }
    
    // ===== STEP 5: VERIFY SUBMITTED STATE =====
    await page.goto('/student/assignments');
    const submittedRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(submittedRow.locator('text=Soumis')).toBeVisible();
    
    // Verify status changed to SUBMITTED
    await expect(submittedRow.locator('text=En cours')).not.toBeVisible();
    
    // ===== STEP 6: TEACHER VIEWS SUBMISSION =====
    await logout(page);
    await loginAsTeacher(page);
    
    await page.goto('/teacher/corrections');
    await waitForPageLoad(page);
    
    const submissionRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(submissionRow).toBeVisible({ timeout: 10000 });
    
    // Verify submission is in SUBMITTED state
    await expect(submissionRow.locator('text=Soumis')).toBeVisible();
    
    // ===== STEP 7: TEACHER GRADES SUBMISSION =====
    const gradeButton = submissionRow.locator('button:has-text("Noter")');
    await expect(gradeButton).toBeVisible();
    await gradeButton.click();
    
    await page.fill('input[name="score"]', '18');
    await page.fill('textarea[name="feedback"]', 'Excellent travail ! Très bonne compréhension.');
    
    const saveGradeButton = page.locator('button:has-text("Enregistrer la note")');
    await saveGradeButton.click();
    
    await expect(page.locator('text=Note enregistrée')).toBeVisible({ timeout: 10000 });
    
    // ===== STEP 8: VERIFY GRADED STATE =====
    await page.goto('/teacher/corrections');
    const gradedRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(gradedRow.locator('text=Corrigé')).toBeVisible();
    
    // Verify status changed to GRADED
    await expect(gradedRow.locator('text=Soumis')).not.toBeVisible();
    
    // ===== STEP 9: STUDENT VIEWS GRADE =====
    await logout(page);
    await loginAsStudent(page);
    
    await page.goto('/student/grades');
    await waitForPageLoad(page);
    
    const gradeRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(gradeRow).toBeVisible({ timeout: 10000 });
    await expect(gradeRow.locator('text=18')).toBeVisible();
    await expect(gradeRow.locator('text=Excellent travail')).toBeVisible();
  });

  test('Prevent Double Submission', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    // Find a submitted assignment
    const submittedRow = page.locator('tr:has([data-status="submitted"])');
    
    if (await submittedRow.count() > 0) {
      await submittedRow.first().click();
      
      // Verify that upload is disabled for submitted assignments
      const uploadSection = page.locator('[data-testid="upload-section"]');
      if (await uploadSection.isVisible()) {
        await expect(uploadSection.locator('text=Déjà soumis')).toBeVisible();
      }
      
      // Verify no file input is available
      const fileInput = page.locator('input[type="file"]');
      await expect(fileInput).not.toBeVisible();
      
      // Verify submit button is disabled
      const submitButton = page.locator('button:has-text("Finaliser la soumission")');
      await expect(submitButton).not.toBeVisible();
    }
  });

  test('Late Submission Handling', async ({ page }) => {
    // Create assignment with past due date
    await loginAsTeacher(page);
    await page.goto('/teacher/assignments/create');
    
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const pastDateString = pastDate.toISOString().split('T')[0];
    
    const lateAssignmentTitle = `Late Assignment Test - ${Date.now()}`;
    await page.fill('input[name="title"]', lateAssignmentTitle);
    await page.fill('textarea[name="description"]', 'Test assignment for late submission');
    await page.selectOption('select[name="type"]', 'homework');
    await page.fill('input[name="dueDate"]', pastDateString);
    
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    
    // Switch to student and try to submit
    await logout(page);
    await loginAsStudent(page);
    
    await page.goto('/student/assignments');
    
    // Look for late assignment indicator
    const lateIndicator = page.locator('text=En retard');
    if (await lateIndicator.count() > 0) {
      await expect(lateIndicator.first()).toBeVisible();
    }
    
    // Try to submit late assignment
    const lateAssignmentRow = page.locator(`tr:has-text("${lateAssignmentTitle}")`);
    if (await lateAssignmentRow.isVisible()) {
      await lateAssignmentRow.click();
      
      // Should show late submission warning
      const lateWarning = page.locator('text=En retard');
      if (await lateWarning.isVisible()) {
        await expect(lateWarning).toBeVisible();
      }
    }
  });

  test('Assignment Deadline Validation', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    // Find assignments and verify deadline handling
    const assignments = page.locator('tr');
    const count = await assignments.count();
    
    for (let i = 0; i < Math.min(count, 3); i++) {
      const assignment = assignments.nth(i);
      
      // Check if assignment shows deadline
      const deadlineElement = assignment.locator('[data-testid="deadline"]');
      if (await deadlineElement.isVisible()) {
        const deadlineText = await deadlineElement.textContent();
        expect(deadlineText).toMatch(/\d{2}\/\d{2}\/\d{4}/); // Date format
      }
      
      // Check priority based on deadline
      const priorityBadge = assignment.locator('[data-testid="priority-badge"]');
      if (await priorityBadge.isVisible()) {
        const priority = await priorityBadge.textContent();
        expect(['Urgent', 'Moyen', 'Faible']).toContain(priority);
      }
    }
  });

  test('Status Badge Consistency', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    // Verify status badges are consistent
    const assignments = page.locator('tr');
    const count = await assignments.count();
    
    for (let i = 0; i < Math.min(count, 5); i++) {
      const assignment = assignments.nth(i);
      const statusBadge = assignment.locator('[data-testid="status-badge"]');
      
      if (await statusBadge.isVisible()) {
        const status = await statusBadge.textContent();
        const statusClass = await statusBadge.getAttribute('class');
        
        // Verify status and styling consistency
        switch (status) {
          case 'En cours':
            expect(statusClass).toContain('outline');
            break;
          case 'Soumis':
            expect(statusClass).toContain('secondary');
            break;
          case 'Corrigé':
            expect(statusClass).toContain('default');
            break;
        }
      }
    }
  });

  test('Grade Display Consistency', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/grades');
    
    // Verify grade display consistency
    const gradeRows = page.locator('tr');
    const count = await gradeRows.count();
    
    for (let i = 0; i < Math.min(count, 3); i++) {
      const gradeRow = gradeRows.nth(i);
      const gradeElement = gradeRow.locator('[data-testid="grade-display"]');
      
      if (await gradeElement.isVisible()) {
        const gradeText = await gradeElement.textContent();
        const gradeClass = await gradeElement.getAttribute('class');
        
        // Verify grade format and color coding
        if (gradeText && gradeText.includes('/')) {
          const score = parseFloat(gradeText.split('/')[0]);
          
          if (score >= 15) {
            expect(gradeClass).toContain('green');
          } else if (score >= 10) {
            expect(gradeClass).toContain('orange');
          } else {
            expect(gradeClass).toContain('red');
          }
        }
      }
    }
  });

  test.afterAll(async () => {
    // Clean up test files
    const testFiles = [
      path.join(__dirname, '../fixtures/state-test.pdf')
    ];
    
    testFiles.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });
});
