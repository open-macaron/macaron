/** Who is signed in, as the app needs it. Filled from the controller's session once sign-in lands. */
export interface ShellUser {
  readonly githubLogin: string;
  readonly name: string;
  readonly avatarUrl: string;
  readonly isAdmin: boolean;
}
