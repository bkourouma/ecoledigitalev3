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

test.describe('API Integration Workflow - Backend API Tests', () => {
  const assignmentTitle = `API Test Assignment - ${Date.now()}`;
  const assignmentDescription = 'Test pour vérifier l\'intégration avec l\'API backend';
  
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
  });

  test('Complete API Integration Test', async ({ page }) => {
    // ===== STEP 1: VERIFY TEACHER CORRECTIONS API =====
    await loginAsTeacher(page);
    
    // Navigate to corrections page and verify it loads
    await page.goto('/teacher/corrections');
    await waitForPageLoad(page);
    
    // Check that the page loads without errors
    await expect(page.locator('h1:has-text("Corrections")')).toBeVisible();
    
    // Verify API call is made (check network tab or console for API calls)
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/teacher/corrections') && response.status() === 200
    );
    
    await page.reload();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    
    // ===== STEP 2: VERIFY STUDENT GRADES API =====
    await logout(page);
    await loginAsStudent(page);
    
    // Navigate to grades page and verify it loads
    await page.goto('/student/grades');
    await waitForPageLoad(page);
    
    // Check that the page loads without errors
    await expect(page.locator('h1:has-text("Mes Notes")')).toBeVisible();
    
    // Verify API call is made
    const gradesResponsePromise = page.waitForResponse(response => 
      response.url().includes('/api/student/grades') && response.status() === 200
    );
    
    await page.reload();
    const gradesResponse = await gradesResponsePromise;
    expect(gradesResponse.status()).toBe(200);
    
    // ===== STEP 3: TEST FILE UPLOAD API =====
    // Create a test assignment first
    await logout(page);
    await loginAsTeacher(page);
    
    await page.goto('/teacher/assignments/create');
    await waitForPageLoad(page);
    
    // Fill assignment form
    await page.fill('input[name="title"]', assignmentTitle);
    await page.fill('textarea[name="description"]', assignmentDescription);
    await page.selectOption('select[name="type"]', 'homework');
    
    // Set due date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dueDateString = futureDate.toISOString().split('T')[0];
    await page.fill('input[name="dueDate"]', dueDateString);
    
    // Submit the form
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    
    // Assign to class
    await page.goto('/academic/assignments/assign');
    await waitForPageLoad(page);
    
    const assignmentRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(assignmentRow).toBeVisible();
    
    const assignButton = assignmentRow.locator('button:has-text("Assigner")');
    await assignButton.click();
    
    // Select a class and assign
    await page.selectOption('select[name="classId"]', { index: 1 });
    await page.click('button:has-text("Confirmer l\'assignation")');
    await page.waitForTimeout(1000);
    
    // ===== STEP 4: TEST STUDENT FILE UPLOAD =====
    await logout(page);
    await loginAsStudent(page);
    
    await page.goto('/student/assignments');
    await waitForPageLoad(page);
    
    // Find and click on the assignment
    const studentAssignmentRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(studentAssignmentRow).toBeVisible();
    await studentAssignmentRow.click();
    
    // Create test submission PDF
    const submissionPdfPath = path.join(__dirname, '../fixtures/api-test-submission.pdf');
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
/Length 44
>>
stream
BT
/F1 12 Tf
100 700 Td
(API Test Submission) Tj
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
      
      fs.writeFileSync(submissionPdfPath, pdfContent);
    }
    
    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(submissionPdfPath);
    
    // Wait for upload to complete and verify API call
    const uploadResponsePromise = page.waitForResponse(response => 
      response.url().includes('/api/assignments/') && 
      response.url().includes('/submissions/upload') && 
      response.status() === 200
    );
    
    const uploadResponse = await uploadResponsePromise;
    expect(uploadResponse.status()).toBe(200);
    
    // Verify upload success message
    await expect(page.locator('text=Fichier téléchargé avec succès')).toBeVisible({ timeout: 10000 });
    
    // ===== STEP 5: TEST GRADING API =====
    await logout(page);
    await loginAsTeacher(page);
    
    await page.goto('/teacher/corrections');
    await waitForPageLoad(page);
    
    // Find the submission and grade it
    const submissionRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(submissionRow).toBeVisible({ timeout: 10000 });
    
    const gradeButton = submissionRow.locator('button[aria-label="Corriger"]');
    await gradeButton.click();
    
    // Fill in grade
    await page.fill('input[name="score"]', '18');
    await page.fill('textarea[name="feedback"]', 'Test API réussi !');
    
    // Submit grade and verify API call
    const gradeResponsePromise = page.waitForResponse(response => 
      response.url().includes('/api/assignments/') && 
      response.url().includes('/submissions/') &&
      response.url().includes('/grade') && 
      response.status() === 200
    );
    
    await page.click('button:has-text("Enregistrer la note")');
    const gradeResponse = await gradeResponsePromise;
    expect(gradeResponse.status()).toBe(200);
    
    // Verify success message
    await expect(page.locator('text=Note enregistrée avec succès')).toBeVisible({ timeout: 5000 });
    
    // ===== STEP 6: VERIFY GRADE IN STUDENT VIEW =====
    await logout(page);
    await loginAsStudent(page);
    
    await page.goto('/student/grades');
    await waitForPageLoad(page);
    
    // Verify the grade appears
    const gradeRow = page.locator(`tr:has-text("${assignmentTitle}")`);
    await expect(gradeRow).toBeVisible({ timeout: 10000 });
    await expect(gradeRow.locator('text=18')).toBeVisible();
    await expect(gradeRow.locator('text=Test API réussi !')).toBeVisible();
    
    console.log('✅ All API integration tests passed successfully!');
  });
});
