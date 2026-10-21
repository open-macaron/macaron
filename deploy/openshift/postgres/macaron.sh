# Sourced by the image's run-postgresql on every start (postgresql-start/*.sh), while the server
# listens on its local socket only. Idempotent.

# Bifrost's role and database. macaron (POSTGRESQL_USER) owns its database and is no superuser; PUBLIC
# loses CONNECT on both databases so neither role can open the other's.
psql --set ON_ERROR_STOP=1 --set=password="$BIFROST_DB_PASSWORD" >/dev/null <<'SQL'
SELECT 'CREATE ROLE bifrost LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bifrost')\gexec
ALTER ROLE bifrost WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'password';
SELECT 'CREATE DATABASE bifrost OWNER bifrost' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'bifrost')\gexec
REVOKE CONNECT ON DATABASE macaron FROM PUBLIC;
REVOKE CONNECT ON DATABASE bifrost FROM PUBLIC;
SQL

# The image lets every host in with md5, replication included. Network logins need TLS and scram;
# the superuser stays reachable only through the pod's local socket (oc exec).
sed -i -e 's/^host all all all md5$/hostssl all all all scram-sha-256/' -e '/^host replication all all md5$/d' "$PGDATA/pg_hba.conf"
