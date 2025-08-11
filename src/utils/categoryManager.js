// Category management utilities
import {
  Lock as GeneralIcon,
  Language as WebsiteIcon,
  Email as EmailIcon,
  Business as BusinessIcon,
  Work as WorkIcon,
  School as SchoolIcon,
  CreditCard as FinanceIcon,
  Games as GamingIcon,
  Cloud as CloudIcon,
  Smartphone as MobileIcon,
  Wifi as WifiIcon,
  Security as SecurityIcon,
  VpnKey as KeyIcon,
  Note as NoteIcon,
  AccountBalance as BankIcon,
  Grid3x3 as GridIcon,
} from '@mui/icons-material';

export const CATEGORIES = [
  { id: 'general', name: 'General', icon: GeneralIcon, color: '#757575' },
  { id: 'website', name: 'Website', icon: WebsiteIcon, color: '#2196f3' },
  { id: 'email', name: 'Email', icon: EmailIcon, color: '#f44336' },
  { id: 'business', name: 'Business', icon: BusinessIcon, color: '#ff9800' },
  { id: 'work', name: 'Work', icon: WorkIcon, color: '#9c27b0' },
  { id: 'school', name: 'School', icon: SchoolIcon, color: '#4caf50' },
  { id: 'finance', name: 'Finance', icon: FinanceIcon, color: '#795548' },
  { id: 'gaming', name: 'Gaming', icon: GamingIcon, color: '#e91e63' },
  { id: 'cloud', name: 'Cloud Service', icon: CloudIcon, color: '#00bcd4' },
  { id: 'mobile', name: 'Mobile App', icon: MobileIcon, color: '#607d8b' },
  { id: 'network', name: 'Network', icon: WifiIcon, color: '#4caf50' },
  { id: 'security', name: 'Security', icon: SecurityIcon, color: '#ff9800' },
  { id: 'keys', name: 'Keys & Certificates', icon: KeyIcon, color: '#9c27b0' },
  { id: 'notes', name: 'Notes', icon: NoteIcon, color: '#607d8b' },
  { id: 'banking', name: 'Banking', icon: BankIcon, color: '#e91e63' },
  { id: 'cards', name: 'Cards', icon: GridIcon, color: '#00bcd4' },
];

export const getCategoryById = (categoryId) => {
  return CATEGORIES.find((cat) => cat.id === categoryId) || CATEGORIES[0];
};

export const getCategoryIcon = (categoryId) => {
  const category = getCategoryById(categoryId);
  return category.icon;
};

export const getCategoryColor = (categoryId) => {
  const category = getCategoryById(categoryId);
  return category.color;
};

export const getCategoryName = (categoryId) => {
  const category = getCategoryById(categoryId);
  return category.name;
};

export const getDefaultCategory = () => {
  return CATEGORIES[0]; // General
};
