# Cloud Run MCP server and Gemini CLI extension
Enable MCP-compatible AI agents to deploy apps to Cloud Run.

```json
"mcpServers":{
  "cloud-run": {
    "command": "npx",
    "args": ["-y", "@google-cloud/cloud-run-mcp"]
  }
}
```

Deploy from Gemini CLI and other AI-powered CLI agents:  

<img  src="https://raw.githubusercontent.com/GoogleCloudPlatform/cloud-run-mcp/refs/heads/main/.github/images/deploycli.gif" width="800">

Deploy from AI-powered IDEs:

<img src="https://raw.githubusercontent.com/GoogleCloudPlatform/cloud-run-mcp/refs/heads/main/.github/images/deploy_from_ide.gif" width="800">

Deploy from AI assistant apps:

<img src="https://raw.githubusercontent.com/GoogleCloudPlatform/cloud-run-mcp/refs/heads/main/.github/images/deploy_from_apps.gif" width="800">

Deploy from agent SDKs, like the [Google Gen AI SDK](https://ai.google.dev/gemini-api/docs/function-calling?example=meeting#use_model_context_protocol_mcp) or [Agent Development Kit](https://google.github.io/adk-docs/tools/mcp-tools/).

> [!NOTE]  
> This is the repository of an MCP server to deploy code to Cloud Run, to learn how to **host** MCP servers on Cloud Run, [visit the Cloud Run documentation](https://cloud.google.com/run/docs/host-mcp-servers).

## Tools

- `deploy-file-contents`: Deploys files to Cloud Run by providing their contents directly.
- `list-services`: Lists Cloud Run services in a given project and region.
- `get-service`: Gets details for a specific Cloud Run service.
- `get-service-log`: Gets Logs and Error Messages for a specific Cloud Run service.

- `deploy-local-folder`\*: Deploys a local folder to a Google Cloud Run service.
- `list-projects`\*: Lists available GCP projects.
- `create-project`\*: Creates a new GCP project and attach it to the first available billing account. A project ID can be optionally specified.

_\* only available when running locally_

## Prompts

Prompts are natural language commands that can be used to perform common tasks. They are shortcuts for executing tool calls with pre-filled arguments.

- `deploy`: Deploys the current working directory to Cloud Run. If a service name is not provided, it will use the `DEFAULT_SERVICE_NAME` environment variable, or the name of the current working directory.
- `logs`: Gets the logs for a Cloud Run service. If a service name is not provided, it will use the `DEFAULT_SERVICE_NAME` environment variable, or the name of the current working directory.


## Use as a Gemini CLI extension

To install this as a [Gemini CLI](https://github.com/google-gemini/gemini-cli) extension, run the following command:

2. Install the extension:

  ```bash
  gemini extensions install https://github.com/GoogleCloudPlatform/cloud-run-mcp
  ```

2. Log in to your Google Cloud account using the command:

   ```bash
   gcloud auth login
   ```

3. Set up application credentials using the command:
   ```bash
   gcloud auth application-default login
   ```


## Use as local MCP server

Run the Cloud Run MCP server on your local machine using local Google Cloud credentials. This is best if you are using an AI-assisted IDE (e.g. Cursor) or a desktop AI application (e.g. Claude).

1. Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) and authenticate with your Google account.

2. Log in to your Google Cloud account using the command:

   ```bash
   gcloud auth login
   ```

3. Set up application credentials using the command:
   ```bash
   gcloud auth application-default login
   ```

Then configure the MCP server using either Node.js or Docker:

### Using Node.js

0. Install [Node.js](https://nodejs.org/en/download/) (LTS version recommended).

1. Update the MCP configuration file of your MCP client with the following:

   ```json
      "cloud-run": {
        "command": "npx",
        "args": ["-y", "@google-cloud/cloud-run-mcp"]
      }
   ```

2. [Optional] Add default configurations

   ```json
      "cloud-run": {
         "command": "npx",
         "args": ["-y", "@google-cloud/cloud-run-mcp"],
         "env": {
               "GOOGLE_CLOUD_PROJECT": "PROJECT_NAME",
               "GOOGLE_CLOUD_REGION": "PROJECT_REGION",
               "DEFAULT_SERVICE_NAME": "SERVICE_NAME"
         }
      }
   ```

### Using Docker

See Docker's [MCP catalog](https://hub.docker.com/mcp/server/cloud-run-mcp/overview), or use these manual instructions:

0. Install [Docker](https://www.docker.com/get-started/)

1. Update the MCP configuration file of your MCP client with the following:

   ```json
      "cloud-run": {
        "command": "docker",
        "args": [
          "run",
          "-i",
          "--rm",
          "-e",
          "GOOGLE_APPLICATION_CREDENTIALS",
          "-v",
          "/local-directory:/local-directory",
          "mcp/cloud-run-mcp:latest"
        ],
        "env": {
          "GOOGLE_APPLICATION_CREDENTIALS": "/Users/slim/.config/gcloud/application_default-credentials.json",
          "DEFAULT_SERVICE_NAME": "SERVICE_NAME"
        }
      }
   ```

## Use as remote MCP server

> [!WARNING]  
> Do not use the remote MCP server without authentication. In the following instructions, we will use IAM authentication to secure the connection to the MCP server from your local machine. This is important to prevent unauthorized access to your Google Cloud resources.

Run the Cloud Run MCP server itself on Cloud Run with connection from your local machine authenticated via IAM.
With this option, you will only be able to deploy code to the same Google Cloud project as where the MCP server is running.

1. Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) and authenticate with your Google account.

2. Log in to your Google Cloud account using the command:

   ```bash
   gcloud auth login
   ```

3. Set your Google Cloud project ID using the command:
   ```bash
   gcloud config set project YOUR_PROJECT_ID
   ```
4. Deploy the Cloud Run MCP server to Cloud Run:

   ```bash
   gcloud run deploy cloud-run-mcp --image us-docker.pkg.dev/cloudrun/container/mcp --no-allow-unauthenticated
   ```

   When prompted, pick a region, for example `europe-west1`.

   Note that the MCP server is _not_ publicly accessible, it requires authentication via IAM.

5. [Optional] Add default configurations

   ```bash
   gcloud run services update cloud-run-mcp --region=REGION --update-env-vars GOOGLE_CLOUD_PROJECT=PROJECT_NAME,GOOGLE_CLOUD_REGION=PROJECT_REGION,DEFAULT_SERVICE_NAME=SERVICE_NAME,SKIP_IAM_CHECK=false
   ```

6. Run a Cloud Run proxy on your local machine to connect securely using your identity to the remote MCP server running on Cloud Run:

   ```bash
   gcloud run services proxy cloud-run-mcp --port=3000 --region=REGION --project=PROJECT_ID
   ```

   This will create a local proxy on port 3000 that forwards requests to the remote MCP server and injects your identity.

7. Update the MCP configuration file of your MCP client with the following:

   ```json
      "cloud-run": {
        "url": "http://localhost:3000/sse"
      }

   ```

   If your MCP client does not support the `url` attribute, you can use [mcp-remote](https://www.npmjs.com/package/mcp-remote):

   ```json
      "cloud-run": {
        "command": "npx",
        "args": ["-y", "mcp-remote", "http://localhost:3000/sse"]
      }
   ```
