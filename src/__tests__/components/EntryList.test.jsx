import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import EntryList, { primarySecretField } from '../../components/EntryList';
import { ENTRY_TYPE_DEFINITIONS } from '../../utils/entryTypes';

// Simplify MUI Menu to avoid portal/popover complexity
vi.mock('@mui/material', async () => {
  const real = await vi.importActual('@mui/material');
  // Pre-bundled (deps.optimizer) packages are reached through `default` too.
  const m = {
    ...real,
    Menu: ({ open, children }) =>
      open ? <div role="menu">{children}</div> : null,
  };
  return { ...m, default: Object.assign({}, real.default, m) };
});

const onEdit = vi.fn();
const onDelete = vi.fn();
const onCopy = vi.fn();

const renderList = (entries) =>
  render(
    <EntryList
      entries={entries}
      onEdit={onEdit}
      onDelete={onDelete}
      onCopy={onCopy}
    />
  );

const card = (id) => within(screen.getByTestId(`entry-${id}`));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EntryList — common behaviour', () => {
  const entries = [
    {
      id: '1',
      title: 'Test Entry 1',
      username: 'user1',
      password: 'p@ssw0rd',
      category: 'work',
      url: 'https://example.com',
    },
    {
      id: '2',
      title: 'Test Entry 2',
      username: 'user2',
      password: 'secret',
      category: 'email',
    },
  ];

  it('renders a list of entries', () => {
    renderList(entries);
    expect(screen.getByText('Test Entry 1')).toBeInTheDocument();
    expect(screen.getByText('Test Entry 2')).toBeInTheDocument();
    expect(screen.getByText('user1')).toBeInTheDocument();
  });

  it('calls onEdit when Edit is selected from the menu', () => {
    renderList(entries);
    fireEvent.click(screen.getAllByLabelText('Open menu')[0]);
    fireEvent.click(screen.getByText('Edit'));
    expect(onEdit).toHaveBeenCalledWith(entries[0]);
  });

  it('calls onDelete when Delete is selected from the menu', () => {
    renderList(entries);
    fireEvent.click(screen.getAllByLabelText('Open menu')[0]);
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith(entries[0].id);
  });

  it('displays a message when no entries are provided', () => {
    renderList([]);
    expect(screen.getByText('No entries found')).toBeInTheDocument();
  });

  it('copies through onCopy with the schema label', () => {
    renderList(entries);
    fireEvent.click(card('1').getByLabelText('Copy Username/Email'));
    expect(onCopy).toHaveBeenCalledWith('user1', 'Username/Email', {
      sensitive: false,
    });
  });

  it('treats an entry without entryType as a password entry', () => {
    renderList(entries);
    expect(screen.getByTestId('entry-1')).toHaveAttribute(
      'data-entry-type',
      'password'
    );
    expect(card('1').getByText('Password:')).toBeInTheDocument();
  });

  it('shows the category from the shared category list', () => {
    renderList([
      { id: 'n', title: 'Home', entryType: 'wifi', category: 'network' },
    ]);
    // The old list only knew a subset and showed "General" for these.
    expect(card('n').getByText('Network')).toBeInTheDocument();
  });
});

describe('EntryList — each type shows its own fields', () => {
  it('password: username, URL and a masked password', () => {
    renderList([
      {
        id: 'p',
        entryType: 'password',
        title: 'Gmail',
        username: 'me@x.com',
        password: 'hunter2',
        url: 'https://mail.google.com',
        category: 'email',
      },
    ]);
    const c = card('p');
    expect(c.getByText('Username/Email:')).toBeInTheDocument();
    expect(c.getByText('Website URL:')).toBeInTheDocument();
    expect(c.getByText('Password:')).toBeInTheDocument();
    expect(c.queryByText('hunter2')).toBeNull();
    expect(c.getByText('••••••••')).toBeInTheDocument();
  });

  it('wifi: SSID and security type, masked WiFi password — no username row', () => {
    renderList([
      {
        id: 'w',
        entryType: 'wifi',
        title: 'Home WiFi',
        ssid: 'MyNet',
        password: 'wifipass',
        security: 'WPA2',
        category: 'network',
      },
    ]);
    const c = card('w');
    expect(c.getByText('Network Name (SSID):')).toBeInTheDocument();
    expect(c.getByText('MyNet')).toBeInTheDocument();
    expect(c.getByText('Security Type:')).toBeInTheDocument();
    expect(c.getByText('WPA2')).toBeInTheDocument();
    expect(c.getByText('WiFi Password:')).toBeInTheDocument();
    expect(c.queryByText(/Username/)).toBeNull();
    expect(c.getByText('WiFi Password')).toBeInTheDocument(); // type chip
  });

  it('credit card: holder and type, masked card number; menu copies by label', () => {
    renderList([
      {
        id: 'c',
        entryType: 'credit_card',
        title: 'Visa',
        cardholderName: 'Jane Doe',
        cardNumber: '4111111111111111',
        cvv: '123',
        cardType: 'visa',
        expiryDate: '12/30',
        category: 'cards',
      },
    ]);
    const c = card('c');
    expect(c.getByText('Cardholder Name:')).toBeInTheDocument();
    expect(c.getByText('Card Number:')).toBeInTheDocument();
    expect(c.queryByText('4111111111111111')).toBeNull();
    expect(c.queryByText(/Username/)).toBeNull();

    fireEvent.click(c.getByLabelText('Open menu'));
    fireEvent.click(screen.getByText('Copy CVV/CVC'));
    expect(onCopy).toHaveBeenCalledWith('123', 'CVV/CVC', { sensitive: true });
  });

  it('select fields show the option label, not the stored value', () => {
    renderList([
      {
        id: 's',
        entryType: 'credit_card',
        title: 'Card',
        cardType: 'amex',
        category: 'cards',
      },
    ]);
    expect(card('s').getByText('American Express')).toBeInTheDocument();
    expect(card('s').queryByText('amex')).toBeNull();
  });

  it('secure note: content is masked and reveals as a block', () => {
    renderList([
      {
        id: 'n',
        entryType: 'secure_note',
        title: 'Recovery codes',
        content: 'line one\nline two',
        tags: 'backup',
        category: 'notes',
      },
    ]);
    const c = card('n');
    expect(c.getByText('Note Content:')).toBeInTheDocument();
    expect(c.queryByText(/line one/)).toBeNull();

    fireEvent.click(c.getByLabelText('Show'));
    const block = c.getByText(/line one/);
    expect(block.tagName).toBe('PRE');
    expect(block.textContent).toBe('line one\nline two');

    fireEvent.click(c.getByLabelText('Hide'));
    expect(c.queryByText(/line one/)).toBeNull();
  });

  it('ssh key: host details, masked private key, copy via the secret row', () => {
    renderList([
      {
        id: 'k',
        entryType: 'ssh_key',
        title: 'Prod box',
        hostname: '10.0.0.1',
        username: 'deploy',
        port: 22,
        privateKey: '-----BEGIN KEY-----',
        category: 'keys',
      },
    ]);
    const c = card('k');
    expect(c.getByText('Hostname/IP:')).toBeInTheDocument();
    expect(c.getByText('Port:')).toBeInTheDocument();
    expect(c.getByText('22')).toBeInTheDocument();
    expect(c.queryByText('-----BEGIN KEY-----')).toBeNull();
    fireEvent.click(c.getByLabelText('Copy Private Key'));
    // A private key is a secret though not password-typed (New-3).
    expect(onCopy).toHaveBeenCalledWith('-----BEGIN KEY-----', 'Private Key', {
      sensitive: true,
    });
  });

  it('level 3 card: its own fields and no secret row', () => {
    renderList([
      {
        id: 'l',
        entryType: 'level3_card',
        title: 'Bank grid',
        cardName: 'MyBank grid',
        issuer: 'MyBank',
        category: 'cards',
      },
    ]);
    const c = card('l');
    expect(c.getByText('Card Name:')).toBeInTheDocument();
    expect(c.queryByText('••••••••')).toBeNull();
    expect(c.queryByLabelText('Show')).toBeNull();
  });

  it('reveal state is per card', () => {
    renderList([
      { id: 'a', title: 'A', username: 'a', password: 'pa', category: 'work' },
      { id: 'b', title: 'B', username: 'b', password: 'pb', category: 'work' },
    ]);
    fireEvent.click(card('a').getByLabelText('Show'));
    expect(card('a').getByText('pa')).toBeInTheDocument();
    expect(card('b').queryByText('pb')).toBeNull();
  });
});

describe('primarySecretField', () => {
  it.each([
    ['password', 'password'],
    ['wifi', 'password'],
    ['otp', 'secret'],
    ['ssh_key', 'privateKey'],
    ['gpg_key', 'privateKey'],
    ['secure_note', 'content'],
    ['bank_account', 'accountNumber'],
    ['credit_card', 'cardNumber'],
    ['level3_card', null],
  ])('%s → %s', (type, expected) => {
    const def = ENTRY_TYPE_DEFINITIONS[type];
    expect(primarySecretField(def.schema, def.copyableFields)).toBe(expected);
  });
});

describe('EntryList — notes', () => {
  it("shows an entry's notes, and nothing when it has none", () => {
    renderList([
      {
        id: '1',
        title: 'With notes',
        username: 'u',
        password: 'p',
        notes: 'Shared with the on-call rota',
      },
      { id: '2', title: 'Without', username: 'u', password: 'p' },
    ]);
    const notes = screen.getAllByTestId('entry-notes');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent('Shared with the on-call rota');
  });
});
