// Navigation helpers shared by every screen: go(screen), openEditor({...}).
import { createContext, useContext } from 'react';
export const Nav = createContext({ screen: 'live', go: () => {}, openEditor: () => {}, closeEditor: () => {} });
export const useNav = () => useContext(Nav);
