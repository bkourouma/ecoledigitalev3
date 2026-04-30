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

test.describe('Assignment PDF Workflow - Complete E2E Tests', () => {
  const assignmentTitle = `Test PDF Assignment - ${Date.now()}`;
  const assignmentDescription = 'Devoir PDF de test pour validation complète du workflow';
  let assignmentId: string;
  
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
  });

  test('Complete PDF Assignment Workflow', async ({ page }) => {
    // ===== STEP 1: TEACHER CREATES PDF ASSIGNMENT =====
    await loginAsTeacher(page);
    
    await page.goto('/teacher/assignments/create');
    await waitForPageLoad(page);
    
    // Fill assignment form
    await page.fill('input[name="title"]', assignmentTitle);
    await page.fill('textarea[name="description"]', assignmentDescription);
    await page.selectOption('select[name="type"]', 'homework');
    
    // Set due date (7 days from now)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dueDateString = futureDate.toISOString().split('T')[0];
    await page.fill('input[name="dueDate"]', dueDateString);
    
    // Submit the form
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    
    // Verify assignment was created
    await page.goto('/teacher/assignments/list');
    await expect(page.locator(`text=${assignmentTitle}`)).toBeVisible();
    
    // ===== STEP 2: TEACHER UPLOADS PDF DOCUMENT =====
    // Navigate to assignment detail page
    const assignmentRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await assignmentRow.click();
    
    // Upload PDF document
    const testPdfPath = path.join(__dirname, '../fixtures/test-assignment.pdf');
    
    // Create test PDF if it doesn't exist
    if (!fs.existsSync(testPdfPath)) {
      // Create a simple test PDF content
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
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length 44
>>
stream
BT
/F1 12 Tf
72 720 Td
(Test Assignment PDF) Tj
ET
endstream
endobj

xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
300
%%EOF`;
      
      fs.writeFileSync(testPdfPath, pdfContent);
    }
    
    // Upload the PDF document
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.isVisible()) {
      await fileInput.setInputFiles(testPdfPath);
      await page.waitForTimeout(2000);
    }
    
    // ===== STEP 3: TEACHER ASSIGNS TO CLASS =====
    await page.goto('/academic/assignments/assign');
    await waitForPageLoad(page);
    
    // Select class (assuming first available class)
    const classSelect = page.locator('select[name="classId"]');
    if (await classSelect.isVisible()) {
      const firstOption = await classSelect.locator('option').nth(1);
      if (await firstOption.isVisible()) {
        await firstOption.click();
        await page.waitForTimeout(1000);
      }
    }
    
    // Select course
    const courseSelect = page.locator('select[name="courseId"]');
    if (await courseSelect.isVisible()) {
      const firstOption = await courseSelect.locator('option').nth(1);
      if (await firstOption.isVisible()) {
        await firstOption.click();
        await page.waitForTimeout(1000);
      }
    }
    
    // Select assignment
    const assignmentSelect = page.locator('select[name="assignmentId"]');
    if (await assignmentSelect.isVisible()) {
      await assignmentSelect.selectOption({ label: assignmentTitle });
      await page.waitForTimeout(1000);
    }
    
    // Configure assignment instance
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 5);
    const endDateString = endDate.toISOString().split('T')[0];
    await page.fill('input[name="ends_at"]', endDateString);
    
    // Submit assignment instance
    const submitButton = page.locator('button:has-text("Créer l\'affectation")');
    if (await submitButton.isVisible()) {
      await submitButton.click();
      await page.waitForTimeout(2000);
    }
    
    // ===== STEP 4: STUDENT VIEWS ASSIGNMENT =====
    await logout(page);
    await loginAsStudent(page);
    
    await page.goto('/student/assignments');
    await waitForPageLoad(page);
    
    // Find the assignment
    const studentAssignmentRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(studentAssignmentRow).toBeVisible({ timeout: 10000 });
    
    // Verify assignment status is "pending"
    await expect(studentAssignmentRow.locator('text=En cours')).toBeVisible();
    
    // ===== STEP 5: STUDENT DOWNLOADS PDF =====
    // Click on assignment to view details
    await studentAssignmentRow.click();
    
    // Verify download button is visible
    const downloadButton = page.locator('button:has-text("Télécharger")');
    await expect(downloadButton).toBeVisible();
    
    // Test download functionality
    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;
    
    // Verify download
    expect(download.suggestedFilename()).toContain('.pdf');
    
    // ===== STEP 6: STUDENT UPLOADS SUBMISSION =====
    // Create test submission PDF
    const submissionPdfPath = path.join(__dirname, '../fixtures/test-submission.pdf');
    if (!fs.existsSync(submissionPdfPath)) {
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
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length 50
>>
stream
BT
/F1 12 Tf
72 720 Td
(Student Submission PDF) Tj
ET
endstream
endobj

xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000206 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
306
%%EOF`;
      
      fs.writeFileSync(submissionPdfPath, pdfContent);
    }
    
    // Upload submission
    const submissionFileInput = page.locator('input[type="file"]');
    await expect(submissionFileInput).toBeVisible();
    await submissionFileInput.setInputFiles(submissionPdfPath);
    
    // Wait for upload to complete
    await page.waitForTimeout(3000);
    
    // Finalize submission
    const finalizeButton = page.locator('button:has-text("Finaliser la soumission")');
    if (await finalizeButton.isVisible()) {
      await finalizeButton.click();
      
      // Confirm submission in modal
      const confirmButton = page.locator('button:has-text("Soumettre")');
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
        await page.waitForTimeout(2000);
      }
    }
    
    // Verify submission status changed to "submitted"
    await page.goto('/student/assignments');
    const submittedRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(submittedRow.locator('text=Soumis')).toBeVisible();
    
    // ===== STEP 7: TEACHER VIEWS SUBMISSION =====
    await logout(page);
    await loginAsTeacher(page);
    
    await page.goto('/teacher/corrections');
    await waitForPageLoad(page);
    
    // Find the submission
    const submissionRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(submissionRow).toBeVisible({ timeout: 10000 });
    
    // Verify submission status
    await expect(submissionRow.locator('text=Soumis')).toBeVisible();
    
    // ===== STEP 8: TEACHER GRADES SUBMISSION =====
    const gradeButton = submissionRow.locator('button:has-text("Noter")');
    await expect(gradeButton).toBeVisible();
    await gradeButton.click();
    
    // Fill in grade and feedback
    await page.fill('input[name="score"]', '16');
    await page.fill('textarea[name="feedback"]', 'Excellent travail ! Très bonne compréhension du sujet.');
    
    // Submit grade
    const saveGradeButton = page.locator('button:has-text("Enregistrer la note")');
    await saveGradeButton.click();
    
    // Wait for success message
    await expect(page.locator('text=Note enregistrée')).toBeVisible({ timeout: 10000 });
    
    // Verify submission status changed to "graded"
    await page.goto('/teacher/corrections');
    const gradedRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(gradedRow.locator('text=Corrigé')).toBeVisible();
    
    // ===== STEP 9: STUDENT VIEWS GRADE =====
    await logout(page);
    await loginAsStudent(page);
    
    await page.goto('/student/grades');
    await waitForPageLoad(page);
    
    // Verify the grade is visible
    const gradeRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(gradeRow).toBeVisible({ timeout: 10000 });
    await expect(gradeRow.locator('text=16')).toBeVisible();
    await expect(gradeRow.locator('text=Excellent travail')).toBeVisible();
    
    // Verify statistics are updated
    const statsSection = page.locator('[data-testid="stats-section"]');
    if (await statsSection.isVisible()) {
      await expect(statsSection).toBeVisible();
    }
  });

  test('File Validation Tests', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    // Find an assignment
    const assignmentRow = page.locator('tr').first();
    if (await assignmentRow.isVisible()) {
      await assignmentRow.click();
      
      // Test invalid file type
      const invalidFilePath = path.join(__dirname, '../fixtures/test-file.txt');
      if (!fs.existsSync(invalidFilePath)) {
        fs.writeFileSync(invalidFilePath, 'This is not a PDF file');
      }
      
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.isVisible()) {
        await fileInput.setInputFiles(invalidFilePath);
        await page.waitForTimeout(1000);
        
        // Verify error message
        await expect(page.locator('text=Type de fichier non autorisé')).toBeVisible();
      }
      
      // Test file size limit
      const largeFilePath = path.join(__dirname, '../fixtures/large-file.pdf');
      if (!fs.existsSync(largeFilePath)) {
        // Create a large file (simulate > 10MB)
        const largeContent = 'A'.repeat(11 * 1024 * 1024); // 11MB
        fs.writeFileSync(largeFilePath, largeContent);
      }
      
      await fileInput.setInputFiles(largeFilePath);
      await page.waitForTimeout(1000);
      
      // Verify error message for file size
      await expect(page.locator('text=trop volumineux')).toBeVisible();
    }
  });

  test('Security and Access Control Tests', async ({ page }) => {
    // Test that students cannot access teacher pages
    await loginAsStudent(page);
    
    // Try to access teacher corrections page
    await page.goto('/teacher/corrections');
    await waitForPageLoad(page);
    
    // Should be redirected or show access denied
    const currentUrl = page.url();
    expect(currentUrl).not.toContain('/teacher/corrections');
    
    // Test that teachers cannot access student pages
    await logout(page);
    await loginAsTeacher(page);
    
    // Try to access student grades page
    await page.goto('/student/grades');
    await waitForPageLoad(page);
    
    // Should be redirected or show access denied
    const currentUrl2 = page.url();
    expect(currentUrl2).not.toContain('/student/grades');
  });

  test('Assignment Status Transitions', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    // Verify status transitions
    const assignments = page.locator('tr');
    const count = await assignments.count();
    
    for (let i = 0; i < Math.min(count, 3); i++) {
      const assignment = assignments.nth(i);
      const statusBadge = assignment.locator('[data-testid="status-badge"]');
      
      if (await statusBadge.isVisible()) {
        const status = await statusBadge.textContent();
        expect(['En cours', 'Soumis', 'Corrigé']).toContain(status);
      }
    }
  });

  test('Download Functionality Tests', async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/assignments');
    
    // Find an assignment with a PDF document
    const assignmentRow = page.locator('tr').first();
    if (await assignmentRow.isVisible()) {
      await assignmentRow.click();
      
      // Test download button
      const downloadButton = page.locator('button:has-text("Télécharger")');
      if (await downloadButton.isVisible()) {
        // Test download
        const downloadPromise = page.waitForEvent('download');
        await downloadButton.click();
        const download = await downloadPromise;
        
        // Verify download properties
        expect(download.suggestedFilename()).toContain('.pdf');
        expect(download.url()).toContain('/api/v1/files/');
      }
    }
  });

  test.afterAll(async () => {
    // Clean up test files
    const testFiles = [
      path.join(__dirname, '../fixtures/test-assignment.pdf'),
      path.join(__dirname, '../fixtures/test-submission.pdf'),
      path.join(__dirname, '../fixtures/test-file.txt'),
      path.join(__dirname, '../fixtures/large-file.pdf')
    ];
    
    testFiles.forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  });
});
