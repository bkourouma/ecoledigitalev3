/**
 * Test file to verify PaymentPeriodForm error handling
 * This test ensures that errors from the API are properly displayed to users
 *
 * Les cas « chevauchement de périodes » ont été retirés : l'API ne refuse plus
 * une période qui en recouvre une autre (elle se contente de la journaliser) et
 * la contrainte d'exclusion en base a été levée par la migration 0112. Le
 * formulaire n'a donc plus de branche à traduire pour ce cas, et les tests qui
 * s'en servaient comme véhicule s'appuient désormais sur l'erreur de cohérence
 * des dates, qui est toujours émise.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/test-globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PaymentPeriodForm } from '../PaymentPeriodForm';

// Mock the DatePickerFr component
jest.mock('@/components/DatePickerFr', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (iso: string) => void }) => (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid="date-picker"
    />
  ),
}));

describe('PaymentPeriodForm Error Handling', () => {
  const mockOnSubmit = jest.fn();
  const mockOnCancel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should clear error message when user changes date fields', async () => {
    const user = userEvent.setup();

    mockOnSubmit.mockRejectedValueOnce(
      new Error('Period start date must be before end date')
    );

    render(
      <PaymentPeriodForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isLoading={false}
      />
    );

    // Fill in the form and submit
    const nameInput = screen.getByLabelText(/nom de la période/i);
    await user.type(nameInput, 'Test Period');

    const submitButton = screen.getByRole('button', { name: /enregistrer/i });
    await user.click(submitButton);

    // Wait for error message to appear
    await waitFor(() => {
      expect(
        screen.getByText(/la date de début doit être antérieure à la date de fin/i)
      ).toBeInTheDocument();
    });

    // Change a date field
    const datePickers = screen.getAllByTestId('date-picker');
    await user.type(datePickers[0], '2025-11-01');

    // Error message should be cleared
    await waitFor(() => {
      expect(
        screen.queryByText(/la date de début doit être antérieure à la date de fin/i)
      ).not.toBeInTheDocument();
    });
  });

  it('should display generic error message for unknown errors', async () => {
    const user = userEvent.setup();

    // Mock onSubmit to throw a generic error
    mockOnSubmit.mockRejectedValueOnce(
      new Error('Network error')
    );

    render(
      <PaymentPeriodForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isLoading={false}
      />
    );

    // Fill in the form
    const nameInput = screen.getByLabelText(/nom de la période/i);
    await user.type(nameInput, 'Test Period');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /enregistrer/i });
    await user.click(submitButton);

    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });

  it('should clear error message on new submission attempt', async () => {
    const user = userEvent.setup();

    // Mock onSubmit to throw an error first, then succeed
    mockOnSubmit
      .mockRejectedValueOnce(new Error('Period start date must be before end date'))
      .mockResolvedValueOnce(undefined);

    render(
      <PaymentPeriodForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isLoading={false}
      />
    );

    // Fill in the form and submit (first attempt - will fail)
    const nameInput = screen.getByLabelText(/nom de la période/i);
    await user.type(nameInput, 'Test Period');

    const submitButton = screen.getByRole('button', { name: /enregistrer/i });
    await user.click(submitButton);

    // Wait for error message to appear
    await waitFor(() => {
      expect(
        screen.getByText(/la date de début doit être antérieure à la date de fin/i)
      ).toBeInTheDocument();
    });

    // Submit again (second attempt - will succeed)
    await user.click(submitButton);

    // Error message should be cleared
    await waitFor(() => {
      expect(
        screen.queryByText(/la date de début doit être antérieure à la date de fin/i)
      ).not.toBeInTheDocument();
    });
  });

  it('should handle date validation errors correctly', async () => {
    const user = userEvent.setup();

    // Mock onSubmit to throw a date validation error
    mockOnSubmit.mockRejectedValueOnce(
      new Error('Period start date must be before end date')
    );

    render(
      <PaymentPeriodForm
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
        isLoading={false}
      />
    );

    // Fill in the form
    const nameInput = screen.getByLabelText(/nom de la période/i);
    await user.type(nameInput, 'Test Period');

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /enregistrer/i });
    await user.click(submitButton);

    // Wait for error message to appear
    await waitFor(() => {
      expect(
        screen.getByText(/la date de début doit être antérieure à la date de fin/i)
      ).toBeInTheDocument();
    });
  });
});
