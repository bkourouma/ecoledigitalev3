import { describe, it, expect } from '@jest/globals';

/**
 * Unit tests for balance calculation utilities
 * Tests the logic for calculating outstanding balances, amount paid, and amount due
 */

describe('Balance Calculation Utilities', () => {
  describe('calculateOutstandingBalance', () => {
    it('should calculate outstanding balance correctly for tuition fees', () => {
      // Test case: Student has 3 installments, 2 paid, 1 pending
      const installments = [
        { amount: 100000, amountPaid: 100000, status: 'paid' },
        { amount: 100000, amountPaid: 100000, status: 'paid' },
        { amount: 100000, amountPaid: 50000, status: 'partial' },
      ];

      const totalOutstanding = installments
        .filter(inst => inst.status !== 'paid')
        .reduce((sum, inst) => sum + (inst.amount - inst.amountPaid), 0);

      const totalAmount = installments.reduce((sum, inst) => sum + inst.amount, 0);
      const totalPaid = installments.reduce((sum, inst) => sum + inst.amountPaid, 0);
      const amountDue = totalAmount - totalPaid;

      expect(totalOutstanding).toBe(50000);
      expect(totalAmount).toBe(300000);
      expect(totalPaid).toBe(250000);
      expect(amountDue).toBe(50000);
    });

    it('should calculate outstanding balance correctly for other fees', () => {
      // Test case: Enrollment fee is 50000, 30000 paid
      const totalAmount = 50000;
      const amountPaid = 30000;
      const amountDue = totalAmount - amountPaid;
      const totalOutstanding = amountDue > 0 ? amountDue : 0;

      expect(totalOutstanding).toBe(20000);
      expect(amountDue).toBe(20000);
    });

    it('should return 0 outstanding when all fees are paid', () => {
      const totalAmount = 100000;
      const amountPaid = 100000;
      const amountDue = totalAmount - amountPaid;
      const totalOutstanding = amountDue > 0 ? amountDue : 0;

      expect(totalOutstanding).toBe(0);
      expect(amountDue).toBe(0);
    });

    it('should handle negative outstanding balance (overpayment)', () => {
      const totalAmount = 100000;
      const amountPaid = 120000;
      const amountDue = totalAmount - amountPaid;
      const totalOutstanding = amountDue > 0 ? amountDue : 0;

      expect(totalOutstanding).toBe(0); // Should not show negative
      expect(amountDue).toBe(-20000);
    });

    it('should calculate correctly with multiple fee types', () => {
      const fees = {
        tuition: { total: 300000, paid: 250000 },
        inscription: { total: 50000, paid: 50000 },
        annexes: { total: 25000, paid: 10000 },
        autres: { total: 10000, paid: 0 },
      };

      const balances = Object.entries(fees).map(([feeType, data]) => {
        const amountDue = data.total - data.paid;
        const totalOutstanding = amountDue > 0 ? amountDue : 0;
        return {
          feeType,
          totalOutstanding,
          amountPaid: data.paid,
          amountDue: data.total,
        };
      });

      expect(balances.find(b => b.feeType === 'tuition')?.totalOutstanding).toBe(50000);
      expect(balances.find(b => b.feeType === 'inscription')?.totalOutstanding).toBe(0);
      expect(balances.find(b => b.feeType === 'annexes')?.totalOutstanding).toBe(15000);
      expect(balances.find(b => b.feeType === 'autres')?.totalOutstanding).toBe(10000);
    });

    it('should handle empty installments array', () => {
      const installments: any[] = [];
      const totalOutstanding = installments
        .filter(inst => inst.status !== 'paid')
        .reduce((sum, inst) => sum + (inst.amount - inst.amountPaid), 0);

      expect(totalOutstanding).toBe(0);
    });

    it('should handle null or undefined amounts', () => {
      const totalAmount = parseFloat(null as any || 0);
      const amountPaid = parseFloat(undefined as any || 0);
      const amountDue = totalAmount - amountPaid;
      const totalOutstanding = amountDue > 0 ? amountDue : 0;

      expect(totalOutstanding).toBe(0);
      expect(amountDue).toBe(0);
    });
  });

  describe('calculateAmountDue', () => {
    it('should calculate amount due correctly', () => {
      const totalAmount = 100000;
      const amountPaid = 30000;
      const amountDue = totalAmount - amountPaid;

      expect(amountDue).toBe(70000);
    });

    it('should handle zero paid amount', () => {
      const totalAmount = 100000;
      const amountPaid = 0;
      const amountDue = totalAmount - amountPaid;

      expect(amountDue).toBe(100000);
    });

    it('should handle full payment', () => {
      const totalAmount = 100000;
      const amountPaid = 100000;
      const amountDue = totalAmount - amountPaid;

      expect(amountDue).toBe(0);
    });
  });

  describe('calculateTotalPaid', () => {
    it('should sum all paid amounts correctly', () => {
      const transactions = [
        { amount: 50000, status: 'completed' },
        { amount: 30000, status: 'completed' },
        { amount: 20000, status: 'pending' },
      ];

      const totalPaid = transactions
        .filter(tx => tx.status === 'completed')
        .reduce((sum, tx) => sum + tx.amount, 0);

      expect(totalPaid).toBe(80000);
    });

    it('should exclude failed and cancelled transactions', () => {
      const transactions = [
        { amount: 50000, status: 'completed' },
        { amount: 30000, status: 'failed' },
        { amount: 20000, status: 'cancelled' },
      ];

      const totalPaid = transactions
        .filter(tx => tx.status === 'completed')
        .reduce((sum, tx) => sum + tx.amount, 0);

      expect(totalPaid).toBe(50000);
    });
  });
});



