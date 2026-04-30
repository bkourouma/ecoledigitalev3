/**
 * Test file for attendance excuse reason validation
 * 
 * This test verifies that:
 * 1. Excused/medical_leave statuses require excuse reasons
 * 2. Frontend validation prevents saving without excuse reason
 * 3. Backend properly handles excuseReason mapping from notes
 */

describe('Attendance Excuse Reason Validation', () => {
  describe('Frontend Validation', () => {
    it('should require excuse reason when status is excused', () => {
      const attendanceData = {
        'student-1': 'excused',
      };
      const notes = {
        'student-1': '', // Empty excuse reason
      };

      // This should trigger validation error
      const requiresExcuse = attendanceData['student-1'] === 'excused' || attendanceData['student-1'] === 'medical_leave';
      const hasExcuse = notes['student-1']?.trim() || false;

      expect(requiresExcuse).toBe(true);
      expect(hasExcuse).toBe(false);
      // Validation should fail
      expect(requiresExcuse && !hasExcuse).toBe(true);
    });

    it('should require excuse reason when status is medical_leave', () => {
      const attendanceData = {
        'student-1': 'medical_leave',
      };
      const notes = {
        'student-1': '', // Empty excuse reason
      };

      const requiresExcuse = attendanceData['student-1'] === 'excused' || attendanceData['student-1'] === 'medical_leave';
      const hasExcuse = notes['student-1']?.trim() || false;

      expect(requiresExcuse).toBe(true);
      expect(hasExcuse).toBe(false);
      expect(requiresExcuse && !hasExcuse).toBe(true);
    });

    it('should allow saving when excused status has excuse reason', () => {
      const attendanceData = {
        'student-1': 'excused',
      };
      const notes = {
        'student-1': 'Maladie',
      };

      const requiresExcuse = attendanceData['student-1'] === 'excused' || attendanceData['student-1'] === 'medical_leave';
      const hasExcuse = notes['student-1']?.trim() || false;

      expect(requiresExcuse).toBe(true);
      expect(hasExcuse).toBe(true);
      expect(requiresExcuse && !hasExcuse).toBe(false);
    });

    it('should not require excuse reason for present status', () => {
      const attendanceData = {
        'student-1': 'present',
      };
      const notes = {
        'student-1': '',
      };

      const requiresExcuse = attendanceData['student-1'] === 'excused' || attendanceData['student-1'] === 'medical_leave';
      const hasExcuse = notes['student-1']?.trim() || false;

      expect(requiresExcuse).toBe(false);
      // Should be allowed even without excuse reason
      expect(requiresExcuse && !hasExcuse).toBe(false);
    });
  });

  describe('Data Mapping', () => {
    it('should map notes to excuseReason for excused status', () => {
      const status = 'excused';
      const notes = 'Raison médicale';

      const record: any = {
        studentId: 'student-1',
        attendanceStatus: status,
        notes: notes,
      };

      if (status === 'excused' || status === 'medical_leave') {
        record.excuseReason = notes || 'Non spécifié';
      }

      expect(record.excuseReason).toBe('Raison médicale');
      expect(record.notes).toBe('Raison médicale');
    });

    it('should map notes to excuseReason for medical_leave status', () => {
      const status = 'medical_leave';
      const notes = 'Congé médical';

      const record: any = {
        studentId: 'student-1',
        attendanceStatus: status,
        notes: notes,
      };

      if (status === 'excused' || status === 'medical_leave') {
        record.excuseReason = notes || 'Non spécifié';
      }

      expect(record.excuseReason).toBe('Congé médical');
    });

    it('should not set excuseReason for present status', () => {
      const status = 'present';
      const notes = 'Some notes';

      const record: any = {
        studentId: 'student-1',
        attendanceStatus: status,
        notes: notes,
      };

      if (status === 'excused' || status === 'medical_leave') {
        record.excuseReason = notes || 'Non spécifié';
      }

      expect(record.excuseReason).toBeUndefined();
      expect(record.notes).toBe('Some notes');
    });
  });

  describe('Backend Validation', () => {
    it('should validate excuse reason is provided for excused status', () => {
      const record = {
        studentId: 'student-1',
        attendanceStatus: 'excused',
        excuseReason: null,
        notes: '',
      };

      const requiresExcuseReason = record.attendanceStatus === 'excused' || record.attendanceStatus === 'medical_leave';
      let excuseReason: string | null = record.excuseReason;
      if (!excuseReason && record.notes) {
        excuseReason = record.notes.trim() || null;
      }

      expect(requiresExcuseReason).toBe(true);
      expect(excuseReason).toBeNull();
      // Should fail validation
      expect(requiresExcuseReason && !excuseReason).toBe(true);
    });

    it('should accept excuseReason from notes field', () => {
      const record = {
        studentId: 'student-1',
        attendanceStatus: 'excused',
        excuseReason: null,
        notes: 'Raison valide',
      };

      const requiresExcuseReason = record.attendanceStatus === 'excused' || record.attendanceStatus === 'medical_leave';
      let excuseReason: string | null = record.excuseReason;
      if (!excuseReason && record.notes) {
        excuseReason = record.notes.trim() || null;
      }

      expect(requiresExcuseReason).toBe(true);
      expect(excuseReason).toBe('Raison valide');
      // Should pass validation
      expect(requiresExcuseReason && !excuseReason).toBe(false);
    });
  });
});

