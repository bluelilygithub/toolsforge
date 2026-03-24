import { createContext, useContext, useMemo } from 'react';
import * as LucideIcons from 'lucide-react';

const semanticMap = {
  home:            { lucide: 'Home' },
  settings:        { lucide: 'Settings' },
  'log-out':       { lucide: 'LogOut' },
  user:            { lucide: 'User' },
  users:           { lucide: 'Users' },
  'chevron-right': { lucide: 'ChevronRight' },
  'chevron-down':  { lucide: 'ChevronDown' },
  'chevron-left':  { lucide: 'ChevronLeft' },
  search:          { lucide: 'Search' },
  x:               { lucide: 'X' },
  check:           { lucide: 'Check' },
  plus:            { lucide: 'Plus' },
  edit:            { lucide: 'Pencil' },
  trash:           { lucide: 'Trash2' },
  eye:             { lucide: 'Eye' },
  'eye-off':       { lucide: 'EyeOff' },
  'alert-circle':  { lucide: 'AlertCircle' },
  'check-circle':  { lucide: 'CheckCircle2' },
  loader:          { lucide: 'Loader2' },
  'bar-chart':     { lucide: 'BarChart2' },
  shield:          { lucide: 'Shield' },
  tool:            { lucide: 'Wrench' },
  'puzzle':        { lucide: 'Puzzle' },
  'layout':        { lucide: 'LayoutDashboard' },
  'refresh-cw':    { lucide: 'RefreshCw' },
  'more-vertical': { lucide: 'MoreVertical' },
  copy:            { lucide: 'Copy' },
  'arrow-right':   { lucide: 'ArrowRight' },
  'external-link': { lucide: 'ExternalLink' },
  mail:            { lucide: 'Mail' },
  lock:            { lucide: 'Lock' },
  key:             { lucide: 'Key' },
  sparkles:        { lucide: 'Sparkles' },
};

const IconContext = createContext(null);

export function IconProvider({ children }) {
  const getIcon = useMemo(() => {
    return (name, props = {}) => {
      const mapping = semanticMap[name];
      if (!mapping) return null;
      const Icon = LucideIcons[mapping.lucide];
      if (!Icon) return null;
      return <Icon size={18} {...props} />;
    };
  }, []);

  return (
    <IconContext.Provider value={getIcon}>
      {children}
    </IconContext.Provider>
  );
}

export function useIcon() {
  return useContext(IconContext);
}

export default IconProvider;
