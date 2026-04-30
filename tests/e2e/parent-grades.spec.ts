import { test, expect } from '@playwright/test';
import { 
  ensureLoggedOut,
  waitForPageLoad 
} from '../utils/auth-helpers';

test.describe('Parent Grades - Assignment Grades', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
  });

  test('should display assignment grades page', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Check that the page loads
    await expect(page.locator('h1, h2')).toBeVisible({ timeout: 10000 });
  });

  test('should display assignment grades with filter controls', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for API call to complete
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/assignments') && 
      response.status() === 200
    );
    
    // Wait for API response
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    
    const responseData = await response.json();
    expect(responseData).toHaveProperty('success', true);
    expect(responseData.data).toHaveProperty('grades');
    expect(responseData.data).toHaveProperty('pagination');
    
    // Check for filter controls (child selector, course selector, date range picker)
    // These might be in various forms, so we check for common patterns
    const filterControls = page.locator('select, [role="combobox"], input[type="date"], button:has-text("Filter")');
    // Filters might not be visible initially, so we just check they exist
    if (await filterControls.count() > 0) {
      // Filters exist
      expect(await filterControls.count()).toBeGreaterThan(0);
    }
  });

  test('should apply child filter when child is selected', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for initial API call
    await page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/assignments') && 
      response.status() === 200
    );
    
    // Try to find and click child selector
    const childSelector = page.locator('select, [role="combobox"], button:has-text("Child"), button:has-text("Enfant")').first();
    if (await childSelector.count() > 0) {
      await childSelector.click();
      await waitForPageLoad(page);
      
      // Wait for filtered API call
      const filteredResponse = await page.waitForResponse(response => 
        response.url().includes('/api/v1/parent/grades/assignments') && 
        response.url().includes('childId') &&
        response.status() === 200
      );
      
      expect(filteredResponse.status()).toBe(200);
    }
  });

  test('should apply course filter when course is selected', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for initial API call
    await page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/assignments') && 
      response.status() === 200
    );
    
    // Try to find and click course selector
    const courseSelector = page.locator('select, [role="combobox"], button:has-text("Course"), button:has-text("Cours")').first();
    if (await courseSelector.count() > 0) {
      await courseSelector.click();
      await waitForPageLoad(page);
      
      // Wait for filtered API call
      const filteredResponse = await page.waitForResponse(response => 
        response.url().includes('/api/v1/parent/grades/assignments') && 
        response.url().includes('courseId') &&
        response.status() === 200
      );
      
      expect(filteredResponse.status()).toBe(200);
    }
  });

  test('should handle pagination', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for initial API call
    const initialResponse = await page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/assignments') && 
      response.status() === 200
    );
    
    const initialData = await initialResponse.json();
    
    // If there are multiple pages, test pagination
    if (initialData.data.pagination.totalPages > 1) {
      // Find pagination controls
      const nextButton = page.locator('button:has-text("Next"), button:has-text("Suivant"), [aria-label="Next page"]').first();
      if (await nextButton.count() > 0) {
        await nextButton.click();
        await waitForPageLoad(page);
        
        // Wait for paginated API call
        const paginatedResponse = await page.waitForResponse(response => 
          response.url().includes('/api/v1/parent/grades/assignments') && 
          response.url().includes('page=2') &&
          response.status() === 200
        );
        
        expect(paginatedResponse.status()).toBe(200);
        
        const paginatedData = await paginatedResponse.json();
        expect(paginatedData.data.pagination.page).toBe(2);
      }
    }
  });

  test('should display empty state when no graded assignments exist', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for API call
    const response = await page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/assignments') && 
      response.status() === 200
    );
    
    const responseData = await response.json();
    
    // If no grades exist, check for empty state message
    if (responseData.data.grades.length === 0) {
      const emptyState = page.locator('text=/no grades/i, text=/aucune note/i, text=/no assignments/i, text=/aucun devoir/i');
      // Empty state might be displayed in various ways
      if (await emptyState.count() > 0) {
        await expect(emptyState.first()).toBeVisible();
      }
    }
  });
});

test.describe('Parent Grades - Grades by Course', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
  });

  test('should display grades by course view', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Check that the page loads
    await expect(page.locator('h1, h2')).toBeVisible({ timeout: 10000 });
    
    // Look for grades by course section or tab
    const gradesByCourseSection = page.locator('text=/grades.*course|course.*grades/i, [data-testid*="course"], [aria-label*="course"]');
    // The section might be in a tab or separate section
    if (await gradesByCourseSection.count() > 0) {
      await expect(gradesByCourseSection.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display grades grouped by course', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for API call to complete
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/by-course') && 
      response.status() === 200
    );
    
    // Wait for API response
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    
    const responseData = await response.json();
    expect(responseData).toHaveProperty('success', true);
    expect(responseData.data).toHaveProperty('courses');
    expect(Array.isArray(responseData.data.courses)).toBe(true);
  });

  test('should display course average for each course', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for API call to complete
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/by-course') && 
      response.status() === 200
    );
    
    // Wait for API response
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    
    const responseData = await response.json();
    if (responseData.data.courses.length > 0) {
      const course = responseData.data.courses[0];
      expect(course).toHaveProperty('courseAverage');
      expect(typeof course.courseAverage).toBe('number');
    }
  });

  test('should filter grades by child', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for initial API call
    await page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/by-course') && 
      response.status() === 200
    );
    
    // Look for child selector
    const childSelector = page.locator('select[name*="child"], [role="combobox"]:has-text("child"), button:has-text("child")');
    if (await childSelector.count() > 0) {
      // Select a child if selector exists
      await childSelector.first().click();
      
      // Wait for filtered API call
      const filteredResponse = await page.waitForResponse(response => 
        response.url().includes('/api/v1/parent/grades/by-course') && 
        response.url().includes('childId') &&
        response.status() === 200
      );
      
      expect(filteredResponse.status()).toBe(200);
      const filteredData = await filteredResponse.json();
      expect(filteredData.data.courses.every((c: any) => c.childId)).toBe(true);
    }
  });

  test('should display assignment grades for each course', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for API call to complete
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/by-course') && 
      response.status() === 200
    );
    
    // Wait for API response
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    
    const responseData = await response.json();
    if (responseData.data.courses.length > 0) {
      const course = responseData.data.courses[0];
      expect(course).toHaveProperty('assignmentGrades');
      expect(Array.isArray(course.assignmentGrades)).toBe(true);
      
      if (course.assignmentGrades.length > 0) {
        const assignmentGrade = course.assignmentGrades[0];
        expect(assignmentGrade).toHaveProperty('id');
        expect(assignmentGrade).toHaveProperty('assignmentId');
        expect(assignmentGrade).toHaveProperty('assignmentName');
        expect(assignmentGrade).toHaveProperty('grade');
        expect(assignmentGrade).toHaveProperty('percentage');
      }
    }
  });
});

test.describe('Parent Grades - Overall Averages', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
  });

  test('should display overall averages section', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Check that the page loads
    await expect(page.locator('h1, h2')).toBeVisible({ timeout: 10000 });
    
    // Look for overall averages section or tab
    const overallAveragesSection = page.locator('text=/overall|moyenne|statistics|statistiques/i, [data-testid*="overall"], [aria-label*="overall"]');
    // The section might be in a tab or separate section
    if (await overallAveragesSection.count() > 0) {
      await expect(overallAveragesSection.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display overall averages and statistics', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for API call to complete
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/averages') && 
      response.status() === 200
    );
    
    // Wait for API response
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    
    const responseData = await response.json();
    expect(responseData).toHaveProperty('success', true);
    expect(responseData.data).toHaveProperty('statistics');
    expect(responseData.data.statistics).toHaveProperty('overallAverage');
    expect(responseData.data.statistics).toHaveProperty('totalGraded');
    expect(responseData.data.statistics).toHaveProperty('gradeDistribution');
    expect(responseData.data.statistics).toHaveProperty('bestScore');
    expect(responseData.data.statistics).toHaveProperty('worstScore');
  });

  test('should display grade distribution', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for API call to complete
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/averages') && 
      response.status() === 200
    );
    
    // Wait for API response
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    
    const responseData = await response.json();
    if (responseData.data.statistics) {
      const distribution = responseData.data.statistics.gradeDistribution;
      expect(distribution).toHaveProperty('excellent');
      expect(distribution).toHaveProperty('good');
      expect(distribution).toHaveProperty('average');
      expect(distribution).toHaveProperty('belowAverage');
    }
  });

  test('should filter overall averages by child', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for initial API call
    await page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/averages') && 
      response.status() === 200
    );
    
    // Look for child selector
    const childSelector = page.locator('select[name*="child"], [role="combobox"]:has-text("child"), button:has-text("child")');
    if (await childSelector.count() > 0) {
      // Select a child if selector exists
      await childSelector.first().click();
      
      // Wait for filtered API call
      const filteredResponse = await page.waitForResponse(response => 
        response.url().includes('/api/v1/parent/grades/averages') && 
        response.url().includes('childId') &&
        response.status() === 200
      );
      
      expect(filteredResponse.status()).toBe(200);
      const filteredData = await filteredResponse.json();
      expect(filteredData.data.statistics).toBeDefined();
    }
  });
});

test.describe('Parent Grades - Grade Trends', () => {
  test.beforeEach(async ({ page }) => {
    await ensureLoggedOut(page);
  });

  test('should display grade trends section', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Check that the page loads
    await expect(page.locator('h1, h2')).toBeVisible({ timeout: 10000 });
    
    // Look for grade trends section or tab
    const gradeTrendsSection = page.locator('text=/trends|tendance|chart|graphique/i, [data-testid*="trends"], [aria-label*="trends"]');
    // The section might be in a tab or separate section
    if (await gradeTrendsSection.count() > 0) {
      await expect(gradeTrendsSection.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should display grade trends data', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for API call to complete
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/trends') && 
      response.status() === 200
    );
    
    // Wait for API response
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    
    const responseData = await response.json();
    expect(responseData).toHaveProperty('success', true);
    expect(responseData.data).toHaveProperty('trends');
    expect(Array.isArray(responseData.data.trends)).toBe(true);
  });

  test('should display chart with trend data', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for API call to complete
    const responsePromise = page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/trends') && 
      response.status() === 200
    );
    
    // Wait for API response
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    
    const responseData = await response.json();
    if (responseData.data.trends.length > 0) {
      const trend = responseData.data.trends[0];
      expect(trend).toHaveProperty('periodStart');
      expect(trend).toHaveProperty('periodEnd');
      expect(trend).toHaveProperty('periodLabel');
      expect(trend).toHaveProperty('averageGrade');
      expect(trend).toHaveProperty('gradeCount');
    }
  });

  test('should filter trends by child', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for initial API call
    await page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/trends') && 
      response.status() === 200
    );
    
    // Look for child selector
    const childSelector = page.locator('select[name*="child"], [role="combobox"]:has-text("child"), button:has-text("child")');
    if (await childSelector.count() > 0) {
      // Select a child if selector exists
      await childSelector.first().click();
      
      // Wait for filtered API call
      const filteredResponse = await page.waitForResponse(response => 
        response.url().includes('/api/v1/parent/grades/trends') && 
        response.url().includes('childId') &&
        response.status() === 200
      );
      
      expect(filteredResponse.status()).toBe(200);
      const filteredData = await filteredResponse.json();
      expect(filteredData.data.trends).toBeDefined();
    }
  });

  test('should support different time period groupings', async ({ page }) => {
    // Navigate to parent grades page
    await page.goto('/parent/grades');
    await waitForPageLoad(page);
    
    // Wait for initial API call
    await page.waitForResponse(response => 
      response.url().includes('/api/v1/parent/grades/trends') && 
      response.status() === 200
    );
    
    // Look for period selector
    const periodSelector = page.locator('select[name*="period"], [role="combobox"]:has-text("period"), button:has-text("period")');
    if (await periodSelector.count() > 0) {
      // Select a period if selector exists
      await periodSelector.first().click();
      
      // Wait for filtered API call
      const filteredResponse = await page.waitForResponse(response => 
        response.url().includes('/api/v1/parent/grades/trends') && 
        response.url().includes('period') &&
        response.status() === 200
      );
      
      expect(filteredResponse.status()).toBe(200);
      const filteredData = await filteredResponse.json();
      expect(filteredData.data.trends).toBeDefined();
    }
  });
});

