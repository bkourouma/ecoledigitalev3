import { test, expect } from '@playwright/test';
import { 
  loginAsTeacher, 
  loginAsStudent, 
  logout, 
  ensureLoggedOut,
  expectUserRole,
  TEST_ACCOUNTS 
} from '../utils/auth-helpers';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure we start each test logged out
    await ensureLoggedOut(page);
  });

  test('should login as teacher successfully', async ({ page }) => {
    await loginAsTeacher(page);
    
    // Verify we're on a teacher page
    await expectUserRole(page, 'teacher');
    
    // Check that we can see teacher-specific navigation
    await expect(page.locator('text=Créer des Devoirs')).toBeVisible();
    await expect(page.locator('text=Corrections en Attente')).toBeVisible();
  });

  test('should login as student successfully', async ({ page }) => {
    await loginAsStudent(page);
    
    // Verify we're on a student page
    await expectUserRole(page, 'student');
    
    // Check that we can see student-specific navigation
    await expect(page.locator('text=Devoirs')).toBeVisible();
    await expect(page.locator('text=Mes Notes')).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    // Login first
    await loginAsTeacher(page);
    
    // Then logout
    await logout(page);
    
    // Verify we're back on login page
    await expect(page).toHaveURL(/.*auth\/signin/);
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/auth/signin');
    
    // Try with invalid credentials
    await page.fill('input[name="email"]', 'invalid@example.com');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    
    // Should show error message or stay on login page
    await page.waitForTimeout(2000);
    
    // Check we're still on login page or see error message
    const currentUrl = page.url();
    const hasError = await page.locator('text=Erreur, text=Invalid, text=Incorrect').isVisible();
    
    expect(currentUrl.includes('/auth/signin') || hasError).toBeTruthy();
  });

  test('should redirect unauthenticated users to login', async ({ page }) => {
    // Try to access a protected teacher page without logging in
    await page.goto('/teacher/assignments');
    
    // Should be redirected to login
    await expect(page).toHaveURL(/.*auth\/signin/, { timeout: 10000 });
  });

  test('should prevent cross-role access', async ({ page }) => {
    // Login as student
    await loginAsStudent(page);
    
    // Try to access teacher page
    await page.goto('/teacher/corrections');
    
    // Should be redirected or show access denied
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    
    // Should not be on the teacher corrections page
    expect(currentUrl).not.toContain('/teacher/corrections');
  });

  test('should maintain session across page refreshes', async ({ page }) => {
    // Login as teacher
    await loginAsTeacher(page);
    
    // Navigate to a specific page
    await page.goto('/teacher/assignments/list');
    await expect(page.locator('text=Liste des Devoirs')).toBeVisible();
    
    // Refresh the page
    await page.reload();
    
    // Should still be logged in and on the same page
    await expect(page.locator('text=Liste des Devoirs')).toBeVisible();
    await expectUserRole(page, 'teacher');
  });
});
