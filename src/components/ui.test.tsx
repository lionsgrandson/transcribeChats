import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, EmptyState } from './ui';

describe('shared UI states', () => {
  it('renders a blank-state action', async () => {
    const action = vi.fn();
    render(<EmptyState title="No tasks" body="Create your first task." action={<Button onClick={action}>Add task</Button>} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }));
    expect(action).toHaveBeenCalledOnce();
  });

  it('prevents duplicate interaction while busy', () => {
    render(<Button busy>Saving</Button>);
    expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled();
  });
});
