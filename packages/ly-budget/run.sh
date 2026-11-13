#!/usr/bin/env bash
set -eo pipefail

# Only the CMS owns database migrations. The image is built with its schema;
# running Keystone's migration CLI with a read-only schema fails validation.
strategy="${ACCESS_CONTROL_STRATEGY:-cms}"
case "$strategy" in
  cms|gql|preview) ;;
  *)
    echo "ACCESS_CONTROL_STRATEGY must be cms, gql or preview" >&2
    exit 1
    ;;
esac

# Create mount directory for service
mkdir -p "$MNT_DIR"

echo "Mounting GCS Fuse."
gcsfuse --debug_gcs --debug_fuse "$GCS_BUCKET" "$MNT_DIR"
echo "Mounting completed."

# Public services start directly with their runtime read-only configuration.
if [ "$strategy" = cms ]; then
  yarn run db-migrate
fi

exec yarn start
