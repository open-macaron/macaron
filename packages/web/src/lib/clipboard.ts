import { toast } from "svelte-sonner";

/** Copies `text` and says so, or says it couldn't (no clipboard permission, insecure context). */
export async function copyToClipboard(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error(`${what} could not be copied`);
  }
}
