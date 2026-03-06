import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useErrorSnackbar, ErrorSnackbarProvider } from './ErrorSnackbarContext';

function TestConsumer() {
  const { showError, showSuccess } = useErrorSnackbar();
  return (
    <div>
      <button onClick={() => showError('Test error')}>Show error</button>
      <button onClick={() => showSuccess('Test success')}>Show success</button>
    </div>
  );
}

describe('ErrorSnackbarContext', () => {
  it('provides showError and showSuccess', () => {
    render(
      <ErrorSnackbarProvider>
        <TestConsumer />
      </ErrorSnackbarProvider>
    );
    expect(screen.getByText('Show error')).toBeInTheDocument();
    expect(screen.getByText('Show success')).toBeInTheDocument();
  });

  it('useErrorSnackbar returns no-ops when used outside provider', () => {
    function Outside() {
      const { showError } = useErrorSnackbar();
      showError('should not throw');
      return <span>ok</span>;
    }
    render(<Outside />);
    expect(screen.getByText('ok')).toBeInTheDocument();
  });
});
