---
name: cloud-run
description: 'Manage Cloud Run services and jobs.'
metadata:
  version: 0.1.0
  openclaw:
    category: 'compute'
    requires:
      bins:
        - gcloud
    cliHelp: 'gcloud run --help'
---

# run (v1)

> **PREREQUISITE:** Ensure you have the `gcloud` CLI installed and authenticated with `gcloud auth login`. Set your project with `gcloud config set project [PROJECT_ID]`.

```bash
gcloud run <resource> <method> [flags]
```

## Helper Commands

| Command  | Description                                  |
| -------- | -------------------------------------------- |
| `deploy` | Create or update a Cloud Run service or job. |

## API Resources

### services

- `list` — List available services in the specified region.
- `describe` — Obtain details about a given service, such as its URL and configuration.
- `update` — Update Cloud Run environment variables, concurrency settings, and other configuration.
- `delete` — Delete a service and its associated revisions.
- `update-traffic` — Adjust the traffic assignments for a Cloud Run service.
- `proxy` — Proxy a service to localhost authenticating as the active account.
- `logs read` — Read logs for a Cloud Run service.
- `replace` - Create or replace a service from a YAML service specification.
- `add-iam-policy-binding` — Add IAM policy binding to a Cloud Run service (e.g., to make it public).
- `remove-iam-policy-binding` - Remove IAM policy binding of a Cloud Run service.
- `get-iam-policy` - Get the IAM policy for a Cloud Run service.
- `set-iam-policy` - Set the IAM policy for a Cloud Run service.

### jobs

- `create` — Create a Cloud Run job.
- `execute` — Start an execution of a Cloud Run job.
- `list` — List available jobs.
- `describe` — Obtain details about a given job.
- `deploy` - Create or update a Cloud Run job
- `update` — Update a Cloud Run job configuration.
- `delete` — Delete a Cloud Run job.
- `replace` - Create or replace a Cloud Run job from a YAML job specification.
- `executions list` — List executions of a Cloud Run job.
- `logs read` — Read logs for a Cloud Run job.
- `add-iam-policy-binding` — Add IAM policy binding to a Cloud Run job.
- `remove-iam-policy-binding` - Remove IAM policy binding of a Cloud Run job.
- `get-iam-policy` - Get the IAM policy for a Cloud Run job.
- `set-iam-policy` - Set the IAM policy for a Cloud Run job.

### domain-mappings

- `list` — List domain mappings.
- `create` — Create a new domain mapping.
- `describe` — Obtain details about a domain mapping.
- `delete` — Delete a domain mapping.

### multi-region-services

- `list` — List multi-region services.
- `describe` — Obtain details about a multi-region service.
- `update` — Update settings for multi-region services.
- `delete` — Delete a multi-region service.
- `replace` - Create or Update multi-region service from YAML specification.

### revisions

- `list` — List available revisions for a service.
- `describe` — Obtain details about a specific revision.
- `delete` — Delete a specific revision.

### regions

- `list` — View available Cloud Run (fully managed) regions.

### compose

- `up` — Deploy to Cloud Run from a compose specification.

## Discovering Commands

Before calling any command, inspect it for help:

```bash
# Browse resources and methods
gcloud run --help

# Inspect a specific resource methods
gcloud run services --help

# Inspect a specific resource's sub-group methods
gcloud run jobs executions --help

# Inspect a method's specific flags and arguments
gcloud run deploy --help
```

Use the output of `--help` to discover available flags like `--image`, `--env-vars`, `--memory`, etc.
