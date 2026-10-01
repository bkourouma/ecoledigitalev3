import { Page, expect } from '@playwright/test';

// Mots de passe fournis par l'environnement : E2E_TEACHER_PASSWORD, E2E_STUDENT_PASSWORD.
export const TEST_ACCOUNTS = {
  teacher: {
    email: 'kouadio.assi@ecoledigitale.ci',
    password: process.env.E2E_TEACHER_PASSWORD ?? '',
    role: 'teacher'
  },
  student: {
    email: 'kacoucelestin@gmail.com',
    password: process.env.E2E_STUDENT_PASSWORD ?? '',
    role: 'student'
  }
};

export async function loginAsTeacher(page: Page) {
  await login(page, TEST_ACCOUNTS.teacher);
}

export async function loginAsStudent(page: Page) {
  await login(page, TEST_ACCOUNTS.student);
}

export async function login(page: Page, account: { email: string; password: string; role: string }) {
  // Navigate to login page
  await page.goto('/auth/signin');
  
  // Wait for the page to load
  await page.waitForLoadState('networkidle');
  
  // Fill in credentials
  await page.fill('input[name="email"]', account.email);
  await page.fill('input[name="password"]', account.password);
  
  // Submit the form
  await page.click('button[type="submit"]');
  
  // Wait for redirect after successful login
  await page.waitForURL('**', { timeout: 10000 });
  
  // Verify we're logged in by checking for user-specific elements
  if (account.role === 'teacher') {
    await expect(page.locator('text=Tableau de Bord')).toBeVisible({ timeout: 10000 });
  } else if (account.role === 'student') {
    await expect(page.locator('text=Mes Cours')).toBeVisible({ timeout: 10000 });
  }
}

export async function logout(page: Page) {
  // Look for logout button in sidebar or header
  const logoutButton = page.locator('button:has-text("Déconnexion"), a:has-text("Déconnexion")');
  
  if (await logoutButton.isVisible()) {
    await logoutButton.click();
  } else {
    // Alternative: navigate to sign out URL
    await page.goto('/auth/signout');
  }
  
  // Wait for redirect to login page
  await page.waitForURL('**/auth/signin', { timeout: 10000 });
}

export async function ensureLoggedOut(page: Page) {
  try {
    await logout(page);
  } catch (error) {
    // If logout fails, we might already be logged out
    console.log('Logout failed, might already be logged out:', error);
  }
}

export async function waitForPageLoad(page: Page, timeout = 10000) {
  await page.waitForLoadState('networkidle', { timeout });
  
  // Wait for any loading spinners to disappear
  const loadingSpinners = page.locator('.animate-spin, [data-testid="loading"]');
  if (await loadingSpinners.count() > 0) {
    await loadingSpinners.first().waitFor({ state: 'hidden', timeout });
  }
}

export async function expectToBeOnPage(page: Page, urlPattern: string | RegExp) {
  await expect(page).toHaveURL(urlPattern, { timeout: 10000 });
}

export async function expectUserRole(page: Page, role: 'teacher' | 'student') {
  if (role === 'teacher') {
    // Check for teacher-specific navigation items
    await expect(page.locator('text=Corrections en Attente')).toBeVisible({ timeout: 5000 });
  } else if (role === 'student') {
    // Check for student-specific navigation items
    await expect(page.locator('text=Mes Notes')).toBeVisible({ timeout: 5000 });
  }
}
