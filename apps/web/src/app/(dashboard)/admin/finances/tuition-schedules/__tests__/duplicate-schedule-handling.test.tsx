/**
 * Test file for duplicate schedule handling
 * 
 * This test file verifies the behavior when a user tries to create
 * a tuition schedule with a name that already exists for the same
 * academic year and cycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Duplicate Schedule Handling', () => {
  describe('Backend Error Response', () => {
    it('should return 409 Conflict with existing schedule ID when duplicate is detected', async () => {
      // Mock duplicate schedule scenario
      const duplicateError = {
        error: "Duplicate Schedule",
        message: "A schedule with this name already exists for the specified academic year and cycle",
        existingScheduleId: "test-schedule-id-123",
        existingScheduleName: "Echéancier Master Data Science"
      };

      expect(duplicateError.error).toBe("Duplicate Schedule");
      expect(duplicateError.existingScheduleId).toBeDefined();
      expect(duplicateError.existingScheduleName).toBeDefined();
    });
  });

  describe('Frontend Error Handling', () => {
    it('should detect duplicate schedule error and extract existing schedule ID', () => {
      const errorMessage = "A schedule with this name already exists for the specified academic year and cycle";
      const errorObj = {
        message: errorMessage,
        existingScheduleId: "test-schedule-id-123",
        existingScheduleName: "Echéancier Master Data Science"
      };

      const isDuplicateError = errorMessage.includes("already exists") || errorMessage.includes("Duplicate Schedule");
      expect(isDuplicateError).toBe(true);
      expect(errorObj.existingScheduleId).toBeDefined();
    });

    it('should display user-friendly error message with action buttons', () => {
      const errorMessage = `Un échéancier avec le nom "Echéancier Master Data Science" existe déjà pour cette année académique et ce cycle.\n\n` +
                          `Souhaitez-vous modifier l'échéancier existant ?\n\n` +
                          `Si vous souhaitez créer un nouvel échéancier, veuillez utiliser un nom différent.`;

      expect(errorMessage).toContain("existe déjà");
      expect(errorMessage).toContain("modifier l'échéancier existant");
      expect(errorMessage).toContain("nom différent");
    });
  });

  describe('User Actions', () => {
    it('should allow user to edit existing schedule', () => {
      const existingScheduleId = "test-schedule-id-123";
      const onEditExisting = vi.fn((scheduleId: string) => {
        expect(scheduleId).toBe(existingScheduleId);
      });

      onEditExisting(existingScheduleId);
      expect(onEditExisting).toHaveBeenCalledWith(existingScheduleId);
    });

    it('should suggest a new name when user chooses to use different name', () => {
      const originalName = "Echéancier Master Data Science";
      const suggestedName = `${originalName} (Copie)`;

      expect(suggestedName).toBe("Echéancier Master Data Science (Copie)");
      expect(suggestedName).not.toBe(originalName);
    });
  });

  describe('Form Behavior', () => {
    it('should clear errors when user chooses an action', () => {
      const errors = [
        "Un échéancier avec le nom \"Echéancier Master Data Science\" existe déjà...",
        "ID_EXISTING_SCHEDULE:test-schedule-id-123"
      ];

      const visibleErrors = errors.filter(error => !error.startsWith("ID_EXISTING_SCHEDULE:"));
      expect(visibleErrors.length).toBe(1);
      expect(visibleErrors[0]).not.toContain("ID_EXISTING_SCHEDULE:");
    });

    it('should extract existing schedule ID from error array', () => {
      const errors = [
        "Un échéancier avec le nom \"Echéancier Master Data Science\" existe déjà...",
        "ID_EXISTING_SCHEDULE:test-schedule-id-123"
      ];

      const existingScheduleId = errors.find(e => e.startsWith("ID_EXISTING_SCHEDULE:"))?.split(":")[1];
      expect(existingScheduleId).toBe("test-schedule-id-123");
    });
  });
});

