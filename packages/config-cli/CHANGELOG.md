# @open-macaron/config-cli

## 0.1.18

### Patch Changes

- Updated dependencies [5eabb9c]
  - @open-macaron/contracts@0.17.0
  - @open-macaron/owners@0.1.18

## 0.1.17

### Patch Changes

- Updated dependencies [b4e2518]
  - @open-macaron/contracts@0.16.0
  - @open-macaron/owners@0.1.17

## 0.1.16

### Patch Changes

- Updated dependencies [75749f8]
  - @open-macaron/contracts@0.15.0
  - @open-macaron/owners@0.1.16

## 0.1.15

### Patch Changes

- Updated dependencies [9dfb39a]
  - @open-macaron/contracts@0.14.1
  - @open-macaron/owners@0.1.15

## 0.1.14

### Patch Changes

- Updated dependencies [b401fb2]
  - @open-macaron/contracts@0.14.0
  - @open-macaron/owners@0.1.14

## 0.1.13

### Patch Changes

- Updated dependencies [5d473ba]
  - @open-macaron/contracts@0.13.0
  - @open-macaron/owners@0.1.13

## 0.1.12

### Patch Changes

- Updated dependencies [96f4b99]
  - @open-macaron/contracts@0.12.0
  - @open-macaron/owners@0.1.12

## 0.1.11

### Patch Changes

- Updated dependencies [9e9b47f]
  - @open-macaron/contracts@0.11.0
  - @open-macaron/owners@0.1.11

## 0.1.10

### Patch Changes

- Updated dependencies [9ca6995]
  - @open-macaron/contracts@0.10.0
  - @open-macaron/owners@0.1.10

## 0.1.9

### Patch Changes

- Updated dependencies [a71ccab]
  - @open-macaron/contracts@0.9.0
  - @open-macaron/owners@0.1.9

## 0.1.8

### Patch Changes

- 703d412: The controller now owns the bot's forks, so onboarding a repository is just the open-macaron/config pull request. When a configuration goes live, and at every boot, the controller does four things for each repository:
  
  - It forks the upstream under a random name, or adopts the bot's existing fork of that fork network.
  - It switches off the fork's Actions, wiki, issues and projects.
  - It records the fork by repository id in a new `forks` table.
  - It comments on the config pull request with the fork's link, or with why there is none.
  
  Requests on a repository are refused until its fork is ready. A repository file's `fork` key is now ignored, so a configuration can't point a repository at another of the bot's repositories. The comment needs `GH_ORG` to have Pull requests write on open-macaron/config.
- Updated dependencies [703d412]
  - @open-macaron/contracts@0.8.0
  - @open-macaron/owners@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [acf0af5]
  - @open-macaron/contracts@0.7.0
  - @open-macaron/owners@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [3a1032a]
  - @open-macaron/contracts@0.6.0
  - @open-macaron/owners@0.1.6

## 0.1.5

### Patch Changes

- fbd5b6e: A project file no longer accepts a `users` list (deprecated and ignored since who may trigger the bot became an account of the web app): one with it is refused. open-macaron/config dropped its lists. config-cli no longer reserves `users` for the platform team: the schema refuses it outright.
- Updated dependencies [fbd5b6e]
  - @open-macaron/contracts@0.5.0
  - @open-macaron/owners@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [7dfb14e]
  - @open-macaron/contracts@0.4.0
  - @open-macaron/owners@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [9ab8f08]
- Updated dependencies [b6b02bf]
- Updated dependencies [47abc60]
  - @open-macaron/contracts@0.3.0
  - @open-macaron/owners@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [6b1ed0d]
  - @open-macaron/contracts@0.2.0
  - @open-macaron/owners@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [92b7ca5]
- Updated dependencies [f238b34]
  - @open-macaron/contracts@0.1.0
  - @open-macaron/owners@0.1.1
