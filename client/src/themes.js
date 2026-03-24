export const themes = {
  'warm-sand': {
    label: 'Warm Sand',
    bg: '#F5F5F0',
    surface: '#EEEEE8',
    border: '#D8D8D0',
    primary: '#CC785C',
    text: '#1A1A1A',
    muted: '#888888',
  },
  'dark-slate': {
    label: 'Dark Slate',
    bg: '#0F1117',
    surface: '#1A1D27',
    border: '#2A2D3A',
    primary: '#7C8CF8',
    text: '#F0F0F0',
    muted: '#666666',
  },
  forest: {
    label: 'Forest',
    bg: '#F0F4F0',
    surface: '#E4EBE4',
    border: '#C8D4C8',
    primary: '#3D7A5E',
    text: '#1A2A1A',
    muted: '#777777',
  },
  'midnight-blue': {
    label: 'Midnight Blue',
    bg: '#0D1B2A',
    surface: '#1A2E42',
    border: '#243D52',
    primary: '#5DADE2',
    text: '#EAF4FB',
    muted: '#5A7080',
  },
  'paper-white': {
    label: 'Paper White',
    bg: '#FFFFFF',
    surface: '#F5F5F5',
    border: '#E0E0E0',
    primary: '#333333',
    text: '#111111',
    muted: '#888888',
  },
};

export const googleFonts = [
  // Sans-serif
  { value: 'Inter',            label: 'Inter',            stack: "'Inter', sans-serif",          category: 'sans' },
  { value: 'DM Sans',          label: 'DM Sans',          stack: "'DM Sans', sans-serif",         category: 'sans' },
  { value: 'Open Sans',        label: 'Open Sans',        stack: "'Open Sans', sans-serif",       category: 'sans' },
  { value: 'Lato',             label: 'Lato',             stack: "'Lato', sans-serif",            category: 'sans' },
  { value: 'Nunito',           label: 'Nunito',           stack: "'Nunito', sans-serif",          category: 'sans' },
  { value: 'Poppins',          label: 'Poppins',          stack: "'Poppins', sans-serif",         category: 'sans' },
  { value: 'Raleway',          label: 'Raleway',          stack: "'Raleway', sans-serif",         category: 'sans' },
  { value: 'Montserrat',       label: 'Montserrat',       stack: "'Montserrat', sans-serif",      category: 'sans' },
  { value: 'Oswald',           label: 'Oswald',           stack: "'Oswald', sans-serif",          category: 'sans' },
  // Serif
  { value: 'Lora',             label: 'Lora',             stack: "'Lora', serif",                 category: 'serif' },
  { value: 'Merriweather',     label: 'Merriweather',     stack: "'Merriweather', serif",         category: 'serif' },
  { value: 'Playfair Display', label: 'Playfair Display', stack: "'Playfair Display', serif",     category: 'serif' },
  { value: 'PT Serif',         label: 'PT Serif',         stack: "'PT Serif', serif",             category: 'serif' },
  { value: 'Crimson Text',     label: 'Crimson Text',     stack: "'Crimson Text', serif",         category: 'serif' },
  // Monospace
  { value: 'JetBrains Mono',   label: 'JetBrains Mono',  stack: "'JetBrains Mono', monospace",   category: 'mono' },
  { value: 'Fira Code',        label: 'Fira Code',        stack: "'Fira Code', monospace",        category: 'mono' },
];

export const FONT_CATEGORIES = [
  { key: 'sans',  label: 'Sans-serif' },
  { key: 'serif', label: 'Serif' },
  { key: 'mono',  label: 'Monospace' },
];
