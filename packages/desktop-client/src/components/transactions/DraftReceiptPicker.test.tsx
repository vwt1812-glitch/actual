import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { DraftReceiptPicker } from './DraftReceiptPicker';

vi.mock('#hooks/useMetadataPref', () => ({
  useMetadataPref: (name: string) => [name === 'cloudFileId' ? 'budget' : null],
}));

function Fixture({ initial = [] }: { initial?: File[] }) {
  const [files, setFiles] = useState(initial);
  return <DraftReceiptPicker files={files} onChange={setFiles} />;
}

it('stages multiple files locally and allows removing one before the booking is saved', () => {
  const { container } = render(<Fixture />);
  fireEvent.change(container.querySelector('input')!, {
    target: { files: [new File(['a'], 'a.pdf'), new File(['b'], 'b.png')] },
  });
  expect(screen.getByText('a.pdf')).toBeInTheDocument();
  expect(screen.getByText('b.png')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /a\.pdf/ }));
  expect(screen.queryByText('a.pdf')).not.toBeInTheDocument();
  expect(screen.getByText('b.png')).toBeInTheDocument();
});

it('rejects oversized and unsupported files without adding them', () => {
  const { container } = render(<Fixture />);
  const large = new File(['a'], 'large.pdf');
  Object.defineProperty(large, 'size', { value: 11 * 1024 * 1024 });
  fireEvent.change(container.querySelector('input')!, {
    target: { files: [large] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('10 MB');
  expect(screen.queryByText('large.pdf')).not.toBeInTheDocument();
  fireEvent.change(container.querySelector('input')!, {
    target: { files: [new File(['a'], 'a.exe')] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('PDF');
});

it('retains the existing selection when the twenty-file limit would be exceeded', () => {
  const { container } = render(
    <Fixture
      initial={Array.from(
        { length: 20 },
        (_, i) => new File(['a'], `${i}.pdf`),
      )}
    />,
  );
  fireEvent.change(container.querySelector('input')!, {
    target: { files: [new File(['a'], 'extra.pdf')] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('20');
  expect(screen.getByText('0.pdf')).toBeInTheDocument();
  expect(screen.queryByText('extra.pdf')).not.toBeInTheDocument();
});

