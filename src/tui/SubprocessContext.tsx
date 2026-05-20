import { createContext, useContext } from 'react';

interface SubprocessContextValue {
  runInteractive: (cmd: string[]) => void;
}

export const SubprocessContext = createContext<SubprocessContextValue>({
  runInteractive: () => {},
});

export function useInteractiveSubprocess(): (cmd: string[]) => void {
  return useContext(SubprocessContext).runInteractive;
}
