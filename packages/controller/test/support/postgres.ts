import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

/** Same major as production (rhel10/postgresql-18, DEPLOYMENT.md §2). */
const IMAGE = "docker.io/library/postgres:18-alpine";

/**
 * A throwaway Postgres. Works with Docker or Podman: point DOCKER_HOST at the Podman API socket
 * and set TESTCONTAINERS_RYUK_DISABLED=true when running rootless Podman.
 */
export async function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer(IMAGE).withDatabase("macaron").withUsername("macaron").withPassword("macaron").start();
}
