import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { DialogueMessage } from '@/components/game/DialogueBox';
import type { DialogueOption } from '@/components/game/DialogueBox';

interface DialogueState {
  dialogueMessages: DialogueMessage[];
  dialogueOptions: DialogueOption[];
  isTyping: boolean;

  addDialogueMessage: (message: DialogueMessage) => void;
  setDialogueMessages: (messages: DialogueMessage[]) => void;
  setDialogueOptions: (options: DialogueOption[]) => void;
  setIsTyping: (typing: boolean) => void;
  clearDialogue: () => void;
}

export const useDialogueStore = create<DialogueState>()(
  devtools(
    immer((set) => ({
      dialogueMessages: [],
      dialogueOptions: [],
      isTyping: false,

      addDialogueMessage: (message) =>
        set((state) => {
          if (message.id && state.dialogueMessages.some(m => m.id === message.id)) {
            return;
          }
          state.dialogueMessages.push(message);
        }),

      setDialogueMessages: (messages) =>
        set((state) => {
          state.dialogueMessages = messages;
        }),

      setDialogueOptions: (options) =>
        set((state) => {
          state.dialogueOptions = options;
        }),

      setIsTyping: (typing) =>
        set((state) => {
          state.isTyping = typing;
        }),

      clearDialogue: () =>
        set((state) => {
          state.dialogueMessages = [];
          state.dialogueOptions = [];
        }),
    })),
    { name: 'DialogueStore' }
  )
);
