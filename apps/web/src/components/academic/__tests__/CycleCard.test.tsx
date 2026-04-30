import { render, screen, fireEvent } from '@testing-library/react';
import { CycleCard } from '../CycleCard';
import { Cycle } from '@ecoledigitale/contracts';

const mockCycle: Cycle = {
  id: '1',
  tenantId: 'tenant-1',
  name: 'BTS Services Informatiques',
  code: 'BTS-SIO',
  type: 'academic',
  durationMonths: 24,
  description: 'Formation en services informatiques aux organisations',
  certificationLevel: 'Bac+2',
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('CycleCard', () => {
  it('renders cycle information correctly', () => {
    render(<CycleCard cycle={mockCycle} />);
    
    expect(screen.getByText('BTS Services Informatiques')).toBeInTheDocument();
    expect(screen.getByText('Code: BTS-SIO')).toBeInTheDocument();
    expect(screen.getByText('Niveau: Bac+2')).toBeInTheDocument();
    expect(screen.getByText('Actif')).toBeInTheDocument();
  });

  it('calls onEdit when edit button is clicked', () => {
    const onEdit = jest.fn();
    render(<CycleCard cycle={mockCycle} onEdit={onEdit} />);
    
    const editButton = screen.getByText('Modifier');
    fireEvent.click(editButton);
    
    expect(onEdit).toHaveBeenCalledWith(mockCycle);
  });

  it('calls onView when card is clicked', () => {
    const onView = jest.fn();
    render(<CycleCard cycle={mockCycle} onView={onView} />);
    
    const card = screen.getByRole('generic', { name: /cycle card/i });
    fireEvent.click(card);
    
    expect(onView).toHaveBeenCalledWith(mockCycle);
  });

  it('displays description when provided', () => {
    render(<CycleCard cycle={mockCycle} />);
    
    expect(screen.getByText('Formation en services informatiques aux organisations')).toBeInTheDocument();
  });

  it('does not display edit button when onEdit is not provided', () => {
    render(<CycleCard cycle={mockCycle} />);
    
    expect(screen.queryByText('Modifier')).not.toBeInTheDocument();
  });
});
