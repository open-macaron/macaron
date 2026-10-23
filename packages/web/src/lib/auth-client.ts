import { authUserFields } from "@open-macaron/contracts/auth";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/svelte";

/**
 * Sign-in and sign-out from the browser, on the app's own origin: the edge sends /api/auth/* to
 * the controller. The user's extra fields are typed from the same declaration the controller uses.
 */
export const authClient = createAuthClient({ basePath: "/api/auth", plugins: [inferAdditionalFields({ user: authUserFields })] });
