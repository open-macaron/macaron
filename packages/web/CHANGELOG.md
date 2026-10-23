# @open-macaron/web

## 0.1.1

### Patch Changes

- 5897e6a: Sessions stay alive while you use the app: the browser renews its session cookie once per visit (they used to end after 7 days, active or not). The sidebar and sign-in page show the macaron mark.

## 0.1.0

### Minor Changes

- 04a334a: The web app: SvelteKit 3 with adapter-node, shadcn-svelte, a strict CSP, and its image (`ghcr.io/open-macaron/web`), deployed behind the edge. This release is the shell (sidebar, overview, usage and key pages, sign-in screen); sign-in, keys and usage history come next.
- 6928696: Sign in with GitHub, by invitation. The overview and the usage page show your runs and their cost; administrators invite people with capabilities and change them on the Users page.
